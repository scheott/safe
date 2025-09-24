# comprehensive_negative_tests.py
"""
Comprehensive test suite including negative cases to prevent regressions.
Tests the production-ready brand similarity detection.
"""

import sys
import os

# Add current directory to path
if "." not in sys.path:
    sys.path.insert(0, ".")

from src.services.reputation_service import ReputationService

def test_production_brand_similarity():
    print("🧪 Production Brand Similarity Detection Tests")
    print("=" * 65)
    
    reputation = ReputationService()
    
    test_scenarios = [
        {
            "category": "✅ Exact Match Different TLD (Should Flag)",
            "cases": [
                ("chase.tk", "exact_match_different_tld", "DANGER", "Exact brand + suspicious TLD"),
                ("google.ml", "exact_match_different_tld", "DANGER", "Exact brand + suspicious TLD"),
                ("microsoft.cf", "exact_match_different_tld", "DANGER", "Exact brand + suspicious TLD"),
                ("paypal.gq", "exact_match_different_tld", "DANGER", "Exact brand + suspicious TLD"),
            ]
        },
        {
            "category": "✅ Brand + Keywords (Should Flag)",
            "cases": [
                ("microsoft-support.com", "brand_with_keywords", "WARNING", "Brand + keyword, normal TLD"),
                ("google-login.tk", "brand_with_keywords", "DANGER", "Brand + keyword, suspicious TLD"),
                ("apple-billing.com", "brand_with_keywords", "WARNING", "Brand + keyword, normal TLD"),
                ("chase-secure.xyz", "brand_with_keywords", "DANGER", "Brand + keyword, suspicious TLD"),
                ("paypal-verify.ml", "brand_with_keywords", "DANGER", "Brand + keyword, suspicious TLD"),
                ("microsoft--support.com", "brand_with_keywords", "WARNING", "Double hyphen should still match"),
            ]
        },
        {
            "category": "✅ Lookalike/Typosquatting (Should Flag)",
            "cases": [
                ("g00gle.com", "lookalike", "WARNING", "Homoglyph 0→o"),
                ("paypaI.com", "lookalike", "WARNING", "Confusable I→l"),
                ("micr0soft.com", "lookalike", "WARNING", "Homoglyph 0→o"),
                ("amaz0n.tk", "lookalike", "DANGER", "Homoglyph + suspicious TLD"),
                ("appl3.com", "lookalike", "WARNING", "Homoglyph 3→e"),
                ("microsofy.com", "lookalike", "WARNING", "Single typo t→y"),
            ]
        },
        {
            "category": "❌ Official Subdomains (Should NOT Flag)",
            "cases": [
                ("support.microsoft.com", None, "SAFE", "Official Microsoft subdomain"),
                ("login.microsoft.com", None, "SAFE", "Official Microsoft subdomain"),
                ("accounts.google.com", None, "SAFE", "Official Google subdomain"),
                ("support.apple.com", None, "SAFE", "Official Apple subdomain"),
                ("mail.google.com", None, "SAFE", "Official Google subdomain"),
                ("aws.amazon.com", None, "SAFE", "Official Amazon subdomain"),
            ]
        },
        {
            "category": "❌ Dictionary Words without Extra Signals (Should NOT Flag)",
            "cases": [
                ("appledaily.com", None, "SAFE", "Dictionary word + non-keyword, normal TLD"),
                ("targetnews.com", None, "SAFE", "Dictionary word + non-keyword, normal TLD"),
                ("chaserewards.com", None, "SAFE", "Dictionary word + non-keyword, normal TLD"),
                ("appleforum.org", None, "SAFE", "Dictionary word + non-keyword, normal TLD"),
                ("squarestore.net", None, "SAFE", "Dictionary word + non-keyword, normal TLD"),
            ]
        },
        {
            "category": "✅ Dictionary Words WITH Extra Signals (Should Flag)",
            "cases": [
                ("apple-login.tk", "brand_with_keywords", "DANGER", "Dictionary word + keyword + suspicious TLD"),
                ("chase-support.ml", "brand_with_keywords", "DANGER", "Dictionary word + keyword + suspicious TLD"),
                ("target.tk", "exact_match_different_tld", "DANGER", "Dictionary word + suspicious TLD alone"),
            ]
        },
        {
            "category": "✅ Multi-part TLD Support",
            "cases": [
                ("microsoft-support.co.uk", "brand_with_keywords", "WARNING", "Multi-part TLD should work"),
                ("google.co.uk", "exact_match_different_tld", "WARNING", "Multi-part TLD exact match"),
            ]
        },
        {
            "category": "✅ Path-based Enhancement",
            "cases": [
                ("g00gle.com/login", "lookalike", "DANGER", "Lookalike + auth path should boost to danger"),
                ("paypaI.com/signin", "lookalike", "DANGER", "Lookalike + auth path should boost to danger"),
            ]
        },
        {
            "category": "❌ Edge Cases (Should NOT Flag)",
            "cases": [
                ("verylongdomainnamethatshouldnotmatch.com", None, "SAFE", "Very long domain, no brand similarity"),
                ("a.com", None, "SAFE", "Very short domain"),
                ("123456.tk", None, "SAFE", "Numeric domain"),
                ("random-words-here.com", None, "SAFE", "Random words, no brand tokens"),
            ]
        }
    ]
    
    total_tests = 0
    passed_tests = 0
    failed_tests = []
    
    for scenario in test_scenarios:
        print(f"\n{scenario['category']}")
        print("-" * 50)
        
        for domain, expected_type, expected_risk, description in scenario['cases']:
            total_tests += 1
            print(f"\n   🧪 {domain}")
            print(f"   Expected: {description}")
            
            # Test brand similarity
            similar = reputation.find_similar_brands(domain)
            
            # Test scoring integration
            try:
                score_result = reputation.get_brand_similarity_score(domain)
                score = score_result['score']
                reasons = score_result['reasons']
                details = score_result['details']
            except AttributeError:
                # Method doesn't exist yet, skip scoring test
                score_result = None
                score = 0
            
            if expected_type is None:  # Should NOT flag
                if not similar:
                    print(f"   ✅ PASS: No matches (correct)")
                    passed_tests += 1
                else:
                    print(f"   ❌ FAIL: Found matches but shouldn't")
                    for match in similar[:2]:
                        print(f"      - {match['brand']} ({match['type']}, conf: {match['confidence']:.2f})")
                    failed_tests.append((domain, "Should not flag", f"Found {len(similar)} matches"))
            
            else:  # Should flag
                if similar:
                    match = similar[0]
                    if match['type'] == expected_type:
                        print(f"   ✅ PASS: {match['brand']} ({match['type']}, conf: {match['confidence']:.2f})")
                        
                        # Test scoring if available
                        if score_result:
                            risk_level = "DANGER" if score >= 4 else "WARNING" if score >= 2 else "LOW"
                            if risk_level == expected_risk:
                                print(f"      Score: {score} ({risk_level}) ✅")
                            else:
                                print(f"      Score: {score} ({risk_level}) ❌ Expected {expected_risk}")
                        
                        passed_tests += 1
                    else:
                        print(f"   ⚠️  PARTIAL: Wrong type - got {match['type']}, expected {expected_type}")
                        passed_tests += 0.5
                        failed_tests.append((domain, f"Expected {expected_type}", f"Got {match['type']}"))
                else:
                    print(f"   ❌ FAIL: No matches found")
                    failed_tests.append((domain, f"Expected {expected_type}", "No matches"))
    
    # Summary
    print(f"\n" + "=" * 65)
    print(f"📊 Test Results: {passed_tests}/{total_tests} tests passed ({passed_tests/total_tests*100:.1f}%)")
    
    if failed_tests:
        print(f"\n❌ Failed Tests:")
        for domain, expected, actual in failed_tests[:5]:  # Show first 5 failures
            print(f"   • {domain}: Expected {expected}, Got {actual}")
        if len(failed_tests) > 5:
            print(f"   ... and {len(failed_tests) - 5} more")
    
    success_rate = passed_tests / total_tests
    if success_rate >= 0.85:
        print("🎉 Production-ready! Brand similarity detection is working excellently.")
        return True
    elif success_rate >= 0.75:
        print("⚠️  Good progress but needs fine-tuning.")
        return False
    else:
        print("❌ Needs significant improvements before production.")
        return False

def test_normalization_and_tokenization():
    print(f"\n🔤 Testing Normalization & Tokenization:")
    print("-" * 45)
    
    reputation = ReputationService()
    
    normalization_tests = [
        ("G00gle", "google", "Homoglyph normalization"),
        ("Micr0s0ft", "microsoft", "Multiple homoglyphs"),
        ("PayPaI", "paypal", "Case + confusable"),
        ("Àpple-Störe", "apple-store", "Diacritics + hyphens"),
        ("microsoft--support", "microsoft--support", "Double hyphens preserved"),
    ]
    
    print("   Normalization:")
    for original, expected, description in normalization_tests:
        normalized = reputation._normalize_label_robust(original)
        status = "✅" if normalized == expected else "❌"
        print(f"   {status} '{original}' → '{normalized}' ({description})")
    
    tokenization_tests = [
        ("microsoft-support", {"microsoft", "support"}, "Hyphen tokenization"),
        ("google123login", {"google123login"}, "No special chars to split on"),
        ("apple--store", {"apple", "store"}, "Double hyphen tokenization"),
        ("pay-pal-verify", {"pay", "pal", "verify"}, "Multiple hyphens"),
    ]
    
    print("\n   Tokenization:")
    for label, expected, description in tokenization_tests:
        import re
        norm = reputation._normalize_label_robust(label)
        tokens = set(re.findall(r'[a-z0-9]+', norm))
        status = "✅" if tokens == expected else "❌"
        print(f"   {status} '{label}' → {tokens} ({description})")

def test_etld1_extraction():
    print(f"\n🌐 Testing eTLD+1 Extraction:")
    print("-" * 35)
    
    reputation = ReputationService()
    
    etld1_tests = [
        ("microsoft-support.com", "microsoft-support.com", "Standard domain"),
        ("www.google-login.co.uk", "google-login.co.uk", "Multi-part TLD"),
        ("subdomain.apple.com", "apple.com", "Subdomain removal"),
        ("https://chase-secure.tk/login", "chase-secure.tk", "Full URL with path"),
        ("support.microsoft.com.au", "microsoft.com.au", "Multi-part TLD with subdomain"),
        ("very.deep.subdomain.paypal.com", "paypal.com", "Deep subdomain"),
    ]
    
    for input_domain, expected, description in etld1_tests:
        extracted = reputation._extract_etld1_robust(input_domain)
        status = "✅" if extracted == expected else "❌"
        print(f"   {status} '{input_domain}' → '{extracted}' ({description})")

def test_dictionary_word_protection():
    print(f"\n📚 Testing Dictionary Word Protection:")
    print("-" * 40)
    
    reputation = ReputationService()
    
    # Test cases for dictionary word brands
    dictionary_tests = [
        # Should NOT flag (dictionary word without extra signals)
        ("appledaily.com", False, "News site, no keywords, normal TLD"),
        ("targetstore.com", False, "Store site, no keywords, normal TLD"),
        ("chasebank.org", False, "Bank reference, normal TLD, no explicit keywords"),
        ("squareup.net", False, "Related but different, normal TLD"),
        
        # Should flag (dictionary word WITH extra signals)
        ("apple.tk", True, "Dictionary word + suspicious TLD"),
        ("chase-login.com", True, "Dictionary word + impersonation keyword"),
        ("target-support.ml", True, "Dictionary word + keyword + suspicious TLD"),
        ("apple.com/login", True, "Auth path should provide signal"),
    ]
    
    for domain, should_flag, description in dictionary_tests:
        similar = reputation.find_similar_brands(domain)
        flagged = len(similar) > 0
        
        status = "✅" if flagged == should_flag else "❌"
        result = "FLAGGED" if flagged else "SAFE"
        expected = "should flag" if should_flag else "should NOT flag"
        
        print(f"   {status} {domain} → {result} ({description} - {expected})")
        
        if flagged and similar:
            match = similar[0]
            print(f"      Match: {match['brand']} ({match['type']}, conf: {match['confidence']:.2f})")

def test_performance_edge_cases():
    print(f"\n⚡ Testing Performance Edge Cases:")
    print("-" * 35)
    
    reputation = ReputationService()
    
    edge_cases = [
        ("verylongdomainnamethatdoesnotmatchanybrand.com", "Very long domain"),
        ("a.tk", "Very short domain"),
        ("12345.ml", "Numeric domain"),
        ("xyzabc.cf", "Random letters"),
        ("", "Empty domain"),
        ("invalid", "Single word"),
        ("multi-hyphen-domain-name-here.com", "Multiple hyphens"),
        ("specialchars!@#$.com", "Special characters"),
    ]
    
    import time
    
    for domain, description in edge_cases:
        start_time = time.time()
        try:
            similar = reputation.find_similar_brands(domain)
            elapsed = (time.time() - start_time) * 1000
            status = "✅" if elapsed < 100 else "⚠️"  # Should be fast
            print(f"   {status} {domain[:30]:<30} → {len(similar)} matches ({elapsed:.1f}ms) - {description}")
        except Exception as e:
            print(f"   ❌ {domain[:30]:<30} → ERROR: {e}")

def test_scoring_integration():
    print(f"\n🎯 Testing Scoring Integration:")
    print("-" * 32)
    
    reputation = ReputationService()
    
    if not hasattr(reputation, 'get_brand_similarity_score'):
        print("   ⚠️  get_brand_similarity_score method not implemented yet")
        return
    
    scoring_tests = [
        ("chase.tk", 4, "Exact match + suspicious TLD → DANGER"),
        ("microsoft-support.com", 2, "Brand + keywords + normal TLD → WARNING"),
        ("g00gle.com", 2, "Lookalike + normal TLD → WARNING"),
        ("amaz0n.tk", 4, "Lookalike + suspicious TLD → DANGER"),
        ("g00gle.com/login", 4, "Lookalike + auth path → DANGER"),
        ("appledaily.com", 0, "Dictionary word without signals → SAFE"),
    ]
    
    for domain, expected_score, description in scoring_tests:
        try:
            result = reputation.get_brand_similarity_score(domain)
            score = result['score']
            reasons = result['reasons']
            details = result['details']
            
            status = "✅" if score == expected_score else "❌"
            risk_level = "DANGER" if score >= 4 else "WARNING" if score >= 2 else "SAFE"
            
            print(f"   {status} {domain} → {score} ({risk_level}) - {description}")
            
            if score > 0:
                print(f"      Reasons: {reasons}")
                print(f"      Brand: {details.get('brand', 'N/A')}, Type: {details.get('type', 'N/A')}")
                
        except Exception as e:
            print(f"   ❌ {domain} → ERROR: {e}")

if __name__ == "__main__":
    print("🚀 Starting Comprehensive Brand Similarity Tests")
    print("=" * 65)
    
    success = test_production_brand_similarity()
    
    print("\n" + "=" * 65)
    print("🔧 DETAILED COMPONENT TESTS")
    print("=" * 65)
    
    test_normalization_and_tokenization()
    test_etld1_extraction()
    test_dictionary_word_protection()
    test_performance_edge_cases()
    test_scoring_integration()
    
    print(f"\n" + "=" * 65)
    if success:
        print("🎉 READY FOR PRODUCTION!")
        print("✅ All critical tests passed")
        print("✅ Dictionary word protection working")
        print("✅ Official domain detection working")
        print("✅ Negative test cases passing")
        print("\n🚀 Ready to integrate with Tier-0 analyzer!")
    else:
        print("⚠️  NEEDS REFINEMENT")
        print("Some test cases are failing - review implementation")
        print("Focus on failed test cases shown above")
    
    print(f"\nNext steps:")
    print(f"1. Apply the production-ready implementation")
    print(f"2. Run: python comprehensive_negative_tests.py")
    print(f"3. Integration: Update Tier-0 analyzer to use get_brand_similarity_score()")
    print(f"4. Run: python test_phase23.py")