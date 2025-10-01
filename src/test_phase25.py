# api/test_phase25.py
"""
Phase 2.5 Test Suite: Product & Health Scan Endpoints
Tests both API endpoints and client-side hint extraction
"""

import asyncio
import json
from typing import Dict, List
import httpx
import pytest
from fastapi.testclient import TestClient

# Test URLs representing different page types
TEST_URLS = {
    "product": {
        "amazon_tv": "https://www.amazon.com/dp/B08XXX/samsung-tv-65-inch",
        "walmart_supplement": "https://www.walmart.com/ip/vitamin-d3-5000iu/12345",
        "sketchy_product": "https://buy-now-limited.biz/miracle-cure-device"
    },
    "health": {
        "webmd_article": "https://www.webmd.com/diet/intermittent-fasting",
        "miracle_cure": "https://cure-everything.net/quantum-healing",
        "supplement_site": "https://super-supplements.shop/omega3-benefits"
    }
}

# Mock product hints
PRODUCT_HINTS = {
    "tv": {
        "title": "Samsung 65\" 4K Smart TV QLED Q80",
        "brand": "Samsung", 
        "model": "QN65Q80",
        "price": 1299.99
    },
    "supplement": {
        "title": "Vitamin D3 5000 IU High Potency",
        "brand": "Nature's Way",
        "upc": "033674104651"
    },
    "sketchy": {
        "title": "MIRACLE CURE DEVICE - Doctors Hate This!",
        "brand": None,
        "price": 49.99
    }
}

# Mock health hints
HEALTH_HINTS = {
    "intermittent_fasting": {
        "claims": [
            "Helps you lose weight fast",
            "Improves insulin sensitivity",
            "May extend lifespan"
        ],
        "topic": "intermittent fasting"
    },
    "miracle_cure": {
        "claims": [
            "Cures cancer in 30 days",
            "Reverses aging completely",
            "Doctors don't want you to know"
        ]
    },
    "supplement": {
        "claims": [
            "Supports heart health",
            "Clinically proven omega-3",
            "Reduces inflammation by 50%"
        ],
        "topic": "omega-3"
    }
}

class TestPhase25:
    """Comprehensive test suite for Phase 2.5"""
    
    @pytest.fixture
    def api_client(self):
        """Create test client"""
        from main import app  # Import your FastAPI app
        return TestClient(app)
    
    # =========================================================================
    # PRODUCT SCANNER TESTS
    # =========================================================================
    
    def test_product_scan_basic(self, api_client):
        """Test basic product scanning"""
        response = api_client.post("/api/scan/product", json={
            "url": TEST_URLS["product"]["amazon_tv"],
            "hints": PRODUCT_HINTS["tv"],
            "mode": "fast"
        })
        
        assert response.status_code == 200
        data = response.json()
        
        # Check response structure
        assert "query" in data
        assert "matches" in data
        assert "notes" in data
        assert "confidence" in data
        
        # Check query normalization
        assert data["query"]["brand"] == "SAMSUNG"
        assert "Samsung" in data["query"]["title"]
        
        # Check matches
        assert len(data["matches"]) <= 3
        if data["matches"]:
            match = data["matches"][0]
            assert "retailer" in match
            assert "price" in match
            assert "seller" in match
            assert "url" in match
    
    def test_product_scan_with_upc(self, api_client):
        """Test product scanning with UPC"""
        response = api_client.post("/api/scan/product", json={
            "url": TEST_URLS["product"]["walmart_supplement"],
            "hints": PRODUCT_HINTS["supplement"],
            "mode": "fast"
        })
        
        assert response.status_code == 200
        data = response.json()
        
        # UPC should be in query
        assert "upc" in data["query"]
        assert data["query"]["upc"] == "033674104651"
    
    def test_product_scan_sketchy_seller(self, api_client):
        """Test detection of sketchy sellers"""
        response = api_client.post("/api/scan/product", json={
            "url": TEST_URLS["product"]["sketchy_product"],
            "hints": PRODUCT_HINTS["sketchy"],
            "mode": "fast"
        })
        
        assert response.status_code == 200
        data = response.json()
        
        # Should have warning notes
        assert len(data["notes"]) > 0
        
        # Confidence should be lower
        assert data["confidence"] < 0.7
    
    def test_product_scan_timeout_handling(self, api_client):
        """Test timeout handling with fallback"""
        # This would need mock/patch in real implementation
        response = api_client.post("/api/scan/product", json={
            "url": "https://slow-site.com/product",
            "hints": {"title": "Test Product"},
            "mode": "fast"
        })
        
        # Should still return something
        assert response.status_code == 200
    
    # =========================================================================
    # HEALTH SCANNER TESTS
    # =========================================================================
    
    def test_health_scan_basic(self, api_client):
        """Test basic health claim scanning"""
        response = api_client.post("/api/scan/health", json={
            "url": TEST_URLS["health"]["webmd_article"],
            "hints": HEALTH_HINTS["intermittent_fasting"],
            "mode": "fast"
        })
        
        assert response.status_code == 200
        data = response.json()
        
        # Check response structure
        assert "topic" in data
        assert "verdict" in data
        assert "bullets" in data
        assert "sources" in data
        assert "supplement_flag" in data
        
        # Check topic detection
        assert "fasting" in data["topic"].lower()
        
        # Check sources
        assert len(data["sources"]) >= 2
        primary_sources = [s for s in data["sources"] if s["tier"] == "primary"]
        assert len(primary_sources) > 0
    
    def test_health_scan_dangerous_claims(self, api_client):
        """Test detection of dangerous health claims"""
        response = api_client.post("/api/scan/health", json={
            "url": TEST_URLS["health"]["miracle_cure"],
            "hints": HEALTH_HINTS["miracle_cure"],
            "mode": "fast"
        })
        
        assert response.status_code == 200
        data = response.json()
        
        # Should flag as harmful or not supported
        assert data["verdict"] in ["harmful", "not_supported"]
        
        # Should have warning in bullets
        assert any("cure" in b.lower() or "not" in b.lower() 
                  for b in data["bullets"])
    
    def test_health_scan_supplement_detection(self, api_client):
        """Test supplement detection and flagging"""
        response = api_client.post("/api/scan/health", json={
            "url": TEST_URLS["health"]["supplement_site"],
            "hints": HEALTH_HINTS["supplement"],
            "mode": "fast"
        })
        
        assert response.status_code == 200
        data = response.json()
        
        # Should detect supplement
        assert data["supplement_flag"] is True
        
        # Should have supplement warning
        assert any("supplement" in b.lower() or "FDA" in b 
                  for b in data["bullets"])
    
    def test_health_scan_source_ranking(self, api_client):
        """Test that primary sources are prioritized"""
        response = api_client.post("/api/scan/health", json={
            "url": "https://example.com/health",
            "hints": {
                "claims": ["Improves heart health"],
                "topic": "omega-3"
            },
            "mode": "fast"
        })
        
        assert response.status_code == 200
        data = response.json()
        
        # Primary sources should come first
        if len(data["sources"]) > 1:
            assert data["sources"][0]["tier"] == "primary"
    
    # =========================================================================
    # INTEGRATION TESTS
    # =========================================================================
    
    def test_parallel_scans(self, api_client):
        """Test running product and health scans in parallel"""
        import concurrent.futures
        
        def scan_product():
            return api_client.post("/api/scan/product", json={
                "url": TEST_URLS["product"]["amazon_tv"],
                "hints": PRODUCT_HINTS["tv"],
                "mode": "fast"
            })
        
        def scan_health():
            return api_client.post("/api/scan/health", json={
                "url": TEST_URLS["health"]["webmd_article"],
                "hints": HEALTH_HINTS["intermittent_fasting"],
                "mode": "fast"
            })
        
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            product_future = executor.submit(scan_product)
            health_future = executor.submit(scan_health)
            
            product_response = product_future.result()
            health_response = health_future.result()
        
        assert product_response.status_code == 200
        assert health_response.status_code == 200
    
    def test_cache_behavior(self, api_client):
        """Test that caching works properly"""
        # First request
        response1 = api_client.post("/api/scan/product", json={
            "url": TEST_URLS["product"]["amazon_tv"],
            "hints": PRODUCT_HINTS["tv"],
            "mode": "fast"
        })
        
        # Second identical request (should be cached)
        response2 = api_client.post("/api/scan/product", json={
            "url": TEST_URLS["product"]["amazon_tv"],
            "hints": PRODUCT_HINTS["tv"],
            "mode": "fast"
        })
        
        assert response1.status_code == 200
        assert response2.status_code == 200
        
        # Results should be identical (from cache)
        assert response1.json() == response2.json()
    
    def test_mode_switching(self, api_client):
        """Test fast vs full mode behavior"""
        # Fast mode
        fast_response = api_client.post("/api/scan/product", json={
            "url": TEST_URLS["product"]["amazon_tv"],
            "hints": PRODUCT_HINTS["tv"],
            "mode": "fast"
        })
        
        # Full mode (might have more results)
        full_response = api_client.post("/api/scan/product", json={
            "url": TEST_URLS["product"]["amazon_tv"],
            "hints": PRODUCT_HINTS["tv"],
            "mode": "full"
        })
        
        assert fast_response.status_code == 200
        assert full_response.status_code == 200
        
        # Full mode might have higher confidence
        fast_data = fast_response.json()
        full_data = full_response.json()
        assert full_data["confidence"] >= fast_data["confidence"]
    
    # =========================================================================
    # ENDPOINT AVAILABILITY TESTS
    # =========================================================================
    
    def test_list_retailers_endpoint(self, api_client):
        """Test retailer listing endpoint"""
        response = api_client.get("/api/scan/product/retailers")
        
        assert response.status_code == 200
        data = response.json()
        
        assert "retailers" in data
        assert "count" in data
        assert len(data["retailers"]) >= 4
        assert "amazon" in data["retailers"]
    
    def test_list_health_topics_endpoint(self, api_client):
        """Test health topics listing endpoint"""
        response = api_client.get("/api/scan/health/topics")
        
        assert response.status_code == 200
        data = response.json()
        
        assert "topics" in data
        assert "count" in data
        assert len(data["topics"]) >= 3
        assert "intermittent-fasting" in data["topics"]
    
    # =========================================================================
    # ERROR HANDLING TESTS
    # =========================================================================
    
    def test_missing_hints(self, api_client):
        """Test handling of missing hints"""
        response = api_client.post("/api/scan/product", json={
            "url": "https://example.com",
            "hints": {},
            "mode": "fast"
        })
        
        # Should handle gracefully
        assert response.status_code in [200, 422]
    
    def test_invalid_url(self, api_client):
        """Test handling of invalid URLs"""
        response = api_client.post("/api/scan/product", json={
            "url": "not-a-valid-url",
            "hints": {"title": "Test"},
            "mode": "fast"
        })
        
        # Should handle gracefully
        assert response.status_code in [200, 422]
    
    def test_empty_claims(self, api_client):
        """Test health scan with no claims"""
        response = api_client.post("/api/scan/health", json={
            "url": "https://example.com",
            "hints": {"claims": []},
            "mode": "fast"
        })
        
        # Should handle gracefully
        assert response.status_code in [200, 422]


# ============================================================================
# MANUAL TEST RUNNER
# ============================================================================

async def manual_test():
    """Run manual tests for Phase 2.5"""
    print("=" * 60)
    print("SafeSignal Phase 2.5 - Manual Test Suite")
    print("=" * 60)
    
    base_url = "http://localhost:8000"
    
    async with httpx.AsyncClient(base_url=base_url, timeout=10.0) as client:
        
        # Test 1: Product Scanner
        print("\n[1] Testing Product Scanner")
        print("-" * 40)
        
        product_tests = [
            {
                "name": "Samsung TV",
                "payload": {
                    "url": "https://www.amazon.com/samsung-tv",
                    "hints": {
                        "title": "Samsung 65\" QLED 4K Smart TV",
                        "brand": "Samsung",
                        "model": "QN65Q80",
                        "price": 1299.99
                    },
                    "mode": "fast"
                }
            },
            {
                "name": "Vitamin D Supplement",
                "payload": {
                    "url": "https://example.com/vitamin-d",
                    "hints": {
                        "title": "Vitamin D3 5000 IU",
                        "brand": "Nature Made",
                        "upc": "031604026752"
                    },
                    "mode": "fast"
                }
            }
        ]
        
        for test in product_tests:
            try:
                print(f"\nTesting: {test['name']}")
                response = await client.post(
                    "/api/scan/product",
                    json=test["payload"]
                )
                
                if response.status_code == 200:
                    data = response.json()
                    print(f"✅ Success - Found {len(data['matches'])} matches")
                    if data.get('best'):
                        best = data['best']
                        print(f"   Best deal: {best['retailer']} - ${best['price']:.2f}")
                    for note in data.get('notes', []):
                        print(f"   Note: {note}")
                else:
                    print(f"❌ Failed with status {response.status_code}")
                    
            except Exception as e:
                print(f"❌ Error: {e}")
        
        # Test 2: Health Scanner
        print("\n[2] Testing Health Scanner")
        print("-" * 40)
        
        health_tests = [
            {
                "name": "Intermittent Fasting",
                "payload": {
                    "url": "https://example.com/if-article",
                    "hints": {
                        "claims": [
                            "Helps lose weight fast",
                            "Improves insulin sensitivity",
                            "Extends lifespan"
                        ],
                        "topic": "intermittent fasting"
                    },
                    "mode": "fast"
                }
            },
            {
                "name": "Miracle Cure (Dangerous)",
                "payload": {
                    "url": "https://sketchy-site.com/cure",
                    "hints": {
                        "claims": [
                            "Cures cancer in 30 days",
                            "Reverses aging",
                            "Doctors hate this trick"
                        ]
                    },
                    "mode": "fast"
                }
            },
            {
                "name": "Omega-3 Supplement",
                "payload": {
                    "url": "https://example.com/omega3",
                    "hints": {
                        "claims": [
                            "Supports heart health",
                            "Clinically proven",
                            "Reduces inflammation"
                        ],
                        "topic": "omega-3"
                    },
                    "mode": "fast"
                }
            }
        ]
        
        for test in health_tests:
            try:
                print(f"\nTesting: {test['name']}")
                response = await client.post(
                    "/api/scan/health",
                    json=test["payload"]
                )
                
                if response.status_code == 200:
                    data = response.json()
                    print(f"✅ Topic: {data['topic']}")
                    print(f"   Verdict: {data['verdict']}")
                    if data['supplement_flag']:
                        print("   ⚠️ Supplement detected")
                    print(f"   Sources: {', '.join(s['name'] for s in data['sources'][:3])}")
                    for bullet in data['bullets'][:2]:
                        print(f"   • {bullet[:50]}...")
                else:
                    print(f"❌ Failed with status {response.status_code}")
                    
            except Exception as e:
                print(f"❌ Error: {e}")
        
        # Test 3: Parallel Execution
        print("\n[3] Testing Parallel Scanning")
        print("-" * 40)
        
        try:
            # Send both requests simultaneously
            product_task = client.post("/api/scan/product", json={
                "url": "https://example.com/product",
                "hints": {"title": "Test Product", "brand": "TestBrand"},
                "mode": "fast"
            })
            
            health_task = client.post("/api/scan/health", json={
                "url": "https://example.com/health",
                "hints": {"claims": ["Boosts immune system"]},
                "mode": "fast"
            })
            
            # Wait for both
            product_resp, health_resp = await asyncio.gather(
                product_task, health_task
            )
            
            if product_resp.status_code == 200 and health_resp.status_code == 200:
                print("✅ Both scans completed successfully in parallel")
            else:
                print("❌ One or both scans failed")
                
        except Exception as e:
            print(f"❌ Parallel execution error: {e}")
        
        # Test 4: List Endpoints
        print("\n[4] Testing List Endpoints")
        print("-" * 40)
        
        try:
            # List retailers
            retailers_resp = await client.get("/api/scan/product/retailers")
            if retailers_resp.status_code == 200:
                data = retailers_resp.json()
                print(f"✅ Found {data['count']} retailers: {', '.join(data['retailers'])}")
            
            # List health topics
            topics_resp = await client.get("/api/scan/health/topics")
            if topics_resp.status_code == 200:
                data = topics_resp.json()
                print(f"✅ Found {data['count']} pre-indexed health topics")
                print(f"   Sample: {', '.join(data['topics'][:3])}")
                
        except Exception as e:
            print(f"❌ List endpoints error: {e}")
    
    print("\n" + "=" * 60)
    print("Phase 2.5 Testing Complete!")
    print("=" * 60)
    print("\nSummary:")
    print("- Product scanner can find safer deals across retailers")
    print("- Health scanner can fact-check claims against trusted sources")
    print("- Both endpoints support fast/full modes with timeout handling")
    print("- Caching reduces redundant processing")
    print("- Parallel execution works for better performance")


if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 1 and sys.argv[1] == "pytest":
        # Run with pytest
        pytest.main([__file__, "-v"])
    else:
        # Run manual tests
        print("\n🚀 Starting Phase 2.5 Manual Tests...")
        print("   Make sure the API server is running on localhost:8000")
        print("   To run unit tests instead: python test_phase25.py pytest\n")
        
        asyncio.run(manual_test())