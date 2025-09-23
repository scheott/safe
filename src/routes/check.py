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
from ..services.database import get_db_service

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

@router.post("/check", response_model=CheckResponse)
async def check_url(request: CheckRequest, req: Request):
    """
    Main URL checking endpoint - Phase 2.4 with Tier-0 scoring + persistent logging.
    
    Flow:
    1. Normalize URL and strip tracking params
    2. Fetch first 100-200KB of content with staged timeouts  
    3. Run Tier-0 heuristic analysis (domain reputation + content analysis)
    4. Log every check to SQLite database (Step 1 requirement)
    5. Return verdict with reasons and metadata
    """
    start_time = time.time()
    
    # Get services from app state (or fallback to singletons)
    try:
        reputation_service = req.app.state.reputation_service
        tier0_analyzer = req.app.state.tier0_analyzer
    except AttributeError:
        # Fallback to singleton pattern for backward compatibility
        reputation_service = ReputationService()
        tier0_analyzer = Tier0Analyzer(reputation_service)
    
    db_service = get_db_service()
    url_str = str(request.url)
    
    try:
        # Step 1: Normalize URL
        logger.info(f"Starting check for URL: {url_str}")
        normalization_result = url_normalizer.normalize(url_str)
        
        # Step 2: Fetch page content
        fetch_start = time.time()
        fetch_result = await url_fetcher.fetch_url(normalization_result.normalized_url)
        fetch_time_ms = int((time.time() - fetch_start) * 1000)
        
        # Handle different fetch outcomes
        if fetch_result.success:
            # Step 3a: Successful fetch - full analysis
            return await _handle_successful_fetch(
                fetch_result, normalization_result, start_time, 
                tier0_analyzer, db_service, url_str
            )
        elif fetch_result.was_blocked:
            # Step 3b: Site has WAF/protection - limited analysis
            return await _handle_blocked_response(
                fetch_result, normalization_result, start_time,
                tier0_analyzer, db_service, url_str
            )
        else:
            # Step 3c: Fetch failed - domain-only analysis
            return await _handle_fetch_failure(
                fetch_result, normalization_result, start_time,
                tier0_analyzer, db_service, url_str
            )
        
    except Exception as e:
        processing_time_ms = int((time.time() - start_time) * 1000)
        logger.error(f"Unexpected error processing check request: {e}")
        
        # Try to log the error case too (Step 1 requirement)
        try:
            db_service.log_url_check(
                url=url_str,
                domain=url_str.split('/')[2] if '//' in url_str else 'unknown',
                verdict="error",
                reasons=["processing_error"],
                tier0_score=-1,
                analysis_details={"error": str(e), "error_type": type(e).__name__},
                processing_time_ms=processing_time_ms,
                fetch_time_ms=0,
                source="extension"
            )
        except:
            pass  # Don't fail on logging errors
        
        raise HTTPException(
            status_code=500,
            detail={
                "error": "internal_server_error",
                "message": "An unexpected error occurred while processing the request",
                "processing_time_ms": processing_time_ms
            }
        )

async def _handle_successful_fetch(
    fetch_result: FetchResult,
    normalization_result: Dict[str, Any], 
    start_time: float,
    tier0_analyzer,
    db_service,
    original_url: str
) -> CheckResponse:
    """Handle successful URL fetch with full content analysis"""
    
    # Step 3: Analyze with Tier-0 heuristics
    analysis_result = tier0_analyzer.analyze(
        url=fetch_result.final_url,
        fetch_result=fetch_result,
        content_excerpt=fetch_result.body_excerpt
    )
    
    # Calculate total processing time
    processing_time_ms = int((time.time() - start_time) * 1000)
    
    # Step 4: Log to database (CRITICAL - Step 1 requirement)
    log_success = False
    try:
        log_success = db_service.log_url_check(
            url=original_url,
            domain=fetch_result.domain,
            verdict=analysis_result.verdict,
            reasons=analysis_result.reasons,
            tier0_score=analysis_result.score,
            analysis_details={
                "final_url": fetch_result.final_url,
                "redirect_count": fetch_result.redirect_count,
                "content_length": fetch_result.content_length,
                "removed_tracking_params": getattr(normalization_result, 'removed_params_count', 0),
                "punycode_detected": getattr(normalization_result, 'punycode_detected', False),
                "tier0_details": analysis_result.details,
                "escalate_to_tier1": analysis_result.escalate_to_tier1,
                "analysis_mode": "full_content"
            },
            processing_time_ms=processing_time_ms,
            fetch_time_ms=fetch_result.fetch_time_ms,
            user_id=None,  # TODO: Extract from auth when implemented
            source="extension"
        )
        
        if log_success:
            logger.debug(f"Successfully logged check for {fetch_result.domain}")
        else:
            logger.warning(f"Failed to log check for {fetch_result.domain}")
            
    except Exception as log_error:
        # Don't fail the main request if logging fails
        logger.error(f"Database logging error: {log_error}")
    
    # Build response
    response = CheckResponse(
        verdict=analysis_result.verdict,
        reasons=analysis_result.reasons,
        summary=analysis_result.details.get('summary'),  # Will be None for Tier-0
        meta={
            "domain": fetch_result.domain,
            "title": fetch_result.title,
            "final_url": fetch_result.final_url,
            "redirect_count": fetch_result.redirect_count,
            "content_length": fetch_result.content_length,
            "fetch_time_ms": fetch_result.fetch_time_ms,
            "analysis_mode": "full_content",
            
            # Tier-0 analysis details
            "tier0_score": analysis_result.score,
            "tier0_details": analysis_result.details,
            "escalate_to_tier1": analysis_result.escalate_to_tier1,
            
            # URL normalization info
            "normalized_url": getattr(normalization_result, 'normalized_url', fetch_result.final_url),
            "removed_tracking_params": getattr(normalization_result, 'removed_params_count', 0),
            "punycode_detected": getattr(normalization_result, 'punycode_detected', False),
            "is_suspicious_tld": getattr(normalization_result, 'is_suspicious_tld', False),
            
            # Database logging status (for debugging)
            "logged_to_db": log_success
        },
        processing_time_ms=processing_time_ms
    )
    
    logger.info(f"Check completed for {fetch_result.domain}: {analysis_result.verdict} in {processing_time_ms}ms")
    return response

async def _handle_fetch_failure(
    fetch_result: FetchResult, 
    normalization_result: Dict[str, Any], 
    start_time: float,
    tier0_analyzer,
    db_service,
    original_url: str
) -> CheckResponse:
    """Handle cases where URL fetch failed - use domain-only analysis"""
    
    processing_time_ms = int((time.time() - start_time) * 1000)
    
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
    
    # Log to database (Step 1 requirement)
    log_success = False
    try:
        log_success = db_service.log_url_check(
            url=original_url,
            domain=getattr(normalization_result, 'domain', fetch_result.final_url.split('/')[2] if '//' in fetch_result.final_url else 'unknown'),
            verdict=verdict,
            reasons=reasons,
            tier0_score=analysis_result.score,
            analysis_details={
                "final_url": fetch_result.final_url,
                "error_reason": fetch_result.error_reason,
                "fetch_time_ms": fetch_result.fetch_time_ms,
                "redirect_count": fetch_result.redirect_count,
                "tier0_details": analysis_result.details,
                "analysis_mode": "domain_only"
            },
            processing_time_ms=processing_time_ms,
            fetch_time_ms=fetch_result.fetch_time_ms,
            source="extension"
        )
    except Exception as log_error:
        logger.error(f"Database logging error: {log_error}")
    
    return CheckResponse(
        verdict=verdict,
        reasons=reasons,
        summary=None,
        meta={
            "domain": getattr(normalization_result, 'domain', fetch_result.final_url.split('/')[2] if '//' in fetch_result.final_url else 'unknown'),
            "final_url": fetch_result.final_url,
            "title": None,
            "fetch_time_ms": fetch_result.fetch_time_ms,
            "redirect_count": fetch_result.redirect_count,
            "error_reason": fetch_result.error_reason,
            "analysis_mode": "domain_only",
            
            # Include domain analysis details
            "tier0_score": analysis_result.score,
            "tier0_details": analysis_result.details,
            "logged_to_db": log_success
        },
        processing_time_ms=processing_time_ms
    )

async def _handle_blocked_response(
    fetch_result: FetchResult,
    normalization_result: Dict[str, Any],
    start_time: float,
    tier0_analyzer,
    db_service,
    original_url: str
) -> CheckResponse:
    """Handle cases where site is blocking our requests"""
    
    processing_time_ms = int((time.time() - start_time) * 1000)
    
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
    
    # Log to database (Step 1 requirement)
    log_success = False
    try:
        log_success = db_service.log_url_check(
            url=original_url,
            domain=fetch_result.domain,
            verdict=final_verdict,
            reasons=reasons,
            tier0_score=analysis_result.score,
            analysis_details={
                "final_url": fetch_result.final_url,
                "was_blocked": fetch_result.was_blocked,
                "status_code": fetch_result.status_code,
                "tier0_details": analysis_result.details,
                "analysis_mode": "limited_waf"
            },
            processing_time_ms=processing_time_ms,
            fetch_time_ms=fetch_result.fetch_time_ms,
            source="extension"
        )
    except Exception as log_error:
        logger.error(f"Database logging error: {log_error}")
    
    return CheckResponse(
        verdict=final_verdict,
        reasons=reasons,
        summary=None,
        meta={
            "domain": fetch_result.domain,
            "final_url": fetch_result.final_url,
            "title": fetch_result.title,
            "fetch_time_ms": fetch_result.fetch_time_ms,
            "redirect_count": fetch_result.redirect_count,
            "status_code": fetch_result.status_code,
            "was_blocked": fetch_result.was_blocked,
            "analysis_mode": "limited_waf",
            
            # Include analysis details
            "tier0_score": analysis_result.score,
            "tier0_details": analysis_result.details,
            "logged_to_db": log_success
        },
        processing_time_ms=processing_time_ms
    )

# Analytics endpoints (Step 1 requirement)
@router.get("/analytics/daily")
async def get_daily_analytics(
    days: int = 7,
    req: Request = None
):
    """
    Get daily analytics for the last N days.
    
    Returns aggregated statistics including:
    - Total checks per day
    - Verdict distribution (ok/warning/danger)  
    - Average processing time
    - Unique domains checked
    
    This endpoint always returns a 200 response, even with no data.
    """
    try:
        db_service = get_db_service()
        stats = db_service.get_daily_stats(days)
        
        return {
            "status": "success",
            "days_requested": days,
            "total_days": len(stats),
            "stats": stats
        }
        
    except Exception as e:
        logger.error(f"Error getting daily analytics: {e}")
        # Still return 200 with empty data as per Step 1 requirement
        return {
            "status": "success", 
            "days_requested": days,
            "total_days": 0,
            "stats": [],
            "note": "Analytics data temporarily unavailable"
        }

@router.get("/analytics/summary")
async def get_analytics_summary():
    """Get overall analytics summary"""
    try:
        db_service = get_db_service()
        
        total_checks = db_service.get_total_checks()
        verdict_distribution = db_service.get_verdict_distribution(30)  # Last 30 days
        
        return {
            "status": "success",
            "total_checks": total_checks,
            "verdict_distribution": verdict_distribution,
            "timestamp": time.time()
        }
        
    except Exception as e:
        logger.error(f"Error getting analytics summary: {e}")
        # Return empty data on error
        return {
            "status": "success",
            "total_checks": 0,
            "verdict_distribution": {"ok": 0, "warning": 0, "danger": 0},
            "timestamp": time.time(),
            "note": "Analytics data temporarily unavailable"
        }

# Database management endpoints
@router.get("/database/info")
async def get_database_info():
    """Get database information and statistics"""
    try:
        db_service = get_db_service()
        
        total_checks = db_service.get_total_checks()
        verdict_distribution = db_service.get_verdict_distribution(7)
        
        return {
            "status": "success",
            "database": {
                "total_checks": total_checks,
                "recent_verdict_distribution": verdict_distribution,
                "database_path": str(db_service.db_path),
                "initialized": True
            }
        }
    except Exception as e:
        logger.error(f"Error getting database info: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/database/cleanup")
async def cleanup_database(days: int = 30):
    """Clean up old database records"""
    try:
        db_service = get_db_service()
        deleted_count = db_service.cleanup_old_records(days)
        return {
            "status": "success",
            "message": f"Cleaned up {deleted_count} records older than {days} days",
            "deleted_count": deleted_count,
            "retention_days": days
        }
    except Exception as e:
        logger.error(f"Error cleaning up database: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# Reputation service endpoints (preserving existing functionality)
@router.get("/reputation/stats")
async def get_reputation_stats(req: Request):
    """Get statistics about loaded reputation data"""
    try:
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
    except Exception as e:
        logger.error(f"Error getting reputation stats: {e}")
        return {
            "status": "error",
            "message": str(e)
        }

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