#!/usr/bin/env python3
"""
SafeSignal Step 1 Verification Script

This script verifies that Step 1 of the backfill pack is complete:
1. Wire persistent logging + analytics stub
2. Log every /check to SQLite (verdict, score, reasons, mode, elapsed_ms)
3. Add GET /analytics/daily returning a 200 with empty arrays if no data
4. Acceptance: running test suite shows Total checks > 0 and analytics no longer 404s

Usage:
    python verify_step1.py
"""

import asyncio
import httpx
import time
import sys

API_BASE_URL = "http://localhost:8000"

class Colors:
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    BOLD = '\033[1m'
    END = '\033[0m'

def print_success(message):
    print(f"{Colors.GREEN}✅ {message}{Colors.END}")

def print_error(message):
    print(f"{Colors.RED}❌ {message}{Colors.END}")

def print_warning(message):
    print(f"{Colors.YELLOW}⚠️ {message}{Colors.END}")

def print_info(message):
    print(f"{Colors.BLUE}ℹ️ {message}{Colors.END}")

def print_header(message):
    print(f"\n{Colors.BOLD}{Colors.BLUE}{message}{Colors.END}")

async def verify_step1():
    """Verify Step 1 implementation"""
    
    print(f"{Colors.BOLD}🧪 SafeSignal Step 1 Verification{Colors.END}")
    print("=" * 50)
    
    # Test connectivity
    print_header("1. Testing API Connectivity")
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{API_BASE_URL}/health", timeout=5.0)
            if response.status_code == 200:
                data = response.json()
                print_success(f"API is healthy (version: {data.get('version', 'unknown')})")
                
                # Check if database is connected
                db_info = data.get('database', {})
                if db_info.get('connected'):
                    print_success(f"Database connected (total checks: {db_info.get('total_checks', 0)})")
                else:
                    print_error("Database not connected")
                    return False
            else:
                print_error(f"Health check failed: {response.status_code}")
                return False
    except Exception as e:
        print_error(f"Cannot connect to API: {e}")
        print_info("Make sure your API server is running on http://localhost:8000")
        return False
    
    # Test analytics endpoint returns 200
    print_header("2. Testing Analytics Endpoint")
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{API_BASE_URL}/api/analytics/daily")
            
            if response.status_code == 200:
                print_success("Analytics endpoint returns 200 OK")
                data = response.json()
                print_info(f"Status: {data.get('status', 'unknown')}")
                print_info(f"Days requested: {data.get('days_requested', 'N/A')}")
                print_info(f"Stats returned: {len(data.get('stats', []))} days")
            else:
                print_error(f"Analytics endpoint failed: {response.status_code}")
                return False
                
    except Exception as e:
        print_error(f"Analytics test failed: {e}")
        return False
    
    # Get initial state
    print_header("3. Getting Initial State")
    initial_total = 0
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{API_BASE_URL}/api/analytics/summary")
            if response.status_code == 200:
                data = response.json()
                initial_total = data.get('total_checks', 0)
                print_info(f"Initial total checks: {initial_total}")
            else:
                print_warning(f"Could not get initial state: {response.status_code}")
    except Exception as e:
        print_warning(f"Initial state check failed: {e}")
    
    # Test URL checking with logging
    print_header("4. Testing URL Checking with Logging")
    test_urls = [
        "https://www.google.com",
        "https://www.github.com", 
        "https://example.com"
    ]
    
    successful_checks = 0
    
    try:
        async with httpx.AsyncClient() as client:
            for i, url in enumerate(test_urls, 1):
                print_info(f"Testing {i}/{len(test_urls)}: {url}")
                
                start_time = time.time()
                response = await client.post(
                    f"{API_BASE_URL}/api/check",
                    json={"url": url},
                    headers={"Content-Type": "application/json"},
                    timeout=15.0
                )
                elapsed_ms = (time.time() - start_time) * 1000
                
                if response.status_code == 200:
                    result = response.json()
                    verdict = result.get('verdict', 'unknown')
                    api_time = result.get('processing_time_ms', 0)
                    print_success(f"  {verdict} in {api_time}ms (total: {elapsed_ms:.0f}ms)")
                    successful_checks += 1
                    
                    # Verify response structure
                    required_fields = ['verdict', 'reasons', 'meta', 'processing_time_ms']
                    missing_fields = [f for f in required_fields if f not in result]
                    if missing_fields:
                        print_warning(f"  Missing response fields: {missing_fields}")
                else:
                    print_error(f"  Failed: {response.status_code} - {response.text}")
                    
                # Small delay between requests
                await asyncio.sleep(0.5)
                
    except Exception as e:
        print_error(f"URL checking failed: {e}")
        return False
    
    print_info(f"Successful checks: {successful_checks}/{len(test_urls)}")
    
    # Verify logging worked
    print_header("5. Verifying Logging Worked")
    await asyncio.sleep(1)  # Give database time to process
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{API_BASE_URL}/api/analytics/summary")
            if response.status_code == 200:
                data = response.json()
                final_total = data.get('total_checks', 0)
                increase = final_total - initial_total
                
                print_info(f"Final total checks: {final_total}")
                print_info(f"Increase: +{increase}")
                
                if increase >= successful_checks:
                    print_success("Logging is working correctly!")
                    
                    # Show verdict distribution
                    dist = data.get('verdict_distribution', {})
                    print_info(f"Recent verdicts - OK: {dist.get('ok', 0)}, Warning: {dist.get('warning', 0)}, Danger: {dist.get('danger', 0)}")
                    
                    return True
                else:
                    print_error(f"Expected at least +{successful_checks} new checks, got +{increase}")
                    return False
            else:
                print_error(f"Could not verify logging: {response.status_code}")
                return False
                
    except Exception as e:
        print_error(f"Logging verification failed: {e}")
        return False

async def main():
    """Main verification function"""
    success = await verify_step1()
    
    print("\n" + "=" * 50)
    if success:
        print_success("🎉 Step 1 verification PASSED!")
        print_info("✅ Wire persistent logging + analytics stub")
        print_info("✅ Log every /check to SQLite")
        print_info("✅ Add GET /analytics/daily returning 200")
        print_info("✅ Total checks > 0 and analytics no longer 404s")
        print_info("\n🚀 Ready for Step 2: Lock in danger rule validation")
        sys.exit(0)
    else:
        print_error("❌ Step 1 verification FAILED!")
        print_info("Please check the issues above and fix them before proceeding.")
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main())