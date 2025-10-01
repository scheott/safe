# api/main_with_scanners.py
"""
Updated main.py with Phase 2.5 scanner endpoints integrated
This shows how to add the scanners to your existing API
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import logging
from typing import Optional

# Import existing modules (from your Phase 2 implementation)
from tier0_analyzer import Tier0Analyzer
from reputation_service import ReputationService
from url_processor import URLProcessor
from database import Database

# Import new Phase 2.5 scanners
from scan_endpoints import (
    router as scan_router,
    ProductScanner,
    HealthScanner
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# ============================================================================
# APP LIFECYCLE
# ============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifecycle"""
    # Startup
    logger.info("🚀 Starting SafeSignal API with Scanner Support...")
    
    # Initialize services
    app.state.reputation = ReputationService()
    app.state.analyzer = Tier0Analyzer()
    app.state.db = Database()
    app.state.url_processor = URLProcessor()
    
    # Initialize scanners
    app.state.product_scanner = ProductScanner()
    app.state.health_scanner = HealthScanner()
    
    # Load data
    await app.state.reputation.initialize()
    await app.state.analyzer.initialize()
    
    logger.info("✅ All services initialized successfully")
    
    yield
    
    # Shutdown
    logger.info("👋 Shutting down SafeSignal API...")
    await app.state.db.close()

# ============================================================================
# APP INITIALIZATION
# ============================================================================

app = FastAPI(
    title="SafeSignal API",
    description="Elder-safe web protection with product & health scanning",
    version="2.5.0",
    lifespan=lifespan
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure properly for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================================
# EXISTING ENDPOINTS (Phase 2)
# ============================================================================

@app.get("/")
async def root():
    """Health check endpoint"""
    return {
        "service": "SafeSignal API",
        "version": "2.5.0",
        "status": "healthy",
        "features": [
            "tier0_analysis",
            "domain_reputation", 
            "product_scanner",
            "health_scanner"
        ]
    }

@app.post("/api/check")
async def check_url(request: dict):
    """
    Main URL safety check endpoint
    Returns verdict, reasons, and (for paid) summary
    """
    url = request.get("url")
    if not url:
        raise HTTPException(status_code=400, detail="URL is required")
    
    # Process URL
    processed = await app.state.url_processor.process(url)
    
    # Run Tier-0 analysis
    analysis = await app.state.analyzer.analyze(
        url=processed.final_url,
        content=processed.content,
        title=processed.title
    )
    
    # Check reputation
    reputation = await app.state.reputation.check_domain(processed.domain)
    
    # Combine signals
    total_score = analysis.score + reputation.score_adjustment
    
    # Determine verdict
    if total_score >= 4:
        verdict = "danger"
    elif total_score >= 2:
        verdict = "warning"
    else:
        verdict = "ok"
    
    # Log check
    await app.state.db.log_check(
        url=processed.final_url,
        verdict=verdict,
        reasons=analysis.reasons,
        user_id=request.get("user_id")
    )
    
    return {
        "verdict": verdict,
        "reasons": analysis.reasons,
        "summary": analysis.summary if request.get("paid") else None,
        "meta": {
            "domain": processed.domain,
            "title": processed.title,
            "final_url": processed.final_url
        }
    }

@app.get("/api/analytics/summary")
async def get_analytics_summary():
    """Get analytics summary"""
    return await app.state.db.get_analytics_summary()

# ============================================================================
# REGISTER SCANNER ENDPOINTS (Phase 2.5)
# ============================================================================

# This adds all the /api/scan/* endpoints
app.include_router(scan_router)

# ============================================================================
# ADDITIONAL SCANNER INTEGRATION ENDPOINTS
# ============================================================================

@app.post("/api/check_with_scan")
async def check_url_with_scan(request: dict):
    """
    Enhanced check that includes scanner results
    Combines safety verdict with product/health scanning
    """
    url = request.get("url")
    hints = request.get("hints", {})
    
    # Run normal safety check
    safety_result = await check_url({"url": url, "paid": request.get("paid")})
    
    # Initialize scan results
    scan_results = {
        "product": None,
        "health": None
    }
    
    # If hints suggest product context
    if hints.get("product_hints"):
        try:
            from scan_endpoints import ProductScanRequest, ProductHints
            
            product_request = ProductScanRequest(
                url=url,
                hints=ProductHints(**hints["product_hints"]),
                mode=request.get("mode", "fast")
            )
            
            scan_results["product"] = await app.state.product_scanner.scan(
                product_request
            )
        except Exception as e:
            logger.warning(f"Product scan failed: {e}")
    
    # If hints suggest health context
    if hints.get("health_hints"):
        try:
            from scan_endpoints import HealthScanRequest, HealthHints
            
            health_request = HealthScanRequest(
                url=url,
                hints=HealthHints(**hints["health_hints"]),
                mode=request.get("mode", "fast")
            )
            
            scan_results["health"] = await app.state.health_scanner.scan(
                health_request
            )
        except Exception as e:
            logger.warning(f"Health scan failed: {e}")
    
    # Combine results
    return {
        **safety_result,
        "scans": scan_results
    }

@app.get("/api/scan/status")
async def scanner_status():
    """Get scanner service status"""
    return {
        "product_scanner": {
            "active": True,
            "retailers": len(app.state.product_scanner.cache),
            "cache_size": len(app.state.product_scanner.cache)
        },
        "health_scanner": {
            "active": True,
            "topics": len(app.state.health_scanner.cache),
            "cache_size": len(app.state.health_scanner.cache)
        }
    }

# ============================================================================
# ERROR HANDLERS
# ============================================================================

@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc):
    """Handle HTTP exceptions"""
    return {
        "error": exc.detail,
        "status_code": exc.status_code
    }

@app.exception_handler(Exception)
async def general_exception_handler(request, exc):
    """Handle general exceptions"""
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    return {
        "error": "Internal server error",
        "status_code": 500
    }

# ============================================================================
# DEVELOPMENT SERVER
# ============================================================================

if __name__ == "__main__":
    import uvicorn
    
    print("\n" + "="*60)
    print("🚀 SafeSignal API v2.5 - Starting Development Server")
    print("="*60)
    print("\nFeatures enabled:")
    print("  ✅ Tier-0 Safety Analysis")
    print("  ✅ Domain Reputation Checking")
    print("  ✅ Product Price Scanner")
    print("  ✅ Health Fact Checker")
    print("\nEndpoints available:")
    print("  POST /api/check - Main safety check")
    print("  POST /api/scan/product - Product scanner")
    print("  POST /api/scan/health - Health fact check")
    print("  POST /api/check_with_scan - Combined check")
    print("\nStarting server on http://localhost:8000")
    print("API docs at http://localhost:8000/docs")
    print("="*60 + "\n")
    
    uvicorn.run(
        "main_with_scanners:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )