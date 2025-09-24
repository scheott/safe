# api/create_data_structure.py
"""
Phase 2.3: Create the data file structure for Tier-0 scoring.
Run this script to bootstrap SafeSignal's reputation data.
"""

import json
import os
from pathlib import Path
from typing import Dict, List, Any

def create_data_directory():
    """Create the data directory structure"""
    # Check if we're in the api directory or the root directory
    if Path("src").exists():
        # We're in the api directory
        data_dir = Path("data")
    else:
        # We're in the root directory
        data_dir = Path("api/data")
    
    data_dir.mkdir(exist_ok=True)
    return data_dir

def create_reputable_domains() -> Dict[str, Any]:
    """Create initial list of reputable domains with scores and categories"""
    return {
        "version": "1.0",
        "updated": "2024-12-19",
        "domains": {
            # Search & Reference
            "google.com": {"score": -2, "category": "search", "confidence": "high"},
            "bing.com": {"score": -2, "category": "search", "confidence": "high"},
            "duckduckgo.com": {"score": -2, "category": "search", "confidence": "high"},
            "wikipedia.org": {"score": -2, "category": "education", "confidence": "high"},
            
            # Government (.gov domains)
            "irs.gov": {"score": -2, "category": "government", "confidence": "high"},
            "ssa.gov": {"score": -2, "category": "government", "confidence": "high"},
            "medicare.gov": {"score": -2, "category": "government", "confidence": "high"},
            "cdc.gov": {"score": -2, "category": "government", "confidence": "high"},
            "fda.gov": {"score": -2, "category": "government", "confidence": "high"},
            "usa.gov": {"score": -2, "category": "government", "confidence": "high"},
            
            # Major Banks
            "chase.com": {"score": -2, "category": "banking", "confidence": "high"},
            "bankofamerica.com": {"score": -2, "category": "banking", "confidence": "high"},
            "wellsfargo.com": {"score": -2, "category": "banking", "confidence": "high"},
            "citibank.com": {"score": -2, "category": "banking", "confidence": "high"},
            "usbank.com": {"score": -2, "category": "banking", "confidence": "high"},
            
            # Major Credit Cards
            "discover.com": {"score": -2, "category": "financial", "confidence": "high"},
            "americanexpress.com": {"score": -2, "category": "financial", "confidence": "high"},
            "visa.com": {"score": -2, "category": "financial", "confidence": "high"},
            "mastercard.com": {"score": -2, "category": "financial", "confidence": "high"},
            
            # Tech Companies
            "microsoft.com": {"score": -2, "category": "technology", "confidence": "high"},
            "apple.com": {"score": -2, "category": "technology", "confidence": "high"},
            "amazon.com": {"score": -2, "category": "technology", "confidence": "high"},
            "github.com": {"score": -2, "category": "technology", "confidence": "high"},
            "stackoverflow.com": {"score": -2, "category": "technology", "confidence": "high"},
            
            # Health Organizations
            "mayoclinic.org": {"score": -2, "category": "health", "confidence": "high"},
            "webmd.com": {"score": -1, "category": "health", "confidence": "medium"},
            "healthline.com": {"score": -1, "category": "health", "confidence": "medium"},
            "medlineplus.gov": {"score": -2, "category": "health", "confidence": "high"},
            
            # News & Media (reputable)
            "reuters.com": {"score": -2, "category": "news", "confidence": "high"},
            "ap.org": {"score": -2, "category": "news", "confidence": "high"},
            "npr.org": {"score": -2, "category": "news", "confidence": "high"},
            "pbs.org": {"score": -2, "category": "news", "confidence": "high"},
            "bbc.com": {"score": -2, "category": "news", "confidence": "high"},
            
            # E-commerce (major)
            "ebay.com": {"score": -1, "category": "commerce", "confidence": "medium"},
            "walmart.com": {"score": -1, "category": "commerce", "confidence": "medium"},
            "target.com": {"score": -1, "category": "commerce", "confidence": "medium"},
            
            # Social Media (major platforms)
            "facebook.com": {"score": -1, "category": "social", "confidence": "medium"},
            "twitter.com": {"score": -1, "category": "social", "confidence": "medium"},
            "linkedin.com": {"score": -1, "category": "social", "confidence": "medium"},
            "instagram.com": {"score": -1, "category": "social", "confidence": "medium"},
            
            # Shipping & Logistics
            "ups.com": {"score": -2, "category": "logistics", "confidence": "high"},
            "fedex.com": {"score": -2, "category": "logistics", "confidence": "high"},
            "usps.com": {"score": -2, "category": "logistics", "confidence": "high"},
            
            # Educational Institutions (examples)
            "harvard.edu": {"score": -2, "category": "education", "confidence": "high"},
            "mit.edu": {"score": -2, "category": "education", "confidence": "high"},
            "stanford.edu": {"score": -2, "category": "education", "confidence": "high"},
        }
    }

def create_brand_domains() -> Dict[str, Any]:
    """Create list of major brands for look-alike detection"""
    return {
        "version": "1.0",
        "updated": "2024-12-19",
        "categories": {
            "banks": [
                "chase.com", "bankofamerica.com", "wellsfargo.com", "citibank.com",
                "usbank.com", "capitalone.com", "pnc.com", "truist.com"
            ],
            "credit_cards": [
                "discover.com", "americanexpress.com", "visa.com", "mastercard.com"
            ],
            "tech_giants": [
                "google.com", "microsoft.com", "apple.com", "amazon.com",
                "facebook.com", "netflix.com", "adobe.com"
            ],
            "government": [
                "irs.gov", "ssa.gov", "medicare.gov", "usps.com",
                "dmv.org", "treasury.gov"
            ],
            "shipping": [
                "ups.com", "fedex.com", "usps.com", "dhl.com"
            ],
            "payment_processors": [
                "paypal.com", "venmo.com", "cashapp.com", "zelle.com",
                "westernunion.com", "moneygram.com"
            ]
        }
    }

def create_suspicious_indicators() -> Dict[str, Any]:
    """Create patterns and keywords for suspicious content detection"""
    return {
        "version": "1.0",
        "updated": "2024-12-19",
        "suspicious_tlds": {
            "high_risk": [".tk", ".ml", ".ga", ".cf"],
            "medium_risk": [".top", ".click", ".download", ".stream"]
        },
        "hype_keywords": [
            "urgent", "limited time", "act now", "expires soon",
            "once in a lifetime", "limited offer", "exclusive deal",
            "don't miss out", "hurry", "immediate action required"
        ],
        "financial_danger_keywords": [
            "verify account", "account suspended", "confirm identity",
            "update payment", "billing issue", "security alert",
            "unauthorized access", "verify card", "confirm payment method"
        ],
        "health_scam_keywords": [
            "miracle cure", "doctors hate", "lose weight fast",
            "secret formula", "breakthrough discovery", "natural remedy",
            "FDA approved" # when used falsely
        ],
        "urgency_patterns": [
            "expires in", "only \\d+ left", "\\d+ people viewing",
            "limited quantity", "flash sale", "ends today"
        ]
    }

def create_heuristic_weights() -> Dict[str, Any]:
    """Create scoring weights for different heuristics"""
    return {
        "version": "1.0",
        "updated": "2024-12-19",
        "weights": {
            # Domain-based scoring
            "domain_reputation": {
                "reputable_domain": -2,
                "unknown_domain": 0,
                "suspicious_tld": 2,
                "very_suspicious_tld": 3
            },
            
            # URL structure
            "url_structure": {
                "excessive_subdomains": 1,  # >3 subdomains
                "suspicious_path": 1,       # /verify, /confirm, etc.
                "random_string": 2,         # Long random alphanumeric
                "url_shortener": 1          # bit.ly, tinyurl, etc.
            },
            
            # Brand impersonation
            "brand_similarity": {
                "exact_match_different_tld": 3,  # chase.tk
                "typosquatting": 2,              # chasse.com
                "homograph_attack": 3,           # using cyrillic chars
                "subdomain_impersonation": 2     # chase.fake-site.com
            },
            
            # Content analysis
            "content_heuristics": {
                "offsite_form_action": 2,        # Form posts to different domain
                "excessive_urgency": 1,          # Multiple urgency keywords
                "financial_verification": 2,     # Account/payment verification
                "health_claims": 1,              # Unverified health claims
                "high_caps_ratio": 1,            # >30% ALL CAPS
                "suspicious_contact": 1          # Gmail for business, etc.
            },
            
            # Technical indicators
            "technical_signals": {
                "no_https": 1,                   # HTTP in 2024
                "suspicious_redirects": 2,       # >3 redirects
                "blocked_by_security": 3,        # WAF/security warnings
                "new_domain": 1,                 # Registered <30 days ago
                "hidden_whois": 1                # Privacy protection + suspicious
            }
        },
        
        # Final verdict thresholds
        "thresholds": {
            "danger": 4,    # Score >= 4 → Danger
            "warning": 2,   # Score 2-3 → Warning  
            "ok": 1         # Score 0-1 → OK
        }
    }

def create_all_data_files():
    """Create all data files for Phase 2.3"""
    data_dir = create_data_directory()
    
    files_to_create = {
        "reputable_domains.json": create_reputable_domains(),
        "brand_domains.json": create_brand_domains(),
        "suspicious_indicators.json": create_suspicious_indicators(),
        "heuristic_weights.json": create_heuristic_weights()
    }
    
    for filename, data in files_to_create.items():
        file_path = data_dir / filename
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        print(f"✅ Created {file_path}")
    
    print(f"\n🎯 Phase 2.3 data structure created in {data_dir}/")
    print("Files created:")
    for filename in files_to_create.keys():
        print(f"  - {filename}")
    
    return data_dir

if __name__ == "__main__":
    create_all_data_files()