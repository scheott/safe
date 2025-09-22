# api/src/main.py
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import logging
import time

from .routes import check

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
    version="1.0.0-phase2.1",
    docs_url="/docs",
    redoc_url="/redoc"
)

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

# Request logging middleware
@app.middleware("http")
async def log_requests(request: Request, call_next):
    start_time = time.time()
    
    # Log request
    logger.info(f"Request: {request.method} {request.url}")
    
    # Process request
    response = await call_next(request)
    
    # Log response
    process_time = time.time() - start_time
    logger.info(f"Response: {response.status_code} - {process_time:.3f}s")
    
    return response

# Global exception handler
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Global exception handler: {exc}")
    return JSONResponse(
        status_code=500,
        content={
            "error": "internal_server_error",
            "message": "An unexpected error occurred",
            "detail": str(exc) if app.debug else "Internal server error"
        }
    )

# Include routers
app.include_router(check.router, prefix="/api", tags=["URL Analysis"])

# Health check endpoint
@app.get("/health")
async def health_check():
    """Simple health check endpoint"""
    return {
        "status": "healthy",
        "version": "1.0.0-phase2.1",
        "timestamp": time.time(),
        "phase": "2.1 - Server-Side URL Fetching"
    }

# Root endpoint
@app.get("/")
async def root():
    """API root endpoint with basic info"""
    return {
        "message": "SafeSignal API",
        "version": "1.0.0-phase2.1", 
        "phase": "2.1 - Server-Side URL Fetching",
        "docs": "/docs",
        "health": "/health"
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