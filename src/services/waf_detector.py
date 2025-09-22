# api/src/services/waf_detector.py
import re
from typing import Dict, Any, Optional
import logging

logger = logging.getLogger(__name__)

class WAFDetector:
    """
    Detects WAF/anti-bot pages and blocking responses.
    Used to identify when sites are blocking our fetch attempts.
    """
    
    def __init__(self):
        # Common WAF/challenge page indicators
        self.WAF_INDICATORS = [
            # Cloudflare
            'cloudflare', 'cf-ray', 'checking your browser', 'ddos protection',
            'please wait while we check', 'security check', 'ray id',
            
            # Other WAFs
            'incapsula', 'imperva', 'access denied', 'blocked by administrator',
            'your request has been blocked', 'suspicious activity detected',
            'bot protection', 'anti-bot', 'human verification required',
            
            # CAPTCHA systems
            'recaptcha', 'hcaptcha', 'solve the captcha', 'verify you are human',
            'prove you are not a robot', 'security verification',
            
            # Generic blocking messages
            '403 forbidden', 'access forbidden', 'request blocked',
            'firewall protection', 'web application firewall',
        ]
        
        # Patterns for challenge pages
        self.CHALLENGE_PATTERNS = [
            r'window\.location\.href\s*=\s*["\'].*["\']',  # JavaScript redirects
            r'document\.cookie\s*=',                        # Cookie setting
            r'setTimeout\s*\(\s*function',                  # Delayed redirects
            r'please\s+enable\s+javascript',                # JS requirement
            r'browser\s+check\s+in\s+progress',            # Browser checks
        ]
    
    def detect_waf_response(self, html_content: str, status_code: int = 200) -> Dict[str, Any]:
        """
        Analyze HTML content to detect WAF/blocking responses.
        
        Returns:
        {
            'is_waf_page': bool,
            'waf_type': str or None,
            'confidence': float,  # 0.0 to 1.0
            'indicators': list,
            'is_challenge_page': bool
        }
        """
        try:
            if not html_content:
                return {
                    'is_waf_page': False,
                    'waf_type': None,
                    'confidence': 0.0,
                    'indicators': [],
                    'is_challenge_page': False
                }
            
            content_lower = html_content.lower()
            found_indicators = []
            waf_type = None
            confidence = 0.0
            
            # Check for WAF indicators
            for indicator in self.WAF_INDICATORS:
                if indicator in content_lower:
                    found_indicators.append(indicator)
                    
                    # Determine WAF type
                    if 'cloudflare' in indicator or 'cf-ray' in indicator:
                        waf_type = 'cloudflare'
                        confidence += 0.3
                    elif 'incapsula' in indicator or 'imperva' in indicator:
                        waf_type = 'incapsula'
                        confidence += 0.3
                    elif 'captcha' in indicator:
                        waf_type = 'captcha'
                        confidence += 0.2
                    else:
                        confidence += 0.1
            
            # Check for challenge page patterns
            challenge_patterns_found = []
            for pattern in self.CHALLENGE_PATTERNS:
                if re.search(pattern, html_content, re.IGNORECASE):
                    challenge_patterns_found.append(pattern)
                    confidence += 0.15
            
            is_challenge_page = len(challenge_patterns_found) > 0
            
            # Additional heuristics
            content_length = len(html_content)
            
            # Very short pages with blocking keywords
            if content_length < 2000 and any(indicator in content_lower for indicator in 
                ['access denied', 'blocked', 'forbidden', 'not authorized']):
                confidence += 0.2
            
            # Pages with minimal content but security keywords
            if content_length < 5000 and any(keyword in content_lower for keyword in 
                ['security', 'protection', 'verification', 'checking']):
                confidence += 0.1
            
            # Suspicious status codes
            if status_code in [403, 406, 429, 503]:
                confidence += 0.2
                found_indicators.append(f'http_{status_code}')
            
            # Meta refresh redirects (common in challenge pages)
            if re.search(r'<meta[^>]*http-equiv\s*=\s*["\']refresh["\']', content_lower):
                confidence += 0.15
                found_indicators.append('meta_refresh')
            
            # JavaScript-heavy pages with minimal visible content
            js_matches = len(re.findall(r'<script', content_lower))
            visible_text = re.sub(r'<[^>]+>', ' ', html_content)
            visible_text = re.sub(r'\s+', ' ', visible_text).strip()
            
            if js_matches > 3 and len(visible_text) < 500:
                confidence += 0.1
                found_indicators.append('js_heavy_minimal_content')
            
            # Cap confidence at 1.0
            confidence = min(confidence, 1.0)
            
            # Determine if it's a WAF page (threshold)
            is_waf_page = confidence >= 0.3 or len(found_indicators) >= 2
            
            return {
                'is_waf_page': is_waf_page,
                'waf_type': waf_type,
                'confidence': confidence,
                'indicators': found_indicators,
                'is_challenge_page': is_challenge_page,
                'challenge_patterns': challenge_patterns_found
            }
            
        except Exception as e:
            logger.warning(f"Error detecting WAF response: {e}")
            return {
                'is_waf_page': False,
                'waf_type': None,
                'confidence': 0.0,
                'indicators': [],
                'is_challenge_page': False
            }
    
    def is_blocked_response(self, fetch_result) -> bool:
        """
        Determine if a fetch result indicates the site is blocking us.
        Used to trigger domain-only analysis mode.
        """
        try:
            # Explicit blocking status codes
            if fetch_result.status_code in [403, 401, 451, 429]:
                return True
            
            # Check if it was marked as blocked during fetch
            if fetch_result.was_blocked:
                return True
            
            # If we got HTML content, check for WAF indicators
            if fetch_result.success and fetch_result.body_excerpt:
                waf_analysis = self.detect_waf_response(
                    fetch_result.body_excerpt, 
                    fetch_result.status_code
                )
                
                # High confidence WAF detection = blocked
                if waf_analysis['confidence'] >= 0.5:
                    return True
                
                # Multiple WAF indicators = likely blocked
                if len(waf_analysis['indicators']) >= 3:
                    return True
            
            return False
            
        except Exception as e:
            logger.warning(f"Error checking if response is blocked: {e}")
            return False