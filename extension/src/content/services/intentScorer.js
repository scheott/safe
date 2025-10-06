// extension/src/services/intentScorer.js
// Gate 1: Intent Scoring - Strict thresholds to prevent false positives
// Product ≥0.85, Health ≥0.75 required to show chips

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
   * @returns {object} { score: number, signals: object, threshold: number }
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
    
    return { score, signals, threshold: this.thresholds.product };
  }
  
  /**
   * Score health intent with medical term pairing
   * @returns {object} { score: number, signals: object, threshold: number }
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
    
    return { score, signals, threshold: this.thresholds.health };
  }
  
  /**
   * Detect product signals
   */
  detectProductSignals() {
    const signals = {
      hasProductSchema: false,
      hasCommerceUI: false,
      hasProductURL: false,
      hasBreadcrumb: false,
      rawIndicators: []
    };
    
    // Check for Product schema (0.4 weight)
    const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of jsonLdScripts) {
      try {
        const data = JSON.parse(script.textContent);
        if (data['@type'] === 'Product' || 
            (data['@graph'] && data['@graph'].some(item => item['@type'] === 'Product'))) {
          signals.hasProductSchema = true;
          signals.rawIndicators.push('product_schema');
          break;
        }
      } catch (e) {}
    }
    
    // Check for commerce UI elements (0.3 weight)
    const priceElement = document.querySelector(
      '[class*="price"]:not([class*="priceless"]), [itemprop="price"], ' +
      '[data-price], .product-price, .item-price'
    );
    
    const ctaButton = document.querySelector(
      'button[class*="add-to-cart"], button[class*="addToCart"], ' +
      'button[class*="buy"], button[data-testid*="add-to-cart"], ' +
      'button[type="submit"][value*="cart"], .add-to-bag'
    );
    
    if (priceElement && ctaButton) {
      // Check proximity (within 3 DOM levels)
      let element = priceElement;
      let levels = 0;
      while (element && levels < 3) {
        element = element.parentElement;
        if (element && element.contains(ctaButton)) {
          signals.hasCommerceUI = true;
          signals.rawIndicators.push('price_and_cta_nearby');
          break;
        }
        levels++;
      }
    }
    
    // Check for product URL patterns (0.2 weight)
    const productPatterns = [
      /\/dp\/[A-Z0-9]+/i,  // Amazon
      /\/p\/[^/]+/i,       // Target
      /\/product\/[^/]+/i,
      /\/pd\/[^/]+/i,
      /\/item\/[^/]+/i,
      /\/ip\/[^/]+/i       // Walmart
    ];
    
    const pathname = window.location.pathname;
    if (productPatterns.some(pattern => pattern.test(pathname))) {
      signals.hasProductURL = true;
      signals.rawIndicators.push('product_url_pattern');
    }
    
    // Check for breadcrumb with specific product (0.1 weight)
    const breadcrumbs = document.querySelectorAll(
      'nav[aria-label*="breadcrumb"] li:last-child, ' +
      '.breadcrumb li:last-child, ' +
      '[class*="breadcrumb"] > *:last-child'
    );
    
    for (const crumb of breadcrumbs) {
      const text = crumb.textContent.trim().toLowerCase();
      // Check if it's not generic
      const genericTerms = ['home', 'shop', 'products', 'category', 'all'];
      if (text.length > 3 && !genericTerms.some(term => text.includes(term))) {
        signals.hasBreadcrumb = true;
        signals.rawIndicators.push('specific_breadcrumb');
        break;
      }
    }
    
    return signals;
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
    
    return Math.min(score, 1.0);
  }
  
  /**
   * Detect health signals with medical pairing
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
    
    // Check for Article schema (0.3 weight)
    const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of jsonLdScripts) {
      try {
        const data = JSON.parse(script.textContent);
        if (['Article', 'NewsArticle', 'MedicalWebPage', 'BlogPosting'].includes(data['@type'])) {
          signals.hasArticleSchema = true;
          signals.rawIndicators.push('article_schema');
          break;
        }
      } catch (e) {}
    }
    
    // Check for health URL patterns (0.3 weight)
    const healthPatterns = [
      /\/health\//i, /\/conditions\//i, /\/medical\//i,
      /\/diseases\//i, /\/treatment\//i, /\/symptoms\//i,
      /\/nutrition\//i, /\/wellness\//i, /\/medicine\//i
    ];
    
    const pathname = window.location.pathname;
    if (healthPatterns.some(pattern => pattern.test(pathname))) {
      signals.hasHealthURL = true;
      signals.rawIndicators.push('health_url_pattern');
    }
    
    // Check for medical term pairing (0.3 weight)
    const medicalScore = this.calculateMedicalTermScore();
    if (medicalScore.score > 0) {
      signals.hasMedicalTerms = true;
      signals.medicalPairings = medicalScore.pairings;
      signals.rawIndicators.push('medical_term_pairs');
    }
    
    // Check if on health site (0.1 weight)
    const healthSites = [
      'healthline.com', 'webmd.com', 'mayoclinic.org', 'medlineplus.gov',
      'cdc.gov', 'nih.gov', 'who.int', 'clevelandclinic.org'
    ];
    
    const hostname = window.location.hostname.replace('www.', '');
    if (healthSites.some(site => hostname.includes(site))) {
      signals.isHealthSection = true;
      signals.rawIndicators.push('health_domain');
    }
    
    return signals;
  }
  
  /**
   * Calculate medical term pairing score
   * CRITICAL: Requires condition + therapy + claim verb in proximity
   */
  calculateMedicalTermScore() {
    // Get main content text
    const contentElements = document.querySelectorAll(
      'main, article, [role="main"], .content, .article-body'
    );
    
    let contentText = '';
    for (const element of contentElements) {
      contentText += (element.textContent || '') + ' ';
    }
    
    if (!contentText) {
      contentText = document.body.textContent || '';
    }
    
    // Limit to first 3000 chars for performance
    contentText = contentText.substring(0, 3000).toLowerCase();
    
    // Split into sentences for proximity checking
    const sentences = contentText.split(/[.!?]+/);
    
    const foundPairings = [];
    let pairingCount = 0;
    
    for (const sentence of sentences) {
      const hasCondition = this.medicalTerms.conditions.some(term => 
        sentence.includes(term.toLowerCase())
      );
      const hasTherapy = this.medicalTerms.therapies.some(term => 
        sentence.includes(term.toLowerCase())
      );
      const hasClaim = this.medicalTerms.claimVerbs.some(verb => 
        sentence.includes(verb.toLowerCase())
      );
      
      // All three must be present in the same sentence
      if (hasCondition && hasTherapy && hasClaim) {
        pairingCount++;
        
        // Extract the specific pairing for logging
        const condition = this.medicalTerms.conditions.find(term => 
          sentence.includes(term.toLowerCase())
        );
        const therapy = this.medicalTerms.therapies.find(term => 
          sentence.includes(term.toLowerCase())
        );
        const claim = this.medicalTerms.claimVerbs.find(verb => 
          sentence.includes(verb.toLowerCase())
        );
        
        if (foundPairings.length < 3) {  // Limit logging
          foundPairings.push(`${condition} + ${therapy} + ${claim}`);
        }
      }
    }
    
    // Calculate density: need at least 3 paired terms per 100 words
    const wordCount = contentText.split(/\s+/).length;
    const density = pairingCount / (wordCount / 100);
    
    console.log('[IntentScorer] Medical term analysis:', {
      pairingCount,
      wordCount,
      density,
      pairings: foundPairings
    });
    
    return {
      score: density >= 3 ? 0.3 : 0,
      pairings: foundPairings,
      density
    };
  }
  
  /**
   * Calculate health score from signals
   */
  calculateHealthScore(signals) {
    let score = 0;
    
    // Weight distribution
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
    
    return Math.min(score, 1.0);
  }
  
  /**
   * Log borderline cases for future tuning
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
    
    // Send to analytics if available
    if (typeof analytics !== 'undefined' && analytics.track) {
      analytics.track('chip_intent_borderline', {
        chipType,
        score,
        threshold: this.thresholds[chipType],
        url: window.location.href,
        signals: signals.rawIndicators
      });
    }
  }
  
  /**
   * Get current scores for both chip types
   */
  async getBothScores() {
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