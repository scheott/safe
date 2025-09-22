# api/src/services/url_normalizer.py
import re
from urllib.parse import urlparse, parse_qs, urlencode, urlunparse
from typing import Optional, Dict, Any
import idna
import logging

logger = logging.getLogger(__name__)

class URLNormalizer:
    """
    URL normalization and processing utilities.
    Handles tracking parameter removal, punycode detection, etc.
    """
    
    def __init__(self):
        # Tracking parameters to strip
        self.TRACKING_PARAMS = {
            # UTM parameters
            'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
            'utm_id', 'utm_campaign_id', 'utm_content_id',
            
            # Facebook
            'fbclid', 'fb_action_ids', 'fb_action_types', 'fb_ref', 'fb_source',
            
            # Google
            'gclid', 'gclsrc', 'gcl_au', 'gac_ua', 'gac_gac',
            
            # Microsoft
            'msclkid', 'mc_cid', 'mc_eid',
            
            # Other common tracking
            'zanpid', '_hsenc', '_hsmi', 'hsCtaTracking', 'hsa_acc', 'hsa_cam',
            'hsa_grp', 'hsa_ad', 'hsa_src', 'hsa_tgt', 'hsa_kw', 'hsa_mt',
            'hsa_net', 'hsa_ver', '__s', 'vero_id', 'vero_conv',
            
            # Email marketing
            'mkt_tok', 'trk_contact', 'trk_msg', 'trk_module', 'trk_sid',
            
            # Analytics/session tracking patterns
            '_ga', '_gid', '_gac_', '_gtm_', '_dc_gtm_',
            
            # Cache busting / versioning (common patterns)
            'v', 'ver', 'version', 'cache', 'cb', 'cachebuster',
            't', 'ts', 'timestamp', '_t', '_ts', '_time',
            'r', 'rnd', 'random', '_r', '_rnd', '_random',
            'nonce', '_nonce', 'sig', '_sig', '_signature',
        }
        
        # Session-like parameter patterns (regex)
        self.SESSION_PATTERNS = [
            r'.*_ts$',      # ends with _ts
            r'.*_time$',    # ends with _time  
            r'.*_rnd$',     # ends with _rnd
            r'.*_nonce$',   # ends with _nonce
            r'.*_sig$',     # ends with _sig
            r'.*_cache$',   # ends with _cache
            r'.*_v$',       # ends with _v
        ]
    
    def _strip_tracking_params(self, url: str) -> str:
        """Remove known tracking parameters from URL"""
        try:
            parsed = urlparse(url)
            if not parsed.query:
                return url
            
            # Parse query parameters
            params = parse_qs(parsed.query, keep_blank_values=True)
            
            # Filter out tracking parameters
            clean_params = {}
            for key, values in params.items():
                # Skip known tracking params
                if key.lower() in self.TRACKING_PARAMS:
                    continue
                
                # Skip session-like patterns
                if any(re.match(pattern, key.lower()) for pattern in self.SESSION_PATTERNS):
                    continue
                
                # Keep parameter
                clean_params[key] = values
            
            # Rebuild query string with remaining parameters (sorted for consistency)
            if clean_params:
                # Sort keys for consistent URLs
                sorted_params = []
                for key in sorted(clean_params.keys()):
                    for value in clean_params[key]:
                        sorted_params.append((key, value))
                
                clean_query = urlencode(sorted_params, doseq=True)
                clean_parsed = parsed._replace(query=clean_query)
            else:
                clean_parsed = parsed._replace(query='')
            
            return urlunparse(clean_parsed)
            
        except Exception as e:
            logger.warning(f"Error stripping tracking params from {url}: {e}")
            return url
    
    def _normalize_path(self, url: str) -> str:
        """Normalize URL path (collapse slashes, remove trailing slash)"""
        try:
            parsed = urlparse(url)
            
            # Collapse multiple slashes
            normalized_path = re.sub(r'/+', '/', parsed.path)
            
            # Remove trailing slash (except for root)
            if len(normalized_path) > 1 and normalized_path.endswith('/'):
                normalized_path = normalized_path[:-1]
            
            # Handle empty path
            if not normalized_path:
                normalized_path = '/'
            
            clean_parsed = parsed._replace(path=normalized_path)
            return urlunparse(clean_parsed)
            
        except Exception as e:
            logger.warning(f"Error normalizing path for {url}: {e}")
            return url
    
    def _detect_punycode(self, hostname: str) -> Dict[str, Any]:
        """
        Detect punycode/IDN in hostname and decode for analysis.
        Returns info about potential homograph attacks.
        """
        try:
            # Check if hostname contains punycode (xn--)
            has_punycode = 'xn--' in hostname.lower()
            
            decoded_hostname = hostname
            if has_punycode:
                try:
                    # Decode punycode to Unicode
                    decoded_hostname = idna.decode(hostname)
                except (idna.core.IDNAError, UnicodeError):
                    # If decoding fails, keep original
                    decoded_hostname = hostname
            
            # Check for suspicious characters that might be homographs
            suspicious_chars = []
            if decoded_hostname != hostname:
                # Look for potentially confusing Unicode characters
                for char in decoded_hostname:
                    if ord(char) > 127:  # Non-ASCII
                        # Common homograph characters
                        if char in 'а е о р с х у і ї є':  # Cyrillic that looks like Latin
                            suspicious_chars.append(char)
            
            return {
                'has_punycode': has_punycode,
                'original_hostname': hostname,
                'decoded_hostname': decoded_hostname,
                'suspicious_chars': suspicious_chars,
                'is_suspicious': len(suspicious_chars) > 0
            }
            
        except Exception as e:
            logger.warning(f"Error analyzing punycode for {hostname}: {e}")
            return {
                'has_punycode': False,
                'original_hostname': hostname,
                'decoded_hostname': hostname,
                'suspicious_chars': [],
                'is_suspicious': False
            }
    
    def normalize_url(self, url: str) -> Dict[str, Any]:
        """
        Normalize URL and return analysis info.
        
        Returns:
        {
            'normalized_url': str,
            'original_url': str,
            'domain': str,
            'punycode_info': dict,
            'removed_params': list,
            'has_fragment': bool
        }
        """
        try:
            original_url = url.strip()
            
            # Parse URL
            parsed = urlparse(original_url)
            
            # Lowercase scheme and hostname
            scheme = parsed.scheme.lower()
            hostname = parsed.hostname.lower() if parsed.hostname else ''
            port = parsed.port
            
            # Handle port normalization (remove default ports)
            if (scheme == 'http' and port == 80) or (scheme == 'https' and port == 443):
                netloc = hostname
            elif port:
                netloc = f"{hostname}:{port}"
            else:
                netloc = hostname
            
            # Start with normalized netloc
            normalized_parsed = parsed._replace(scheme=scheme, netloc=netloc)
            normalized_url = urlunparse(normalized_parsed)
            
            # Strip tracking parameters
            params_before = len(parse_qs(parsed.query)) if parsed.query else 0
            normalized_url = self._strip_tracking_params(normalized_url)
            params_after = len(parse_qs(urlparse(normalized_url).query)) if urlparse(normalized_url).query else 0
            removed_params_count = params_before - params_after
            
            # Normalize path
            normalized_url = self._normalize_path(normalized_url)
            
            # Analyze punycode
            punycode_info = self._detect_punycode(hostname) if hostname else {}
            
            # Final parse for analysis
            final_parsed = urlparse(normalized_url)
            
            return {
                'normalized_url': normalized_url,
                'original_url': original_url,
                'domain': hostname,
                'subdomain': hostname.split('.')[0] if '.' in hostname else '',
                'tld': hostname.split('.')[-1] if '.' in hostname else '',
                'path': final_parsed.path,
                'query': final_parsed.query,
                'fragment': final_parsed.fragment,
                'punycode_info': punycode_info,
                'removed_params_count': removed_params_count,
                'has_fragment': bool(final_parsed.fragment),
                'has_query': bool(final_parsed.query),
                'is_suspicious_tld': self._is_suspicious_tld(hostname.split('.')[-1] if '.' in hostname else ''),
            }
            
        except Exception as e:
            logger.error(f"Error normalizing URL {url}: {e}")
            return {
                'normalized_url': url,
                'original_url': url,
                'domain': '',
                'subdomain': '',
                'tld': '',
                'path': '',
                'query': '',
                'fragment': '',
                'punycode_info': {},
                'removed_params_count': 0,
                'has_fragment': False,
                'has_query': False,
                'is_suspicious_tld': False,
            }
    
    def _is_suspicious_tld(self, tld: str) -> bool:
        """Check if TLD is commonly used for suspicious sites"""
        # Common suspicious TLDs (can be refined based on data)
        suspicious_tlds = {
            'tk', 'ml', 'ga', 'cf',  # Free domains
            'bit', 'onion',           # Special cases
        }
        return tld.lower() in suspicious_tlds