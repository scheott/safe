# src/scan_endpoints.py
# Phase 2.5 - Health & Product Scanning Endpoints
# Single-tier model: All users get LLM summaries (no free/paid split yet)

import asyncio
import time
import json
import os
import logging
from typing import List, Dict, Literal, Optional
from urllib.parse import quote_plus

import httpx
from bs4 import BeautifulSoup
from pydantic import BaseModel
from fastapi import APIRouter, HTTPException
from openai import AsyncOpenAI

logger = logging.getLogger(__name__)

# ============================================================================
# RESPONSE MODELS (Stable schemas for Chrome extension)
# ============================================================================

class HealthCitation(BaseModel):
    name: str
    url: str

class HealthScanResponse(BaseModel):
    topic: str
    verdict: Literal["safe", "mixed", "harmful", "uncertain"]
    bullets: List[str]
    citations: List[HealthCitation]
    latency_ms: int
    from_cache: bool

class CompareLink(BaseModel):
    retailer: str
    url: str

class ProductScanResponse(BaseModel):
    product_name: Optional[str]
    advisory: str
    risk_signals: List[str]
    compare_links: List[CompareLink]
    latency_ms: int
    from_cache: bool

# ============================================================================
# HEALTH SCANNER - Grounded LLM summaries from trusted sources
# ============================================================================

TRUSTED_SOURCES = {
    "CDC": "https://search.cdc.gov/search/?query=",
    "NIH": "https://search.nih.gov/search?q=",
    "Mayo Clinic": "https://www.mayoclinic.org/search/search-results?q=",
    "MedlinePlus": "https://medlineplus.gov/search.html?query="
}

class HealthScanner:
    def __init__(self):
        self.cache = {}  # Simple dict cache with TTL
        self.http_client = httpx.AsyncClient(
            timeout=3.0,
            follow_redirects=True,
            headers={'User-Agent': 'SafeSignal/2.5 (Elder Safety Tool)'}
        )
        
        # Initialize OpenAI client
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            logger.warning("OPENAI_API_KEY not set - health summaries will fail")
        self.openai = AsyncOpenAI(api_key=api_key) if api_key else None
        
    async def scan(self, url: str, hints: dict, mode: str = "fast") -> dict:
        """
        Scan for health information with grounded LLM summary.
        
        Args:
            url: Page URL being analyzed
            hints: Dict with 'title', 'claims_text', etc.
            mode: 'fast' or 'full' (affects timeouts)
            
        Returns:
            HealthScanResponse as dict
        """
        start = time.time()
        
        # Build cache key
        topic_hint = hints.get("title", "") or hints.get("claims_text", "")
        cache_key = f"health:{url}:{topic_hint[:50]}"
        
        # Check cache (30 min TTL)
        cached = self._get_cache(cache_key)
        if cached:
            cached['from_cache'] = True
            cached['latency_ms'] = int((time.time() - start) * 1000)
            return cached
        
        # Extract topic from hints
        topic = self._extract_topic(hints)
        
        # Build citation links (always present)
        citations = [
            {"name": name, "url": f"{base_url}{quote_plus(topic)}"}
            for name, base_url in TRUSTED_SOURCES.items()
        ]
        
        # Try to fetch and summarize
        bullets = []
        verdict = "uncertain"
        
        try:
            # Fetch snippets from top 2 sources (CDC + NIH)
            snippets = await self._fetch_snippets(topic, citations[:2], mode)
            
            if snippets and self.openai:
                # Call LLM for grounded summary
                bullets, verdict = await self._summarize_with_llm(topic, snippets, mode)
            else:
                # Fallback: couldn't fetch or no API key
                bullets = [
                    "We couldn't retrieve content from trusted sources right now.",
                    f"Please check the links below for information about {topic}.",
                    "If you have health concerns, consult a healthcare provider."
                ]
                verdict = "uncertain"
                
        except asyncio.TimeoutError:
            logger.warning(f"Health scan timeout for {topic}")
            bullets = [
                "The scan took too long—our apologies.",
                "Check the trusted sources below for reliable information."
            ]
            verdict = "uncertain"
            
        except Exception as e:
            logger.error(f"Health scan failed for {topic}: {e}")
            bullets = [
                "Unable to generate a summary at this time.",
                f"Check trusted medical sources for information about {topic}."
            ]
            verdict = "uncertain"
        
        latency_ms = int((time.time() - start) * 1000)
        
        result = {
            "topic": topic,
            "verdict": verdict,
            "bullets": bullets,
            "citations": citations,
            "latency_ms": latency_ms,
            "from_cache": False
        }
        
        # Cache for 30 minutes
        self._set_cache(cache_key, result, ttl=1800)
        
        return result
    
    def _extract_topic(self, hints: dict) -> str:
        """Extract health topic from page hints"""
        # Priority: title > claims_text > default
        title = hints.get("title", "").strip()
        claims = hints.get("claims_text", "").strip()
        
        topic = title if title else claims
        
        # Clean and truncate
        if topic:
            # Remove common noise words
            noise = ["Learn about", "Information on", "What is", "How to"]
            for n in noise:
                if topic.startswith(n):
                    topic = topic[len(n):].strip()
            
            topic = topic[:100]
        
        return topic if topic else "health information"
    
    async def _fetch_snippets(self, topic: str, citations: List[dict], mode: str) -> List[str]:
        """Fetch text snippets from trusted medical sources"""
        snippets = []
        timeout = 2.0 if mode == "fast" else 3.5
        
        for citation in citations:
            try:
                response = await asyncio.wait_for(
                    self.http_client.get(citation['url']),
                    timeout=timeout
                )
                
                if response.status_code == 200:
                    snippet = self._extract_snippet(response.text)
                    if snippet:
                        snippets.append(f"[{citation['name']}]: {snippet}")
                        
            except asyncio.TimeoutError:
                logger.warning(f"Timeout fetching {citation['name']}")
            except Exception as e:
                logger.warning(f"Failed to fetch {citation['name']}: {e}")
        
        return snippets
    
    def _extract_snippet(self, html: str, max_length: int = 400) -> str:
        """Extract meaningful text snippet from HTML"""
        try:
            soup = BeautifulSoup(html, 'html.parser')
            
            # Remove scripts, styles, navigation
            for tag in soup(['script', 'style', 'nav', 'header', 'footer', 'aside']):
                tag.decompose()
            
            # Get text
            text = soup.get_text(separator=' ', strip=True)
            
            # Clean up whitespace
            text = ' '.join(text.split())
            
            # Truncate
            return text[:max_length] if text else ""
            
        except Exception as e:
            logger.error(f"Failed to parse HTML: {e}")
            return ""
    
    async def _summarize_with_llm(self, topic: str, snippets: List[str], mode: str) -> tuple:
        """
        Use LLM to create grounded summary from fetched sources.
        
        Returns:
            (bullets: List[str], verdict: str)
        """
        timeout = 1.5 if mode == "fast" else 3.0
        
        prompt = f"""You are a medical information assistant helping elderly users understand health topics.

TOPIC: {topic}

TRUSTED SOURCES (only cite information from these):
{chr(10).join(snippets)}

INSTRUCTIONS:
1. Provide 3-5 short, clear bullet points summarizing the key medical facts
2. Use simple, plain language suitable for seniors (avoid jargon)
3. Rate the overall consensus as: safe | mixed | harmful | uncertain
4. ONLY cite information explicitly stated in the sources above
5. If sources lack sufficient information, say "uncertain" and recommend consulting a doctor
6. Never invent statistics, dosages, or medical advice not in the sources

Respond ONLY with valid JSON:
{{"bullets": ["First key fact in simple terms", "Second fact", "Third fact"], "verdict": "mixed"}}
"""
        
        try:
            response = await asyncio.wait_for(
                self.openai.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=[{"role": "user", "content": prompt}],
                    response_format={"type": "json_object"},
                    max_tokens=300,
                    temperature=0.3  # Lower temp for factual accuracy
                ),
                timeout=timeout
            )
            
            result = json.loads(response.choices[0].message.content)
            
            bullets = result.get('bullets', [])
            verdict = result.get('verdict', 'uncertain')
            
            # Validation
            if not bullets or len(bullets) < 2:
                raise ValueError("LLM returned insufficient bullets")
            
            # Ensure verdict is valid
            if verdict not in ['safe', 'mixed', 'harmful', 'uncertain']:
                verdict = 'uncertain'
            
            return bullets, verdict
            
        except asyncio.TimeoutError:
            logger.warning(f"LLM timeout for topic: {topic}")
            raise
        except Exception as e:
            logger.error(f"LLM summarization failed: {e}")
            raise
    
    def _get_cache(self, key: str) -> Optional[dict]:
        """Get cached result if not expired"""
        if key in self.cache:
            entry = self.cache[key]
            if time.time() < entry['expires']:
                return entry['data']
            else:
                del self.cache[key]
        return None
    
    def _set_cache(self, key: str, data: dict, ttl: int):
        """Cache result with TTL"""
        self.cache[key] = {
            'data': data,
            'expires': time.time() + ttl
        }
        
        # Simple cache cleanup: remove if > 1000 entries
        if len(self.cache) > 1000:
            # Remove oldest 20%
            sorted_keys = sorted(self.cache.keys(), key=lambda k: self.cache[k]['expires'])
            for k in sorted_keys[:200]:
                del self.cache[k]

# ============================================================================
# PRODUCT SCANNER - Compare links + risk signals (no prices)
# ============================================================================

RETAILER_SEARCH_URLS = {
    "Amazon": "https://www.amazon.com/s?k=",
    "Target": "https://www.target.com/s?searchTerm=",
    "Walmart": "https://www.walmart.com/search?q=",
    "Google Shopping": "https://www.google.com/search?tbm=shop&q="
}

class ProductScanner:
    def __init__(self, tier0_analyzer):
        self.cache = {}
        self.tier0 = tier0_analyzer
        
    async def scan(self, url: str, hints: dict, mode: str = "fast") -> dict:
        """
        Scan for product comparison opportunities.
        
        Args:
            url: Product page URL
            hints: Dict with 'product_name', 'title', etc.
            mode: 'fast' or 'full'
            
        Returns:
            ProductScanResponse as dict
        """
        start = time.time()
        cache_key = f"product:{url}"
        
        # Check cache
        cached = self._get_cache(cache_key)
        if cached:
            cached['from_cache'] = True
            cached['latency_ms'] = int((time.time() - start) * 1000)
            return cached
        
        # Extract product name from hints
        product_name = hints.get("product_name", "") or hints.get("title", "")
        product_name = product_name.strip()[:100]
        
        # Build compare links for trusted retailers
        search_query = product_name if product_name else "product search"
        compare_links = [
            {"retailer": name, "url": f"{base_url}{quote_plus(search_query)}"}
            for name, base_url in RETAILER_SEARCH_URLS.items()
        ]
        
        # Get risk signals from Tier-0 analysis
        risk_signals = []
        advisory = "Compare prices on trusted retailers before purchasing."
        
        try:
            # Run quick Tier-0 check to get page verdict
            tier0_result = self.tier0.analyze(url)
            
            # Extract relevant risk reasons
            relevant_risks = {
                'clickbait_headline',
                'offsite_form',
                'suspicious_domain',
                'aggressive_timer',
                'low_domain_rep',
                'suspicious_tld',
                'punycode_domain'
            }
            
            risk_signals = [
                reason for reason in tier0_result.reasons
                if reason in relevant_risks
            ]
            
            # Adjust advisory based on verdict
            if tier0_result.verdict == "danger":
                advisory = "⚠️ High-risk site detected. We strongly recommend comparing on trusted retailers."
            elif tier0_result.verdict == "warning":
                advisory = "Use caution—this site has some concerning signals. Compare on trusted retailers."
            elif tier0_result.verdict == "ok":
                advisory = "This site looks reputable, but it's always smart to compare prices."
                
        except Exception as e:
            logger.warning(f"Tier-0 check failed for product scan: {e}")
            # Continue with default advisory
        
        latency_ms = int((time.time() - start) * 1000)
        
        result = {
            "product_name": product_name if product_name else None,
            "advisory": advisory,
            "risk_signals": risk_signals,
            "compare_links": compare_links,
            "latency_ms": latency_ms,
            "from_cache": False
        }
        
        # Cache for 30 minutes
        self._set_cache(cache_key, result, ttl=1800)
        
        return result
    
    def _get_cache(self, key: str) -> Optional[dict]:
        """Get cached result if not expired"""
        if key in self.cache:
            entry = self.cache[key]
            if time.time() < entry['expires']:
                return entry['data']
            else:
                del self.cache[key]
        return None
    
    def _set_cache(self, key: str, data: dict, ttl: int):
        """Cache result with TTL"""
        self.cache[key] = {
            'data': data,
            'expires': time.time() + ttl
        }
        
        # Simple cleanup
        if len(self.cache) > 500:
            sorted_keys = sorted(self.cache.keys(), key=lambda k: self.cache[k]['expires'])
            for k in sorted_keys[:100]:
                del self.cache[k]

# ============================================================================
# API ROUTES
# ============================================================================

router = APIRouter(prefix="/api/scan", tags=["scanning"])

# Global scanner instances (initialized in main.py)
health_scanner = None
product_scanner = None

@router.post("/health", response_model=HealthScanResponse)
async def scan_health(request: dict):
    """
    Scan for health information with grounded LLM summary.
    
    Request body:
    {
        "url": "https://page-url.com",
        "hints": {
            "title": "Page title",
            "claims_text": "Snippet of health claims"
        },
        "mode": "fast"  // or "full"
    }
    
    Returns bullets + citations from trusted medical sources.
    """
    if not health_scanner:
        raise HTTPException(status_code=500, detail="Health scanner not initialized")
    
    url = request.get("url")
    if not url:
        raise HTTPException(status_code=400, detail="URL required")
    
    hints = request.get("hints", {})
    mode = request.get("mode", "fast")
    
    result = await health_scanner.scan(url, hints, mode)
    return result

@router.post("/product", response_model=ProductScanResponse)
async def scan_product(request: dict):
    """
    Scan for product comparison opportunities.
    
    Request body:
    {
        "url": "https://product-page.com",
        "hints": {
            "product_name": "Wireless earbuds",
            "title": "Page title"
        },
        "mode": "fast"
    }
    
    Returns compare links + risk signals (no prices).
    """
    if not product_scanner:
        raise HTTPException(status_code=500, detail="Product scanner not initialized")
    
    url = request.get("url")
    if not url:
        raise HTTPException(status_code=400, detail="URL required")
    
    hints = request.get("hints", {})
    mode = request.get("mode", "fast")
    
    result = await product_scanner.scan(url, hints, mode)
    return result

@router.get("/status")
async def scanner_status():
    """Debug endpoint - check scanner health"""
    return {
        "health_scanner": {
            "active": health_scanner is not None,
            "cache_size": len(health_scanner.cache) if health_scanner else 0,
            "openai_configured": health_scanner.openai is not None if health_scanner else False
        },
        "product_scanner": {
            "active": product_scanner is not None,
            "cache_size": len(product_scanner.cache) if product_scanner else 0
        }
    }

# ============================================================================
# INITIALIZATION HELPER
# ============================================================================

def init_scanners(app, tier0_analyzer):
    """
    Initialize scanner instances and register routes.
    Called from main.py during startup.
    
    Args:
        app: FastAPI app instance
        tier0_analyzer: Tier0Analyzer instance for risk detection
    """
    global health_scanner, product_scanner
    
    health_scanner = HealthScanner()
    product_scanner = ProductScanner(tier0_analyzer)
    
    app.include_router(router)
    
    logger.info("✅ Health and Product scanners initialized")