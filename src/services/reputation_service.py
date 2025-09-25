# api/src/services/reputation_service.py
# Complete drag-and-drop version with production-ready brand similarity detection

import json
import logging
import re
import unicodedata
from pathlib import Path
from typing import Dict, Any, Optional, List, Set
import time
from urllib.parse import urlparse


logger = logging.getLogger(__name__)

class ReputationService:
    """
    File-based reputation service for SafeSignal.
    Loads domain reputation, brand data, and heuristic patterns from JSON files.
    Designed for fast in-memory lookups with hot-reload capability.
    """
    
    def __init__(self, data_dir: str = None):
        # Auto-detect data directory
        if data_dir is None:
            possible_dirs = ["data", "api/data"]
            for check_dir in possible_dirs:
                if Path(check_dir).exists():
                    data_dir = check_dir
                    break
            if data_dir is None:
                data_dir = "data"  # Default, will be created if needed
        
        self.data_dir = Path(data_dir)
        self.last_reload = 0
        self.reload_interval = 300  # 5 minutes
        
        # Data containers
        self.reputable_domains: Dict[str, Dict] = {}
        self.brand_categories: Dict[str, List[str]] = {}
        self.suspicious_indicators: Dict[str, Any] = {}
        self.heuristic_weights: Dict[str, Any] = {}
        
        # Processed data for fast lookups
        self.domain_scores: Dict[str, int] = {}
        self.brand_domains: Set[str] = set()
        self.suspicious_tlds: Set[str] = set()
        
        # Production-ready brand similarity attributes
        self.dictionary_word_brands = {
            'apple', 'target', 'chase', 'gap', 'shell', 'square', 'mint', 
            'ally', 'discover', 'capital', 'virgin', 'orange', 'sprint'
        }
        
        self.multi_part_tlds = {
            'co.uk', 'com.au', 'co.jp', 'co.nz', 'com.br', 'co.za', 
            'com.mx', 'co.in', 'com.sg', 'co.kr', 'com.tw', 'co.th'
        }
        
        self.impersonation_keywords = {
            'support', 'login', 'verify', 'secure', 'update', 'help', 'billing',
            'account', 'portal', 'pay', 'wallet', 'signin', 'auth', 'security',
            'service', 'customer', 'official', 'online', 'access'
        }
        
        # Load initial data
        self.load_all_data()
    
    def load_all_data(self) -> bool:
        """Load all reputation data from files"""
        try:
            start_time = time.time()
            
            # Load main data files
            self._load_reputable_domains()
            self._load_brand_domains() 
            self._load_suspicious_indicators()
            self._load_heuristic_weights()
            
            # Process data for fast lookups
            self._build_lookup_caches()
            
            self.last_reload = time.time()
            load_time = (time.time() - start_time) * 1000
            
            logger.info(f"Reputation data loaded in {load_time:.1f}ms")
            logger.info(f"Loaded {len(self.domain_scores)} domain scores, "
                       f"{len(self.brand_domains)} brand domains")
            
            return True
            
        except Exception as e:
            logger.error(f"Failed to load reputation data: {e}")
            return False
    
    def _load_reputable_domains(self):
        """Load reputable domains list"""
        file_path = self.data_dir / "reputable_domains.json"
        
        if not file_path.exists():
            logger.warning(f"Reputable domains file not found: {file_path}")
            self.reputable_domains = {}
            return
        
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            self.reputable_domains = data.get('domains', {})
        
        logger.info(f"Loaded {len(self.reputable_domains)} reputable domains")
    
    def _load_brand_domains(self):
        """Load brand domains for look-alike detection"""
        file_path = self.data_dir / "brand_domains.json"
        
        if not file_path.exists():
            logger.warning(f"Brand domains file not found: {file_path}")
            self.brand_categories = {}
            return
        
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            self.brand_categories = data.get('categories', {})
        
        total_brands = sum(len(brands) for brands in self.brand_categories.values())
        logger.info(f"Loaded {total_brands} brand domains across {len(self.brand_categories)} categories")
    
    def _load_suspicious_indicators(self):
        """Load suspicious indicators and patterns"""
        file_path = self.data_dir / "suspicious_indicators.json"
        
        if not file_path.exists():
            logger.warning(f"Suspicious indicators file not found: {file_path}")
            self.suspicious_indicators = {}
            return
        
        with open(file_path, 'r', encoding='utf-8') as f:
            self.suspicious_indicators = json.load(f)
            
        logger.info("Loaded suspicious indicators and patterns")
    
    def _load_heuristic_weights(self):
        """Load heuristic weights for scoring"""
        file_path = self.data_dir / "heuristic_weights.json"
        
        if not file_path.exists():
            logger.warning(f"Heuristic weights file not found: {file_path}")
            self.heuristic_weights = {}
            return
        
        with open(file_path, 'r', encoding='utf-8') as f:
            self.heuristic_weights = json.load(f)
            
        logger.info("Loaded heuristic weights and patterns")
    
    def _build_lookup_caches(self):
        """Build optimized lookup caches from loaded data"""
        # Build domain scores lookup
        self.domain_scores = {}
        
        for domain, info in self.reputable_domains.items():
            score = info.get('score', 0)
            self.domain_scores[domain.lower()] = score
        
        # Build brand domains set
        self.brand_domains = set()
        for category, domains in self.brand_categories.items():
            for domain in domains:
                self.brand_domains.add(domain.lower())
        
        # Build suspicious TLDs set
        self.suspicious_tlds = set()
        suspicious_data = self.suspicious_indicators.get('suspicious_tlds', {})
        
        for risk_level in ['high_risk', 'medium_risk']:
            if risk_level in suspicious_data:
                for tld in suspicious_data[risk_level]:
                    # Remove leading dot if present
                    clean_tld = tld.lstrip('.')
                    self.suspicious_tlds.add(clean_tld.lower())
    
    def get_domain_score(self, domain: str) -> int:
        """Get reputation score for a domain using processed cache."""
        if not domain:
            return 0
        
        d = domain.lower()
        if d.startswith('www.'):
            d = d[4:]
        
        # direct lookup
        if d in self.domain_scores:
            return self.domain_scores[d]
        
        # parent domain
        parts = d.split('.')
        if len(parts) > 2:
            parent = '.'.join(parts[-2:])
            if parent in self.domain_scores:
                return self.domain_scores[parent]
        
        # tld risk
        tld = parts[-1]
        if tld in self.suspicious_tlds:
            return 2
        
        return 0
    
    def is_brand_domain(self, domain: str) -> bool:
        """Check if domain is a known brand (for look-alike detection)"""
        normalized_domain = domain.lower()
        if normalized_domain.startswith('www.'):
            normalized_domain = normalized_domain[4:]
        
        return normalized_domain in self.brand_domains
    
    def _confusable_exact(self, raw_label: str, brand_name: str, norm_label: str, norm_brand: str) -> bool:
        """Check if raw differs from brand but normalized equals brand (confusable substitution)"""
        return (raw_label.lower() != brand_name.lower()) and (norm_label == norm_brand)
    
    def find_similar_brands(self, domain: str, max_distance: int = 2) -> List[Dict[str, Any]]:
        """
        Production-ready brand similarity detection with comprehensive fixes.
        Addresses homoglyph normalization, prefilters, and check ordering.
        """
        if not domain:
            return []
        
        # Extract eTLD+1 using improved method
        etld1 = self._extract_etld1_robust(domain)
        if not etld1:
            return []
        
        # FIX 1: Parse once to get a raw-cased label for confusable mapping
        try:
            url = domain if domain.startswith(('http://','https://')) else 'http://' + domain
            p = urlparse(url)
            netloc = p.netloc or domain
        except Exception:
            netloc = domain
        netloc = netloc.split('@')[-1].split(':')[0]                 # strip creds/port
        host_raw = re.sub(r'^www\.', '', netloc, flags=re.IGNORECASE)
        label_raw = host_raw.split('.')[0]                           # <-- PRESERVE CASE
        
        # keep using robust eTLD+1 (lowercased) for the rest
        tld = '.'.join(etld1.split('.')[1:])
        
        # normalize with confusable map (will catch PayPaI → paypal)
        norm = self._normalize_label_robust(label_raw)
        slim = norm.replace('-', '')  # For edit distance (hyphenless)
        
        # NEW: letters-only tokens (drops digits) - this fixes google123login
        tokens = set(re.findall(r'[a-z]+', norm))  # NOTE: letters-only tokens (drops digits)
        
        # Check TLD suspiciousness
        suspicious_tld = self._is_suspicious_tld(tld.split('.')[-1])
        
        # Extract path for additional context
        path_flags = self._extract_path_flags(domain)
        
        hits = []
        
        for brand_domain in self.brand_domains:
            brand_name = brand_domain.split('.')[0]
            brand_meta = self._get_brand_metadata(brand_domain)
            
            # Skip if this eTLD+1 is literally the brand domain (official base)
            if etld1 == brand_domain:
                continue
            
            # Skip if this eTLD+1 is an official domain
            if etld1 in brand_meta.get('official_domains', set()):
                continue
            
            brand_norm = self._normalize_label_robust(brand_name)  # Normalize brand too
            
            # BRANCH 1: Confusable-exact → treat as lookalike (e.g., appl3 → apple)
            if self._confusable_exact(label_raw, brand_name, norm, brand_norm):
                distance = 1  # conceptual distance for confusable
                confidence = 0.85 + (0.05 if suspicious_tld else 0)
                hits.append(self._create_match_result(
                    brand_domain, 'lookalike', distance, confidence, etld1, tld,
                    {
                        'similarity_type': 'confusable_substitution',
                        'path_flags': path_flags,
                        'slim_comparison': f"{slim} vs {brand_norm}"
                    }
                ))
                continue

            # BRANCH 1b: Exact match on a different eTLD+1 (true brand label equal, but not same domain)
            if norm == brand_norm and etld1 != brand_domain:
                # dictionary-word brands need extra signals (or suspicious TLD)
                if self._is_dictionary_word_brand(brand_norm) and not (suspicious_tld or self._has_impersonation_signals(tokens, path_flags)):
                    continue  # do not match
                else:
                    hits.append(self._create_match_result(
                        brand_domain, 'exact_match_different_tld', 0,
                        0.95 + (0.03 if suspicious_tld else 0), etld1, tld,
                        {'normalized_domain': norm, 'normalized_brand': brand_norm, 'path_flags': path_flags}
                    ))
                    continue
            
            # BRANCH 2: Brand + keywords (check before lookalike)
            if self._contains_brand_with_keywords(tokens, brand_norm):
                match_type = 'brand_with_keywords'
                confidence = 0.9 + (0.05 if suspicious_tld else 0)
                hits.append(self._create_match_result(
                    brand_domain, match_type, 0, confidence, etld1, tld,
                    {
                        'keywords_found': list(tokens & self.impersonation_keywords),
                        'path_flags': path_flags
                    }
                ))
                continue
            
            # BRANCH 3: Lookalike (edit distance)
            if len(slim) >= 3 and len(brand_norm) >= 3:
                # Strengthen prefilters (fix amaz0n.tk → Capital One, kill 123456.tk)
                
                # Letters-only guard (avoid numeric/garbage)
                letters_in_slim = [c for c in slim if c.isalpha()]
                if len(letters_in_slim) < 3:
                    continue

                # Character-overlap guard
                char_overlap = len(set(slim) & set(brand_norm))
                min_overlap = max(3, int(0.4 * len(brand_norm)))
                if char_overlap < min_overlap:
                    continue

                # FIX 2: First/last letter guard (OR, not AND)
                if len(slim) >= 3 and len(brand_norm) >= 3:
                    ends_match = (slim[0] == brand_norm[0]) or (slim[-1] == brand_norm[-1])
                    if not ends_match:
                        continue
                
                distance = self._levenshtein_distance(slim, brand_norm)
                threshold = self._get_distance_threshold(brand_norm, suspicious_tld)
                
                # length delta guard helps avoid unrelated matches
                if abs(len(slim) - len(brand_norm)) > threshold + 2:
                    continue
                
                if 0 < distance <= threshold:
                    match_type = 'lookalike'
                    base_confidence = 0.75 + 0.05 * (threshold - distance)
                    
                    # Path-based boost for auth paths
                    if path_flags.get('has_auth_path'):
                        base_confidence += 0.1
                    
                    # For dictionary words, require extra signals
                    if self._is_dictionary_word_brand(brand_norm):
                        if not (suspicious_tld or self._has_impersonation_signals(tokens, path_flags)):
                            continue
                    
                    hits.append(self._create_match_result(
                        brand_domain, match_type, distance, base_confidence, etld1, tld,
                        {
                            'similarity_type': self._classify_similarity_type(slim, brand_norm),
                            'path_flags': path_flags,
                            'char_overlap': char_overlap,
                            'slim_comparison': f"{slim} vs {brand_norm}",
                            'letters_count': len(letters_in_slim)
                        }
                    ))

        
        # Sort by distance, then confidence (descending)
        hits.sort(key=lambda r: (r['distance'], -r['confidence']))
        return hits[:3]

    def get_brand_similarity_score(self, domain: str) -> Dict[str, Any]:
        """
        Enhanced brand similarity scoring with path-based escalation.
        Returns score, reasons, and details for Tier-0 integration.
        """
        similar_brands = self.find_similar_brands(domain)
        
        if not similar_brands:
            return {
                'score': 0,
                'reasons': [],
                'details': {}
            }
        
        # Take the highest-confidence match
        best_match = similar_brands[0]
        match_type = best_match['type']
        brand_domain = best_match['brand_domain']
        confidence = best_match['confidence']
        tld = best_match['tld']
        path_flags = best_match['metadata'].get('path_flags', {})
        
        # Base scoring by match type
        if match_type == 'exact_match_different_tld':
            if self._is_suspicious_tld(tld.split('.')[-1]):
                base_score = 4  # DANGER
                reasons = ['brand_impersonation_high_risk', 'suspicious_domain']
            else:
                base_score = 2  # WARNING  
                reasons = ['brand_impersonation', 'different_tld']
                
        elif match_type == 'brand_with_keywords':
            keywords = best_match['metadata'].get('keywords_found', [])
            if self._is_suspicious_tld(tld.split('.')[-1]):
                base_score = 4  # DANGER
                reasons = ['brand_impersonation_high_risk', 'impersonation_keywords', 'suspicious_domain']
            else:
                base_score = 2  # WARNING
                reasons = ['brand_impersonation', 'impersonation_keywords']
                
        elif match_type == 'lookalike':
            similarity_type = best_match['metadata'].get('similarity_type', 'unknown')
            
            # Base score for lookalikes
            if self._is_suspicious_tld(tld.split('.')[-1]):
                base_score = 3  # WARNING+ (will escalate to DANGER with path)
                reasons = ['brand_similarity', 'suspicious_domain', 'lookalike_domain']
            else:
                base_score = 2  # WARNING
                reasons = ['brand_similarity', 'lookalike_domain']
            
            # Add similarity-specific reason
            if similarity_type == 'confusable_substitution':
                reasons.append('homoglyph_substitution')
        else:
            base_score = 1
            reasons = ['brand_similarity']
        
        # FIX 3: Path-based escalation for auth paths
        if path_flags.get('has_auth_path') and match_type == 'lookalike':
            base_score += 2
            reasons.append('auth_path')
            logger.info(f"Path escalation: {domain} boosted by auth path")
        
        # Cap at 4 (DANGER level)
        final_score = min(base_score, 4)
        
        return {
            'score': final_score,
            'reasons': reasons,
            'details': {
                'brand': brand_domain.split('.')[0],
                'type': match_type,
                'confidence': confidence,
                'tld': tld,
                'similarity_type': best_match['metadata'].get('similarity_type'),
                'path_flags': path_flags,
                'all_matches': len(similar_brands)
            }
        }

        # SUPPORTING METHODS FOR BRAND SIMILARITY (FIXED VERSIONS)
    def _extract_etld1_robust(self, domain: str) -> str:
        """
        FIXED: Robust eTLD+1 extraction with proper subdomain handling.
        This fixes the official subdomain false positive issues.
        """
        if not domain:
            return ""
        
        # Parse URL to get hostname
        try:
            if not domain.startswith(('http://', 'https://')):
                domain = 'http://' + domain
            parsed = urlparse(domain)
            hostname = parsed.hostname or domain.replace('http://', '').replace('https://', '')
        except:
            hostname = domain.replace('http://', '').replace('https://', '')
        
        # Normalize
        hostname = hostname.lower().strip()
        if hostname.startswith('www.'):
            hostname = hostname[4:]
        
        parts = hostname.split('.')
        if len(parts) < 2:
            return hostname
        
        # FIX 2: Enhanced multi-part TLD detection with comprehensive list
        comprehensive_multi_tlds = {
            'co.uk', 'com.au', 'co.jp', 'co.nz', 'com.br', 'co.za',
            'com.mx', 'co.in', 'com.sg', 'co.kr', 'com.tw', 'co.th',
            'com.ar', 'com.co', 'com.pe', 'com.ve', 'com.ec', 'com.uy',
            'com.py', 'com.bo', 'com.cl', 'co.il', 'co.ke', 'co.tz',
            'co.bw', 'co.zm', 'co.zw', 'ac.uk', 'org.uk', 'net.uk',
            'gov.uk', 'sch.uk', 'police.uk', 'mod.uk', 'nhs.uk'
        }
        
        # Check for multi-part TLDs (3-part first, then 2-part)
        for tld_parts in [3, 2]:
            if len(parts) >= tld_parts + 1:  # Need at least one label + TLD parts
                potential_tld = '.'.join(parts[-tld_parts:])
                if potential_tld in comprehensive_multi_tlds:
                    return '.'.join(parts[-(tld_parts + 1):])  # Include one more part
        
        # Default: take last 2 parts (domain + tld)
        return '.'.join(parts[-2:])

    def _normalize_label_robust(self, label: str) -> str:
        """
        FIXED: Comprehensive label normalization with enhanced confusable mapping.
        This was the key missing piece!
        """
        if not label:
            return ""
        
        s = unicodedata.normalize('NFKD', label)
        s = ''.join(c for c in s if not unicodedata.combining(c))

        # Map uppercase-only confusables BEFORE lowercasing (CRITICAL FIX)
        pre_map = {'I': 'l'}  # capital I looks like lowercase L in many fonts
        for ch, rep in pre_map.items():
            s = s.replace(ch, rep)

        s = s.lower()

        post_map = {
            '0': 'o', '1': 'l', '3': 'e', '5': 's', '6': 'g', '8': 'b',
            '@': 'a', '$': 's', '!': 'i',
            # Cyrillic lookalikes
            'а': 'a','е': 'e','о': 'o','р': 'p','с': 'c','х': 'x','у': 'y',
            # Extended Unicode confusables
            'α': 'a', 'β': 'b', 'ε': 'e', 'ο': 'o', 'ρ': 'p',           # Greek
            '⁰': 'o', '¹': 'l', '²': '2', '³': '3',                      # Superscripts
            # Additional common confusables
            'і': 'i', 'ї': 'i', 'є': 'e',  # Ukrainian
            'ǝ': 'e', 'ɑ': 'a', 'ο': 'o',  # IPA/Greek
        }
        for ch, rep in post_map.items():
            s = s.replace(ch, rep)

        return re.sub(r'[^a-z0-9\-]', '', s)

    def _is_suspicious_tld(self, tld: str) -> bool:
        """Enhanced suspicious TLD detection with fallback safety net."""
        t = tld.lower().lstrip('.')
        if t in self.suspicious_tlds:        # from JSON
            return True
        # fallback safety net if JSON misses entries
        fallback = {'tk','ml','ga','cf','gq','xyz','info','top','click','loan','win','work'}
        return t in fallback

    def _is_dictionary_word_brand(self, brand: str) -> bool:
        """Check if brand is a common dictionary word."""
        return brand.lower() in self.dictionary_word_brands

    def _has_impersonation_signals(self, tokens: Set[str], path_flags: Dict[str, Any]) -> bool:
        """Check for impersonation signals in tokens or path."""
        return bool(tokens & self.impersonation_keywords) or path_flags.get('has_auth_path', False)

    def _extract_path_flags(self, domain: str) -> Dict[str, Any]:
        """Enhanced path flag extraction."""
        try:
            if not domain.startswith(('http://', 'https://')):
                domain = 'http://' + domain
            parsed = urlparse(domain)
            path = parsed.path.lower()
            query = parsed.query.lower()
        except:
            path = ""
            query = ""
        
        # Enhanced auth patterns
        auth_patterns = r'/(login|signin|auth|verify|secure|account|portal|billing|payment|wallet|checkout)(/|$|\?)'
        auth_in_query = r'(login|signin|auth|verify|account)='
        
        has_auth_path = bool(re.search(auth_patterns, path))
        has_auth_query = bool(re.search(auth_in_query, query))
        
        return {
            'has_auth_path': has_auth_path or has_auth_query,
            'path_length': len(path),
            'has_path': len(path) > 1,
            'path': path,
            'query': query
        }

    def _contains_brand_with_keywords(self, tokens: Set[str], brand: str) -> bool:
        """Check if tokens contain brand + impersonation keywords."""
        # Must contain the brand name AND at least one keyword
        return brand in tokens and bool(tokens & self.impersonation_keywords)

    def _get_distance_threshold(self, brand: str, suspicious_tld: bool) -> int:
        """Enhanced distance threshold with brand length consideration."""
        brand_len = len(brand)
        
        if brand_len <= 4:
            base_threshold = 1
        elif brand_len <= 8:
            base_threshold = 2
        else:
            base_threshold = 3
        
        # Increase threshold for suspicious TLDs (more permissive)
        if suspicious_tld:
            base_threshold += 1
        
        return base_threshold

    def _levenshtein_distance(self, s1: str, s2: str) -> int:
        """Calculate Levenshtein distance between two strings."""
        if len(s1) < len(s2):
            s1, s2 = s2, s1
        
        if len(s2) == 0:
            return len(s1)
        
        previous_row = list(range(len(s2) + 1))
        for i, c1 in enumerate(s1):
            current_row = [i + 1]
            for j, c2 in enumerate(s2):
                insertions = previous_row[j + 1] + 1
                deletions = current_row[j] + 1
                substitutions = previous_row[j] + (c1 != c2)
                current_row.append(min(insertions, deletions, substitutions))
            previous_row = current_row
        
        return previous_row[-1]

    def _create_match_result(self, brand_domain: str, match_type: str, distance: int, 
                           confidence: float, etld1: str, tld: str, metadata: Dict) -> Dict[str, Any]:
        """Create a standardized match result."""
        return {
            'brand_domain': brand_domain,
            'brand': brand_domain.split('.')[0],  # Add this for test compatibility
            'type': match_type,
            'distance': distance,
            'confidence': round(confidence, 3),
            'etld1': etld1,
            'tld': tld,
            'metadata': metadata
        }

    def _get_brand_metadata(self, brand_domain: str) -> Dict[str, Any]:
        """Get metadata for a brand domain including official subdomains."""
        # Include the base domain as official
        official_domains = {brand_domain}
        
        # Add known official subdomains for major brands
        if brand_domain == 'microsoft.com':
            official_domains.update({
                'support.microsoft.com', 'login.microsoft.com', 
                'account.microsoft.com', 'azure.microsoft.com'
            })
        elif brand_domain == 'google.com':
            official_domains.update({
                'accounts.google.com', 'mail.google.com', 
                'drive.google.com', 'docs.google.com'
            })
        elif brand_domain == 'amazon.com':
            official_domains.update({
                'aws.amazon.com', 'smile.amazon.com',
                'music.amazon.com', 'prime.amazon.com'
            })
        elif brand_domain == 'apple.com':
            official_domains.update({
                'support.apple.com', 'icloud.com', 
                'appleid.apple.com', 'developer.apple.com'
            })
        
        return {
            'official_domains': official_domains,
            'category': self._find_brand_category(brand_domain),
            'risk_level': 'medium'
        }
    def _classify_similarity_type(self, domain_slim: str, brand: str) -> str:
        """Enhanced similarity classification."""
        if len(domain_slim) == len(brand):
            diff_count = sum(1 for a, b in zip(domain_slim, brand) if a != b)
            if diff_count == 1:
                # Check if it's a confusable substitution
                for i, (a, b) in enumerate(zip(domain_slim, brand)):
                    if a != b:
                        confusables = {'o': '0', 'l': '1', 'e': '3', 's': '5'}  # Reversed mapping
                        if b in confusables and confusables[b] == a:
                            return "confusable_substitution"
                        return "single_character_substitution"
            elif diff_count == 2:
                return "double_character_substitution"
            else:
                return "multiple_substitutions"
        elif len(domain_slim) > len(brand):
            return "character_insertion"
        else:
            return "character_deletion"

    # LEGACY METHODS (maintain backward compatibility)
    def _edit_distance(self, s1: str, s2: str) -> int:
        """Backward compatibility wrapper"""
        return self._levenshtein_distance(s1, s2)
    
    def _tld_compatible(self, domain_tld: str, brand_tld: str) -> bool:
        """Legacy TLD compatibility check"""
        if domain_tld == brand_tld:
            return True
        
        # Allow some common substitutions
        compatible_pairs = [
            ('com', 'co'), ('com', 'net'), ('org', 'com'),
        ]
        
        # Suspicious TLDs can impersonate any legitimate TLD
        suspicious_tlds = ['tk', 'ml', 'ga', 'cf', 'top', 'click']
        if domain_tld in suspicious_tlds:
            return True
        
        return (domain_tld, brand_tld) in compatible_pairs or (brand_tld, domain_tld) in compatible_pairs

    def _find_brand_category(self, brand_domain: str) -> str:
        """Find which category a brand domain belongs to"""
        for category, domains in self.brand_categories.items():
            if brand_domain in domains:
                return category
        return "unknown"
    
    def _classify_similarity(self, domain: str, brand: str) -> str:
        """Classify the type of similarity between domain and brand"""
        if len(domain) == len(brand):
            # Count different characters
            diff_count = sum(1 for a, b in zip(domain, brand) if a != b)
            if diff_count == 1:
                return "typosquatting"
            elif diff_count <= 2:
                return "similar_spelling"
        
        if brand in domain or domain in brand:
            return "substring_match"
        
        return "character_similarity"
    
    def check_suspicious_keywords(self, text: str) -> Dict[str, Any]:
        """
        Check text for suspicious keywords and patterns.
        Returns analysis of found suspicious content.
        """
        if not text:
            return {"found_keywords": [], "risk_level": "low", "patterns": []}
        
        text_lower = text.lower()
        found_keywords = []
        patterns = []
        
        # Check for suspicious keywords from our indicators
        suspicious_keywords = self.suspicious_indicators.get('keywords', {})
        
        for category, keywords in suspicious_keywords.items():
            for keyword in keywords:
                if keyword.lower() in text_lower:
                    found_keywords.append({
                        "keyword": keyword,
                        "category": category
                    })
        
        # Check for suspicious patterns
        suspicious_patterns = self.suspicious_indicators.get('patterns', {})
        
        for pattern_name, pattern_info in suspicious_patterns.items():
            if isinstance(pattern_info, dict) and 'regex' in pattern_info:
                try:
                    pattern = re.compile(pattern_info['regex'], re.IGNORECASE)
                    matches = pattern.findall(text)
                    if matches:
                        patterns.append({
                            "pattern": pattern_name,
                            "matches": matches,
                            "weight": pattern_info.get('weight', 1)
                        })
                except re.error:
                    logger.warning(f"Invalid regex pattern: {pattern_info['regex']}")
        
        # Determine risk level
        total_weight = sum(p.get('weight', 1) for p in patterns) + len(found_keywords)
        
        if total_weight >= 5:
            risk_level = "high"
        elif total_weight >= 2:
            risk_level = "medium"
        else:
            risk_level = "low"
        
        return {
            "found_keywords": found_keywords,
            "patterns": patterns,
            "risk_level": risk_level,
            "total_weight": total_weight
        }
    
    def get_heuristic_weights(self) -> Dict[str, Any]:
        """Get heuristic weights for scoring"""
        return self.heuristic_weights.get('weights', {
            'domain_reputation': 2,
            'brand_similarity': 2,
            'suspicious_keywords': 1,
            'technical_indicators': 1
        })
    
    def get_verdict_thresholds(self) -> Dict[str, int]:
        """Get verdict thresholds for scoring"""
        return self.heuristic_weights.get('thresholds', {
            'danger': 4,
            'warning': 2,
            'ok': 1
        })
    
    def score_to_verdict(self, score: int) -> str:
        """Convert numeric score to verdict string"""
        thresholds = self.get_verdict_thresholds()
        
        if score >= thresholds.get('danger', 4):
            return 'danger'
        elif score >= thresholds.get('warning', 2):
            return 'warning'
        else:
            return 'ok'
    
    def hot_reload_if_needed(self) -> bool:
        """Reload data if enough time has passed (for live updates)"""
        if time.time() - self.last_reload > self.reload_interval:
            logger.info("Hot-reloading reputation data...")
            return self.load_all_data()
        return False
    
    def get_stats(self) -> Dict[str, Any]:
        """Get statistics about loaded reputation data"""
        return {
            "reputable_domains": len(self.reputable_domains),
            "brand_domains": len(self.brand_domains),
            "brand_categories": len(self.brand_categories),
            "suspicious_tlds": len(self.suspicious_tlds),
            "last_reload": self.last_reload,
            "data_version": self.reputable_domains.get('version', 'unknown') if self.reputable_domains else 'none'
        }