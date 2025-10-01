# api/scan_endpoints.py
"""
Phase 2.5: Product & Health Scan Endpoints
Fast mode scanners without LLM for SafeSignal MVP
"""

import asyncio
import hashlib
import json
import re
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
from urllib.parse import quote_plus, urlparse

import httpx
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from fuzzywuzzy import fuzz
from cachetools import TTLCache

# ============================================================================
# DATA MODELS
# ============================================================================

class ProductHints(BaseModel):
    title: str = Field(..., max_length=120)
    brand: Optional[str] = Field(None, max_length=40)
    model: Optional[str] = None
    upc: Optional[str] = None
    price: Optional[float] = None
    domPath: Optional[Dict[str, str]] = None

class ProductScanRequest(BaseModel):
    url: str
    hints: ProductHints
    mode: str = "fast"  # fast | full

class ProductMatch(BaseModel):
    retailer: str
    title: str
    price: float
    seller: str
    url: str
    shipping: Optional[float] = None
    rating: Optional[float] = None
    trust_score: float = 1.0

class ProductScanResponse(BaseModel):
    query: Dict[str, Optional[str]]
    matches: List[ProductMatch]
    best: Optional[ProductMatch]
    notes: List[str]
    confidence: float
    ttl_sec: int = 1800

class HealthClaim(BaseModel):
    text: str = Field(..., max_length=200)
    confidence: float = 0.8

class HealthHints(BaseModel):
    claims: List[str] = Field(..., max_items=3)
    topic: Optional[str] = None
    excerpt: Optional[str] = Field(None, max_length=400)
    domPath: Optional[Dict[str, str]] = None

class HealthScanRequest(BaseModel):
    url: str
    hints: HealthHints
    mode: str = "fast"

class HealthSource(BaseModel):
    name: str
    url: str
    tier: str  # primary | secondary
    excerpt: Optional[str] = None

class HealthScanResponse(BaseModel):
    topic: str
    verdict: str  # mixed | promising | not_supported | harmful | needs_context
    bullets: List[str]
    sources: List[HealthSource]
    supplement_flag: bool = False
    confidence: float
    ttl_sec: int = 604800

# ============================================================================
# RETAILER DATA & HEALTH SOURCES
# ============================================================================

TRUSTED_RETAILERS = {
    "amazon": {
        "domain": "amazon.com",
        "search_url": "https://www.amazon.com/s?k={query}",
        "trust_score": 0.95,
        "first_party_sellers": ["Amazon", "Amazon.com"]
    },
    "walmart": {
        "domain": "walmart.com", 
        "search_url": "https://www.walmart.com/search?q={query}",
        "trust_score": 0.95,
        "first_party_sellers": ["Walmart", "Walmart.com"]
    },
    "target": {
        "domain": "target.com",
        "search_url": "https://www.target.com/s?searchTerm={query}",
        "trust_score": 0.95,
        "first_party_sellers": ["Target"]
    },
    "bestbuy": {
        "domain": "bestbuy.com",
        "search_url": "https://www.bestbuy.com/site/searchpage.jsp?st={query}",
        "trust_score": 0.95,
        "first_party_sellers": ["Best Buy"]
    }
}

HEALTH_SOURCES = {
    "primary": {
        "nih": {
            "name": "NIH",
            "domain": "nih.gov",
            "search_url": "https://search.nih.gov/search?q={query}",
            "weight": 1.0
        },
        "cdc": {
            "name": "CDC", 
            "domain": "cdc.gov",
            "search_url": "https://search.cdc.gov/search/?query={query}",
            "weight": 1.0
        },
        "who": {
            "name": "WHO",
            "domain": "who.int",
            "search_url": "https://www.who.int/search?query={query}",
            "weight": 0.95
        },
        "medlineplus": {
            "name": "MedlinePlus",
            "domain": "medlineplus.gov",
            "search_url": "https://medlineplus.gov/search/?q={query}",
            "weight": 0.95
        },
        "cochrane": {
            "name": "Cochrane",
            "domain": "cochrane.org",
            "search_url": "https://www.cochrane.org/search?query={query}",
            "weight": 1.0
        }
    },
    "secondary": {
        "mayo": {
            "name": "Mayo Clinic",
            "domain": "mayoclinic.org",
            "search_url": "https://www.mayoclinic.org/search/search-results?q={query}",
            "weight": 0.7
        },
        "webmd": {
            "name": "WebMD",
            "domain": "webmd.com",
            "search_url": "https://www.webmd.com/search/search_results/default.aspx?query={query}",
            "weight": 0.65
        }
    }
}

# Pre-indexed common health topics (sample)
HEALTH_TOPICS_INDEX = {
    "intermittent-fasting": {
        "canonical": "intermittent fasting",
        "aliases": ["if", "time restricted eating", "16:8"],
        "category": "diet",
        "verdict": "mixed",
        "key_points": [
            "Modest weight loss comparable to calorie restriction",
            "May improve insulin sensitivity",
            "Not recommended for certain conditions"
        ]
    },
    "vitamin-d": {
        "canonical": "vitamin D supplementation",
        "aliases": ["vit d", "d3", "cholecalciferol"],
        "category": "supplement",
        "verdict": "promising",
        "key_points": [
            "Beneficial for deficiency states",
            "May support bone health",
            "Optimal dosing varies by individual"
        ]
    },
    "keto-diet": {
        "canonical": "ketogenic diet",
        "aliases": ["keto", "low carb high fat", "lchf"],
        "category": "diet",
        "verdict": "mixed",
        "key_points": [
            "Effective for short-term weight loss",
            "Potential therapeutic uses in epilepsy",
            "Long-term safety concerns exist"
        ]
    }
}

# ============================================================================
# SERVICES
# ============================================================================

class ProductScanner:
    """Handles product detection and safer deal finding"""
    
    def __init__(self):
        # Cache: (query_hash, retailer) -> results, TTL 30 min
        self.cache = TTLCache(maxsize=1000, ttl=1800)
        self.http = httpx.AsyncClient(timeout=3.0)
    
    def normalize_product_query(self, hints: ProductHints) -> Dict[str, str]:
        """Normalize product info for matching"""
        query = {}
        
        # Clean title
        if hints.title:
            # Remove common junk
            title = re.sub(r'\s+', ' ', hints.title)
            title = re.sub(r'[^\w\s\-\.]', '', title)
            query['title'] = title.strip()[:80]
        
        # Brand normalization
        if hints.brand:
            brand = hints.brand.upper().replace('.', '').strip()
            query['brand'] = brand
        
        # Model number
        if hints.model:
            model = re.sub(r'[^\w\-]', '', hints.model).upper()
            query['model'] = model
        
        # UPC/EAN/GTIN
        if hints.upc:
            upc = re.sub(r'[^\d]', '', hints.upc)
            if len(upc) in [8, 12, 13, 14]:  # Valid lengths
                query['upc'] = upc
        
        return query
    
    def build_search_query(self, query: Dict[str, str]) -> str:
        """Build optimized search string"""
        # UPC takes priority
        if query.get('upc'):
            return query['upc']
        
        # Brand + model is strong signal
        parts = []
        if query.get('brand'):
            parts.append(query['brand'])
        if query.get('model'):
            parts.append(query['model'])
        elif query.get('title'):
            # Extract key product terms
            title_parts = query['title'].split()[:5]  # First 5 words
            parts.extend(title_parts)
        
        return ' '.join(parts)
    
    async def search_retailer(
        self, 
        retailer_id: str, 
        search_query: str,
        original_query: Dict[str, str]
    ) -> List[ProductMatch]:
        """Search a single retailer (mock for MVP)"""
        retailer = TRUSTED_RETAILERS.get(retailer_id)
        if not retailer:
            return []
        
        # In production, this would call retailer APIs or scrape
        # For MVP, return mock matches based on fuzzy matching
        
        # Mock price generation
        base_price = hash(search_query) % 200 + 50
        
        matches = []
        
        # Simulate finding 1-3 matches
        for i in range(min(3, hash(retailer_id + search_query) % 4)):
            seller = retailer['first_party_sellers'][0]
            trust_score = 1.0
            
            # Sometimes simulate marketplace seller
            if i > 0 and hash(f"{retailer_id}{i}") % 3 == 0:
                seller = f"Seller_{i}"
                trust_score = 0.6
            
            match = ProductMatch(
                retailer=retailer_id.title(),
                title=f"{original_query.get('title', 'Product')} - {retailer_id.title()}",
                price=base_price + (i * 5),
                seller=seller,
                url=retailer['search_url'].format(query=quote_plus(search_query)),
                shipping=0 if trust_score > 0.9 else 4.99,
                trust_score=trust_score
            )
            matches.append(match)
        
        return matches
    
    async def scan(self, request: ProductScanRequest) -> ProductScanResponse:
        """Main product scanning logic"""
        # Normalize query
        query = self.normalize_product_query(request.hints)
        search_str = self.build_search_query(query)
        
        # Check cache
        cache_key = hashlib.md5(f"{search_str}".encode()).hexdigest()
        if cache_key in self.cache:
            cached = self.cache[cache_key]
            cached.ttl_sec = 1800  # Reset TTL
            return cached
        
        # Search retailers in parallel
        tasks = []
        for retailer_id in ["amazon", "walmart", "target", "bestbuy"]:
            tasks.append(
                self.search_retailer(retailer_id, search_str, query)
            )
        
        results = await asyncio.gather(*tasks)
        all_matches = [m for r in results for m in r]
        
        # Sort by trust + price
        all_matches.sort(key=lambda x: (x.trust_score, -x.price), reverse=True)
        
        # Take top 3
        top_matches = all_matches[:3]
        
        # Find best deal (trusted seller + lowest price)
        trusted_matches = [m for m in top_matches if m.trust_score > 0.8]
        best = min(trusted_matches, key=lambda x: x.price) if trusted_matches else None
        
        # Build notes
        notes = []
        if best and best.trust_score > 0.9:
            notes.append("Preferring first-party seller")
        if any(m.trust_score < 0.7 for m in top_matches):
            notes.append("Some marketplace sellers - verify before buying")
        
        response = ProductScanResponse(
            query=query,
            matches=top_matches,
            best=best,
            notes=notes,
            confidence=0.85 if best else 0.6,
            ttl_sec=1800
        )
        
        # Cache result
        self.cache[cache_key] = response
        
        return response

class HealthScanner:
    """Handles health claim detection and fact checking"""
    
    def __init__(self):
        # Cache by topic slug, TTL 7 days
        self.cache = TTLCache(maxsize=500, ttl=604800)
        self.http = httpx.AsyncClient(timeout=3.0)
    
    def detect_topic(self, hints: HealthHints) -> Tuple[str, float]:
        """Detect health topic from claims"""
        claims_text = ' '.join(hints.claims).lower()
        
        # Check pre-indexed topics
        best_match = None
        best_score = 0
        
        for topic_id, topic_data in HEALTH_TOPICS_INDEX.items():
            score = 0
            
            # Check canonical name
            if topic_data['canonical'].lower() in claims_text:
                score = 0.9
            
            # Check aliases
            for alias in topic_data['aliases']:
                if alias.lower() in claims_text:
                    score = max(score, 0.8)
            
            # Fuzzy match
            fuzz_score = fuzz.partial_ratio(
                topic_data['canonical'].lower(),
                claims_text
            ) / 100
            score = max(score, fuzz_score * 0.7)
            
            if score > best_score:
                best_score = score
                best_match = topic_id
        
        # Fallback to extracted topic
        if best_score < 0.5:
            # Extract key medical terms
            medical_terms = re.findall(
                r'\b(vitamin|supplement|diet|therapy|treatment|cure|health|immune|'
                r'cancer|diabetes|heart|brain|weight|covid|vaccine)\b',
                claims_text,
                re.I
            )
            if medical_terms:
                best_match = medical_terms[0].lower()
                best_score = 0.6
        
        return best_match or "general-health", best_score
    
    def detect_supplement(self, claims: List[str], topic: str) -> bool:
        """Check if this is about supplements"""
        supplement_keywords = [
            'supplement', 'vitamin', 'mineral', 'herb', 'extract',
            'capsule', 'tablet', 'dose', 'mg', 'iu', 'mcg'
        ]
        
        claims_text = ' '.join(claims).lower()
        
        # Check keywords
        for keyword in supplement_keywords:
            if keyword in claims_text:
                return True
        
        # Check topic category
        if topic in HEALTH_TOPICS_INDEX:
            if HEALTH_TOPICS_INDEX[topic].get('category') == 'supplement':
                return True
        
        return False
    
    def assess_claims(self, claims: List[str], topic: str) -> str:
        """Assess health claims for verdict"""
        # Dangerous claim patterns
        danger_patterns = [
            r'cure.{0,10}(cancer|diabetes|alzheimer)',
            r'(prevent|stop|reverse).{0,10}(aging|disease)',
            r'miracle.{0,10}(cure|treatment|remedy)',
            r'doctors hate',
            r'one weird trick'
        ]
        
        claims_text = ' '.join(claims).lower()
        
        # Check for dangerous claims
        for pattern in danger_patterns:
            if re.search(pattern, claims_text, re.I):
                return "harmful"
        
        # Check pre-indexed verdicts
        if topic in HEALTH_TOPICS_INDEX:
            return HEALTH_TOPICS_INDEX[topic]['verdict']
        
        # Default assessment based on claim strength
        strong_claims = ['cure', 'prevent', 'guaranteed', 'proven']
        if any(word in claims_text for word in strong_claims):
            return "not_supported"
        
        moderate_claims = ['may', 'might', 'could', 'support', 'help']
        if any(word in claims_text for word in moderate_claims):
            return "mixed"
        
        return "needs_context"
    
    async def fetch_sources(
        self, 
        topic: str, 
        claims: List[str]
    ) -> Tuple[List[HealthSource], List[str]]:
        """Fetch relevant health sources"""
        sources = []
        bullets = []
        
        # Build search query
        search_query = topic.replace('-', ' ')
        
        # Search primary sources first
        for source_id, source_data in HEALTH_SOURCES['primary'].items():
            url = source_data['search_url'].format(query=quote_plus(search_query))
            
            sources.append(HealthSource(
                name=source_data['name'],
                url=url,
                tier='primary'
            ))
            
            # Mock bullet points (in production, would fetch real content)
            if source_id == 'cochrane' and topic == 'intermittent-fasting':
                bullets.append("Cochrane: Modest weight loss in RCTs vs calorie restriction")
            elif source_id == 'cdc':
                bullets.append(f"CDC: Consult healthcare provider before major dietary changes")
        
        # Add secondary sources if needed
        if len(bullets) < 3:
            for source_id, source_data in HEALTH_SOURCES['secondary'].items():
                url = source_data['search_url'].format(query=quote_plus(search_query))
                
                sources.append(HealthSource(
                    name=source_data['name'],
                    url=url,
                    tier='secondary'
                ))
                
                if len(sources) >= 5:
                    break
        
        # Ensure we have at least 3 bullets
        while len(bullets) < 3:
            bullets.append(f"See trusted sources for evidence-based information")
        
        return sources[:5], bullets[:3]
    
    async def scan(self, request: HealthScanRequest) -> HealthScanResponse:
        """Main health scanning logic"""
        # Detect topic
        topic, confidence = self.detect_topic(request.hints)
        
        # Check cache
        cache_key = f"{topic}:{request.mode}"
        if cache_key in self.cache:
            cached = self.cache[cache_key]
            cached.ttl_sec = 604800  # Reset TTL
            return cached
        
        # Detect if supplement
        is_supplement = self.detect_supplement(request.hints.claims, topic)
        
        # Assess claims
        verdict = self.assess_claims(request.hints.claims, topic)
        
        # Fetch sources
        sources, bullets = await self.fetch_sources(topic, request.hints.claims)
        
        # Adjust for supplements
        if is_supplement and verdict not in ['harmful']:
            bullets.append("Note: Supplement claims are less regulated by FDA")
        
        response = HealthScanResponse(
            topic=topic.replace('-', ' ').title(),
            verdict=verdict,
            bullets=bullets,
            sources=sources,
            supplement_flag=is_supplement,
            confidence=confidence,
            ttl_sec=604800
        )
        
        # Cache result
        self.cache[cache_key] = response
        
        return response

# ============================================================================
# API ROUTES
# ============================================================================

router = APIRouter(prefix="/api/scan", tags=["scanning"])

# Service instances
product_scanner = ProductScanner()
health_scanner = HealthScanner()

@router.post("/product", response_model=ProductScanResponse)
async def scan_product(request: ProductScanRequest):
    """
    Scan for safer product deals
    - Detects product from hints
    - Searches trusted retailers
    - Returns price comparisons
    """
    try:
        # Fast mode timeout
        if request.mode == "fast":
            return await asyncio.wait_for(
                product_scanner.scan(request),
                timeout=1.5
            )
        else:
            # Full mode allows more time
            return await product_scanner.scan(request)
            
    except asyncio.TimeoutError:
        # Return partial results on timeout
        return ProductScanResponse(
            query=product_scanner.normalize_product_query(request.hints),
            matches=[],
            best=None,
            notes=["Search taking longer than expected"],
            confidence=0.3,
            ttl_sec=300
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/health", response_model=HealthScanResponse)
async def scan_health(request: HealthScanRequest):
    """
    Scan for health fact checking
    - Detects health claims
    - Checks trusted medical sources
    - Returns evidence-based assessment
    """
    try:
        # Fast mode timeout
        if request.mode == "fast":
            return await asyncio.wait_for(
                health_scanner.scan(request),
                timeout=1.5
            )
        else:
            # Full mode allows more time
            return await health_scanner.scan(request)
            
    except asyncio.TimeoutError:
        # Return partial results on timeout
        topic, _ = health_scanner.detect_topic(request.hints)
        return HealthScanResponse(
            topic=topic,
            verdict="needs_context",
            bullets=["Analysis in progress", "Check trusted sources below"],
            sources=[
                HealthSource(
                    name="CDC",
                    url=f"https://search.cdc.gov/search/?query={quote_plus(topic)}",
                    tier="primary"
                ),
                HealthSource(
                    name="NIH",
                    url=f"https://search.nih.gov/search?q={quote_plus(topic)}",
                    tier="primary"
                )
            ],
            supplement_flag=False,
            confidence=0.3,
            ttl_sec=300
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/health/topics")
async def list_health_topics():
    """List pre-indexed health topics for debugging"""
    return {
        "topics": list(HEALTH_TOPICS_INDEX.keys()),
        "count": len(HEALTH_TOPICS_INDEX)
    }

@router.get("/product/retailers")
async def list_retailers():
    """List supported retailers for debugging"""
    return {
        "retailers": list(TRUSTED_RETAILERS.keys()),
        "count": len(TRUSTED_RETAILERS)
    }

# ============================================================================
# INTEGRATION WITH MAIN APP
# ============================================================================

def register_scan_endpoints(app):
    """Register scan endpoints with the main FastAPI app"""
    app.include_router(router)
    return app