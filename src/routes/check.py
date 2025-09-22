# api/src/routes/check.py
from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel, HttpUrl
import logging
import time
from typing import Optional, List, Dict, Any

from ..services.url_fetcher import URLFetcher, FetchResult
from ..services.url_normalizer import URLNormalizer
from ..services.waf_detector import WAFDetector

logger = logging.getLogger(__name__)

router = APIRouter()

# Request/Response models
class CheckRequest(BaseModel):
    url: HttpUrl

class CheckResponse(BaseModel):
    verdict: str  # "ok" | "warning" | "danger"
    reasons: List[str]
    summary: Optional[str] = None
    meta: Dict[str, Any]
    processing_time_ms: int

# Initialize services
url_fetcher = URLFetcher()
url_normalizer = URLNormalizer()
waf_detector = WAFDetector()

@router.post("/check", response_model=CheckResponse)
async def check_url(request: CheckRequest, req: Request):
    """
    Main URL checking endpoint.
    
    Phase 2.1 Implementation:
    - Normalize URL and strip tracking params
    - Fetch first 100-200KB of content with staged timeouts
    - Handle redirects (≤3 hops) with SSRF guards
    - Extract title and body excerpt
    - Return basic structure (Tier-0 scoring comes in Phase 2.3)
    """
    start_time = time.time()
    
    try:
        # Convert pydantic HttpUrl to string
        url_str = str(request.url)
        
        logger.info(f"Processing check request for URL: {url_str}")
        
        # Step 1: Normalize URL
        normalization_result = url_normalizer.normalize_url(url_str)
        normalized_url = normalization_result['normalized_url']
        
        logger.info(f"Normalized URL: {normalized_url}")
        logger.info(f"Removed {normalization_result['removed_params_count']} tracking parameters")
        
        # Step 2: Fetch URL content
        try:
            fetch_result = await url_fetcher.fetch_url(normalized_url)
            logger.info(f"Fetch completed in {fetch_result.fetch_time_ms}ms, success: {fetch_result.success}")
        except Exception as e:
            logger.error(f"Fetch error for {normalized_url}: {type(e).__name__}: {e}")
            processing_time = int((time.time() - start_time) * 1000)
            return CheckResponse(
                verdict="warning",
                reasons=["fetch_failed", f"fetch_error_{type(e).__name__}"],
                summary=None,
                meta={
                    "domain": normalization_result['domain'],
                    "final_url": normalized_url,
                    "title": None,
                    "fetch_time_ms": 0,
                    "redirect_count": 0,
                    "error_reason": f"fetch_error_{type(e).__name__}",
                    "analysis_mode": "domain_only",
                    "error_details": str(e)
                },
                processing_time_ms=processing_time
            )
        
        # Step 3: Analyze fetch result and determine response
        if not fetch_result.success:
            # Handle fetch failures
            return await _handle_fetch_failure(
                fetch_result, 
                normalization_result, 
                start_time
            )
        
        # Step 4: Check for WAF/blocking
        is_blocked = waf_detector.is_blocked_response(fetch_result)
        if is_blocked:
            logger.info(f"Detected WAF/blocking response for {normalized_url}")
            return await _handle_blocked_response(
                fetch_result,
                normalization_result,
                start_time
            )
        
        # Step 5: Successful fetch - analyze content
        return await _handle_successful_fetch(
            fetch_result,
            normalization_result,
            start_time
        )
        
    except Exception as e:
        logger.error(f"Unexpected error processing check request: {e}")
        processing_time = int((time.time() - start_time) * 1000)
        
        raise HTTPException(
            status_code=500,
            detail={
                "error": "internal_server_error",
                "message": "An unexpected error occurred while processing the request",
                "processing_time_ms": processing_time
            }
        )

async def _handle_fetch_failure(
    fetch_result: FetchResult, 
    normalization_result: Dict[str, Any], 
    start_time: float
) -> CheckResponse:
    """Handle cases where URL fetch failed"""
    
    processing_time = int((time.time() - start_time) * 1000)
    
    # Determine verdict based on failure type
    verdict = "warning"  # Default to warning for fetch failures
    reasons = ["fetch_failed"]
    
    # Add specific failure reasons
    if fetch_result.error_reason:
        reasons.append(fetch_result.error_reason)
    
    # Special cases
    if "timeout" in fetch_result.error_reason:
        reasons.append("site_slow_response")
    elif "blocked_by_site" in fetch_result.error_reason:
        reasons.append("access_restricted")
    elif "invalid_url" in fetch_result.error_reason:
        verdict = "danger"
        reasons = ["invalid_url", "malformed_address"]
    
    return CheckResponse(
        verdict=verdict,
        reasons=reasons,
        summary=None,  # No summary for failed fetches in Phase 2.1
        meta={
            "domain": normalization_result['domain'],
            "final_url": fetch_result.final_url,
            "title": None,
            "fetch_time_ms": fetch_result.fetch_time_ms,
            "redirect_count": fetch_result.redirect_count,
            "error_reason": fetch_result.error_reason,
            "analysis_mode": "domain_only"
        },
        processing_time_ms=processing_time
    )

async def _handle_blocked_response(
    fetch_result: FetchResult,
    normalization_result: Dict[str, Any],
    start_time: float
) -> CheckResponse:
    """Handle cases where site is blocking our requests"""
    
    processing_time = int((time.time() - start_time) * 1000)
    
    # WAF/blocking usually indicates a legitimate site with protection
    verdict = "ok"  # Sites with WAF are often legitimate
    reasons = ["site_has_protection", "limited_analysis"]
    
    # Add specific blocking indicators
    if fetch_result.was_blocked:
        reasons.append("access_restricted")
    
    if fetch_result.status_code == 429:
        reasons.append("rate_limited")
    
    return CheckResponse(
        verdict=verdict,
        reasons=reasons,
        summary=None,
        meta={
            "domain": normalization_result['domain'],
            "final_url": fetch_result.final_url,
            "title": fetch_result.title,
            "fetch_time_ms": fetch_result.fetch_time_ms,
            "redirect_count": fetch_result.redirect_count,
            "status_code": fetch_result.status_code,
            "analysis_mode": "domain_only_blocked"
        },
        processing_time_ms=processing_time
    )

async def _handle_successful_fetch(
    fetch_result: FetchResult,
    normalization_result: Dict[str, Any],
    start_time: float
) -> CheckResponse:
    """Handle successful fetch - perform basic analysis"""
    
    processing_time = int((time.time() - start_time) * 1000)
    
    # Phase 2.1: Basic placeholder analysis
    # (Tier-0 scoring will be implemented in Phase 2.3)
    
    verdict = "ok"  # Default to OK for successful fetches
    reasons = ["content_fetched"]
    
    # Basic heuristics based on URL structure
    domain = normalization_result['domain']
    
    # Very basic domain reputation (will be expanded in Phase 2.3)
    if any(trusted in domain for trusted in ['google.', 'wikipedia.', 'github.', 'stackoverflow.']):
        verdict = "ok"
        reasons = ["known_reputable_domain"]
    elif any(suspicious in domain for suspicious in ['.tk', '.ml', '.ga', '.cf']):
        verdict = "warning"
        reasons = ["suspicious_tld", "content_fetched"]
    
    # Basic content analysis
    if fetch_result.body_excerpt:
        content_lower = fetch_result.body_excerpt.lower()
        
        # Simple keyword detection (will be expanded)
        warning_keywords = ['urgent', 'limited time', 'act now', 'click here', 'free money']
        danger_keywords = ['verify account', 'suspended', 'confirm identity', 'update payment']
        
        if any(keyword in content_lower for keyword in danger_keywords):
            verdict = "danger"
            reasons = ["suspicious_content", "account_verification_request"]
        elif any(keyword in content_lower for keyword in warning_keywords):
            verdict = "warning"
            reasons = ["clickbait_content", "urgency_language"]
    
    # Check for suspicious URL patterns
    if normalization_result['punycode_info'].get('is_suspicious'):
        verdict = "warning"
        reasons.append("punycode_domain")
    
    return CheckResponse(
        verdict=verdict,
        reasons=reasons,
        summary=None,  # Phase 2.1: No summaries yet
        meta={
            "domain": normalization_result['domain'],
            "final_url": fetch_result.final_url,
            "title": fetch_result.title,
            "fetch_time_ms": fetch_result.fetch_time_ms,
            "redirect_count": fetch_result.redirect_count,
            "status_code": fetch_result.status_code,
            "content_type": fetch_result.content_type,
            "analysis_mode": "full_content",
            "normalized_url": normalization_result['normalized_url'],
            "removed_tracking_params": normalization_result['removed_params_count'],
            "punycode_detected": normalization_result['punycode_info'].get('has_punycode', False)
        },
        processing_time_ms=processing_time
    )