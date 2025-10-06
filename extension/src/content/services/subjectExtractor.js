// extension/src/services/subjectExtractor.js
// Gate 2: Subject Extraction with Specificity Validation
// Blocks generic subjects like "Apple", "Health", "New Deals"

class SubjectExtractor {
  constructor() {
    // Generic terms that auto-fail specificity check
    this.genericTerms = [
      // Navigation/structure
      'home', 'shop', 'product', 'products', 'category', 'categories',
      'search', 'results', 'browse', 'all', 'more', 'page',
      
      // Commerce
      'deals', 'deal', 'sale', 'sales', 'clearance', 'outlet', 'discount',
      'gifts', 'gift', 'new', 'top', 'best', 'featured', 'trending',
      
      // Content types
      'blog', 'blogs', 'article', 'articles', 'news', 'about', 'help', 
      'support', 'faq', 'contact', 'info', 'guide', 'tutorial',
      
      // Departments (retail)
      'clothing', 'apparel', 'electronics', 'furniture', 'toys', 'books',
      'beauty', 'health', 'wellness', 'fitness', 'sports', 'outdoor',
      'men', 'mens', 'women', 'womens', 'kids', 'baby', 'home',
      
      // Generic health
      'wellness', 'health', 'medical', 'healthcare', 'treatment', 'therapy',
      'medicine', 'condition', 'symptom', 'disease'
    ];
    
    // Model/variant patterns that count as specific
    this.modelPatterns = [
      /^[A-Z]{2,3}$/,              // SE, XL, XS, Pro, Max
      /^\d+[A-Z]+$/,               // 5G, 128GB, 4K
      /^[A-Z]\d+$/,                // M1, M2, S23
      /^v?\d+(\.\d+)?$/            // v2, 2.0, 13
    ];
    
    // Brand-only terms that fail specificity for products
    this.brandOnlyTerms = [
      'apple', 'amazon', 'target', 'walmart', 'bestbuy', 'ebay',
      'nike', 'adidas', 'samsung', 'google', 'microsoft', 'sony'
    ];
    
    // Site-specific adapters
    this.siteAdapters = this.initializeSiteAdapters();
  }
  
  /**
   * Main extraction method
   * @param {string} chipType - 'product' or 'health'
   * @returns {object} { subject, confidence, needsConfirm, failReason?, extractionMethod }
   */
  async extractSubject(chipType) {
    let extraction;
    
    // Try site-specific adapter first
    extraction = this.tryAdapterExtraction(chipType);
    
    // Fall back to generic extraction
    if (!extraction || !extraction.subject) {
      extraction = this.genericExtraction(chipType);
    }
    
    // Validate specificity
    const specificityResult = this.checkSpecificity(extraction.subject, chipType);
    
    if (!specificityResult.pass) {
      extraction.confidence = 'low';
      extraction.needsConfirm = true;
      extraction.failReason = specificityResult.reason;
    } else {
      // Update subject if it was truncated
      if (specificityResult.subject !== extraction.subject) {
        extraction.subject = specificityResult.subject;
      }
      extraction.needsConfirm = extraction.confidence === 'low';
    }
    
    console.log('[SubjectExtractor] Extraction result:', extraction);
    
    return extraction;
  }
  
  /**
   * Try site-specific adapter extraction
   */
  tryAdapterExtraction(chipType) {
    const hostname = window.location.hostname.replace('www.', '');
    const adapterKey = hostname.replace(/\./g, '_');
    
    if (this.siteAdapters[adapterKey]) {
      const adapter = this.siteAdapters[adapterKey];
      
      try {
        if (chipType === 'product' && adapter.productName) {
          const subject = adapter.productName();
          if (subject) {
            return {
              subject,
              confidence: 'high',
              needsConfirm: false,
              extractionMethod: `adapter_${adapterKey}`
            };
          }
        } else if (chipType === 'health' && adapter.healthTopic) {
          const subject = adapter.healthTopic();
          if (subject) {
            return {
              subject,
              confidence: 'high',
              needsConfirm: false,
              extractionMethod: `adapter_${adapterKey}`
            };
          }
        }
      } catch (e) {
        console.warn(`[SubjectExtractor] Adapter failed for ${adapterKey}:`, e);
      }
    }
    
    return null;
  }
  
  /**
   * Generic extraction for any site
   */
  genericExtraction(chipType) {
    if (chipType === 'product') {
      return this.extractProductSubject();
    } else {
      return this.extractHealthSubject();
    }
  }
  
  /**
   * Extract product subject
   */
  extractProductSubject() {
    let subject = '';
    let extractionMethod = '';
    
    // 1. Try JSON-LD Product.name (with variant if available)
    const jsonLd = this.extractFromJsonLd('Product');
    if (jsonLd && jsonLd.name) {
      subject = jsonLd.name;
      
      // Check for selected variant
      if (jsonLd.offers && Array.isArray(jsonLd.offers)) {
        const selectedOffer = jsonLd.offers.find(o => o.availability === 'InStock');
        if (selectedOffer && selectedOffer.name) {
          subject = selectedOffer.name;
        }
      }
      extractionMethod = 'json_ld_product_name';
    }
    
    // 2. Try Open Graph title
    if (!subject) {
      const ogTitle = document.querySelector('meta[property="og:title"]')?.content;
      if (ogTitle) {
        subject = this.cleanTitle(ogTitle);
        extractionMethod = 'og_title';
      }
    }
    
    // 3. Try H1 near price/CTA
    if (!subject) {
      const h1 = this.findH1NearCommerce();
      if (h1) {
        subject = h1;
        extractionMethod = 'h1_near_commerce';
      }
    }
    
    // 4. Try breadcrumb last node
    if (!subject) {
      const breadcrumb = this.extractFromBreadcrumb();
      if (breadcrumb) {
        subject = breadcrumb;
        extractionMethod = 'breadcrumb';
      }
    }
    
    // 5. Try URL slug
    if (!subject) {
      subject = this.extractFromUrlSlug();
      extractionMethod = 'url_slug';
    }
    
    // 6. Fall back to page title
    if (!subject) {
      subject = this.cleanTitle(document.title);
      extractionMethod = 'page_title';
    }
    
    return {
      subject: this.normalizeSubject(subject),
      confidence: extractionMethod.includes('json_ld') || extractionMethod.includes('adapter') ? 'high' : 'low',
      needsConfirm: false,
      extractionMethod
    };
  }
  
  /**
   * Extract health subject
   */
  extractHealthSubject() {
    let subject = '';
    let extractionMethod = '';
    
    // 1. Try JSON-LD Article.headline
    const jsonLd = this.extractFromJsonLd('Article');
    if (jsonLd && jsonLd.headline) {
      subject = jsonLd.headline;
      extractionMethod = 'json_ld_headline';
    }
    
    // 2. Try H1 inside article
    if (!subject) {
      const articleH1 = document.querySelector('article h1, main h1, .article-content h1');
      if (articleH1) {
        subject = articleH1.textContent.trim();
        extractionMethod = 'article_h1';
      }
    }
    
    // 3. Try Open Graph title
    if (!subject) {
      const ogTitle = document.querySelector('meta[property="og:title"]')?.content;
      if (ogTitle) {
        subject = this.cleanTitle(ogTitle);
        extractionMethod = 'og_title';
      }
    }
    
    // 4. Try extracting medical noun phrase from intro
    if (!subject) {
      subject = this.extractMedicalPhrase();
      if (subject) {
        extractionMethod = 'medical_phrase';
      }
    }
    
    // 5. Fall back to page title
    if (!subject) {
      subject = this.cleanTitle(document.title);
      extractionMethod = 'page_title';
    }
    
    return {
      subject: this.normalizeSubject(subject),
      confidence: extractionMethod.includes('json_ld') || extractionMethod === 'article_h1' ? 'high' : 'low',
      needsConfirm: false,
      extractionMethod
    };
  }
  
  /**
   * Check if subject meets specificity requirements
   */
  checkSpecificity(subject, chipType) {
    if (!subject) {
      return { pass: false, reason: 'empty_subject' };
    }
    
    const words = subject.split(/\s+/).filter(w => w.length > 0);
    const lowerSubject = subject.toLowerCase();
    
    // Rule 1: At least 2 words
    if (words.length < 2) {
      return { pass: false, reason: 'too_short' };
    }
    
    // Rule 2: Not in generic terms list
    const hasGenericTerm = this.genericTerms.some(term => {
      const regex = new RegExp(`\\b${term}\\b`, 'i');
      return regex.test(lowerSubject);
    });
    
    if (hasGenericTerm) {
      return { pass: false, reason: 'contains_generic_term' };
    }
    
    // Rule 3: Brand-only guard for products
    if (chipType === 'product') {
      const cleanedSubject = words.map(w => w.toLowerCase()).join(' ');
      const isBrandOnly = this.brandOnlyTerms.some(brand => {
        return cleanedSubject === brand || 
               cleanedSubject === brand + 's' ||
               cleanedSubject === 'the ' + brand;
      });
      
      if (isBrandOnly) {
        return { pass: false, reason: 'brand_only' };
      }
    }
    
    // Rule 4: Contains either a model pattern OR two 4+ char words
    const hasModel = words.some(word => 
      this.modelPatterns.some(pattern => pattern.test(word))
    );
    
    const longWords = words.filter(w => w.length >= 4);
    const hasTwoLongWords = longWords.length >= 2;
    
    if (!hasModel && !hasTwoLongWords) {
      return { pass: false, reason: 'not_specific_enough' };
    }
    
    // Rule 5: Not longer than 8 words (truncate if needed)
    if (words.length > 8) {
      subject = words.slice(0, 8).join(' ');
    }
    
    return { pass: true, subject };
  }
  
  /**
   * Helper: Extract from JSON-LD
   */
  extractFromJsonLd(type) {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
      try {
        const data = JSON.parse(script.textContent);
        if (data['@type'] === type) {
          return data;
        }
        if (data['@graph']) {
          const item = data['@graph'].find(i => i['@type'] === type);
          if (item) return item;
        }
      } catch (e) {}
    }
    return null;
  }
  
  /**
   * Helper: Find H1 near commerce elements
   */
  findH1NearCommerce() {
    const priceElements = document.querySelectorAll('[class*="price"], [data-price]');
    
    for (const priceEl of priceElements) {
      // Look for H1 within 3 parent levels
      let parent = priceEl;
      for (let i = 0; i < 3; i++) {
        parent = parent.parentElement;
        if (!parent) break;
        
        const h1 = parent.querySelector('h1');
        if (h1) {
          return h1.textContent.trim();
        }
      }
    }
    
    return null;
  }
  
  /**
   * Helper: Extract from breadcrumb
   */
  extractFromBreadcrumb() {
    const breadcrumbs = document.querySelectorAll(
      'nav[aria-label*="breadcrumb"] li:last-child, ' +
      '.breadcrumb li:last-child, ' +
      '[class*="breadcrumb"] > *:last-child'
    );
    
    for (const crumb of breadcrumbs) {
      const text = crumb.textContent.trim();
      // Skip if it's a generic term
      if (!this.genericTerms.includes(text.toLowerCase())) {
        return text;
      }
    }
    
    return null;
  }
  
  /**
   * Helper: Extract from URL slug
   */
  extractFromUrlSlug() {
    const pathname = window.location.pathname;
    const segments = pathname.split('/').filter(s => s.length > 0);
    
    if (segments.length > 0) {
      const lastSegment = segments[segments.length - 1];
      // Clean up common patterns
      const cleaned = lastSegment
        .replace(/[-_]/g, ' ')
        .replace(/\.(html?|php|aspx?)$/i, '')
        .replace(/^[A-Z0-9]{10,}$/i, ''); // Skip pure IDs
      
      if (cleaned && !this.genericTerms.includes(cleaned.toLowerCase())) {
        return cleaned;
      }
    }
    
    return null;
  }
  
  /**
   * Helper: Extract medical phrase from content
   */
  extractMedicalPhrase() {
    const intro = document.querySelector(
      'article > p:first-of-type, ' +
      '.article-content > p:first-of-type, ' +
      'main > p:first-of-type'
    );
    
    if (!intro) return null;
    
    const text = intro.textContent.substring(0, 200);
    
    // Look for condition + therapy patterns
    const medicalPattern = /(vitamin [A-Z]\d?|intermittent fasting|keto diet|meditation|acupuncture|supplements?|medication)/i;
    const match = text.match(medicalPattern);
    
    if (match) {
      // Try to get surrounding context
      const startIdx = Math.max(0, match.index - 20);
      const endIdx = Math.min(text.length, match.index + match[0].length + 20);
      const context = text.substring(startIdx, endIdx).trim();
      
      // Clean it up
      return context.replace(/^[^a-zA-Z]+|[^a-zA-Z]+$/g, '');
    }
    
    return null;
  }
  
  /**
   * Helper: Clean title strings
   */
  cleanTitle(title) {
    if (!title) return '';
    
    // Remove common suffixes
    const suffixes = [
      / \| .+$/,           // | SiteName
      / - .+$/,            // - SiteName
      / – .+$/,            // – SiteName
      / • .+$/,            // • SiteName
      / :: .+$/,           // :: SiteName
      / \(\d{4}\)$/,       // (2024)
      / - Review$/i,       // - Review
      / - Buy Online$/i    // - Buy Online
    ];
    
    let cleaned = title;
    for (const suffix of suffixes) {
      cleaned = cleaned.replace(suffix, '');
    }
    
    return cleaned.trim();
  }
  
  /**
   * Helper: Normalize subject text
   */
  normalizeSubject(subject) {
    if (!subject) return '';
    
    // Cap to 8 words
    const words = subject.split(/\s+/);
    if (words.length > 8) {
      subject = words.slice(0, 8).join(' ');
    }
    
    // Clean up whitespace
    subject = subject.replace(/\s+/g, ' ').trim();
    
    // Preserve original case for display
    return subject;
  }
  
  /**
   * Initialize site-specific adapters
   */
  initializeSiteAdapters() {
    return {
      // Amazon adapter
      'amazon_com': {
        productName: () => {
          // Check for selected variant
          const baseTitle = document.querySelector('#productTitle')?.textContent.trim();
          const selectedSize = document.querySelector('#native_dropdown_selected_size_name')?.textContent.trim();
          const selectedColor = document.querySelector('.selection')?.textContent.trim();
          
          const parts = [baseTitle];
          if (selectedColor && !baseTitle?.includes(selectedColor)) {
            parts.push(selectedColor);
          }
          if (selectedSize && !baseTitle?.includes(selectedSize)) {
            parts.push(selectedSize);
          }
          
          return parts.filter(Boolean).join(' ');
        }
      },
      
      // Target adapter
      'target_com': {
        productName: () => {
          const baseTitle = document.querySelector('h1[data-test="product-title"]')?.textContent.trim();
          
          // Check for selected variants
          const variantButtons = document.querySelectorAll('[data-test="variant-selector"] button[aria-checked="true"]');
          const variants = Array.from(variantButtons).map(el => el.textContent.trim());
          
          if (variants.length > 0 && baseTitle) {
            return `${baseTitle} ${variants.join(' ')}`;
          }
          
          return baseTitle;
        }
      },
      
      // Walmart adapter
      'walmart_com': {
        productName: () => {
          const title = document.querySelector('h1[itemprop="name"]')?.textContent.trim();
          const variant = document.querySelector('.variant-selector .selected')?.textContent.trim();
          
          if (variant && title && !title.includes(variant)) {
            return `${title} ${variant}`;
          }
          
          return title;
        }
      },
      
      // Best Buy adapter
      'bestbuy_com': {
        productName: () => {
          return document.querySelector('.sku-title h1')?.textContent.trim();
        }
      },
      
      // Healthline adapter
      'healthline_com': {
        healthTopic: () => {
          const h1 = document.querySelector('h1')?.textContent;
          return h1?.replace(/\s*[-–]\s*Healthline$/i, '').trim();
        }
      },
      
      // Mayo Clinic adapter
      'mayoclinic_org': {
        healthTopic: () => {
          const h1 = document.querySelector('h1.content-title, h1')?.textContent;
          return h1?.replace(/\s*[-–]\s*Mayo Clinic$/i, '').trim();
        }
      },
      
      // WebMD adapter
      'webmd_com': {
        healthTopic: () => {
          return document.querySelector('h1.article-title, h1')?.textContent.trim();
        }
      },
      
      // MedlinePlus adapter
      'medlineplus_gov': {
        healthTopic: () => {
          return document.querySelector('h1.with-also, h1')?.textContent.trim();
        }
      },
      
      // CNN Health adapter
      'cnn_com': {
        pageType: () => {
          const path = window.location.pathname;
          if (path === '/health' || path === '/health/') return 'portal';
          if (document.querySelector('article')) return 'article';
          return 'portal';
        },
        healthTopic: () => {
          const h1 = document.querySelector('h1.article__title, h1[data-test="headline"], h1');
          return h1?.textContent.trim();
        }
      }
    };
  }
}

// Export for use in chipManager
export default SubjectExtractor;