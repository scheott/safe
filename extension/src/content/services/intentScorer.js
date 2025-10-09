// extension/src/content/services/intentScorer.js
// FIXED VERSION - Better Amazon detection and real-world compatibility

class IntentScorer {
  constructor() {
    // STRICT thresholds (Week 1 conservative settings)
    this.thresholds = {
      product: 0.85,  // Very high confidence required
      health: 0.75    // High confidence required
    };
    
    // Medical terms for paired detection
    this.medicalTerms = {
      conditions: [
        'diabetes', 'cancer', 'heart disease', 'arthritis', 'anxiety', 'depression',
        'insomnia', 'obesity', 'pain', 'inflammation', 'infection', 'sleep quality',
        'blood pressure', 'cholesterol', 'immune system', 'digestion', 'covid',
        'alzheimer', 'dementia', 'stroke', 'asthma', 'copd', 'migraine',
        'hypertension', 'fatigue', 'stress', 'metabolism', 'cognitive decline'
      ],
      therapies: [
        'vitamin', 'supplement', 'medication', 'drug', 'therapy', 'treatment',
        'diet', 'exercise', 'fasting', 'meditation', 'acupuncture', 'surgery',
        'remedy', 'cure', 'medicine', 'pill', 'dosage', 'prescription',
        'vaccine', 'injection', 'procedure', 'rehabilitation', 'counseling'
      ],
      claimVerbs: [
        'cures', 'treats', 'prevents', 'reverses', 'eliminates', 'fixes',
        'reduces', 'improves', 'helps', 'alleviates', 'manages', 'controls',
        'boosts', 'enhances', 'supports', 'relieves', 'heals', 'restores',
        'combats', 'fights', 'addresses', 'mitigates', 'remedies'
      ]
    };
  }
  
  /**
   * Score product intent
   * @returns {object} { score: number, signals: object, threshold: number, passes: boolean }
   */
  async scoreProductIntent() {
    const signals = this.detectProductSignals();
    const score = this.calculateProductScore(signals);
    
    // Log borderline cases for tuning
    if (score >= 0.55 && score < this.thresholds.product) {
      this.logBorderlineCase('product', score, signals);
    }
    
    console.log('[IntentScorer] Product intent:', {
      score,
      threshold: this.thresholds.product,
      passes: score >= this.thresholds.product,
      signals
    });
    
    return { 
      score, 
      signals, 
      threshold: this.thresholds.product,
      passes: score >= this.thresholds.product 
    };
  }
  
  /**
   * Score health intent with medical term pairing
   * @returns {object} { score: number, signals: object, threshold: number, passes: boolean }
   */
  async scoreHealthIntent() {
    const signals = this.detectHealthSignals();
    const score = this.calculateHealthScore(signals);
    
    // Log borderline cases for tuning
    if (score >= 0.55 && score < this.thresholds.health) {
      this.logBorderlineCase('health', score, signals);
    }
    
    console.log('[IntentScorer] Health intent:', {
      score,
      threshold: this.thresholds.health,
      passes: score >= this.thresholds.health,
      signals
    });
    
    return { 
      score, 
      signals, 
      threshold: this.thresholds.health,
      passes: score >= this.thresholds.health 
    };
  }
  
  /**
   * Detect product signals - ENHANCED FOR AMAZON
   */
  detectProductSignals() {
    const signals = {
      hasProductSchema: false,
      hasCommerceUI: false,
      hasProductURL: false,
      hasBreadcrumb: false,
      rawIndicators: []
    };
    
    // Check for Product schema (0.4 weight) - ENHANCED
    const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of jsonLdScripts) {
      try {
        const data = JSON.parse(script.textContent);
        // Check for direct Product type
        if (data['@type'] === 'Product' || 
            (data['@graph'] && data['@graph'].some(item => item['@type'] === 'Product'))) {
          signals.hasProductSchema = true;
          signals.rawIndicators.push('product_schema');
          break;
        }
        // Check for BreadcrumbList with product indication
        if (data['@type'] === 'BreadcrumbList' && data.itemListElement) {
          const lastItem = data.itemListElement[data.itemListElement.length - 1];
          if (lastItem && lastItem.name && !this.isGenericTerm(lastItem.name)) {
            signals.hasProductSchema = true;
            signals.rawIndicators.push('product_breadcrumb_schema');
            break;
          }
        }
      } catch (e) {}
    }
    
    // Check for commerce UI elements (0.3 weight) - ENHANCED FOR AMAZON
    const priceElement = document.querySelector(
      // Standard selectors
      '[class*="price"]:not([class*="priceless"]), [itemprop="price"], ' +
      '[data-price], .product-price, .item-price, ' +
      // Amazon-specific selectors
      '.a-price, .a-price-whole, .a-price-range, ' +
      '#priceblock_dealprice, #priceblock_ourprice, #priceblock_saleprice, ' +
      '.priceBlockBuyingPriceString, .offer-price, ' +
      // Other major retailers
      '[data-test*="product-price"], [data-testid*="price"], ' +
      '.Price__container, .product__price'
    );
    
    const ctaButton = document.querySelector(
      'button[class*="add-to-cart"], ' +
      'button[class*="addToCart"], ' +
      'button[class*="buy"], ' +
      'button[data-testid*="add-to-cart"], ' +
      'button[type="submit"][value*="cart"], ' +
      '.add-to-bag, ' +
      '#add-to-cart-button, ' +
      '#buy-now-button, ' +
      'input[id="add-to-cart-button"], ' +
      'input[name="submit.add-to-cart"], ' +
      '.a-button-oneclick, ' +
      '#submitOrderButtonId, ' +
      '[aria-label*="Add to Cart"], ' +
      '[aria-label*="Buy Now"], ' +
      '[data-test*="add-to-cart"]'
    );
    
    // Check both presence and proximity
    if (priceElement && ctaButton) {
      signals.hasCommerceUI = true;
      signals.rawIndicators.push('price_and_cta_found');
    } else if (priceElement || ctaButton) {
      // Even if only one is found, on a product URL, that's a strong signal
      if (signals.hasProductURL || this.isProductURL()) {
        signals.hasCommerceUI = true;
        signals.rawIndicators.push(priceElement ? 'price_only_on_product_page' : 'cta_only_on_product_page');
      }
    }
    
    // Amazon-specific: Check for key product indicators
    if (window.location.hostname.includes('amazon')) {
      const hasAmazonProductIndicators = 
        document.querySelector('#productTitle, #title_feature_div, .product-title-word-break') ||
        document.querySelector('#feature-bullets, #detailBullets') ||
        document.querySelector('#availability, .availability') ||
        document.querySelector('#variation_color_name, #variation_size_name') ||
        document.querySelector('.imgTagWrapper, #imageBlock');
      
      if (hasAmazonProductIndicators) {
        if (!signals.hasCommerceUI) {
          signals.hasCommerceUI = true;
          signals.rawIndicators.push('amazon_product_indicators');
        }
      }
    }
    
    // Check for product URL patterns (0.2 weight)
    if (this.isProductURL()) {
      signals.hasProductURL = true;
      signals.rawIndicators.push('product_url_pattern');
    }
    
    // Check for breadcrumb with specific product (0.1 weight) - ENHANCED
    const breadcrumbs = document.querySelectorAll(
      'nav[aria-label*="breadcrumb"] li:last-child, ' +
      '.breadcrumb li:last-child, ' +
      '[class*="breadcrumb"] > *:last-child, ' +
      // Amazon breadcrumb
      '.a-breadcrumb li:last-child, #wayfinding-breadcrumbs_feature_div li:last-child'
    );
    
    for (const crumb of breadcrumbs) {
      const text = crumb.textContent.trim().toLowerCase();
      // Check if it's not generic
      if (text.length > 3 && !this.isGenericTerm(text)) {
        signals.hasBreadcrumb = true;
        signals.rawIndicators.push('specific_breadcrumb');
        break;
      }
    }
    
    return signals;
  }
  
  /**
   * Helper: Check if current URL is a product URL
   */
  isProductURL() {
    const productPatterns = [
      /\/dp\/[A-Z0-9]+/i,       // Amazon
      /\/p\/[^/]+/i,            // Target
      /\/product\/[^/]+/i,
      /\/pd\/[^/]+/i,
      /\/item\/[^/]+/i,
      /\/ip\/[^/]+/i,           // Walmart
      /\/gp\/product\//i,       // Amazon gp/product
      /\/[^/]+\/B[A-Z0-9]{9}/i  // Amazon ASIN pattern
    ];
    
    const pathname = window.location.pathname;
    return productPatterns.some(pattern => pattern.test(pathname));
  }
  
  /**
   * Helper: Check if term is generic
   */
  isGenericTerm(text) {
    const genericTerms = ['home', 'shop', 'products', 'category', 'all', 'search', 'results'];
    const lowerText = text.toLowerCase();
    return genericTerms.some(term => lowerText.includes(term));
  }
  
  /**
   * Calculate product score from signals
   */
  calculateProductScore(signals) {
    let score = 0;
    
    // Weight distribution (must sum to 1.0)
    const weights = {
      hasProductSchema: 0.4,
      hasCommerceUI: 0.3,
      hasProductURL: 0.2,
      hasBreadcrumb: 0.1
    };
    
    if (signals.hasProductSchema) score += weights.hasProductSchema;
    if (signals.hasCommerceUI) score += weights.hasCommerceUI;
    if (signals.hasProductURL) score += weights.hasProductURL;
    if (signals.hasBreadcrumb) score += weights.hasBreadcrumb;
    
    return score;
  }
  
  /**
   * Detect health signals
   */
  detectHealthSignals() {
    const signals = {
      hasArticleSchema: false,
      hasHealthURL: false,
      hasMedicalTerms: false,
      isHealthSection: false,
      medicalPairings: [],
      rawIndicators: []
    };
    
    // Check for Article/MedicalWebPage schema (0.3 weight)
    const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of jsonLdScripts) {
      try {
        const data = JSON.parse(script.textContent);
        if (['Article', 'NewsArticle', 'MedicalWebPage', 'HealthTopicContent'].includes(data['@type'])) {
          signals.hasArticleSchema = true;
          signals.rawIndicators.push('article_schema');
          break;
        }
      } catch (e) {}
    }
    
    // Check for health URL patterns (0.3 weight)
    const healthPatterns = [
      /\/health\//i, /\/wellness\//i, /\/nutrition\//i,
      /\/medical\//i, /\/disease\//i, /\/condition\//i,
      /\/treatment\//i, /\/symptom\//i
    ];
    
    if (healthPatterns.some(p => p.test(window.location.pathname))) {
      signals.hasHealthURL = true;
      signals.rawIndicators.push('health_url_pattern');
    }
    
    // Check for medical term pairing (0.3 weight)
    const termAnalysis = this.calculateMedicalTermScore();
    if (termAnalysis.pairingCount > 0) {
      signals.hasMedicalTerms = true;
      signals.medicalPairings = termAnalysis.pairings;
      signals.rawIndicators.push('medical_term_pairs');
    }
    
    // Check if in health section (0.1 weight)
    const breadcrumb = document.querySelector('[aria-label*="breadcrumb"], .breadcrumb');
    if (breadcrumb && breadcrumb.textContent.toLowerCase().includes('health')) {
      signals.isHealthSection = true;
      signals.rawIndicators.push('health_breadcrumb');
    }
    
    return signals;
  }
  
  /**
   * Calculate health score
   */
  calculateHealthScore(signals) {
    let score = 0;
    
    const weights = {
      hasArticleSchema: 0.3,
      hasHealthURL: 0.3,
      hasMedicalTerms: 0.3,
      isHealthSection: 0.1
    };
    
    if (signals.hasArticleSchema) score += weights.hasArticleSchema;
    if (signals.hasHealthURL) score += weights.hasHealthURL;
    if (signals.hasMedicalTerms) score += weights.hasMedicalTerms;
    if (signals.isHealthSection) score += weights.isHealthSection;
    
    return score;
  }
  
  /**
   * Analyze medical terms for condition + therapy + claim pairing
   */
  calculateMedicalTermScore() {
    // Get main content text
    const contentElements = document.querySelectorAll(
      'article, main, [role="main"], .content, #content'
    );
    
    let text = '';
    if (contentElements.length > 0) {
      text = Array.from(contentElements).map(el => el.textContent).join(' ');
    } else {
      text = document.body.textContent || '';
    }
    
    // Normalize text
    text = text.toLowerCase().slice(0, 5000); // Cap at 5000 chars for performance
    const words = text.split(/\s+/);
    
    // Find medical term pairings
    const foundConditions = new Set();
    const foundTherapies = new Set();
    const foundClaims = new Set();
    
    // Check for conditions
    for (const condition of this.medicalTerms.conditions) {
      if (text.includes(condition)) {
        foundConditions.add(condition);
      }
    }
    
    // Check for therapies
    for (const therapy of this.medicalTerms.therapies) {
      if (text.includes(therapy)) {
        foundTherapies.add(therapy);
      }
    }
    
    // Check for claim verbs
    for (const verb of this.medicalTerms.claimVerbs) {
      if (text.includes(verb)) {
        foundClaims.add(verb);
      }
    }
    
    // Calculate pairing score
    const hasPairing = foundConditions.size > 0 && 
                       foundTherapies.size > 0 && 
                       foundClaims.size > 0;
    
    const pairings = hasPairing ? 
      [`${[...foundConditions][0]} + ${[...foundTherapies][0]} + ${[...foundClaims][0]}`] : [];
    
    console.log('[IntentScorer] Medical term analysis:', {
      pairingCount: hasPairing ? 1 : 0,
      wordCount: words.length,
      density: hasPairing ? (3 / words.length) * 100 : 0,
      pairings
    });
    
    return {
      pairingCount: hasPairing ? 1 : 0,
      pairings
    };
  }
  
  /**
   * Log borderline cases for tuning
   */
  logBorderlineCase(chipType, score, signals) {
    console.warn(`[IntentScorer] BORDERLINE ${chipType.toUpperCase()} case for tuning:`, {
      url: window.location.href,
      chipType,
      score,
      threshold: this.thresholds[chipType],
      gap: this.thresholds[chipType] - score,
      signals,
      timestamp: new Date().toISOString(),
      recommendation: 'Review this case for threshold adjustment'
    });
  }
  
  /**
   * Test both intents (for debugging)
   */
  async testBothIntents() {
    const [productResult, healthResult] = await Promise.all([
      this.scoreProductIntent(),
      this.scoreHealthIntent()
    ]);
    
    return {
      product: productResult,
      health: healthResult
    };
  }
}

// Export for use in chipManager
export default IntentScorer;