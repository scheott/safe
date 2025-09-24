# api/verify_and_fix_data.py
"""
Verify and fix data files to ensure all test brands are present
Run this before running comprehensive_negative_tests.py
"""

import json
from pathlib import Path
import sys

def find_data_directory():
    """Find the correct data directory"""
    possible_dirs = [Path("data"), Path("api/data")]
    for data_dir in possible_dirs:
        if data_dir.exists():
            return data_dir
    
    # Create data directory if it doesn't exist
    if Path("src").exists():
        data_dir = Path("data")
    else:
        data_dir = Path("api/data")
    
    data_dir.mkdir(exist_ok=True)
    return data_dir

def ensure_test_brands_exist():
    """Ensure all test brands are in brand_domains.json"""
    data_dir = find_data_directory()
    brand_file = data_dir / "brand_domains.json"
    
    # Essential brands needed for tests
    essential_test_brands = {
        "tech_giants": [
            "google.com", "microsoft.com", "apple.com", "amazon.com", 
            "facebook.com", "netflix.com", "adobe.com"
        ],
        "banks": [
            "chase.com", "bankofamerica.com", "wellsfargo.com", "citibank.com",
            "usbank.com", "capitalone.com", "pnc.com"
        ],
        "credit_cards": [
            "discover.com", "americanexpress.com", "visa.com", "mastercard.com"
        ],
        "payment_services": [
            "paypal.com", "venmo.com", "zelle.com", "cashapp.com"
        ],
        "shipping": [
            "ups.com", "fedex.com", "usps.com", "dhl.com"
        ],
        "retail": [
            "target.com", "walmart.com", "amazon.com", "ebay.com"
        ]
    }
    
    if brand_file.exists():
        with open(brand_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
    else:
        data = {
            "version": "1.0",
            "updated": "2024-12-19",
            "categories": {}
        }
    
    # Ensure categories exist and merge with essential brands
    categories = data.get('categories', {})
    
    for category, brands in essential_test_brands.items():
        if category not in categories:
            categories[category] = []
        
        # Add missing brands
        existing_brands = set(categories[category])
        for brand in brands:
            if brand not in existing_brands:
                categories[category].append(brand)
                print(f"   Added {brand} to {category}")
    
    data['categories'] = categories
    
    # Save updated file
    with open(brand_file, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    
    total_brands = sum(len(brands) for brands in categories.values())
    print(f"✅ Verified brand_domains.json with {total_brands} brands across {len(categories)} categories")
    
    return True

def create_minimal_suspicious_indicators():
    """Create minimal suspicious indicators file"""
    data_dir = find_data_directory()
    file_path = data_dir / "suspicious_indicators.json"
    
    if not file_path.exists():
        data = {
            "suspicious_tlds": {
                "high_risk": [
                    "tk", "ml", "ga", "cf", "gq", "top", "click", "download", 
                    "stream", "xyz", "info", "bid", "country", "kim", "party", 
                    "review", "trade", "webcam", "win", "loan", "racing", 
                    "science", "work", "date"
                ],
                "medium_risk": [
                    "biz", "mobi", "name", "pro", "aero", "asia", "cat", 
                    "coop", "jobs", "museum", "tel", "travel"
                ]
            },
            "keywords": {
                "phishing": [
                    "verify account", "suspended", "urgent action", "click here",
                    "confirm identity", "update payment", "security alert"
                ],
                "scam": [
                    "act now", "limited time", "free money", "guaranteed",
                    "no risk", "exclusive deal", "winner", "congratulations"
                ]
            }
        }
        
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        
        print(f"✅ Created {file_path}")
    
    return True

def create_minimal_heuristic_weights():
    """Create minimal heuristic weights file"""
    data_dir = find_data_directory()
    file_path = data_dir / "heuristic_weights.json"
    
    if not file_path.exists():
        data = {
            "weights": {
                "domain_reputation": 2,
                "brand_similarity": 2, 
                "suspicious_keywords": 1,
                "technical_indicators": 1
            },
            "thresholds": {
                "danger": 4,
                "warning": 2,
                "ok": 1
            }
        }
        
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        
        print(f"✅ Created {file_path}")
    
    return True

def create_minimal_reputable_domains():
    """Create minimal reputable domains file"""
    data_dir = find_data_directory()
    file_path = data_dir / "reputable_domains.json"
    
    if not file_path.exists():
        data = {
            "version": "1.0",
            "updated": "2024-12-19",
            "domains": {
                # Essential reputable domains
                "google.com": {"score": -2, "category": "search"},
                "microsoft.com": {"score": -2, "category": "technology"},
                "apple.com": {"score": -2, "category": "technology"},
                "amazon.com": {"score": -2, "category": "commerce"},
                "wikipedia.org": {"score": -2, "category": "education"},
                "github.com": {"score": -2, "category": "technology"},
                
                # Government
                "irs.gov": {"score": -2, "category": "government"},
                "ssa.gov": {"score": -2, "category": "government"},
                "cdc.gov": {"score": -2, "category": "government"},
                
                # Banks
                "chase.com": {"score": -2, "category": "banking"},
                "bankofamerica.com": {"score": -2, "category": "banking"},
                "wellsfargo.com": {"score": -2, "category": "banking"},
                
                # Payment
                "paypal.com": {"score": -2, "category": "financial"},
                "visa.com": {"score": -2, "category": "financial"},
                "mastercard.com": {"score": -2, "category": "financial"}
            }
        }
        
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        
        print(f"✅ Created {file_path}")
    
    return True

def verify_data_setup():
    """Verify all data files are properly set up"""
    print("🔧 Verifying and fixing data setup...")
    print("=" * 50)
    
    data_dir = find_data_directory()
    print(f"📂 Using data directory: {data_dir}")
    
    # Create/verify all required files
    ensure_test_brands_exist()
    create_minimal_suspicious_indicators()
    create_minimal_heuristic_weights()
    create_minimal_reputable_domains()
    
    # Verify files exist
    required_files = [
        "reputable_domains.json",
        "brand_domains.json",
        "suspicious_indicators.json", 
        "heuristic_weights.json"
    ]
    
    print(f"\n📋 File verification:")
    all_good = True
    for filename in required_files:
        file_path = data_dir / filename
        if file_path.exists():
            print(f"   ✅ {filename}")
            
            # Quick validation
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    
                if filename == "brand_domains.json":
                    categories = data.get('categories', {})
                    total_brands = sum(len(brands) for brands in categories.values())
                    print(f"      → {total_brands} brands in {len(categories)} categories")
                    
                elif filename == "reputable_domains.json":
                    domains = data.get('domains', {})
                    print(f"      → {len(domains)} reputable domains")
                    
            except Exception as e:
                print(f"   ⚠️  {filename} - Error reading: {e}")
                all_good = False
        else:
            print(f"   ❌ {filename} - Missing!")
            all_good = False
    
    if all_good:
        print(f"\n🎉 Data setup complete! Ready to run tests:")
        print(f"   python comprehensive_negative_tests.py")
    else:
        print(f"\n⚠️  Some issues found. Please review and fix.")
    
    return all_good

if __name__ == "__main__":
    verify_data_setup()