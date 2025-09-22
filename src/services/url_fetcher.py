# api/src/services/url_fetcher.py
import httpx
import time
import logging
from urllib.parse import urlparse, urljoin
from typing import Optional, Dict, Any, List
import re
from dataclasses import dataclass

logger = logging.getLogger(__name__)

@dataclass
class FetchResult:
    """Result of URL fetch operation"""
    success: bool
    final_url: str
    status_code: Optional[int] = None
    content_type: Optional[str] = None
    title: Optional[str] = None
    body_excerpt: Optional[str] = None
    error_reason: Optional[str] = None
    fetch_time_ms: int = 0
    redirect_count: int = 0
    was_blocked: bool = False

class URLFetcher:
    """
    Server-side URL fetching with staged timeouts and security guards.
    Follows the decisions from DECISIONS.md:
    - 2s DNS, 2s TLS, 3s first byte, 3s body (10s total)
    - Follow ≤3 redirects, block private IPs (SSRF guard)
    - Return domain-only verdict on timeout/block
    """
    
    def __init__(self):
        self.MAX_REDIRECTS = 3
        self.MAX_BODY_SIZE = 200 * 1024  # 200KB
        self.CONNECT_TIMEOUT = 2.0
        self.TLS_TIMEOUT = 2.0
        self.READ_TIMEOUT = 3.0
        self.TOTAL_TIMEOUT = 10.0
        
        # Private IP ranges to block (SSRF protection)
        self.PRIVATE_IP_PATTERNS = [
            r'^127\.',           # 127.0.0.0/8
            r'^10\.',            # 10.0.0.0/8
            r'^172\.(1[6-9]|2[0-9]|3[01])\.',  # 172.16.0.0/12
            r'^192\.168\.',      # 192.168.0.0/16
            r'^169\.254\.',      # 169.254.0.0/16 (link-local)
            r'^::1$',            # IPv6 localhost
            r'^fc00:',           # IPv6 private
        ]
        
    def _is_private_ip(self, host: str) -> bool:
        """Check if host resolves to private IP (basic SSRF protection)"""
        for pattern in self.PRIVATE_IP_PATTERNS:
            if re.match(pattern, host):
                return True
        return False
    
    def _is_valid_url(self, url: str) -> bool:
        """Validate URL scheme and basic structure"""
        try:
            parsed = urlparse(url)
            if parsed.scheme not in ('http', 'https'):
                return False
            if not parsed.netloc:
                return False
            if self._is_private_ip(parsed.hostname or ''):
                return False
            return True
        except Exception:
            return False
    
    def _extract_title(self, html_content: str) -> Optional[str]:
        """Extract page title from HTML content"""
        try:
            # Simple regex to extract title (good enough for MVP)
            title_match = re.search(r'<title[^>]*>(.*?)</title>', html_content, re.IGNORECASE | re.DOTALL)
            if title_match:
                title = title_match.group(1).strip()
                # Clean up whitespace and decode basic HTML entities
                title = re.sub(r'\s+', ' ', title)
                title = title.replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
                title = title.replace('&quot;', '"').replace('&#39;', "'")
                return title[:200]  # Limit title length
        except Exception as e:
            logger.warning(f"Error extracting title: {e}")
        return None
    
    def _extract_body_excerpt(self, html_content: str) -> str:
        """Extract first 1000 chars of meaningful text content"""
        try:
            # Remove script and style tags
            clean_content = re.sub(r'<script[^>]*?>.*?</script>', '', html_content, flags=re.IGNORECASE | re.DOTALL)
            clean_content = re.sub(r'<style[^>]*?>.*?</style>', '', clean_content, flags=re.IGNORECASE | re.DOTALL)
            
            # Remove HTML tags
            clean_content = re.sub(r'<[^>]+>', ' ', clean_content)
            
            # Normalize whitespace
            clean_content = re.sub(r'\s+', ' ', clean_content).strip()
            
            # Return first 1000 chars for analysis
            return clean_content[:1000]
        except Exception as e:
            logger.warning(f"Error extracting body excerpt: {e}")
            return ""
    
    async def fetch_url(self, url: str) -> FetchResult:
        """
        Fetch URL with staged timeouts and security checks.
        Returns FetchResult with success/failure info and extracted content.
        """
        start_time = time.time()
        
        # Validate URL first
        if not self._is_valid_url(url):
            return FetchResult(
                success=False,
                final_url=url,
                error_reason="invalid_url",
                fetch_time_ms=int((time.time() - start_time) * 1000)
            )
        
        redirect_count = 0
        current_url = url
        
        try:
            # Create timeout configuration for httpx 0.27.2
            # Format: Timeout(default, connect=X, read=Y, write=Z)
            timeout_config = httpx.Timeout(
                timeout=self.TOTAL_TIMEOUT,  # Default timeout
                connect=self.CONNECT_TIMEOUT,
                read=self.READ_TIMEOUT,
                write=self.TLS_TIMEOUT,
            )
            
            # Create client with staged timeouts
            async with httpx.AsyncClient(
                timeout=timeout_config,
                follow_redirects=False,  # Handle redirects manually
                headers={
                    'User-Agent': 'SafeSignal/1.0 (+https://safesignal.com/bot)',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5',
                    'Accept-Encoding': 'gzip, deflate',
                    'DNT': '1',
                    'Connection': 'keep-alive',
                }
            ) as client:
                
                # Follow redirects manually (up to MAX_REDIRECTS)
                while redirect_count <= self.MAX_REDIRECTS:
                    # Validate current URL
                    if not self._is_valid_url(current_url):
                        return FetchResult(
                            success=False,
                            final_url=current_url,
                            error_reason="blocked_by_ssrf",
                            fetch_time_ms=int((time.time() - start_time) * 1000),
                            redirect_count=redirect_count
                        )
                    
                    logger.info(f"Fetching URL (redirect {redirect_count}): {current_url}")
                    
                    try:
                        response = await client.get(current_url)
                    except httpx.TimeoutException as e:
                        timeout_stage = "unknown"
                        if "connect" in str(e).lower():
                            timeout_stage = "connect"
                        elif "read" in str(e).lower():
                            timeout_stage = "read"
                        
                        return FetchResult(
                            success=False,
                            final_url=current_url,
                            error_reason=f"fetch_timeout_stage_{timeout_stage}",
                            fetch_time_ms=int((time.time() - start_time) * 1000),
                            redirect_count=redirect_count
                        )
                    except Exception as e:
                        return FetchResult(
                            success=False,
                            final_url=current_url,
                            error_reason=f"fetch_error_{type(e).__name__}",
                            fetch_time_ms=int((time.time() - start_time) * 1000),
                            redirect_count=redirect_count
                        )
                    
                    # Check for blocking responses
                    if response.status_code in (403, 401, 451):
                        return FetchResult(
                            success=False,
                            final_url=current_url,
                            status_code=response.status_code,
                            error_reason="blocked_by_site",
                            fetch_time_ms=int((time.time() - start_time) * 1000),
                            redirect_count=redirect_count,
                            was_blocked=True
                        )
                    
                    # Check for rate limiting
                    if response.status_code == 429:
                        return FetchResult(
                            success=False,
                            final_url=current_url,
                            status_code=response.status_code,
                            error_reason="rate_limited",
                            fetch_time_ms=int((time.time() - start_time) * 1000),
                            redirect_count=redirect_count,
                            was_blocked=True
                        )
                    
                    # Handle redirects
                    if response.status_code in (301, 302, 303, 307, 308):
                        location = response.headers.get('Location')
                        if not location:
                            break
                        
                        # Convert relative to absolute URL
                        current_url = urljoin(current_url, location)
                        redirect_count += 1
                        
                        if redirect_count > self.MAX_REDIRECTS:
                            return FetchResult(
                                success=False,
                                final_url=current_url,
                                error_reason="too_many_redirects",
                                fetch_time_ms=int((time.time() - start_time) * 1000),
                                redirect_count=redirect_count
                            )
                        
                        continue  # Follow redirect
                    
                    # Success case - got final response
                    if response.status_code == 200:
                        content_type = response.headers.get('content-type', '').lower()
                        
                        # Only process HTML content
                        if 'text/html' not in content_type:
                            return FetchResult(
                                success=False,
                                final_url=current_url,
                                status_code=response.status_code,
                                content_type=content_type,
                                error_reason="not_html",
                                fetch_time_ms=int((time.time() - start_time) * 1000),
                                redirect_count=redirect_count
                            )
                        
                        # Read content with size limit
                        try:
                            content_bytes = b""
                            async for chunk in response.aiter_bytes():
                                content_bytes += chunk
                                if len(content_bytes) > self.MAX_BODY_SIZE:
                                    content_bytes = content_bytes[:self.MAX_BODY_SIZE]
                                    break
                            
                            html_content = content_bytes.decode('utf-8', errors='ignore')
                            
                        except Exception as e:
                            return FetchResult(
                                success=False,
                                final_url=current_url,
                                status_code=response.status_code,
                                content_type=content_type,
                                error_reason=f"content_decode_error_{type(e).__name__}",
                                fetch_time_ms=int((time.time() - start_time) * 1000),
                                redirect_count=redirect_count
                            )
                        
                        # Extract title and body excerpt
                        title = self._extract_title(html_content)
                        body_excerpt = self._extract_body_excerpt(html_content)
                        
                        return FetchResult(
                            success=True,
                            final_url=current_url,
                            status_code=response.status_code,
                            content_type=content_type,
                            title=title,
                            body_excerpt=body_excerpt,
                            fetch_time_ms=int((time.time() - start_time) * 1000),
                            redirect_count=redirect_count
                        )
                    
                    # Other status codes
                    else:
                        return FetchResult(
                            success=False,
                            final_url=current_url,
                            status_code=response.status_code,
                            error_reason=f"http_error_{response.status_code}",
                            fetch_time_ms=int((time.time() - start_time) * 1000),
                            redirect_count=redirect_count
                        )
                
                # If we get here, we've exhausted redirects
                return FetchResult(
                    success=False,
                    final_url=current_url,
                    error_reason="redirect_loop",
                    fetch_time_ms=int((time.time() - start_time) * 1000),
                    redirect_count=redirect_count
                )
        
        except Exception as e:
            logger.error(f"Unexpected error fetching URL {url}: {e}")
            return FetchResult(
                success=False,
                final_url=current_url,
                error_reason=f"unexpected_error_{type(e).__name__}",
                fetch_time_ms=int((time.time() - start_time) * 1000),
                redirect_count=redirect_count
            )