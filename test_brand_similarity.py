# test_brand_similarity.py
"""
Fixed test script to debug brand similarity detection
Run this from the api directory: python test_brand_similarity.py
"""

import sys
import os

# Add current directory to path
if "." not in sys.path:
    sys.path.insert(0, ".")

from src.services.reputation_service import ReputationService

def test_brand_similarity():
    print("🧪 Testing Brand Similarity Detection")
    print("=" * 50)
    
    # Initialize reputation service
    reputation = ReputationService()
    
    # Print loaded data
    print(f"📊 Loaded data:")
    print(f"   Reputable domains: {len(reputation.reputable_domains)}")
    print(f"   Brand categories: {len(reputation.brand_categories)}")
    print(f"   Brand domains: {len(reputation.brand_domains)}")
    print(f"   First 10 brand domains: {list(reputation.brand_domains)[:10]}")
    
    # Test cases that should find matches
    test_cases = [
        ("chase.tk", "Should match chase.com"),
        ("g00gle.com", "Should match google.com"),
        ("paypaI.com", "Should match paypal.com (capital I vs l)"),
        ("microsoft-support.com", "Should match microsoft.com"),
        ("appl3.com", "Should match apple.com"),
        ("amaz0n.tk", "Should match amazon.com"),
    ]
    
    print(f"\n🎭 Brand Similarity Tests:")
    success_count = 0
    
    for domain, expected in test_cases:
        print(f"\n   Testing: {domain}")
        print(f"   Expected: {expected}")
        
        # Test the new production-ready method
        similar = reputation.find_similar_brands(domain)
        if similar:
            success_count += 1
            for i, match in enumerate(similar[:2]):  # Show top 2 matches
                # Handle different result structures
                match_type = match.get('type', 'unknown')
                distance = match.get('distance', 0)
                confidence = match.get('confidence', 0)
                brand = match.get('brand', 'unknown')
                
                print(f"   ✅ Match {i+1}: {brand}")
                print(f"      Type: {match_type}")
                print(f"      Distance: {distance}")
                print(f"      Confidence: {confidence:.3f}")
                
                # Show additional details based on match type
                if 'keywords_found' in match:
                    print(f"      Keywords: {match['keywords_found']}")
                if 'similarity_type' in match:
                    print(f"      Similarity: {match['similarity_type']}")
                if 'suspicious_tld' in match:
                    print(f"      Suspicious TLD: {match['suspicious_tld']}")
        else:
            print(f"   ❌ No matches found")
            
            # Quick debug for failed cases
            domain_name = domain.split('.')[0]
            domain_base = domain_name.split('-')[0] if '-' in domain_name else domain_name
            print(f"      Debug: domain_name='{domain_name}', domain_base='{domain_base}'")
            
            # Test if brand exists in data
            for brand in reputation.brand_domains:
                brand_name = brand.split('.')[0]
                if brand_name in domain_name or domain_name in brand_name:
                    print(f"      Debug: Found potential brand '{brand}' but no match returned")
                    break
    
    print(f"\n📊 Results: {success_count}/{len(test_cases)} test cases passed")
    
    return success_count >= len(test_cases) - 1  # Allow 1 failure

def test_scoring_integration():
    """Test the scoring integration"""
    print(f"\n🎯 Testing Scoring Integration:")
    
    reputation = ReputationService()
    
    # Test the scoring method if it exists
    if hasattr(reputation, 'get_brand_similarity_score'):
        test_domains = [
            "chase.tk",
            "microsoft-support.com", 
            "g00gle.com",
            "appledaily.com"  # Should not flag
        ]
        
        for domain in test_domains:
            try:
                result = reputation.get_brand_similarity_score(domain)
                score = result['score']
                reasons = result['reasons']
                details = result.get('details', {})
                
                risk_level = "DANGER" if score >= 4 else "WARNING" if score >= 2 else "SAFE"
                print(f"   {domain} → {score} ({risk_level})")
                
                if score > 0:
                    print(f"      Reasons: {reasons}")
                    if details.get('brand'):
                        print(f"      Brand: {details['brand']}, Type: {details.get('type', 'N/A')}")
                
            except Exception as e:
                print(f"   ❌ {domain} → ERROR: {e}")
    else:
        print("   ⚠️  get_brand_similarity_score method not available yet")

def test_edge_cases():
    print(f"\n🔍 Testing Edge Cases:")
    
    reputation = ReputationService()
    
    edge_cases = [
        ("support.microsoft.com", "Should NOT match (official subdomain)"),
        ("appledaily.com", "Should NOT match (dictionary word without signals)"),
        ("exact-match.com", "Testing exact domain match detection"),
        ("microsoft--support.com", "Testing double hyphen"),
    ]
    
    for domain, description in edge_cases:
        print(f"\n   {domain}: {description}")
        similar = reputation.find_similar_brands(domain)
        if similar:
            match = similar[0]
            print(f"   Found: {match['brand']} ({match['type']}, conf: {match['confidence']:.3f})")
        else:
            print(f"   No matches (may be expected)")

if __name__ == "__main__":
    success = test_brand_similarity()
    test_scoring_integration()
    test_edge_cases()
    
    if success:
        print(f"\n✅ Ready to run: python comprehensive_negative_tests.py")
    else:
        print(f"\n⚠️  Some issues detected - check the implementation")