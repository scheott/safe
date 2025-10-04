# api/src/main.py
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import logging
import time
import os
from .routes import check
from .services.database import get_db_service
from .services.reputation_service import ReputationService
from .services.tier0_analyzer import Tier0Analyzer

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Create FastAPI app
app = FastAPI(
    title="SafeSignal API",
    description="URL safety analysis for seniors and their families",
    version="1.0.0-phase2.5-scanners",
    docs_url="/docs",
    redoc_url="/redoc"
)

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

api_key = os.getenv("OPENAI_API_KEY")

# ============================================================================
# CORS FIX - Allow Extension Origins + Preflight Requests
# ============================================================================

# CRITICAL: CORS must come BEFORE routes to handle OPTIONS preflight
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins (Chrome extensions need this)
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],  # Include OPTIONS
    allow_headers=["*"],  # Allow all headers
    expose_headers=["*"],  # Expose all headers to the client
)

# ============================================================================
# REQUEST LOGGING MIDDLEWARE
# ============================================================================

@app.middleware("http")
async def log_requests(request: Request, call_next):
    """Log all requests with timing"""
    start_time = time.time()
    
    # Log request
    logger.info(f"Request: {request.method} {request.url}")
    
    # Process request
    response = await call_next(request)
    
    # Calculate processing time
    process_time = time.time() - start_time
    
    # Log response
    logger.info(f"Response: {response.status_code} - {process_time:.3f}s")
    
    return response

# ============================================================================
# ROUTES - Include scanner endpoints
# ============================================================================

app.include_router(check.router, prefix="/api", tags=["check"])

# Import and register scanner endpoints
try:
    from src.scan_endpoints import router as scan_router
    # Note: scan_router already has prefix="/api/scan" defined in scan_endpoints.py
    app.include_router(scan_router, tags=["scanners"])
    logger.info("✅ Scanner routes registered")
except ImportError as e:
    logger.warning(f"Could not import scanner endpoints: {e}")

# ============================================================================
# STARTUP & SHUTDOWN
# ============================================================================

@app.on_event("startup")
async def startup_event():
    """Initialize services on startup"""
    logger.info("🚀 SafeSignal API starting up with scanners...")
    
    try:
        # Initialize database service
        db_service = get_db_service()
        logger.info(f"✅ Database service initialized at {db_service.db_path}")
        
        # Initialize reputation service (loads data in __init__)
        rep_service = ReputationService()
        logger.info("✅ Reputation service initialized")
        
        # Initialize Tier-0 analyzer (pass reputation service)
        analyzer = Tier0Analyzer(rep_service)
        logger.info("✅ Tier-0 analyzer initialized")
        
        # Initialize Phase 2.5 scanners
        try:
            import src.scan_endpoints as scan_ep
            
            # Initialize the global scanner instances
            scan_ep.health_scanner = scan_ep.HealthScanner()
            scan_ep.product_scanner = scan_ep.ProductScanner(analyzer)
            
            logger.info("✅ Health and Product scanners initialized")
        except Exception as scanner_error:
            logger.warning(f"Scanner initialization failed (non-critical): {scanner_error}")
        
        logger.info("✅ All services ready!")
        
    except Exception as e:
        logger.error(f"❌ Startup failed: {e}", exc_info=True)
        raise

@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown"""
    logger.info("👋 SafeSignal API shutting down...")
    
    try:
        db_service = get_db_service()
        await db_service.close()
        logger.info("✅ Database closed")
    except Exception as e:
        logger.error(f"Error during shutdown: {e}")

# ============================================================================
# ROOT ENDPOINT
# ============================================================================

@app.get("/")
async def root():
    """Health check endpoint"""
    return {
        "service": "SafeSignal API",
        "version": "1.0.0-phase2.5",
        "status": "healthy",
        "features": [
            "tier0_analysis",
            "domain_reputation",
            "product_scanner",
            "health_scanner"
        ],
        "endpoints": {
            "check": "/api/check",
            "product_scan": "/api/scan/product",
            "health_scan": "/api/scan/health",
            "scanner_status": "/api/scan/status"
        }
    }

@app.get("/health")
async def health():
    """Simple health check"""
    return {"status": "ok"}

# ============================================================================
# ERROR HANDLERS
# ============================================================================

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Catch-all exception handler"""
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={
            "error": "Internal server error",
            "detail": str(exc) if os.getenv("DEBUG") else "An error occurred"
        }
    )

# ============================================================================
# DEVELOPMENT SERVER
# ============================================================================

if __name__ == "__main__":
    import uvicorn
    
    print("\n" + "="*70)
    print("🚀 SafeSignal API v2.5 - Starting Development Server")
    print("="*70)
    print("\n✨ Features enabled:")
    print("  ✅ Tier-0 Safety Analysis")
    print("  ✅ Domain Reputation Checking")
    print("  ✅ Product Scanner (Phase 2.5)")
    print("  ✅ Health Fact Checker (Phase 2.5)")
    print("  ✅ CORS enabled for Chrome extensions")
    print("\n📍 Endpoints available:")
    print("  POST /api/check - Main safety check")
    print("  POST /api/scan/product - Product comparison scanner")
    print("  POST /api/scan/health - Health fact checker")
    print("  GET  /api/scan/status - Scanner health check")
    print("\n🌐 Server running at:")
    print("  http://localhost:8000")
    print("  API docs: http://localhost:8000/docs")
    print("="*70 + "\n")
    
    uvicorn.run(
        "src.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )