# api/src/services/tier0_analyzer.py
import re
import logging
from typing import Dict, Any, List, Optional
from urllib.parse import urlparse
from dataclasses import dataclass

from .reputation_service import ReputationService
from .url_normalizer import URLNormalizer

logger = logging.getLogger(__name__)

@dataclass
class AnalysisResult:
    """Result of Tier-0 analysis"""
    verdict: str  # "ok" | "warning" | "danger"
    score: int
    reasons: List[str]
    details: Dict[str, Any]
    escalate_to_tier1: bool = False

class Tier0Analyzer:
    """
    Tier-0 heuristic analyzer for SafeSignal.
    
    Uses deterministic rules to score URLs and content:
    - Domain reputation lookup
    - Brand look-alike detection  
    - URL structure analysis
    - Content heuristics (HTML patterns)
    - Technical indicators
    
    Fast execution (~150-600ms) with explainable scoring.
    """
    
    def __init__(self, reputation_service: ReputationService):
        self.reputation = reputation_service
        self.url_normalizer = URLNormalizer()
        
        # Precompiled regex patterns for performance
        self._compile_patterns()
    
    def _compile_patterns(self):
        """Precompile regex patterns for better performance"""
        self.patterns = {
            'all_caps': re.compile(r'[A-Z]{3,}'),
            'excessive_exclamation': re.compile(r'!{2,}'),
            'phone_number': re.compile(r'\b\d{3}[-.]?\d{3}[-.]?\d{4}\b'),
            'email_pattern': re.compile(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b'),
            'form_action': re.compile(r'<form[^>]*action\s*=\s*["\']([^"\']+)["\']', re.IGNORECASE),
            'external_link': re.compile(r'<a[^>]*href\s*=\s*["\']([^"\']+)["\']', re.IGNORECASE),
            'meta_refresh': re.compile(r'<meta[^>]*http-equiv\s*=\s*["\']refresh["\']', re.IGNORECASE),
            'suspicious_path': re.compile(r'/(verify|confirm|update|secure|account|login|signin|payment)/', re.IGNORECASE),
            'random_string': re.compile(r'/[a-z0-9]{20,}', re.IGNORECASE),
            'subdomain_count': re.compile(r'([^.]+\.)+'),
            'url_shortener': re.compile(r'(bit\.ly|tinyurl|t\.co|goo\.gl|short\.link)', re.IGNORECASE)
        }
    
    def analyze(self, url: str, fetch_result = None, content_excerpt: str = None) -> AnalysisResult:
        """
        Perform complete Tier-0 analysis on URL and content.
        
        Args:
            url: The URL to analyze
            fetch_result: Optional fetch result with metadata
            content_excerpt: Optional content excerpt for analysis
            
        Returns:
            AnalysisResult with verdict, score, reasons, and details
        """
        try:
            # Normalize URL for analysis
            url_info = self.url_normalizer.normalize_url(url)
            
            # Initialize scoring
            score = 0
            reasons = []
            details = {
                'domain_analysis': {},
                'url_analysis': {},
                'content_analysis': {},
                'technical_analysis': {},
                'brand_analysis': {}
            }
            
            # 1. Domain reputation analysis
            domain_score, domain_reasons, domain_details = self._analyze_domain(url_info)
            score += domain_score
            reasons.extend(domain_reasons)
            details['domain_analysis'] = domain_details
            
            # 2. URL structure analysis
            url_score, url_reasons, url_details = self._analyze_url_structure(url_info)
            score += url_score
            reasons.extend(url_reasons)
            details['url_analysis'] = url_details
            
            # 3. Brand look-alike analysis
            brand_score, brand_reasons, brand_details = self._analyze_brand_similarity(url_info)
            score += brand_score
            reasons.extend(brand_reasons)
            details['brand_analysis'] = brand_details
            
            # 4. Content analysis (if available)
            if content_excerpt:
                content_score, content_reasons, content_details = self._analyze_content(content_excerpt, url_info)
                score += content_score
                reasons.extend(content_reasons)
                details['content_analysis'] = content_details
            
            # 5. Technical indicators (if fetch_result available)
            if fetch_result:
                tech_score, tech_reasons, tech_details = self._analyze_technical_indicators(fetch_result, url_info)
                score += tech_score
                reasons.extend(tech_reasons)
                details['technical_analysis'] = tech_details
            
            # 6. Determine final verdict
            verdict = self.reputation.score_to_verdict(score)
            
            # 7. Check if should escalate to Tier-1
            escalate = self._should_escalate_to_tier1(score, reasons, verdict)
            
            return AnalysisResult(
                verdict=verdict,
                score=score,
                reasons=list(set(reasons)),  # Remove duplicates
                details=details,
                escalate_to_tier1=escalate
            )
            
        except Exception as e:
            logger.error(f"Error in Tier-0 analysis: {e}")
            return AnalysisResult(
                verdict="warning",
                score=2,
                reasons=["analysis_error"],
                details={"error": str(e)},
                escalate_to_tier1=False
            )
    
    def _analyze_domain(self, url_info: Dict[str, Any]) -> tuple[int, List[str], Dict[str, Any]]:
        """Analyze domain reputation and characteristics"""
        score = 0
        reasons = []
        details = {}
        
        domain = url_info.get('domain', '')
        if not domain:
            return 1, ["invalid_domain"], {"domain": None}
        
        # Get base reputation score
        reputation_score = self.reputation.get_domain_score(domain)
        score += reputation_score
        details['reputation_score'] = reputation_score
        
        if reputation_score <= -2:
            reasons.append("reputable_domain")
        elif reputation_score >= 2:
            reasons.append("suspicious_domain")
        
        # Check TLD reputation
        tld = url_info.get('tld', '').lower()
        if tld in ['.tk', '.ml', '.ga', '.cf']:
            score += self.reputation.get_heuristic_weight('domain_reputation', 'very_suspicious_tld')
            reasons.append("suspicious_tld")
        elif tld in ['.top', '.click', '.download', '.stream']:
            score += self.reputation.get_heuristic_weight('domain_reputation', 'suspicious_tld')
            reasons.append("questionable_tld")
        
        # Check for excessive subdomains
        subdomain_count = len(domain.split('.')) - 2  # Subtract main domain + TLD
        if subdomain_count > 3:
            score += self.reputation.get_heuristic_weight('url_structure', 'excessive_subdomains')
            reasons.append("excessive_subdomains")
        
        details.update({
            'domain': domain,
            'tld': tld,
            'subdomain_count': subdomain_count
        })
        
        return score, reasons, details
    
    def _analyze_url_structure(self, url_info: Dict[str, Any]) -> tuple[int, List[str], Dict[str, Any]]:
        """Analyze URL structure for suspicious patterns"""
        score = 0
        reasons = []
        details = {}
        
        normalized_url = url_info.get('normalized_url', '')
        path = url_info.get('path', '')
        
        # Check for suspicious paths
        if self.patterns['suspicious_path'].search(path):
            score += self.reputation.get_heuristic_weight('url_structure', 'suspicious_path')
            reasons.append("suspicious_path")
        
        # Check for random strings in path
        if self.patterns['random_string'].search(path):
            score += self.reputation.get_heuristic_weight('url_structure', 'random_string')
            reasons.append("random_string_path")
        
        # Check for URL shorteners in the domain
        if self.patterns['url_shortener'].search(normalized_url):
            score += self.reputation.get_heuristic_weight('url_structure', 'url_shortener')
            reasons.append("url_shortener")
        
        details.update({
            'path': path,
            'path_length': len(path),
            'has_query': url_info.get('has_query', False),
            'has_fragment': url_info.get('has_fragment', False)
        })
        
        return score, reasons, details
    
    def _analyze_brand_similarity(self, url_info: Dict[str, Any]) -> tuple[int, List[str], Dict[str, Any]]:
        """Analyze domain for brand impersonation"""
        score = 0
        reasons = []
        details = {}
        
        domain = url_info.get('domain', '')
        if not domain:
            return 0, [], {}
        
        # Extract registrable domain and components
        domain_parts = domain.lower().split('.')
        if len(domain_parts) >= 2:
            domain_name = domain_parts[-2]  # Main domain part
            tld = domain_parts[-1]          # TLD
            registrable_domain = f"{domain_name}.{tld}"
        else:
            domain_name = domain.lower()
            tld = ""
            registrable_domain = domain.lower()
        
        # Check for exact brand token impersonation on suspicious TLDs
        suspicious_tlds = ['tk', 'ml', 'ga', 'cf', 'top', 'click', 'download', 'stream']
        impersonation_keywords = ['support', 'secure', 'login', 'update', 'verify', 'account', 'service']
        
        # Look for exact brand matches + suspicious keywords on bad TLDs
        brand_impersonation_detected = False
        for brand_domain in self.reputation.brand_domains:
            brand_name = brand_domain.split('.')[0]  # e.g., "microsoft" from "microsoft.com"
            
            # Check if domain contains exact brand name + impersonation keyword
            if (brand_name in domain_name and 
                any(keyword in domain_name for keyword in impersonation_keywords) and
                tld in suspicious_tlds):
                
                score += 4  # Jump straight to danger
                reasons.append("brand_impersonation_high_risk")
                reasons.append("impersonation_keywords")
                brand_impersonation_detected = True
                
                category = self.reputation._find_brand_category(brand_domain)
                details.update({
                    'exact_brand_match': brand_name,
                    'impersonation_keywords': [kw for kw in impersonation_keywords if kw in domain_name],
                    'suspicious_tld': tld,
                    'brand_category': category
                })
                
                logger.info(f"Exact brand impersonation detected: {domain} contains '{brand_name}' + keywords on .{tld}")
                break
        
        # If no exact match found, try similarity-based detection
        if not brand_impersonation_detected:
            similar_brands = self.reputation.find_similar_brands(domain, max_distance=2)
            
            if similar_brands:
                # Get the closest match
                closest_brand = similar_brands[0]
                distance = closest_brand['distance']
                similarity_type = closest_brand['similarity_type']
                brand_category = closest_brand['category']
                
                # Score based on distance and category
                base_score = 0
                if distance == 1:
                    if brand_category in ['banks', 'government', 'payment_processors']:
                        base_score = self.reputation.get_heuristic_weight('brand_similarity', 'exact_match_different_tld')
                        reasons.append("brand_impersonation_high_risk")
                    else:
                        base_score = self.reputation.get_heuristic_weight('brand_similarity', 'typosquatting')
                        reasons.append("brand_impersonation")
                elif distance == 2:
                    base_score = self.reputation.get_heuristic_weight('brand_similarity', 'typosquatting')
                    reasons.append("brand_similarity")
                
                # BONUS: Brand similarity + suspicious TLD = extra danger
                if base_score > 0 and tld in suspicious_tlds:
                    bonus_score = 2  # Extra penalty for brand + bad TLD combo
                    score += base_score + bonus_score
                    reasons.append("brand_impersonation_suspicious_tld")
                    logger.info(f"Brand similarity + bad TLD detected: {domain} (base: {base_score}, bonus: {bonus_score})")
                else:
                    score += base_score
                
                details.update({
                    'similar_brands': similar_brands[:3],  # Top 3 matches
                    'closest_brand': closest_brand['brand'],
                    'similarity_type': similarity_type,
                    'edit_distance': distance,
                    'tld_bonus_applied': tld in suspicious_tlds and base_score > 0
                })
        
        # Check for subdomain impersonation (e.g., paypal.fake-site.com)
        if len(domain_parts) > 2:
            main_part = domain_parts[0]
            if self.reputation.is_brand_domain(f"{main_part}.com"):
                score += self.reputation.get_heuristic_weight('brand_similarity', 'subdomain_impersonation')
                reasons.append("subdomain_brand_impersonation")
        
        return score, reasons, details
    
    def _analyze_content(self, content: str, url_info: Dict[str, Any]) -> tuple[int, List[str], Dict[str, Any]]:
        """Analyze page content for suspicious patterns"""
        score = 0
        reasons = []
        details = {}
        
        if not content:
            return 0, [], {}
        
        # Check suspicious keywords
        keyword_analysis = self.reputation.check_suspicious_keywords(content)
        score += keyword_analysis['total_score']
        
        for pattern_type in keyword_analysis['pattern_types']:
            if pattern_type == 'financial_verification':
                reasons.append("financial_verification_request")
            elif pattern_type == 'hype_language':
                reasons.append("hype_language")
            elif pattern_type == 'health_claims':
                reasons.append("unverified_health_claims")
            elif pattern_type == 'urgency_pattern':
                reasons.append("urgency_tactics")
        
        # Analyze form actions (off-site posting)
        form_matches = self.patterns['form_action'].findall(content)
        current_domain = url_info.get('domain', '')
        
        offsite_forms = 0
        for form_action in form_matches:
            if form_action.startswith('http'):
                parsed_action = urlparse(form_action)
                if parsed_action.netloc and parsed_action.netloc != current_domain:
                    offsite_forms += 1
        
        if offsite_forms > 0:
            score += self.reputation.get_heuristic_weight('content_heuristics', 'offsite_form_action')
            reasons.append("offsite_form_submission")
        
        # Analyze text characteristics
        text_stats = self._analyze_text_characteristics(content)
        
        if text_stats['caps_ratio'] > 0.3:  # >30% ALL CAPS
            score += self.reputation.get_heuristic_weight('content_heuristics', 'high_caps_ratio')
            reasons.append("excessive_caps")
        
        if text_stats['exclamation_count'] > 5:
            score += 1
            reasons.append("excessive_exclamation")
        
        # Check for suspicious contact info
        if self._has_suspicious_contact_info(content):
            score += self.reputation.get_heuristic_weight('content_heuristics', 'suspicious_contact')
            reasons.append("suspicious_contact_info")
        
        details.update({
            'keyword_analysis': keyword_analysis,
            'text_stats': text_stats,
            'offsite_forms': offsite_forms,
            'form_actions': form_matches[:3]  # First 3 form actions
        })
        
        return score, reasons, details
    
    def _analyze_technical_indicators(self, fetch_result, url_info: Dict[str, Any]) -> tuple[int, List[str], Dict[str, Any]]:
        """Analyze technical indicators from fetch result"""
        score = 0
        reasons = []
        details = {}
        
        # Check HTTPS usage
        if url_info.get('normalized_url', '').startswith('http://'):
            score += self.reputation.get_heuristic_weight('technical_signals', 'no_https')
            reasons.append("no_https")
        
        # Check redirect count
        redirect_count = getattr(fetch_result, 'redirect_count', 0)
        if redirect_count > 3:
            score += self.reputation.get_heuristic_weight('technical_signals', 'suspicious_redirects')
            reasons.append("excessive_redirects")
        
        # Check if blocked by security
        if getattr(fetch_result, 'was_blocked', False):
            score += self.reputation.get_heuristic_weight('technical_signals', 'blocked_by_security')
            reasons.append("blocked_by_security")
        
        details.update({
            'redirect_count': redirect_count,
            'final_url': getattr(fetch_result, 'final_url', ''),
            'status_code': getattr(fetch_result, 'status_code', None),
            'was_blocked': getattr(fetch_result, 'was_blocked', False)
        })
        
        return score, reasons, details
    
    def _analyze_text_characteristics(self, text: str) -> Dict[str, Any]:
        """Analyze text characteristics like caps ratio, exclamations, etc."""
        if not text:
            return {'caps_ratio': 0, 'exclamation_count': 0, 'word_count': 0}
        
        # Count ALL CAPS words
        caps_matches = self.patterns['all_caps'].findall(text)
        total_caps = sum(len(match) for match in caps_matches)
        
        # Count exclamation marks
        exclamation_count = len(self.patterns['excessive_exclamation'].findall(text))
        
        # Basic word count
        words = text.split()
        word_count = len(words)
        
        # Calculate caps ratio
        total_letters = sum(1 for char in text if char.isalpha())
        caps_ratio = total_caps / total_letters if total_letters > 0 else 0
        
        return {
            'caps_ratio': caps_ratio,
            'exclamation_count': exclamation_count,
            'word_count': word_count,
            'total_letters': total_letters,
            'total_caps': total_caps
        }
    
    def _has_suspicious_contact_info(self, content: str) -> bool:
        """Check for suspicious contact information patterns"""
        # Check for Gmail addresses for "business" websites
        email_matches = self.patterns['email_pattern'].findall(content.lower())
        suspicious_emails = [email for email in email_matches 
                           if any(domain in email for domain in ['@gmail.com', '@yahoo.com', '@hotmail.com'])]
        
        # If there are business-like words but only personal email domains
        business_words = ['llc', 'inc', 'corp', 'company', 'business', 'official', 'customer service']
        has_business_context = any(word in content.lower() for word in business_words)
        
        return has_business_context and len(suspicious_emails) > 0
    
    def _should_escalate_to_tier1(self, score: int, reasons: List[str], verdict: str) -> bool:
        """
        Determine if this check should be escalated to Tier-1 LLM analysis.
        
        Escalate if:
        - Verdict is warning (ambiguous cases)
        - Contains financial/health content with borderline score
        - Brand impersonation detected
        """
        # Always escalate warnings (ambiguous cases)
        if verdict == "warning":
            return True
        
        # Escalate financial verification requests with medium scores
        if "financial_verification_request" in reasons and 1 <= score <= 3:
            return True
        
        # Escalate health claims that aren't clear-cut
        if "unverified_health_claims" in reasons and score <= 2:
            return True
        
        # Escalate brand impersonation cases
        if any("brand" in reason for reason in reasons):
            return True
        
        # Don't escalate clear-cut cases
        return False