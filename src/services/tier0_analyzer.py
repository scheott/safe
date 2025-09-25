# api/src/services/tier0_analyzer.py
# Complete drag-and-drop version with enhanced brand similarity integration

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
    
    def analyze(self, url: str, fetch_result=None, content_excerpt: str = None) -> AnalysisResult:
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
            # Normalize URL for analysis using the existing url_normalizer
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
            
            # ✅ Early return for highly reputable domains
            if domain_score <= -2:  # Highly reputable (e.g., -2)
                logger.info(f"Domain {url_info.get('domain')} is highly reputable, skipping further analysis")
                return AnalysisResult(
                    verdict="ok",
                    score=domain_score,
                    reasons=domain_reasons,
                    details=details,
                    escalate_to_tier1=False
                )
            
            # 2. URL structure analysis
            try:
                url_score, url_reasons, url_details = self._analyze_url_structure(url_info)
                score += url_score
                reasons.extend(url_reasons)
                details['url_analysis'] = url_details
            except Exception as e:
                logger.warning(f"URL analysis failed for {url}: {e}")
            
            # 3. Enhanced brand similarity analysis
            try:
                brand_score, brand_reasons, brand_details = self._analyze_brand_similarity(url_info)
                score += brand_score
                reasons.extend(brand_reasons)
                details['brand_analysis'] = brand_details
            except Exception as e:
                logger.warning(f"Brand analysis failed for {url}: {e}")
            
            # 4. Content analysis (if available)
            if content_excerpt:
                try:
                    content_score, content_reasons, content_details = self._analyze_content(content_excerpt, url_info)
                    score += content_score
                    reasons.extend(content_reasons)
                    details['content_analysis'] = content_details
                except Exception as e:
                    logger.warning(f"Content analysis failed for {url}: {e}")
                    # Only add analysis_error if this is the main failure point
                    # and we don't have domain-level confidence
                    if domain_score >= 0:  # Unknown or suspicious domain
                        reasons.append("analysis_error")
                        score += 1  # Small penalty for analysis failures on unknown domains
            
            # 5. Technical indicators (if fetch_result available)
            if fetch_result:
                try:
                    tech_score, tech_reasons, tech_details = self._analyze_technical_indicators(fetch_result, url_info)
                    score += tech_score
                    reasons.extend(tech_reasons)
                    details['technical_analysis'] = tech_details
                except Exception as e:
                    logger.warning(f"Technical analysis failed for {url}: {e}")
            
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
            logger.error(f"Critical error in Tier-0 analysis for {url}: {e}")
            # Only return analysis_error for truly critical failures
            # Try to extract domain for basic analysis using url_normalizer
            try:
                url_info = self.url_normalizer.normalize_url(url)
                domain_score = self.reputation.get_domain_score(url_info.get('domain', ''))
                if domain_score <= -2:
                    # Even with errors, trust reputable domains
                    return AnalysisResult(
                        verdict="ok",
                        score=domain_score,
                        reasons=["reputable_domain"],
                        details={"error": str(e), "fallback": "domain_reputation"},
                        escalate_to_tier1=False
                    )
            except:
                pass  # Fall through to error state
            
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
        """
        ENHANCED: Analyze domain for brand impersonation using production-ready detection.
        """
        domain = url_info.get('domain', '')
        if not domain:
            return 0, [], {}
        
        # Use the new production-ready brand similarity scoring
        try:
            similarity_result = self.reputation.get_brand_similarity_score(domain)
            score = similarity_result['score']
            reasons = similarity_result['reasons']
            details = similarity_result['details']
            all_matches = similarity_result.get('all_matches', [])
            
            # Log structured data for analytics
            if score > 0 and details:
                logger.info(f"Brand similarity detected: {domain} → {details}")
            
            # Prepare analysis details for response
            analysis_details = {}
            if all_matches:
                best_match = all_matches[0]
                analysis_details.update({
                    'matched_brand': best_match['brand'],
                    'match_type': best_match['type'],
                    'confidence': best_match['confidence'],
                    'distance': best_match['distance'],
                    'suspicious_tld': best_match['suspicious_tld'],
                    'registrable_domain': best_match['registrable_domain'],
                    'all_matches': [
                        {
                            'brand': m['brand'],
                            'type': m['type'],
                            'confidence': round(m['confidence'], 3),
                            'distance': m['distance']
                        }
                        for m in all_matches[:3]  # Top 3 matches
                    ]
                })
                
                # Add type-specific details
                if 'keywords_found' in best_match:
                    analysis_details['keywords_found'] = best_match['keywords_found']
                if 'path_flags' in best_match:
                    analysis_details['path_flags'] = best_match['path_flags']
                if 'similarity_type' in best_match:
                    analysis_details['similarity_type'] = best_match['similarity_type']
            
            return score, reasons, analysis_details
            
        except Exception as e:
            logger.error(f"Brand similarity analysis failed for {domain}: {e}")
            # Fallback to basic domain reputation
            domain_score = self.reputation.get_domain_score(domain)
            if domain_score > 0:
                return domain_score, ['suspicious_domain'], {'fallback_used': True, 'error': str(e)}
            return 0, [], {'error': str(e)}
    
    def _analyze_content(self, content: str, url_info: Dict[str, Any]) -> tuple[int, List[str], Dict[str, Any]]:
        """Analyze page content for suspicious patterns"""
        score = 0
        reasons = []
        details = {}
        
        if not content:
            return 0, [], {}
        
        try:
            # Check suspicious keywords
            keyword_analysis = self.reputation.check_suspicious_keywords(content)
            score += keyword_analysis['total_score']  # ✅ This should now work
            
            for pattern_type in keyword_analysis.get('pattern_types', []):
                if pattern_type == 'financial_verification':
                    reasons.append("financial_verification_request")
                elif pattern_type == 'hype_language':
                    reasons.append("hype_language")
                elif pattern_type == 'health_claims':
                    reasons.append("unverified_health_claims")
                elif pattern_type == 'urgency_pattern':
                    reasons.append("urgency_tactics")
            
            # ✅ Store keyword analysis details
            details['keyword_analysis'] = {
                'total_score': keyword_analysis['total_score'],
                'risk_level': keyword_analysis['risk_level'],
                'pattern_count': len(keyword_analysis.get('patterns', []))
            }
            
            # Analyze form actions (off-site posting)
            if hasattr(self, 'patterns') and 'form_action' in self.patterns:
                form_matches = self.patterns['form_action'].findall(content)
                current_domain = url_info.get('domain', '')
                
                offsite_forms = 0
                for form_action in form_matches:
                    if current_domain not in form_action.lower():
                        offsite_forms += 1
                
                if offsite_forms > 0:
                    score += self.reputation.get_heuristic_weight('content_analysis', 'offsite_form_action')
                    reasons.append("offsite_form_action")
                    details['offsite_forms'] = offsite_forms
            
            return score, reasons, details
            
        except Exception as e:
            logger.error(f"Content analysis error: {e}")
            # Return minimal penalty for content analysis errors
            return 1, ["content_analysis_error"], {"error": str(e)}
    
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
        
        # Check for timeout/slow response patterns
        if hasattr(fetch_result, 'fetch_time_ms') and fetch_result.fetch_time_ms > 10000:
            score += 1
            reasons.append("site_slow_response")
        
        # Check for fetch failures
        if hasattr(fetch_result, 'error') and fetch_result.error:
            if 'ConnectError' in str(fetch_result.error):
                score += 1
                reasons.append("fetch_failed")
                reasons.append("fetch_error_ConnectError")
            elif 'timeout' in str(fetch_result.error).lower():
                score += 1
                reasons.append("fetch_failed")
                reasons.append("fetch_timeout_stage_unknown")
        
        details.update({
            'redirect_count': redirect_count,
            'final_url': getattr(fetch_result, 'final_url', ''),
            'status_code': getattr(fetch_result, 'status_code', None),
            'was_blocked': getattr(fetch_result, 'was_blocked', False),
            'fetch_time_ms': getattr(fetch_result, 'fetch_time_ms', None)
        })
        
        return score, reasons, details
    
    def _analyze_text_characteristics(self, text: str) -> Dict[str, Any]:
        """Analyze text characteristics like caps ratio, exclamations, etc."""
        if not text:
            return {'caps_ratio': 0, 'exclamation_count': 0, 'word_count': 0}
        
        # Count capital letters and words
        caps_count = sum(1 for c in text if c.isupper())
        total_chars = len([c for c in text if c.isalpha()])
        caps_ratio = caps_count / total_chars if total_chars > 0 else 0
        
        # Count exclamation marks
        exclamation_count = text.count('!')
        
        # Count words (rough estimate)
        word_count = len(text.split())
        
        return {
            'caps_ratio': caps_ratio,
            'exclamation_count': exclamation_count,
            'word_count': word_count,
            'total_chars': total_chars,
            'caps_count': caps_count
        }
    
    def _has_suspicious_contact_info(self, content: str) -> bool:
        """Check for suspicious contact information patterns"""
        # Check for phone numbers in suspicious contexts
        phone_matches = self.patterns['phone_number'].findall(content)
        if len(phone_matches) > 2:  # More than 2 phone numbers might be suspicious
            return True
        
        # Check for email addresses in suspicious contexts
        email_matches = self.patterns['email_pattern'].findall(content)
        if len(email_matches) > 3:  # More than 3 emails might be suspicious
            return True
        
        # Check for suspicious contact patterns
        suspicious_contact_patterns = [
            r'call now',
            r'urgent.{0,20}contact',
            r'immediate.{0,20}response',
            r'limited time.{0,20}call'
        ]
        
        content_lower = content.lower()
        for pattern in suspicious_contact_patterns:
            if re.search(pattern, content_lower):
                return True
        
        return False
    
    def _should_escalate_to_tier1(self, score: int, reasons: List[str], verdict: str) -> bool:
        """Determine if analysis should escalate to Tier-1 (LLM)"""
        # Escalate conditions for paid users:
        # 1. Borderline warning cases that could benefit from LLM analysis
        # 2. Sensitive categories (health/finance) with unclear verdict
        # 3. Brand impersonation cases that need deeper analysis
        
        if verdict == "warning" and score >= 2:
            # Check for sensitive content that warrants LLM review
            sensitive_reasons = {
                'financial_verification_request', 'unverified_health_claims',
                'brand_impersonation', 'brand_similarity'
            }
            if any(reason in sensitive_reasons for reason in reasons):
                return True
        
        # Always escalate if we have brand impersonation signals
        if any('brand' in reason for reason in reasons):
            return True
        
        return False
    
    def get_analysis_summary(self, result: AnalysisResult) -> str:
        """Generate human-readable summary of analysis"""
        if result.verdict == "ok":
            return "No significant risks detected"
        
        summary_parts = []
        
        # Brand-related summaries
        brand_details = result.details.get('brand_analysis', {})
        if brand_details.get('matched_brand'):
            brand = brand_details['matched_brand']
            match_type = brand_details.get('match_type', 'similarity')
            
            if match_type == 'exact_match_different_tld':
                summary_parts.append(f"Appears to impersonate {brand}")
            elif match_type == 'brand_with_keywords':
                keywords = brand_details.get('keywords_found', [])
                if keywords:
                    summary_parts.append(f"Contains {brand} branding with suspicious keywords: {', '.join(keywords[:2])}")
                else:
                    summary_parts.append(f"Contains {brand} branding with impersonation keywords")
            elif match_type == 'lookalike':
                summary_parts.append(f"Domain similar to {brand}")
        
        # Domain-related summaries
        domain_details = result.details.get('domain_analysis', {})
        if 'suspicious_domain' in result.reasons or 'suspicious_tld' in result.reasons:
            tld = domain_details.get('tld', '')
            if tld in ['.tk', '.ml', '.ga', '.cf']:
                summary_parts.append(f"Uses suspicious {tld} domain")
            else:
                summary_parts.append("Uses suspicious domain")
        
        # Content-related summaries
        if 'financial_verification_request' in result.reasons:
            summary_parts.append("Requests financial verification")
        if 'hype_language' in result.reasons:
            summary_parts.append("Uses high-pressure sales language")
        if 'offsite_form_submission' in result.reasons:
            summary_parts.append("Forms submit to external sites")
        if 'unverified_health_claims' in result.reasons:
            summary_parts.append("Makes unverified health claims")
        
        # Technical summaries
        if 'no_https' in result.reasons:
            summary_parts.append("Does not use secure HTTPS")
        if 'excessive_redirects' in result.reasons:
            summary_parts.append("Uses excessive redirects")
        if 'fetch_failed' in result.reasons:
            summary_parts.append("Website failed to load properly")
        
        if not summary_parts:
            return f"Flagged with {result.score} risk points"
        
        # Format as bullet points
        return "• " + "\n• ".join(summary_parts[:3])  # Limit to top 3 points