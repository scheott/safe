# api/src/routes/check.py
from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel, HttpUrl
import logging
import time
from typing import Optional, List, Dict, Any

from ..services.url_fetcher import URLFetcher, FetchResult
from ..services.url_normalizer import URLNormalizer
from ..services.waf_detector import WAFDetector
from ..services.reputation_service import ReputationService
from ..services.tier0_analyzer import Tier0Analyzer
from ..services.database import log_url_check, get_daily_stats, db_service

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

# Initialize services (singleton pattern) - Keep for backward compatibility
url_fetcher = URLFetcher()
url_normalizer = URLNormalizer()
waf_detector = WAFDetector()

# Note: reputation_service and tier0_analyzer now come from app.state

@router.post("/check", response_model=CheckResponse)
async def check_url(request: CheckRequest, req: Request):
    """
    Main URL checking endpoint - Phase 2.3 with Tier-0 scoring.
    """
    start_time = time.time()
    
    try:
        # Get services from app state
        reputation_service = req.app.state.reputation_service
        tier0_analyzer = req.app.state.tier0_analyzer
        
        # Convert pydantic HttpUrl to string
        url_str = str(request.url)
        
        logger.info(f"Processing check request for URL: {url_str}")
        
        # Hot-reload reputation data if needed (for live updates)
        reputation_service.hot_reload_if_needed()
        
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
            
            # Log failed fetch
            log_url_check(
                url=normalized_url,
                domain=normalization_result['domain'],
                verdict="warning",
                reasons=["fetch_failed", f"fetch_error_{type(e).__name__}"],
                tier0_score=2,
                analysis_details={"error": str(e), "error_type": type(e).__name__},
                processing_time_ms=processing_time,
                fetch_time_ms=0
            )
            
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
        
        # Step 5: Run Tier-0 Analysis
        analysis_result = tier0_analyzer.analyze(
            url=normalized_url,
            fetch_result=fetch_result,
            content_excerpt=fetch_result.body_excerpt
        )
        
        logger.info(f"Tier-0 analysis: verdict={analysis_result.verdict}, "
                   f"score={analysis_result.score}, "
                   f"escalate={analysis_result.escalate_to_tier1}")
        
        # Step 6: Log to database
        processing_time = int((time.time() - start_time) * 1000)
        
        log_success = log_url_check(
            url=normalized_url,
            domain=normalization_result['domain'],
            verdict=analysis_result.verdict,
            reasons=analysis_result.reasons,
            tier0_score=analysis_result.score,
            analysis_details=analysis_result.details,
            processing_time_ms=processing_time,
            fetch_time_ms=fetch_result.fetch_time_ms
        )
        
        if not log_success:
            logger.warning("Failed to log URL check to database")
        
        # Step 7: Return result
        return CheckResponse(
            verdict=analysis_result.verdict,
            reasons=analysis_result.reasons,
            summary=None,  # Phase 2.3: No Tier-1 summaries yet
            meta={
                "domain": normalization_result['domain'],
                "final_url": fetch_result.final_url,
                "title": fetch_result.title,
                "fetch_time_ms": fetch_result.fetch_time_ms,
                "redirect_count": fetch_result.redirect_count,
                "status_code": fetch_result.status_code,
                "content_type": fetch_result.content_type,
                "analysis_mode": "tier0_complete",
                
                # Tier-0 analysis details
                "tier0_score": analysis_result.score,
                "tier0_details": analysis_result.details,
                "escalate_to_tier1": analysis_result.escalate_to_tier1,
                
                # URL normalization info
                "normalized_url": normalization_result['normalized_url'],
                "removed_tracking_params": normalization_result['removed_params_count'],
                "punycode_detected": normalization_result['punycode_info'].get('has_punycode', False),
                "is_suspicious_tld": normalization_result.get('is_suspicious_tld', False),
                
                # Reputation service stats
                "reputation_stats": reputation_service.get_stats(),
                
                # Database logging status
                "logged_to_db": log_success
            },
            processing_time_ms=processing_time
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
    """Handle cases where URL fetch failed - use domain-only analysis"""
    
    processing_time = int((time.time() - start_time) * 1000)
    
    # Run domain-only Tier-0 analysis
    analysis_result = tier0_analyzer.analyze(
        url=fetch_result.final_url,
        fetch_result=fetch_result,
        content_excerpt=None  # No content available
    )
    
    # Combine fetch failure reasons with analysis reasons
    reasons = analysis_result.reasons.copy()
    reasons.append("fetch_failed")
    
    # Add specific failure reasons
    if fetch_result.error_reason:
        reasons.append(fetch_result.error_reason)
    
    # Special cases for verdict adjustment
    verdict = analysis_result.verdict
    if "timeout" in fetch_result.error_reason:
        reasons.append("site_slow_response")
    elif "blocked_by_site" in fetch_result.error_reason:
        reasons.append("access_restricted")
    elif "invalid_url" in fetch_result.error_reason:
        # Override verdict for invalid URLs
        verdict = "danger"
        analysis_result.score = 4
        reasons = ["invalid_url", "malformed_address"]
    elif "ConnectError" in fetch_result.error_reason or "timeout" in fetch_result.error_reason:
        # Network errors for non-reputable domains should be warnings
        domain_score = analysis_result.details.get('domain_analysis', {}).get('reputation_score', 0)
        if domain_score >= 0:  # Not a reputable domain (-1 or higher = not trusted)
            if verdict == "ok":  # Only upgrade if currently "ok"
                verdict = "warning"
                analysis_result.score = max(analysis_result.score, 2)  # Ensure warning threshold
                reasons.append("network_error_suspicious")
    
    # Log to database
    log_url_check(
        url=fetch_result.final_url,
        domain=normalization_result['domain'],
        verdict=verdict,
        reasons=reasons,
        tier0_score=analysis_result.score,
        analysis_details=analysis_result.details,
        processing_time_ms=processing_time,
        fetch_time_ms=fetch_result.fetch_time_ms
    )
    
    return CheckResponse(
        verdict=verdict,
        reasons=reasons,
        summary=None,
        meta={
            "domain": normalization_result['domain'],
            "final_url": fetch_result.final_url,
            "title": None,
            "fetch_time_ms": fetch_result.fetch_time_ms,
            "redirect_count": fetch_result.redirect_count,
            "error_reason": fetch_result.error_reason,
            "analysis_mode": "domain_only",
            
            # Include domain analysis details
            "tier0_score": analysis_result.score,
            "tier0_details": analysis_result.details
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
    
    # Run analysis with limited content
    analysis_result = tier0_analyzer.analyze(
        url=fetch_result.final_url,
        fetch_result=fetch_result,
        content_excerpt=fetch_result.body_excerpt  # May contain WAF page
    )
    
    # WAF/blocking usually indicates a legitimate site with protection
    # But still run our analysis to check for domain issues
    reasons = analysis_result.reasons.copy()
    reasons.extend(["site_has_protection", "limited_analysis"])
    
    # Add specific blocking indicators
    if fetch_result.was_blocked:
        reasons.append("access_restricted")
    
    if fetch_result.status_code == 429:
        reasons.append("rate_limited")
    
    # For legitimate sites with WAF, lean toward "ok" unless domain analysis suggests otherwise
    if analysis_result.verdict == "danger":
        # Keep danger verdict if domain analysis found serious issues
        final_verdict = "danger"
    elif analysis_result.score >= 2:
        # Some suspicious signals but has WAF protection
        final_verdict = "warning"
    else:
        # Likely legitimate site with protection
        final_verdict = "ok"
    
    # Log to database
    log_url_check(
        url=fetch_result.final_url,
        domain=normalization_result['domain'],
        verdict=final_verdict,
        reasons=reasons,
        tier0_score=analysis_result.score,
        analysis_details=analysis_result.details,
        processing_time_ms=processing_time,
        fetch_time_ms=fetch_result.fetch_time_ms
    )
    
    return CheckResponse(
        verdict=final_verdict,
        reasons=reasons,
        summary=None,
        meta={
            "domain": normalization_result['domain'],
            "final_url": fetch_result.final_url,
            "title": fetch_result.title,
            "fetch_time_ms": fetch_result.fetch_time_ms,
            "redirect_count": fetch_result.redirect_count,
            "status_code": fetch_result.status_code,
            "analysis_mode": "blocked_response",
            
            # Include analysis details
            "tier0_score": analysis_result.score,
            "tier0_details": analysis_result.details,
            "waf_detected": True
        },
        processing_time_ms=processing_time
    )

# Additional analytics endpoints
@router.get("/analytics/daily")
async def get_analytics_daily(days: int = 7):
    """Get daily analytics for the last N days"""
    try:
        from ..services.database import db_service
        stats = db_service.get_daily_stats(days)
        return {
            "status": "success",
            "days_requested": days,
            "total_days": len(stats),
            "stats": stats
        }
    except Exception as e:
        logger.error(f"Error getting daily analytics: {e}")
        # Return empty but successful response instead of 500 for MVP
        return {
            "status": "success",
            "days_requested": days,
            "total_days": 0,
            "stats": [],
            "note": "Analytics data not yet available"
        }

@router.get("/analytics/domains")
async def get_domain_analytics(days: int = 7):
    """Get domain-level analytics"""
    try:
        domain_stats = db_service.get_domain_stats(days)
        return {
            "status": "success", 
            "days_requested": days,
            "total_domains": len(domain_stats),
            "domains": domain_stats
        }
    except Exception as e:
        logger.error(f"Error getting domain analytics: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/analytics/recent")
async def get_recent_checks(limit: int = 50):
    """Get recent URL checks (anonymized)"""
    try:
        recent_checks = db_service.get_recent_checks(limit)
        return {
            "status": "success",
            "limit": limit,
            "total_returned": len(recent_checks),
            "checks": recent_checks
        }
    except Exception as e:
        logger.error(f"Error getting recent checks: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# Additional endpoint for reputation service stats
@router.get("/reputation/stats")
async def get_reputation_stats(req: Request):
    """Get statistics about loaded reputation data"""
    reputation_service = req.app.state.reputation_service
    return {
        "status": "healthy",
        "reputation_service": reputation_service.get_stats(),
        "data_files": [
            "reputable_domains.json",
            "brand_domains.json", 
            "suspicious_indicators.json",
            "heuristic_weights.json"
        ]
    }

# Endpoint to trigger reputation data reload
@router.post("/reputation/reload")
async def reload_reputation_data(req: Request):
    """Manually trigger a reload of reputation data"""
    try:
        reputation_service = req.app.state.reputation_service
        success = reputation_service.load_all_data()
        if success:
            return {
                "status": "success",
                "message": "Reputation data reloaded successfully",
                "stats": reputation_service.get_stats()
            }
        else:
            raise HTTPException(
                status_code=500,
                detail="Failed to reload reputation data"
            )
    except Exception as e:
        logger.error(f"Error reloading reputation data: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Error reloading reputation data: {str(e)}"
        )

# Database management endpoints
@router.get("/database/info")
async def get_database_info():
    """Get database information and statistics"""
    try:
        info = db_service.get_database_info()
        return {
            "status": "success",
            "database": info
        }
    except Exception as e:
        logger.error(f"Error getting database info: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/database/cleanup")
async def cleanup_database(days: int = 30):
    """Clean up old database records"""
    try:
        deleted_count = db_service.cleanup_old_records(days)
        return {
            "status": "success",
            "message": f"Cleaned up {deleted_count} records older than {days} days",
            "deleted_count": deleted_count,
            "retention_days": days
        }
    except Exception as e:
        logger.error(f"Error cleaning up database: {e}")
        raise HTTPException(status_code=500, detail=str(e))# api/src/routes/check.py
from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel, HttpUrl
import logging
import time
from typing import Optional, List, Dict, Any

from ..services.url_fetcher import URLFetcher, FetchResult
from ..services.url_normalizer import URLNormalizer
from ..services.waf_detector import WAFDetector
from ..services.reputation_service import ReputationService
from ..services.tier0_analyzer import Tier0Analyzer

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

# Initialize services (singleton pattern)
url_fetcher = URLFetcher()
url_normalizer = URLNormalizer()
waf_detector = WAFDetector()

# Initialize reputation service and analyzer
reputation_service = ReputationService()
tier0_analyzer = Tier0Analyzer(reputation_service)

@router.post("/check", response_model=CheckResponse)
async def check_url(request: CheckRequest, req: Request):
    """
    Main URL checking endpoint - Phase 2.3 with Tier-0 scoring.
    
    Flow:
    1. Normalize URL and strip tracking params
    2. Fetch first 100-200KB of content with staged timeouts  
    3. Run Tier-0 heuristic analysis (domain reputation + content analysis)
    4. Return verdict with explainable reasons
    """
    start_time = time.time()
    
    try:
        # Convert pydantic HttpUrl to string
        url_str = str(request.url)
        
        logger.info(f"Processing check request for URL: {url_str}")
        
        # Hot-reload reputation data if needed (for live updates)
        reputation_service.hot_reload_if_needed()
        
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
        
        # Step 5: Run Tier-0 Analysis
        analysis_result = tier0_analyzer.analyze(
            url=normalized_url,
            fetch_result=fetch_result,
            content_excerpt=fetch_result.body_excerpt
        )
        
        logger.info(f"Tier-0 analysis: verdict={analysis_result.verdict}, "
                   f"score={analysis_result.score}, "
                   f"escalate={analysis_result.escalate_to_tier1}")
        
        # Step 6: Return result
        processing_time = int((time.time() - start_time) * 1000)
        
        return CheckResponse(
            verdict=analysis_result.verdict,
            reasons=analysis_result.reasons,
            summary=None,  # Phase 2.3: No Tier-1 summaries yet
            meta={
                "domain": normalization_result['domain'],
                "final_url": fetch_result.final_url,
                "title": fetch_result.title,
                "fetch_time_ms": fetch_result.fetch_time_ms,
                "redirect_count": fetch_result.redirect_count,
                "status_code": fetch_result.status_code,
                "content_type": fetch_result.content_type,
                "analysis_mode": "tier0_complete",
                
                # Tier-0 analysis details
                "tier0_score": analysis_result.score,
                "tier0_details": analysis_result.details,
                "escalate_to_tier1": analysis_result.escalate_to_tier1,
                
                # URL normalization info
                "normalized_url": normalization_result['normalized_url'],
                "removed_tracking_params": normalization_result['removed_params_count'],
                "punycode_detected": normalization_result['punycode_info'].get('has_punycode', False),
                "is_suspicious_tld": normalization_result.get('is_suspicious_tld', False),
                
                # Reputation service stats
                "reputation_stats": reputation_service.get_stats()
            },
            processing_time_ms=processing_time
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
    """Handle cases where URL fetch failed - use domain-only analysis"""
    
    processing_time = int((time.time() - start_time) * 1000)
    
    # Run domain-only Tier-0 analysis
    analysis_result = tier0_analyzer.analyze(
        url=fetch_result.final_url,
        fetch_result=fetch_result,
        content_excerpt=None  # No content available
    )
    
    # Combine fetch failure reasons with analysis reasons
    reasons = analysis_result.reasons.copy()
    reasons.append("fetch_failed")
    
    # Add specific failure reasons
    if fetch_result.error_reason:
        reasons.append(fetch_result.error_reason)
    
    # Special cases for verdict adjustment
    if "timeout" in fetch_result.error_reason:
        reasons.append("site_slow_response")
    elif "blocked_by_site" in fetch_result.error_reason:
        reasons.append("access_restricted")
    elif "invalid_url" in fetch_result.error_reason:
        # Override verdict for invalid URLs
        analysis_result.verdict = "danger"
        reasons = ["invalid_url", "malformed_address"]
    
    return CheckResponse(
        verdict=analysis_result.verdict,
        reasons=reasons,
        summary=None,
        meta={
            "domain": normalization_result['domain'],
            "final_url": fetch_result.final_url,
            "title": None,
            "fetch_time_ms": fetch_result.fetch_time_ms,
            "redirect_count": fetch_result.redirect_count,
            "error_reason": fetch_result.error_reason,
            "analysis_mode": "domain_only",
            
            # Include domain analysis details
            "tier0_score": analysis_result.score,
            "tier0_details": analysis_result.details
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
    
    # Run analysis with limited content
    analysis_result = tier0_analyzer.analyze(
        url=fetch_result.final_url,
        fetch_result=fetch_result,
        content_excerpt=fetch_result.body_excerpt  # May contain WAF page
    )
    
    # WAF/blocking usually indicates a legitimate site with protection
    # But still run our analysis to check for domain issues
    reasons = analysis_result.reasons.copy()
    reasons.extend(["site_has_protection", "limited_analysis"])
    
    # Add specific blocking indicators
    if fetch_result.was_blocked:
        reasons.append("access_restricted")
    
    if fetch_result.status_code == 429:
        reasons.append("rate_limited")
    
    # For legitimate sites with WAF, lean toward "ok" unless domain analysis suggests otherwise
    if analysis_result.verdict == "danger":
        # Keep danger verdict if domain analysis found serious issues
        final_verdict = "danger"
    elif analysis_result.score >= 2:
        # Some suspicious signals but has WAF protection
        final_verdict = "warning"
    else:
        # Likely legitimate site with protection
        final_verdict = "ok"
    
    return CheckResponse(
        verdict=final_verdict,
        reasons=reasons,
        summary=None,
        meta={
            "domain": normalization_result['domain'],
            "final_url": fetch_result.final_url,
            "title": fetch_result.title,
            "fetch_time_ms": fetch_result.fetch_time_ms,
            "redirect_count": fetch_result.redirect_count,
            "status_code": fetch_result.status_code,
            "analysis_mode": "blocked_response",
            
            # Include analysis details
            "tier0_score": analysis_result.score,
            "tier0_details": analysis_result.details,
            "waf_detected": True
        },
        processing_time_ms=processing_time
    )

# Additional endpoint for reputation service stats
@router.get("/reputation/stats")
async def get_reputation_stats():
    """Get statistics about loaded reputation data"""
    return {
        "status": "healthy",
        "reputation_service": reputation_service.get_stats(),
        "data_files": [
            "reputable_domains.json",
            "brand_domains.json", 
            "suspicious_indicators.json",
            "heuristic_weights.json"
        ]
    }

# Endpoint to trigger reputation data reload
@router.post("/reputation/reload")
async def reload_reputation_data():
    """Manually trigger a reload of reputation data"""
    try:
        success = reputation_service.load_all_data()
        if success:
            return {
                "status": "success",
                "message": "Reputation data reloaded successfully",
                "stats": reputation_service.get_stats()
            }
        else:
            raise HTTPException(
                status_code=500,
                detail="Failed to reload reputation data"
            )
    except Exception as e:
        logger.error(f"Error reloading reputation data: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Error reloading reputation data: {str(e)}"
        )