# api/src/main.py
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import logging
import time
import os
from src.scan_endpoints import router as scan_router
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
    version="1.0.0-phase2.4-logging",
    docs_url="/docs",
    redoc_url="/redoc"
)
try:
    from dotenv import load_dotenv
    load_dotenv()  # This looks for .env in the current directory
except ImportError:
    pass

# Then access it
api_key = os.getenv("OPENAI_API_KEY")
# CORS middleware for extension requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "chrome-extension://*",  # Chrome extensions
        "moz-extension://*",     # Firefox extensions  
        "safari-web-extension://*",  # Safari extensions
        "http://localhost:3000", # Local development
        "https://safesignal.com", # Production website
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["*"],
)
app.include_router(scan_router)

@app.on_event("startup")
async def startup_event():
    """Initialize services on startup"""
    logger.info("SafeSignal API starting up...")
    
    # Initialize database service
    try:
        db_service = get_db_service()
        logger.info(f"Database service initialized at {db_service.db_path}")
        
        # Log startup event
        db_service.log_url_check(
            url="system://startup",
            domain="system",
            verdict="ok", 
            reasons=["system_startup"],
            tier0_score=0,
            analysis_details={"event": "api_startup", "version": "1.0.0-phase2.4-logging"},
            processing_time_ms=0,
            source="system"
        )
        
    except Exception as e:
        logger.error(f"Failed to initialize database service: {e}")
        raise e
    
    # Initialize reputation service
    try:
        reputation_service = ReputationService()
        app.state.reputation_service = reputation_service
        logger.info("Reputation service initialized")
        
        # Initialize tier0 analyzer
        tier0_analyzer = Tier0Analyzer(reputation_service)
        app.state.tier0_analyzer = tier0_analyzer
        logger.info("Tier0 analyzer initialized")
        
    except Exception as e:
        logger.error(f"Failed to initialize analysis services: {e}")
        raise e
    
    logger.info("SafeSignal API startup complete")

@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown"""
    logger.info("SafeSignal API shutting down...")
    
    # Log shutdown event
    try:
        db_service = get_db_service()
        db_service.log_url_check(
            url="system://shutdown",
            domain="system",
            verdict="ok",
            reasons=["system_shutdown"], 
            tier0_score=0,
            analysis_details={"event": "api_shutdown"},
            processing_time_ms=0,
            source="system"
        )
    except Exception as e:
        logger.error(f"Error logging shutdown event: {e}")

# Request logging middleware
@app.middleware("http")
async def log_requests(request: Request, call_next):
    start_time = time.time()
    
    # Log request (but don't log every health check)
    if not request.url.path.endswith("/health"):
        logger.info(f"Request: {request.method} {request.url}")
    
    # Process request
    response = await call_next(request)
    
    # Log response (but don't log every health check)
    process_time = time.time() - start_time
    if not request.url.path.endswith("/health"):
        logger.info(f"Response: {response.status_code} - {process_time:.3f}s")
    
    return response

# Global exception handler
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Global exception handler: {exc}")
    
    # Try to log error to database
    try:
        db_service = get_db_service()
        db_service.log_url_check(
            url=f"error://{request.url.path}",
            domain="error",
            verdict="error",
            reasons=["unhandled_exception"],
            tier0_score=-1,
            analysis_details={
                "exception_type": type(exc).__name__,
                "exception_message": str(exc),
                "request_path": request.url.path,
                "request_method": request.method
            },
            processing_time_ms=0,
            source="system"
        )
    except:
        pass  # Don't fail on logging errors
    
    return JSONResponse(
        status_code=500,
        content={
            "error": "internal_server_error",
            "message": "An unexpected error occurred",
            "detail": str(exc) if os.getenv("DEBUG", "false").lower() == "true" else "Internal server error"
        }
    )

# Include routers
app.include_router(check.router, prefix="/api", tags=["URL Analysis"])

# Health check endpoint
@app.get("/health")
async def health_check():
    """Simple health check endpoint"""
    try:
        # Check database connectivity
        db_service = get_db_service()
        total_checks = db_service.get_total_checks()
        
        return {
            "status": "healthy",
            "version": "1.0.0-phase2.4-logging",
            "timestamp": time.time(),
            "phase": "2.4 - Persistent Logging + Analytics Stub",
            "database": {
                "connected": True,
                "total_checks": total_checks
            }
        }
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return {
            "status": "degraded",
            "version": "1.0.0-phase2.4-logging", 
            "timestamp": time.time(),
            "error": str(e),
            "database": {
                "connected": False
            }
        }

# Root endpoint
@app.get("/")
async def root():
    """API root endpoint with basic info"""
    try:
        db_service = get_db_service()
        total_checks = db_service.get_total_checks()
        
        return {
            "message": "SafeSignal API",
            "version": "1.0.0-phase2.4-logging", 
            "phase": "2.4 - Persistent Logging + Analytics Stub",
            "docs": "/docs",
            "health": "/health",
            "analytics": "/api/analytics/daily",
            "stats": {
                "total_checks": total_checks
            }
        }
    except Exception as e:
        return {
            "message": "SafeSignal API",
            "version": "1.0.0-phase2.4-logging",
            "phase": "2.4 - Persistent Logging + Analytics Stub", 
            "docs": "/docs",
            "health": "/health",
            "error": "Database unavailable"
        }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "src.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )