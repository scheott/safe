// extension/src/scanners.js
/**
 * Phase 2.5: Client-side scanner integration
 * Handles product and health detection + API calls
 */

class PageScanner {
  constructor(apiClient) {
    this.api = apiClient;
    this.cache = new Map(); // Simple in-memory cache
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
  }

  // =========================================================================
  // CONTEXT DETECTION
  // =========================================================================

  /**
   * Quick local probe to detect page type
   * Returns confidence scores for different contexts
   */
  quickContextProbe() {
    const signals = {
      product: 0,
      health: 0,
      news: 0,
      general: 0
    };

    // Get page text samples
    const title = document.title.toLowerCase();
    const metaDesc = this.getMetaContent('description');
    const bodyText = this.getBodySample();
    const url = window.location.href.toLowerCase();

    // Product signals
    const productSignals = [
      /\$[\d,]+\.?\d*/g,  // Price patterns
      /add to cart/i,
      /buy now/i,
      /in stock/i,
      /out of stock/i,
      /shipping/i,
      /review/i,
      /rating/i,
      /product/i,
      /price/i
    ];

    productSignals.forEach(pattern => {
      if (pattern.test(bodyText) || pattern.test(title)) {
        signals.product += 0.15;
      }
    });

    // Check for structured data
    if (this.getProductStructuredData()) {
      signals.product += 0.4;
    }

    // Health signals  
    const healthSignals = [
      /symptom/i,
      /treatment/i,
      /disease/i,
      /health/i,
      /medical/i,
      /doctor/i,
      /medicine/i,
      /supplement/i,
      /vitamin/i,
      /cure/i,
      /remedy/i,
      /clinical/i,
      /study/i,
      /research/i
    ];

    healthSignals.forEach(pattern => {
      if (pattern.test(bodyText) || pattern.test(title)) {
        signals.health += 0.12;
      }
    });

    // URL patterns
    if (url.includes('product') || url.includes('item') || url.includes('/p/')) {
      signals.product += 0.3;
    }
    if (url.includes('health') || url.includes('medical') || url.includes('symptom')) {
      signals.health += 0.3;
    }

    // Normalize scores
    const maxScore = Math.max(...Object.values(signals));
    if (maxScore > 0) {
      Object.keys(signals).forEach(key => {
        signals[key] = signals[key] / maxScore;
      });
    }

    return signals;
  }

  // =========================================================================
  // HINT EXTRACTION
  // =========================================================================

  /**
   * Extract product hints from the page
   */
  extractProductHints() {
    const hints = {
      title: null,
      brand: null,
      model: null,
      upc: null,
      price: null,
      domPath: {}
    };

    // Try structured data first
    const productData = this.getProductStructuredData();
    if (productData) {
      hints.title = productData.name;
      hints.brand = productData.brand?.name;
      if (productData.offers) {
        hints.price = parseFloat(productData.offers.price);
      }
      if (productData.gtin || productData.gtin13) {
        hints.upc = productData.gtin || productData.gtin13;
      }
    }

    // Fallback to DOM extraction
    if (!hints.title) {
      // Common product title selectors
      const titleSelectors = [
        'h1[itemprop="name"]',
        '#productTitle',
        '.product-title',
        '.product-name',
        'h1.title',
        'h1'
      ];

      for (const selector of titleSelectors) {
        const el = document.querySelector(selector);
        if (el && el.textContent.trim()) {
          hints.title = el.textContent.trim().slice(0, 120);
          hints.domPath.title = selector;
          break;
        }
      }
    }

    // Extract brand
    if (!hints.brand) {
      const brandSelectors = [
        '[itemprop="brand"]',
        '.product-brand',
        '.brand-name',
        'a[href*="/brand/"]'
      ];

      for (const selector of brandSelectors) {
        const el = document.querySelector(selector);
        if (el) {
          hints.brand = el.textContent.trim().slice(0, 40);
          break;
        }
      }
    }

    // Extract price
    if (!hints.price) {
      const priceSelectors = [
        '[itemprop="price"]',
        '.price',
        '#priceblock_ourprice',
        '.product-price',
        '.current-price'
      ];

      for (const selector of priceSelectors) {
        const el = document.querySelector(selector);
        if (el) {
          const priceMatch = el.textContent.match(/[\d,]+\.?\d*/);
          if (priceMatch) {
            hints.price = parseFloat(priceMatch[0].replace(',', ''));
            hints.domPath.price = selector;
            break;
          }
        }
      }
    }

    // Extract model from title or page
    if (!hints.model && hints.title) {
      // Common model patterns
      const modelMatch = hints.title.match(/\b([A-Z0-9]{2,}[\-A-Z0-9]+)\b/);
      if (modelMatch) {
        hints.model = modelMatch[1];
      }
    }

    return hints;
  }

  /**
   * Extract health claims from the page
   */
  extractHealthHints() {
    const hints = {
      claims: [],
      topic: null,
      excerpt: null,
      domPath: {}
    };

    // Look for claim patterns
    const claimSelectors = [
      'h1, h2, h3',  // Headers often contain claims
      '.claim',
      '.benefit',
      '[itemprop="description"]',
      '.product-description li'
    ];

    const foundClaims = new Set();
    
    // Use outer loop with early exit
    outer: for (const selector of claimSelectors) {
      const elements = document.querySelectorAll(selector);
      
      for (const el of elements) {
        const text = el.textContent.trim();
        
        // Look for health claim patterns
        const claimPatterns = [
          /(?:helps?|supports?|promotes?|improves?|reduces?|prevents?|treats?|cures?)\s+.{5,50}/gi,
          /clinically\s+(?:proven|tested|shown)/gi,
          /\d+%\s+(?:improvement|reduction|better)/gi,
          /(?:boosts?|strengthens?|enhances?)\s+.{5,50}/gi,
          /(?:natural|organic|pure)\s+(?:remedy|treatment|cure)/gi
        ];
        
        for (const pattern of claimPatterns) {
          const matches = text.match(pattern);
          if (matches) {
            for (const match of matches) {
              const claim = match.trim().slice(0, 200);
              if (claim.length > 10 && !foundClaims.has(claim)) {
                foundClaims.add(claim);
                hints.claims.push(claim);
                if (hints.claims.length >= 3) break outer;
              }
            }
          }
        }
      }
    }

    // Extract topic from title or main heading
    const h1 = document.querySelector('h1');
    if (h1) {
      // Extract potential health topic
      const topicMatch = h1.textContent.match(
        /(?:vitamin\s+\w+|omega[\s-]?\d+|probiotics?|collagen|turmeric|cbd|melatonin)/i
      );
      if (topicMatch) {
        hints.topic = topicMatch[0].toLowerCase();
      }
    }

    // Get excerpt from main content
    const mainContent = document.querySelector('main, article, .content, #content');
    if (mainContent) {
      hints.excerpt = mainContent.textContent
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 400);
    }

    return hints;
  }

  // =========================================================================
  // API CALLS
  // =========================================================================

  /**
   * Scan for safer product deals
   */
  async scanProduct(url = window.location.href, mode = 'fast') {
    const cacheKey = `product:${url}:${mode}`;
    
    // Check cache
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    // Extract hints
    const hints = this.extractProductHints();
    
    // Must have at least a title
    if (!hints.title) {
      return {
        error: 'Could not detect product information',
        confidence: 0
      };
    }

    try {
      const response = await this.api.post('/api/scan/product', {
        url,
        hints,
        mode
      });

      // Cache successful response
      this.setCache(cacheKey, response, response.ttl_sec * 1000);
      
      return response;
    } catch (error) {
      console.error('Product scan failed:', error);
      
      // Retry with full mode if fast mode failed
      if (mode === 'fast' && error.code === 'TIMEOUT') {
        return this.scanProduct(url, 'full');
      }
      
      throw error;
    }
  }

  /**
   * Scan for health fact checking
   */
  async scanHealth(url = window.location.href, mode = 'fast') {
    const cacheKey = `health:${url}:${mode}`;
    
    // Check cache
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    // Extract hints
    const hints = this.extractHealthHints();
    
    // Must have at least one claim
    if (!hints.claims.length) {
      return {
        error: 'Could not detect health claims',
        confidence: 0
      };
    }

    try {
      const response = await this.api.post('/api/scan/health', {
        url,
        hints,
        mode
      });

      // Cache successful response
      this.setCache(cacheKey, response, response.ttl_sec * 1000);
      
      return response;
    } catch (error) {
      console.error('Health scan failed:', error);
      
      // Retry with full mode if fast mode failed
      if (mode === 'fast' && error.code === 'TIMEOUT') {
        return this.scanHealth(url, 'full');
      }
      
      throw error;
    }
  }

  // =========================================================================
  // UTILITIES
  // =========================================================================

  getMetaContent(name) {
    const meta = document.querySelector(`meta[name="${name}"], meta[property="og:${name}"]`);
    return meta?.content || '';
  }

  getBodySample(maxLength = 1000) {
    const body = document.body.textContent || '';
    return body.slice(0, maxLength).toLowerCase();
  }

  getProductStructuredData() {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    
    for (const script of scripts) {
      try {
        const data = JSON.parse(script.textContent);
        
        // Check if it's a Product schema
        if (data['@type'] === 'Product' || data.type === 'Product') {
          return data;
        }
        
        // Check nested graph
        if (data['@graph']) {
          const product = data['@graph'].find(
            item => item['@type'] === 'Product'
          );
          if (product) return product;
        }
      } catch (e) {
        // Invalid JSON, skip
      }
    }
    
    return null;
  }

  getCached(key) {
    const item = this.cache.get(key);
    if (!item) return null;
    
    if (Date.now() > item.expires) {
      this.cache.delete(key);
      return null;
    }
    
    return item.data;
  }

  setCache(key, data, ttl = this.cacheTimeout) {
    this.cache.set(key, {
      data,
      expires: Date.now() + ttl
    });
  }
}

// =========================================================================
// BADGE UI INTEGRATION
// =========================================================================

class ScannerUI {
  constructor(scanner, shadowRoot) {
    this.scanner = scanner;
    this.shadowRoot = shadowRoot;
    this.container = null;
    this.initUI();
  }

  initUI() {
    // Add scanner buttons to badge
    const style = document.createElement('style');
    style.textContent = `
      .scanner-chips {
        display: none;
        gap: 4px;
        margin-top: 8px;
      }
      
      .scanner-chips.visible {
        display: flex;
      }
      
      .scanner-chip {
        display: inline-flex;
        align-items: center;
        padding: 4px 8px;
        background: white;
        border: 1px solid #e0e0e0;
        border-radius: 12px;
        font-size: 11px;
        cursor: pointer;
        transition: all 0.2s;
        box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      }
      
      .scanner-chip:hover {
        background: #f5f5f5;
        transform: translateY(-1px);
        box-shadow: 0 2px 5px rgba(0,0,0,0.15);
      }
      
      .scanner-chip.product {
        border-color: #4caf50;
        color: #2e7d32;
      }
      
      .scanner-chip.health {
        border-color: #2196f3;
        color: #1565c0;
      }
      
      .scanner-chip .icon {
        margin-right: 4px;
        font-size: 14px;
      }
      
      .scanner-chip.loading {
        opacity: 0.6;
        cursor: wait;
      }
      
      .scanner-chip.upgrade {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        border: none;
      }
      
      /* Modal for results */
      .scanner-modal {
        display: none;
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: white;
        border-radius: 12px;
        padding: 16px;
        max-width: 320px;
        box-shadow: 0 10px 40px rgba(0,0,0,0.2);
        z-index: 10001;
      }
      
      .scanner-modal.visible {
        display: block;
      }
      
      .modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
        padding-bottom: 8px;
        border-bottom: 1px solid #e0e0e0;
      }
      
      .modal-title {
        font-size: 14px;
        font-weight: 600;
      }
      
      .modal-close {
        cursor: pointer;
        color: #999;
        font-size: 18px;
      }
      
      .product-match {
        padding: 8px;
        margin: 4px 0;
        border: 1px solid #e0e0e0;
        border-radius: 8px;
      }
      
      .match-retailer {
        font-weight: 600;
        color: #333;
      }
      
      .match-price {
        color: #4caf50;
        font-weight: bold;
      }
      
      .match-seller {
        font-size: 11px;
        color: #666;
      }
      
      .health-verdict {
        padding: 8px;
        border-radius: 8px;
        margin-bottom: 8px;
      }
      
      .verdict-mixed { background: #fff8e1; }
      .verdict-promising { background: #e8f5e9; }
      .verdict-not_supported { background: #ffebee; }
      .verdict-harmful { background: #ffcdd2; }
      
      .health-bullet {
        padding: 4px 0;
        font-size: 12px;
        line-height: 1.4;
      }
      
      .health-source {
        display: inline-block;
        padding: 2px 6px;
        margin: 2px;
        background: #f5f5f5;
        border-radius: 4px;
        font-size: 11px;
        color: #1976d2;
        text-decoration: none;
      }
      
      .health-source:hover {
        background: #e3f2fd;
      }
    `;
    
    this.shadowRoot.appendChild(style);
    
    // Create scanner chip container
    this.container = document.createElement('div');
    this.container.className = 'scanner-chips';
    
    // Will be populated based on context
    this.shadowRoot.querySelector('.badge-container').appendChild(this.container);
    
    // Create modal for results
    this.modal = document.createElement('div');
    this.modal.className = 'scanner-modal';
    this.shadowRoot.appendChild(this.modal);
    
    // Check context on load
    this.updateContext();
    
    // Re-check on significant DOM changes
    this.observePageChanges();
  }

  updateContext() {
    const context = this.scanner.quickContextProbe();
    
    this.container.innerHTML = '';
    this.container.classList.remove('visible');
    
    // Show chips if high confidence
    if (context.product > 0.7) {
      this.addProductChip();
      this.container.classList.add('visible');
    }
    
    if (context.health > 0.7) {
      this.addHealthChip();
      this.container.classList.add('visible');
    }
    
    // Debug mode shows all contexts
    if (window.SS_DEBUG) {
      console.log('SafeSignal Context:', context);
      if (context.product > 0.5 || context.health > 0.5) {
        this.container.classList.add('visible');
      }
    }
  }

  addProductChip() {
    const chip = document.createElement('button');
    chip.className = 'scanner-chip product';
    chip.innerHTML = `
      <span class="icon">🛍️</span>
      <span>Find Safer Deals</span>
    `;
    
    chip.addEventListener('click', async () => {
      await this.handleProductScan(chip);
    });
    
    this.container.appendChild(chip);
  }

  addHealthChip() {
    const chip = document.createElement('button');
    chip.className = 'scanner-chip health';
    chip.innerHTML = `
      <span class="icon">🔬</span>
      <span>Health Fact Check</span>
    `;
    
    chip.addEventListener('click', async () => {
      await this.handleHealthScan(chip);
    });
    
    this.container.appendChild(chip);
  }

  async handleProductScan(chip) {
    chip.classList.add('loading');
    chip.innerHTML = `<span class="icon">⏳</span><span>Scanning...</span>`;
    
    try {
      const result = await this.scanner.scanProduct();
      
      if (result.error) {
        this.showError(result.error);
      } else {
        this.showProductResults(result);
      }
    } catch (error) {
      this.showError('Could not scan for products');
    } finally {
      chip.classList.remove('loading');
      chip.innerHTML = `<span class="icon">🛍️</span><span>Find Safer Deals</span>`;
    }
  }

  async handleHealthScan(chip) {
    chip.classList.add('loading');
    chip.innerHTML = `<span class="icon">⏳</span><span>Checking...</span>`;
    
    try {
      const result = await this.scanner.scanHealth();
      
      if (result.error) {
        this.showError(result.error);
      } else {
        this.showHealthResults(result);
      }
    } catch (error) {
      this.showError('Could not check health claims');
    } finally {
      chip.classList.remove('loading');
      chip.innerHTML = `<span class="icon">🔬</span><span>Health Fact Check</span>`;
    }
  }

  showProductResults(result) {
    this.modal.innerHTML = `
      <div class="modal-header">
        <span class="modal-title">🛍️ Safer Deals Found</span>
        <span class="modal-close">×</span>
      </div>
      <div class="modal-body">
        ${result.matches.map(match => `
          <div class="product-match">
            <div class="match-retailer">${match.retailer}</div>
            <div class="match-price">$${match.price.toFixed(2)}</div>
            <div class="match-seller">Sold by: ${match.seller}</div>
            <a href="${match.url}" target="_blank">View →</a>
          </div>
        `).join('')}
        ${result.notes.map(note => `
          <div style="font-size: 11px; color: #666; margin-top: 8px;">
            ℹ️ ${note}
          </div>
        `).join('')}
      </div>
    `;
    
    this.showModal();
  }

  showHealthResults(result) {
    const verdictClass = `verdict-${result.verdict.replace('_', '')}`;
    
    this.modal.innerHTML = `
      <div class="modal-header">
        <span class="modal-title">🔬 Health Fact Check</span>
        <span class="modal-close">×</span>
      </div>
      <div class="modal-body">
        <div class="health-verdict ${verdictClass}">
          <strong>${result.topic}</strong><br>
          Verdict: ${result.verdict.replace('_', ' ')}
        </div>
        <div class="health-bullets">
          ${result.bullets.map(bullet => `
            <div class="health-bullet">• ${bullet}</div>
          `).join('')}
        </div>
        <div class="health-sources">
          <div style="font-size: 11px; color: #666; margin: 8px 0;">Trusted Sources:</div>
          ${result.sources.map(source => `
            <a href="${source.url}" target="_blank" class="health-source">
              ${source.name}
            </a>
          `).join('')}
        </div>
        ${result.supplement_flag ? `
          <div style="font-size: 11px; color: #ff6b35; margin-top: 8px;">
            ⚠️ Note: Supplement claims are less regulated by FDA
          </div>
        ` : ''}
      </div>
    `;
    
    this.showModal();
  }

  showError(message) {
    this.modal.innerHTML = `
      <div class="modal-header">
        <span class="modal-title">⚠️ Notice</span>
        <span class="modal-close">×</span>
      </div>
      <div class="modal-body">
        <p>${message}</p>
      </div>
    `;
    
    this.showModal();
  }

  showModal() {
    this.modal.classList.add('visible');
    
    // Close handler
    const closeBtn = this.modal.querySelector('.modal-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        this.modal.classList.remove('visible');
      });
    }
    
    // Close on outside click
    setTimeout(() => {
      const closeOnOutside = (e) => {
        if (!this.modal.contains(e.target)) {
          this.modal.classList.remove('visible');
          document.removeEventListener('click', closeOnOutside);
        }
      };
      document.addEventListener('click', closeOnOutside);
    }, 100);
  }

  observePageChanges() {
    // Watch for significant DOM changes
    const observer = new MutationObserver(() => {
      // Debounce updates
      clearTimeout(this.updateTimeout);
      this.updateTimeout = setTimeout(() => {
        this.updateContext();
      }, 1000);
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: false,
      characterData: false
    });
  }
}

// =========================================================================
// API CLIENT INTEGRATION
// =========================================================================

class APIClient {
  constructor(baseURL = 'http://localhost:8000') {
    this.baseURL = baseURL;
    this.token = null;
  }

  async post(endpoint, data) {
    const response = await fetch(this.baseURL + endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.token && { 'Authorization': `Bearer ${this.token}` })
      },
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      const error = new Error(`API Error: ${response.statusText}`);
      error.code = response.status === 504 ? 'TIMEOUT' : 'ERROR';
      throw error;
    }

    return response.json();
  }
}

// =========================================================================
// INITIALIZATION
// =========================================================================

function initializeScanners(shadowRoot, apiBaseURL = 'http://localhost:8000') {
  // Create API client
  const apiClient = new APIClient(apiBaseURL);
  
  // Create scanner
  const scanner = new PageScanner(apiClient);
  
  // Create UI
  const scannerUI = new ScannerUI(scanner, shadowRoot);
  
  // Export for debugging
  window.SafeSignalScanner = {
    scanner,
    ui: scannerUI,
    debug: () => {
      const context = scanner.quickContextProbe();
      console.log('Context:', context);
      console.log('Product hints:', scanner.extractProductHints());
      console.log('Health hints:', scanner.extractHealthHints());
    }
  };
  
  return { scanner, scannerUI };
}

// =========================================================================
// EXPORTS
// =========================================================================

// For module environments (webpack, etc)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PageScanner,
    ScannerUI,
    APIClient,
    initializeScanners
  };
}

// For browser global
if (typeof window !== 'undefined') {
  window.SafeSignalScanners = {
    PageScanner,
    ScannerUI,
    APIClient,
    initializeScanners
  };
}