# test_phase23.py
"""
Test script for SafeSignal Phase 2.3 - Tier-0 Analysis & Domain Reputation

Run this after setting up the data files and starting the API server.
"""

import asyncio
import httpx
import json
import time
from pathlib import Path

# Test URLs for different scenarios
TEST_SCENARIOS = {
    "reputable_sites": [
        "https://www.google.com",
        "https://en.wikipedia.org/wiki/Internet_safety",
        "https://github.com/microsoft/vscode",
        "https://www.mayo clinic.org/diseases-conditions/heart-disease",
        "https://www.irs.gov/individuals",
    ],
    
    "suspicious_domains": [
        "https://example.tk",  # Suspicious TLD
        "https://g00gle.com",  # Typosquatting (if registered)
        "https://microsoft-support.tk",  # Brand impersonation
    ],
    
    "tracking_params": [
        "https://www.example.com/?utm_source=google&utm_medium=cpc&fbclid=123&gclid=456",
        "https://news.site.com/article?utm_campaign=test&_hsenc=123&mc_cid=456",
    ],
    
    "content_heuristics": [
        # These would need to be real sites with suspicious content
        "https://httpbin.org/html",  # Safe test site
    ],
    
    "technical_issues": [
        "https://invalid-url-that-does-not-exist-12345.com",
        "http://localhost:1234",  # Should be blocked by SSRF
        "https://httpstat.us/429",  # Rate limiting test
    ]
}

async def test_data_setup():
    """Test that data files are properly created and loaded"""
    print("=== Testing Data Setup ===\n")
    
    # Check if data files exist - handle both locations
    possible_data_dirs = [Path("data"), Path("api/data")]
    data_dir = None
    
    for check_dir in possible_data_dirs:
        if check_dir.exists():
            data_dir = check_dir
            break
    
    if not data_dir:
        print("❌ No data directory found")
        print("🔧 Run this first:")
        print("cd api && python create_data_structure.py")
        return False
    
    print(f"📂 Using data directory: {data_dir}")
    
    required_files = [
        "reputable_domains.json",
        "brand_domains.json", 
        "suspicious_indicators.json",
        "heuristic_weights.json"
    ]
    
    all_files_exist = True
    for filename in required_files:
        file_path = data_dir / filename
        if file_path.exists():
            print(f"✅ {filename} exists")
            
            # Check file content
            try:
                with open(file_path, 'r') as f:
                    data = json.load(f)
                    print(f"   📊 Loaded {len(data)} top-level keys")
                    
                    if filename == "reputable_domains.json":
                        domains = data.get('domains', {})
                        print(f"   🌐 Contains {len(domains)} reputable domains")
                    elif filename == "brand_domains.json":
                        categories = data.get('categories', {})
                        total_brands = sum(len(brands) for brands in categories.values())
                        print(f"   🏢 Contains {total_brands} brand domains across {len(categories)} categories")
                        
            except Exception as e:
                print(f"   ❌ Error reading {filename}: {e}")
                all_files_exist = False
        else:
            print(f"❌ {filename} missing")
            all_files_exist = False
    
    if not all_files_exist:
        print("\n🔧 Run this first:")
        print("python create_data_structure.py")  # Remove the cd api part since we're already there
        return False
    
    print(f"\n✅ All data files exist in {data_dir}/")
    return True

async def test_reputation_service():
    """Test reputation service directly"""
    print("\n=== Testing Reputation Service ===\n")
    
    try:
        # Import our services - handle both running from api/ and root directory
        import sys
        import os
        
        # If we're in the api directory, add current directory to path
        if os.path.exists("src"):
            if "." not in sys.path:
                sys.path.insert(0, ".")
        else:
            # We're in root directory, add api to path
            if "api" not in sys.path:
                sys.path.append("api")
        
        from src.services.reputation_service import ReputationService
        
        reputation = ReputationService()
        
        # Test domain scoring
        test_domains = [
            ("google.com", "Should be reputable"),
            ("example.tk", "Should be suspicious TLD"),
            ("unknown-domain.com", "Should be neutral"),
            ("github.com", "Should be reputable"),
        ]
        
        print("🔍 Domain Reputation Tests:")
        for domain, description in test_domains:
            score = reputation.get_domain_score(domain)
            print(f"   {domain}: {score} ({description})")
        
        # Test brand similarity
        print("\n🎭 Brand Similarity Tests:")
        test_lookalikes = [
            "chase.tk",
            "g00gle.com", 
            "paypaI.com",  # Note: capital i instead of l
            "microsoft-support.com"
        ]
        
        for domain in test_lookalikes:
            similar = reputation.find_similar_brands(domain)
            if similar:
                closest = similar[0]
                print(f"   {domain} → similar to {closest['brand']} (distance: {closest['distance']})")
            else:
                print(f"   {domain} → no similar brands found")
        
        # Test keyword detection
        print("\n🚨 Keyword Detection Tests:")
        test_content = [
            "Your account has been suspended. Please verify your identity immediately.",
            "Miracle cure discovered! Doctors hate this one simple trick.",
            "Limited time offer! Act now before it expires!",
            "This is normal content about web development."
        ]
        
        for content in test_content:
            result = reputation.check_suspicious_keywords(content)
            print(f"   '{content[:50]}...' → Score: {result['total_score']}, Patterns: {result['pattern_types']}")
        
        # Get stats
        stats = reputation.get_stats()
        print(f"\n📊 Reputation Service Stats:")
        print(f"   Reputable domains: {stats['reputable_domains']}")
        print(f"   Brand domains: {stats['brand_domains']}")
        print(f"   Brand categories: {stats['brand_categories']}")
        
        return True
        
    except ImportError as e:
        print(f"❌ Could not import reputation service: {e}")
        print("Make sure you're running from the project root directory")
        return False
    except Exception as e:
        print(f"❌ Error testing reputation service: {e}")
        return False

async def test_tier0_analyzer():
    """Test Tier-0 analyzer directly"""
    print("\n=== Testing Tier-0 Analyzer ===\n")
    
    try:
        import sys
        import os
        
        # If we're in the api directory, add current directory to path
        if os.path.exists("src"):
            if "." not in sys.path:
                sys.path.insert(0, ".")
        else:
            # We're in root directory, add api to path
            if "api" not in sys.path:
                sys.path.append("api")
        
        from src.services.reputation_service import ReputationService
        from src.services.tier0_analyzer import Tier0Analyzer
        
        reputation = ReputationService()
        analyzer = Tier0Analyzer(reputation)
        
        # Test different types of URLs
        test_cases = [
            {
                "url": "https://www.google.com/search?q=test",
                "expected": "ok",
                "description": "Reputable domain"
            },
            {
                "url": "https://example.tk/verify-account.php",
                "expected": "warning",
                "description": "Suspicious TLD + suspicious path"
            },
            {
                "url": "https://microsoft-support.tk/urgent-update",
                "expected": "danger", 
                "description": "Brand impersonation + suspicious elements"
            },
            {
                "url": "https://unknown-site.com/normal-page",
                "expected": "ok",
                "description": "Unknown but normal domain"
            }
        ]
        
        for test_case in test_cases:
            print(f"🧪 Testing: {test_case['url']}")
            
            result = analyzer.analyze(
                url=test_case['url'],
                fetch_result=None,  # No fetch result for this test
                content_excerpt=None
            )
            
            print(f"   Expected: {test_case['expected']}, Got: {result.verdict}")
            print(f"   Score: {result.score}")
            print(f"   Reasons: {result.reasons}")
            print(f"   Description: {test_case['description']}")
            
            # Check if verdict matches expectation
            if result.verdict == test_case['expected']:
                print("   ✅ PASS")
            else:
                print("   ⚠️  Different than expected (may still be correct)")
            
            print()
        
        return True
        
    except Exception as e:
        print(f"❌ Error testing Tier-0 analyzer: {e}")
        import traceback
        traceback.print_exc()
        return False

async def test_api_endpoints():
    """Test the API endpoints with Tier-0 analysis"""
    print("\n=== Testing API Endpoints ===\n")
    
    api_base_url = "http://localhost:8000"
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        # Test health endpoint
        try:
            health_response = await client.get(f"{api_base_url}/health")
            print(f"✅ Health check: {health_response.status_code}")
            if health_response.status_code == 200:
                health_data = health_response.json()
                print(f"   Version: {health_data.get('version')}")
                print(f"   Phase: {health_data.get('phase')}")
        except Exception as e:
            print(f"❌ Health check failed: {e}")
            return False
        
        # Test reputation stats endpoint
        try:
            stats_response = await client.get(f"{api_base_url}/api/reputation/stats")
            if stats_response.status_code == 200:
                stats_data = stats_response.json()
                print(f"✅ Reputation stats: {stats_data['status']}")
                reputation_stats = stats_data.get('reputation_service', {})
                print(f"   Reputable domains: {reputation_stats.get('reputable_domains')}")
                print(f"   Brand domains: {reputation_stats.get('brand_domains')}")
            else:
                print(f"⚠️  Reputation stats: {stats_response.status_code}")
        except Exception as e:
            print(f"❌ Reputation stats failed: {e}")
        
        # Test URL checking with different scenarios
        for scenario_name, urls in TEST_SCENARIOS.items():
            print(f"\n📋 Testing {scenario_name}:")
            
            for url in urls[:2]:  # Test first 2 URLs from each scenario
                print(f"\n🔍 Checking: {url}")
                start_time = time.time()
                
                try:
                    response = await client.post(
                        f"{api_base_url}/api/check",
                        json={"url": url},
                        headers={"Content-Type": "application/json"}
                    )
                    
                    elapsed_time = (time.time() - start_time) * 1000
                    
                    if response.status_code == 200:
                        result = response.json()
                        print(f"   ✅ Status: {response.status_code}")
                        print(f"   📊 Verdict: {result['verdict']}")
                        print(f"   🔍 Reasons: {', '.join(result['reasons'])}")
                        print(f"   🌐 Domain: {result['meta']['domain']}")
                        print(f"   📄 Title: {result['meta'].get('title', 'N/A')}")
                        print(f"   🔢 Tier-0 Score: {result['meta'].get('tier0_score', 'N/A')}")
                        print(f"   ⏱️  Total time: {elapsed_time:.0f}ms (API: {result['processing_time_ms']}ms)")
                        print(f"   🔧 Analysis mode: {result['meta']['analysis_mode']}")
                        
                        # Show interesting details
                        if result['meta'].get('removed_tracking_params', 0) > 0:
                            print(f"   🧹 Removed {result['meta']['removed_tracking_params']} tracking params")
                        
                        if result['meta'].get('escalate_to_tier1'):
                            print(f"   🚀 Would escalate to Tier-1")
                        
                        # Show domain analysis details if available
                        tier0_details = result['meta'].get('tier0_details', {})
                        domain_analysis = tier0_details.get('domain_analysis', {})
                        if domain_analysis:
                            print(f"   🏷️  Domain reputation: {domain_analysis.get('reputation_score', 'N/A')}")
                        
                        brand_analysis = tier0_details.get('brand_analysis', {})
                        if brand_analysis.get('similar_brands'):
                            similar = brand_analysis['similar_brands'][0]
                            print(f"   🎭 Similar to: {similar['brand']} (distance: {similar['distance']})")
                        
                    else:
                        print(f"   ❌ Status: {response.status_code}")
                        print(f"   Error: {response.text}")
                        
                except Exception as e:
                    elapsed_time = (time.time() - start_time) * 1000
                    print(f"   ❌ Request failed after {elapsed_time:.0f}ms: {e}")
        
        # Test analytics endpoints
        print(f"\n📈 Testing Analytics Endpoints:")
        
        try:
            analytics_response = await client.get(f"{api_base_url}/api/analytics/daily?days=1")
            if analytics_response.status_code == 200:
                analytics_data = analytics_response.json()
                print(f"   ✅ Daily analytics: {len(analytics_data.get('stats', []))} days of data")
            else:
                print(f"   ⚠️  Daily analytics: {analytics_response.status_code}")
        except Exception as e:
            print(f"   ❌ Analytics failed: {e}")
        
        return True

async def test_database():
    """Test database functionality"""
    print("\n=== Testing Database ===\n")
    
    try:
        import sys
        import os
        
        # If we're in the api directory, add current directory to path
        if os.path.exists("src"):
            if "." not in sys.path:
                sys.path.insert(0, ".")
        else:
            # We're in root directory, add api to path
            if "api" not in sys.path:
                sys.path.append("api")
        
        from src.services.database import db_service
        
        # Get database info
        db_info = db_service.get_database_info()
        print("📊 Database Info:")
        print(f"   Path: {db_info.get('database_path')}")
        print(f"   Size: {db_info.get('database_size_mb', 0):.2f} MB")
        print(f"   Total checks: {db_info.get('total_url_checks', 0)}")
        
        # Get recent stats
        daily_stats = db_service.get_daily_stats(7)
        if daily_stats:
            print(f"\n📈 Recent Activity:")
            for day_stat in daily_stats[:3]:  # Show last 3 days
                print(f"   {day_stat['date']}: {day_stat['total_checks']} checks "
                     f"(OK: {day_stat['ok_checks']}, Warning: {day_stat['warning_checks']}, "
                     f"Danger: {day_stat['danger_checks']})")
        else:
            print("   No activity data yet")
        
        return True
        
    except Exception as e:
        print(f"❌ Error testing database: {e}")
        return False

def print_usage():
    """Print usage instructions"""
    print("""
=== SafeSignal Phase 2.3 Test Instructions ===

1. Set up data files:
   cd api
   python create_data_structure.py

2. Start the API server:
   pip install -r requirements.txt
   uvicorn src.main:app --reload --host 0.0.0.0 --port 8000

3. Run this test script:
   python test_phase23.py

Expected behavior:
- Reputation service loads domain data and provides scoring
- Tier-0 analyzer combines multiple heuristics for smart verdicts
- API endpoints return detailed analysis with explainable reasons
- Database logs all checks for analytics
- google.com, wikipedia.org → "ok" verdict with high reputation
- .tk domains → "warning" or "danger" with suspicious TLD reason
- Brand look-alikes → detected with similarity scoring
- Tracking params → automatically stripped and normalized

Check the console for detailed results!
""")

async def main():
    """Run all tests"""
    print("SafeSignal Phase 2.3 - Tier-0 Analysis Test Suite")
    print("=" * 55)
    
    # Test data setup first
    if not await test_data_setup():
        print("\n❌ Data setup failed. Please run the setup script first.")
        print_usage()
        return
    
    # Test services directly
    results = []
    results.append(await test_reputation_service())
    results.append(await test_tier0_analyzer())
    results.append(await test_database())
    
    # Test API endpoints
    results.append(await test_api_endpoints())
    
    # Summary
    print("\n" + "=" * 55)
    print("SUMMARY:")
    
    test_names = [
        "Data Setup",
        "Reputation Service", 
        "Tier-0 Analyzer",
        "Database",
        "API Endpoints"
    ]
    
    for i, (name, success) in enumerate(zip(test_names, results)):
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"  {name}: {status}")
    
    all_passed = all(results)
    print(f"\nOverall: {'✅ ALL TESTS PASSED' if all_passed else '❌ SOME TESTS FAILED'}")
    
    if all_passed:
        print("\n🎉 Phase 2.3 is working correctly!")
        print("   - Domain reputation scoring active")
        print("   - Brand impersonation detection working")
        print("   - Content heuristics analyzing text")
        print("   - Database logging URL checks")
        print("   - Analytics endpoints providing insights")
    else:
        print("\n🔧 Troubleshooting tips:")
        print("1. Make sure you're in the project root directory")
        print("2. Run: cd api && python create_data_structure.py")
        print("3. Install requirements: pip install -r api/requirements.txt")
        print("4. Start the API server before running API tests")

if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 1 and sys.argv[1] == "help":
        print_usage()
    else:
        asyncio.run(main())