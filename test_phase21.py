# test_phase21.py
"""
Test script for SafeSignal Phase 2.1 - Server-Side URL Fetching

Run this after starting the API server to verify functionality.
"""

import asyncio
import httpx
import json
import time

# Test URLs for different scenarios
TEST_URLS = [
    # Legitimate sites (should return "ok")
    "https://www.google.com",
    "https://en.wikipedia.org/wiki/Internet_safety",
    "https://github.com/microsoft/vscode",
    
    # Sites with tracking parameters (test normalization)
    "https://www.example.com/?utm_source=google&utm_medium=cpc&fbclid=123&gclid=456",
    
    # Suspicious TLD (should return "warning")
    "https://example.tk",
    
    # Invalid URLs (should return "danger")
    "https://invalid-url-that-does-not-exist-12345.com",
    "http://localhost:1234",  # Should be blocked by SSRF protection
    
    # Redirects (test redirect following)
    "http://google.com",  # Redirects to https
]

async def test_api_endpoint():
    """Test the /api/check endpoint with various URLs"""
    
    api_base_url = "http://localhost:8000"
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        print("=== SafeSignal API Phase 2.1 Test ===\n")
        
        # Test health endpoint first
        try:
            health_response = await client.get(f"{api_base_url}/health")
            print(f"✅ Health check: {health_response.status_code}")
            print(f"   Response: {health_response.json()}\n")
        except Exception as e:
            print(f"❌ Health check failed: {e}")
            return
        
        # Test each URL
        for i, test_url in enumerate(TEST_URLS):
            print(f"Test {i+1}: {test_url}")
            print("-" * 50)
            
            start_time = time.time()
            
            try:
                response = await client.post(
                    f"{api_base_url}/api/check",
                    json={"url": test_url},
                    headers={"Content-Type": "application/json"}
                )
                
                elapsed_time = (time.time() - start_time) * 1000
                
                if response.status_code == 200:
                    result = response.json()
                    print(f"✅ Status: {response.status_code}")
                    print(f"📊 Verdict: {result['verdict']}")
                    print(f"🔍 Reasons: {', '.join(result['reasons'])}")
                    print(f"🌐 Domain: {result['meta']['domain']}")
                    print(f"📄 Title: {result['meta']['title'] or 'N/A'}")
                    print(f"🔄 Redirects: {result['meta']['redirect_count']}")
                    print(f"⏱️  Total time: {elapsed_time:.0f}ms (API: {result['processing_time_ms']}ms)")
                    print(f"🔧 Analysis mode: {result['meta']['analysis_mode']}")
                    
                    if result['meta'].get('removed_tracking_params', 0) > 0:
                        print(f"🧹 Removed {result['meta']['removed_tracking_params']} tracking params")
                    
                    if result['meta'].get('punycode_detected'):
                        print("🌐 Punycode detected in domain")
                    
                else:
                    print(f"❌ Status: {response.status_code}")
                    print(f"Error: {response.text}")
                    
            except Exception as e:
                elapsed_time = (time.time() - start_time) * 1000
                print(f"❌ Request failed after {elapsed_time:.0f}ms: {e}")
            
            print()  # Empty line between tests

async def test_normalization_directly():
    """Test URL normalization without making API calls"""
    print("=== URL Normalization Tests ===\n")
    
    # Import our normalizer directly
    import sys
    import os
    sys.path.append(os.path.join(os.path.dirname(__file__), 'api'))
    
    try:
        from src.services.url_normalizer import URLNormalizer
        
        normalizer = URLNormalizer()
        
        test_urls = [
            "https://example.com/path/?utm_source=google&utm_medium=cpc&fbclid=123&v=1&legitimate_param=value",
            "http://EXAMPLE.COM:80/PATH//WITH//DOUBLE///SLASHES/",
            "https://www.xn--fsq.xn--0zwm56d",  # Punycode example
        ]
        
        for url in test_urls:
            print(f"Original: {url}")
            result = normalizer.normalize_url(url)
            print(f"Normalized: {result['normalized_url']}")
            print(f"Removed {result['removed_params_count']} tracking params")
            if result['punycode_info'].get('has_punycode'):
                print(f"Punycode decoded: {result['punycode_info']['decoded_hostname']}")
            print("-" * 40)
            
    except ImportError as e:
        print(f"Could not import normalizer: {e}")
        print("Make sure you're running from the project root directory")

def print_usage():
    """Print usage instructions"""
    print("""
=== SafeSignal Phase 2.1 Test Instructions ===

1. Start the API server:
   cd api
   pip install -r requirements.txt
   uvicorn src.main:app --reload --host 0.0.0.0 --port 8000

2. Run this test script:
   python test_phase21.py

Expected behavior:
- google.com, wikipedia.org → "ok" verdict
- URLs with tracking params → normalized URLs
- .tk domains → "warning" verdict  
- Invalid/unreachable URLs → "danger" or "warning" with fetch errors
- Localhost URLs → blocked by SSRF protection

Check the console for detailed results!
""")

if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 1 and sys.argv[1] == "normalize":
        asyncio.run(test_normalization_directly())
    elif len(sys.argv) > 1 and sys.argv[1] == "help":
        print_usage()
    else:
        asyncio.run(test_api_endpoint())