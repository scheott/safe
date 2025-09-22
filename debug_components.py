# debug_components.py
"""
Debug script to test individual SafeSignal components.
Run this to isolate where the TypeError is coming from.
"""

import asyncio
import sys
import os

# Add the api directory to the path
sys.path.append(os.path.join(os.path.dirname(__file__), 'api'))

async def test_url_normalizer():
    """Test URL normalization component"""
    print("=== Testing URL Normalizer ===")
    
    try:
        from src.services.url_normalizer import URLNormalizer
        normalizer = URLNormalizer()
        
        test_url = "https://www.google.com/?utm_source=test"
        result = normalizer.normalize_url(test_url)
        
        print(f"✅ URL Normalizer works!")
        print(f"   Original: {test_url}")
        print(f"   Normalized: {result['normalized_url']}")
        print(f"   Domain: {result['domain']}")
        print(f"   Removed params: {result['removed_params_count']}")
        return True
        
    except Exception as e:
        print(f"❌ URL Normalizer failed: {type(e).__name__}: {e}")
        return False

async def test_url_fetcher():
    """Test URL fetcher component"""
    print("\n=== Testing URL Fetcher ===")
    
    try:
        from src.services.url_fetcher import URLFetcher
        fetcher = URLFetcher()
        
        # Test a simple URL
        test_url = "https://httpbin.org/get"  # Simple test endpoint
        print(f"Testing fetch of: {test_url}")
        
        result = await fetcher.fetch_url(test_url)
        
        print(f"✅ URL Fetcher works!")
        print(f"   Success: {result.success}")
        print(f"   Final URL: {result.final_url}")
        print(f"   Status Code: {result.status_code}")
        print(f"   Fetch Time: {result.fetch_time_ms}ms")
        print(f"   Title: {result.title}")
        
        if not result.success:
            print(f"   Error: {result.error_reason}")
        
        return True
        
    except Exception as e:
        print(f"❌ URL Fetcher failed: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
        return False

async def test_waf_detector():
    """Test WAF detection component"""
    print("\n=== Testing WAF Detector ===")
    
    try:
        from src.services.waf_detector import WAFDetector
        detector = WAFDetector()
        
        # Test with sample HTML
        sample_html = "<html><body>Access Denied - Cloudflare</body></html>"
        result = detector.detect_waf_response(sample_html, 403)
        
        print(f"✅ WAF Detector works!")
        print(f"   Is WAF page: {result['is_waf_page']}")
        print(f"   WAF type: {result['waf_type']}")
        print(f"   Confidence: {result['confidence']}")
        print(f"   Indicators: {result['indicators']}")
        return True
        
    except Exception as e:
        print(f"❌ WAF Detector failed: {type(e).__name__}: {e}")
        return False

async def test_simple_httpx():
    """Test raw httpx to isolate the issue"""
    print("\n=== Testing Raw HTTPX ===")
    
    try:
        import httpx
        
        print(f"HTTPX version: {httpx.__version__}")
        
        # Test basic httpx functionality
        async with httpx.AsyncClient() as client:
            response = await client.get("https://httpbin.org/get")
            print(f"✅ Basic HTTPX works!")
            print(f"   Status: {response.status_code}")
            print(f"   Content length: {len(response.content)}")
        
        return True
        
    except Exception as e:
        print(f"❌ Basic HTTPX failed: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
        return False

async def main():
    """Run all component tests"""
    print("SafeSignal Component Debug Tests")
    print("=" * 40)
    
    results = []
    
    # Test each component
    results.append(await test_url_normalizer())
    results.append(await test_simple_httpx()) 
    results.append(await test_url_fetcher())
    results.append(await test_waf_detector())
    
    print("\n" + "=" * 40)
    print("SUMMARY:")
    
    component_names = ["URL Normalizer", "Basic HTTPX", "URL Fetcher", "WAF Detector"]
    for i, (name, success) in enumerate(zip(component_names, results)):
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"  {name}: {status}")
    
    all_passed = all(results)
    print(f"\nOverall: {'✅ ALL TESTS PASSED' if all_passed else '❌ SOME TESTS FAILED'}")
    
    if not all_passed:
        print("\nTroubleshooting tips:")
        print("1. Make sure you're in the project root directory")
        print("2. Install requirements: pip install -r api/requirements.txt")
        print("3. Check Python version (3.8+ required)")
        print("4. Check for conflicting packages: pip list | grep httpx")

if __name__ == "__main__":
    asyncio.run(main())