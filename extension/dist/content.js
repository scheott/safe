/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ({

/***/ 63:
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   Q9: () => (/* binding */ APIClient),
/* harmony export */   Y7: () => (/* binding */ PageScanner),
/* harmony export */   vk: () => (/* binding */ ScannerUI)
/* harmony export */ });
// extension/src/content/scanners.js
// Phase 2.5 - Health & Product Scanning UI
// Connects to backend scan endpoints and displays results

const API_BASE_URL = 'http://localhost:8000'; // TODO: Update to production URL

// ============================================================================
// API CLIENT
// ============================================================================

class APIClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
  }
  
  async post(endpoint, data) {
    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data)
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      return await response.json();
      
    } catch (error) {
      console.error(`API call failed: ${endpoint}`, error);
      throw error;
    }
  }
}

// ============================================================================
// PAGE SCANNER - Detects context and calls appropriate endpoints
// ============================================================================

class PageScanner {
  constructor(apiClient) {
    this.api = apiClient;
    this.cache = new Map();
    this.cacheTimeout = 30 * 60 * 1000; // 30 minutes
  }
  
  // =========================================================================
  // CONTEXT DETECTION
  // =========================================================================
  
  detectProductContext() {
    const hints = {
      product_name: '',
      title: ''
    };
    
    // Try to extract product name from page
    const titleEl = document.querySelector('h1, [class*="product-title"], [class*="productTitle"]');
    if (titleEl) {
      hints.product_name = titleEl.textContent.trim();
    }
    
    // Fallback to page title
    hints.title = document.title;
    
    // Look for product indicators
    const isProduct = this._hasProductIndicators();
    
    return { hints, confidence: isProduct ? 0.8 : 0.3 };
  }
  
  detectHealthContext() {
    const hints = {
      title: '',
      claims_text: ''
    };
    
    // Get page title
    hints.title = document.title;
    
    // Get main content sample
    const mainContent = document.querySelector('main, article, [role="main"], .content');
    if (mainContent) {
      const text = mainContent.textContent.trim();
      hints.claims_text = text.substring(0, 500);
    }
    
    // Check for health indicators
    const isHealth = this._hasHealthIndicators();
    
    return { hints, confidence: isHealth ? 0.8 : 0.3 };
  }
  
  _hasProductIndicators() {
    const indicators = [
      document.querySelector('[class*="product"]'),
      document.querySelector('[class*="cart"]'),
      document.querySelector('[class*="price"]'),
      document.querySelector('[itemtype*="Product"]'),
      /buy|purchase|cart|price|\$\d+/i.test(document.body.textContent)
    ];
    
    return indicators.filter(Boolean).length >= 2;
  }
  
  _hasHealthIndicators() {
    const indicators = [
      /health|medical|symptom|disease|treatment|diagnosis/i.test(document.title),
      document.querySelector('[class*="health"], [class*="medical"]'),
      /CDC|NIH|Mayo Clinic|WebMD/i.test(document.body.textContent)
    ];
    
    return indicators.filter(Boolean).length >= 1;
  }
  
  // =========================================================================
  // SCAN METHODS
  // =========================================================================
  
  async scanProduct(url, mode = 'fast') {
    const cacheKey = `product:${url}`;
    
    // Check cache
    const cached = this.getCache(cacheKey);
    if (cached) {
      return cached;
    }
    
    // Detect product context
    const { hints } = this.detectProductContext();
    
    try {
      const response = await this.api.post('/api/scan/product', {
        url,
        hints,
        mode
      });
      
      // Cache successful response
      this.setCache(cacheKey, response);
      
      return response;
      
    } catch (error) {
      console.error('Product scan failed:', error);
      
      // Return error response
      return {
        product_name: hints.product_name,
        advisory: "Unable to check this site right now.",
        risk_signals: [],
        compare_links: this._getFallbackRetailers(hints.product_name),
        latency_ms: 0,
        from_cache: false,
        error: true
      };
    }
  }
  
  async scanHealth(url, mode = 'fast') {
    const cacheKey = `health:${url}`;
    
    // Check cache
    const cached = this.getCache(cacheKey);
    if (cached) {
      return cached;
    }
    
    // Detect health context
    const { hints } = this.detectHealthContext();
    
    try {
      const response = await this.api.post('/api/scan/health', {
        url,
        hints,
        mode
      });
      
      // Cache successful response
      this.setCache(cacheKey, response);
      
      return response;
      
    } catch (error) {
      console.error('Health scan failed:', error);
      
      // Return error response with fallback links
      return {
        topic: hints.title || 'health information',
        verdict: 'uncertain',
        bullets: [
          "We couldn't check health sources right now.",
          "Please use the trusted medical links below."
        ],
        citations: this._getFallbackHealthSources(hints.title),
        latency_ms: 0,
        from_cache: false,
        error: true
      };
    }
  }
  
  // =========================================================================
  // FALLBACK HELPERS
  // =========================================================================
  
  _getFallbackRetailers(productName) {
    const query = encodeURIComponent(productName || 'product search');
    return [
      { retailer: 'Amazon', url: `https://www.amazon.com/s?k=${query}` },
      { retailer: 'Target', url: `https://www.target.com/s?searchTerm=${query}` },
      { retailer: 'Walmart', url: `https://www.walmart.com/search?q=${query}` },
      { retailer: 'Google Shopping', url: `https://www.google.com/search?tbm=shop&q=${query}` }
    ];
  }
  
  _getFallbackHealthSources(topic) {
    const query = encodeURIComponent(topic || 'health');
    return [
      { name: 'CDC', url: `https://search.cdc.gov/search/?query=${query}` },
      { name: 'NIH', url: `https://search.nih.gov/search?q=${query}` },
      { name: 'Mayo Clinic', url: `https://www.mayoclinic.org/search/search-results?q=${query}` },
      { name: 'MedlinePlus', url: `https://medlineplus.gov/search.html?query=${query}` }
    ];
  }
  
  // =========================================================================
  // CACHE MANAGEMENT
  // =========================================================================
  
  getCache(key) {
    const item = this.cache.get(key);
    if (!item) return null;
    
    if (Date.now() > item.expires) {
      this.cache.delete(key);
      return null;
    }
    
    return item.data;
  }
  
  setCache(key, data) {
    this.cache.set(key, {
      data,
      expires: Date.now() + this.cacheTimeout
    });
    
    // Cleanup if cache gets too big
    if (this.cache.size > 100) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }
  }
}

// ============================================================================
// SCANNER UI - Modal rendering and interactions
// ============================================================================

class ScannerUI {
  constructor(scanner, shadowRoot) {
    this.scanner = scanner;
    this.shadowRoot = shadowRoot;
    this.activeModal = null;
    
    this.addStyles();
  }
  
  // =========================================================================
  // BUTTON CLICK HANDLERS
  // =========================================================================
  
  async handleHealthScan() {
    this.showLoadingModal('Checking trusted medical sources...');
    
    try {
      const response = await this.scanner.scanHealth(window.location.href, 'fast');
      this.showHealthResults(response);
      
    } catch (error) {
      this.showErrorModal('health', error);
    }
  }
  
  async handleProductScan() {
    this.showLoadingModal('Finding trusted retailers...');
    
    try {
      const response = await this.scanner.scanProduct(window.location.href, 'fast');
      this.showProductResults(response);
      
    } catch (error) {
      this.showErrorModal('product', error);
    }
  }
  
  // =========================================================================
  // RESULT RENDERING
  // =========================================================================
  
  showHealthResults(data) {
    const verdictEmoji = {
      'safe': '✅',
      'mixed': '⚠️',
      'harmful': '❌',
      'uncertain': '❓'
    };
    
    const modal = this.createModal();
    modal.innerHTML = `
      <div class="ss-modal-content ss-health">
        <div class="ss-modal-header">
          <h3>🩺 Health Information Check</h3>
          <button class="ss-close-btn" aria-label="Close">×</button>
        </div>
        
        <div class="ss-topic-badge">
          ${this.escapeHtml(data.topic)}
        </div>
        
        <div class="ss-verdict-badge ss-verdict-${data.verdict}">
          ${verdictEmoji[data.verdict]} ${this.formatVerdict(data.verdict)}
        </div>
        
        <div class="ss-summary">
          ${data.bullets.map(bullet => `
            <p class="ss-bullet">• ${this.escapeHtml(bullet)}</p>
          `).join('')}
        </div>
        
        <div class="ss-citations">
          <p class="ss-citations-label">Read more from trusted sources:</p>
          ${data.citations.map(citation => `
            <a href="${citation.url}" target="_blank" rel="noopener noreferrer" class="ss-citation-link">
              <span class="ss-citation-name">${this.escapeHtml(citation.name)}</span>
              <span class="ss-arrow">→</span>
            </a>
          `).join('')}
        </div>
        
        <p class="ss-disclaimer">
          ⚕️ This is informational only. Always consult a healthcare provider for medical advice.
        </p>
        
        ${data.from_cache ? '<p class="ss-cache-note">Previously checked result</p>' : ''}
      </div>
    `;
    
    this.attachModalHandlers(modal);
    this.showModal(modal);
  }
  
  showProductResults(data) {
    const modal = this.createModal();
    
    modal.innerHTML = `
      <div class="ss-modal-content ss-product">
        <div class="ss-modal-header">
          <h3>🛒 Compare Before You Buy</h3>
          <button class="ss-close-btn" aria-label="Close">×</button>
        </div>
        
        ${data.product_name ? `
          <div class="ss-product-name">
            ${this.escapeHtml(data.product_name)}
          </div>
        ` : ''}
        
        <p class="ss-advisory">${this.escapeHtml(data.advisory)}</p>
        
        ${data.risk_signals.length > 0 ? `
          <div class="ss-risk-signals">
            <p class="ss-risk-label">⚠️ We noticed on this page:</p>
            <div class="ss-risk-chips">
              ${data.risk_signals.map(signal => `
                <span class="ss-risk-chip">${this.escapeHtml(this.formatRiskSignal(signal))}</span>
              `).join('')}
            </div>
          </div>
        ` : ''}
        
        <div class="ss-compare-section">
          <p class="ss-compare-label">Compare on trusted retailers:</p>
          <div class="ss-retailer-buttons">
            ${data.compare_links.map(link => `
              <a href="${link.url}" target="_blank" rel="noopener noreferrer" class="ss-retailer-btn">
                ${this.getRetailerIcon(link.retailer)}
                <span>${this.escapeHtml(link.retailer)}</span>
              </a>
            `).join('')}
          </div>
        </div>
        
        ${data.from_cache ? '<p class="ss-cache-note">Previously checked result</p>' : ''}
      </div>
    `;
    
    this.attachModalHandlers(modal);
    this.showModal(modal);
  }
  
  showLoadingModal(message) {
    const modal = this.createModal();
    modal.innerHTML = `
      <div class="ss-modal-content ss-loading">
        <div class="ss-spinner"></div>
        <p>${this.escapeHtml(message)}</p>
      </div>
    `;
    
    this.showModal(modal);
    return modal;
  }
  
  showErrorModal(scanType, error) {
    const configs = {
      'health': {
        title: '🩺 Health Check Unavailable',
        body: "We couldn't check health sources right now. Please try again or check the trusted medical sites directly.",
        links: [
          { name: 'CDC', url: 'https://www.cdc.gov' },
          { name: 'NIH', url: 'https://www.nih.gov' },
          { name: 'Mayo Clinic', url: 'https://www.mayoclinic.org' }
        ]
      },
      'product': {
        title: '🛒 Comparison Unavailable',
        body: "We couldn't generate comparison links right now. Try searching directly on trusted retailers.",
        links: [
          { name: 'Amazon', url: 'https://www.amazon.com' },
          { name: 'Target', url: 'https://www.target.com' },
          { name: 'Walmart', url: 'https://www.walmart.com' }
        ]
      }
    };
    
    const config = configs[scanType];
    const modal = this.createModal();
    
    modal.innerHTML = `
      <div class="ss-modal-content ss-error">
        <div class="ss-modal-header">
          <h3>${config.title}</h3>
          <button class="ss-close-btn" aria-label="Close">×</button>
        </div>
        <p class="ss-error-body">${config.body}</p>
        <div class="ss-fallback-links">
          ${config.links.map(link => `
            <a href="${link.url}" target="_blank" rel="noopener noreferrer">
              ${this.escapeHtml(link.name)} →
            </a>
          `).join('')}
        </div>
        <button class="ss-retry-btn">Try Again</button>
      </div>
    `;
    
    this.attachModalHandlers(modal, scanType);
    this.showModal(modal);
  }
  
  // =========================================================================
  // MODAL MANAGEMENT
  // =========================================================================
  
  createModal() {
    const modal = document.createElement('div');
    modal.className = 'ss-modal-overlay';
    return modal;
  }
  
  showModal(modal) {
    // Remove any existing modal
    if (this.activeModal) {
      this.activeModal.remove();
    }
    
    // Add to shadow root
    this.shadowRoot.appendChild(modal);
    this.activeModal = modal;
    
    // Animate in
    requestAnimationFrame(() => {
      modal.classList.add('ss-visible');
    });
  }
  
  closeModal() {
    if (this.activeModal) {
      this.activeModal.classList.remove('ss-visible');
      setTimeout(() => {
        this.activeModal?.remove();
        this.activeModal = null;
      }, 200);
    }
  }
  
  attachModalHandlers(modal, scanType = null) {
    // Close button
    const closeBtn = modal.querySelector('.ss-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.closeModal());
    }
    
    // Click outside to close
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        this.closeModal();
      }
    });
    
    // Retry button
    const retryBtn = modal.querySelector('.ss-retry-btn');
    if (retryBtn && scanType) {
      retryBtn.addEventListener('click', () => {
        if (scanType === 'health') {
          this.handleHealthScan();
        } else if (scanType === 'product') {
          this.handleProductScan();
        }
      });
    }
    
    // Escape key to close
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        this.closeModal();
        document.removeEventListener('keydown', handleEscape);
      }
    };
    document.addEventListener('keydown', handleEscape);
  }
  
  // =========================================================================
  // FORMATTING HELPERS
  // =========================================================================
  
  formatVerdict(verdict) {
    const labels = {
      'safe': 'Generally Safe',
      'mixed': 'Mixed Evidence',
      'harmful': 'Potentially Harmful',
      'uncertain': 'More Research Needed'
    };
    return labels[verdict] || verdict;
  }
  
  formatRiskSignal(signal) {
    const labels = {
      'clickbait_headline': 'Sensational language',
      'offsite_form': 'Unusual checkout',
      'suspicious_domain': 'Unfamiliar website',
      'aggressive_timer': 'Countdown timer',
      'low_domain_rep': 'Unknown site',
      'suspicious_tld': 'Suspicious domain',
      'punycode_domain': 'Look-alike domain'
    };
    return labels[signal] || signal.replace(/_/g, ' ');
  }
  
  getRetailerIcon(retailer) {
    const icons = {
      'Amazon': '📦',
      'Target': '🎯',
      'Walmart': '🏪',
      'Google Shopping': '🔍'
    };
    return icons[retailer] || '🛍️';
  }
  
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  // =========================================================================
  // STYLES
  // =========================================================================
  
  addStyles() {
    const style = document.createElement('style');
    style.textContent = `
      /* Modal Overlay */
      .ss-modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2147483647;
        opacity: 0;
        transition: opacity 0.2s ease;
      }
      
      .ss-modal-overlay.ss-visible {
        opacity: 1;
      }
      
      /* Modal Content */
      .ss-modal-content {
        background: white;
        border-radius: 16px;
        padding: 24px;
        max-width: 480px;
        width: 90%;
        max-height: 80vh;
        overflow-y: auto;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
        transform: scale(0.9);
        transition: transform 0.2s ease;
      }
      
      .ss-visible .ss-modal-content {
        transform: scale(1);
      }
      
      /* Modal Header */
      .ss-modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 16px;
        padding-bottom: 12px;
        border-bottom: 2px solid #e0e0e0;
      }
      
      .ss-modal-header h3 {
        margin: 0;
        font-size: 20px;
        font-weight: 600;
        color: #333;
      }
      
      .ss-close-btn {
        background: none;
        border: none;
        font-size: 28px;
        color: #666;
        cursor: pointer;
        padding: 0;
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        transition: background 0.2s;
      }
      
      .ss-close-btn:hover {
        background: #f0f0f0;
      }
      
      /* Health Results */
      .ss-topic-badge {
        background: #e3f2fd;
        color: #1565c0;
        padding: 8px 12px;
        border-radius: 8px;
        font-weight: 500;
        margin-bottom: 12px;
        font-size: 14px;
      }
      
      .ss-verdict-badge {
        padding: 10px 16px;
        border-radius: 8px;
        font-weight: 600;
        margin-bottom: 16px;
        text-align: center;
        font-size: 16px;
      }
      
      .ss-verdict-safe {
        background: #e8f5e9;
        color: #2e7d32;
      }
      
      .ss-verdict-mixed {
        background: #fff3e0;
        color: #e65100;
      }
      
      .ss-verdict-harmful {
        background: #ffebee;
        color: #c62828;
      }
      
      .ss-verdict-uncertain {
        background: #f5f5f5;
        color: #616161;
      }
      
      .ss-summary {
        margin-bottom: 16px;
      }
      
      .ss-bullet {
        margin: 8px 0;
        font-size: 15px;
        line-height: 1.6;
        color: #424242;
      }
      
      .ss-citations {
        margin-top: 20px;
        padding-top: 16px;
        border-top: 1px solid #e0e0e0;
      }
      
      .ss-citations-label {
        font-weight: 600;
        margin-bottom: 12px;
        color: #424242;
        font-size: 14px;
      }
      
      .ss-citation-link {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 12px;
        background: #f5f5f5;
        border-radius: 8px;
        margin-bottom: 8px;
        text-decoration: none;
        color: #1976d2;
        transition: all 0.2s;
      }
      
      .ss-citation-link:hover {
        background: #e3f2fd;
        transform: translateX(4px);
      }
      
      .ss-citation-name {
        font-weight: 500;
      }
      
      .ss-arrow {
        font-size: 18px;
      }
      
      .ss-disclaimer {
        margin-top: 16px;
        padding: 12px;
        background: #fff9c4;
        border-radius: 8px;
        font-size: 13px;
        color: #827717;
        line-height: 1.5;
      }
      
      /* Product Results */
      .ss-product-name {
        font-size: 18px;
        font-weight: 600;
        color: #333;
        margin-bottom: 12px;
        padding: 12px;
        background: #f5f5f5;
        border-radius: 8px;
      }
      
      .ss-advisory {
        font-size: 15px;
        color: #424242;
        margin-bottom: 16px;
        line-height: 1.6;
      }
      
      .ss-risk-signals {
        margin-bottom: 20px;
        padding: 12px;
        background: #fff3e0;
        border-radius: 8px;
      }
      
      .ss-risk-label {
        font-weight: 600;
        color: #e65100;
        margin-bottom: 8px;
        font-size: 14px;
      }
      
      .ss-risk-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      
      .ss-risk-chip {
        display: inline-block;
        padding: 4px 10px;
        background: white;
        border: 1px solid #ffb74d;
        border-radius: 12px;
        font-size: 12px;
        color: #e65100;
      }
      
      .ss-compare-section {
        margin-top: 20px;
        padding-top: 16px;
        border-top: 1px solid #e0e0e0;
      }
      
      .ss-compare-label {
        font-weight: 600;
        margin-bottom: 12px;
        color: #424242;
        font-size: 14px;
      }
      
      .ss-retailer-buttons {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }
      
      .ss-retailer-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 12px;
        background: white;
        border: 2px solid #e0e0e0;
        border-radius: 8px;
        text-decoration: none;
        color: #424242;
        font-weight: 500;
        font-size: 14px;
        transition: all 0.2s;
      }
      
      .ss-retailer-btn:hover {
        border-color: #1976d2;
        background: #e3f2fd;
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
      }
      
      /* Loading State */
      .ss-loading {
        text-align: center;
        padding: 40px 24px;
      }
      
      .ss-spinner {
        width: 48px;
        height: 48px;
        border: 4px solid #e0e0e0;
        border-top-color: #1976d2;
        border-radius: 50%;
        animation: ss-spin 0.8s linear infinite;
        margin: 0 auto 16px;
      }
      
      @keyframes ss-spin {
        to { transform: rotate(360deg); }
      }
      
      .ss-loading p {
        color: #666;
        font-size: 15px;
      }
      
      /* Error State */
      .ss-error-body {
        font-size: 15px;
        color: #424242;
        line-height: 1.6;
        margin-bottom: 16px;
      }
      
      .ss-fallback-links {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-bottom: 16px;
      }
      
      .ss-fallback-links a {
        padding: 10px 12px;
        background: #f5f5f5;
        border-radius: 8px;
        text-decoration: none;
        color: #1976d2;
        font-weight: 500;
        transition: all 0.2s;
      }
      
      .ss-fallback-links a:hover {
        background: #e3f2fd;
      }
      
      .ss-retry-btn {
        width: 100%;
        padding: 12px;
        background: #1976d2;
        color: white;
        border: none;
        border-radius: 8px;
        font-weight: 600;
        font-size: 15px;
        cursor: pointer;
        transition: background 0.2s;
      }
      
      .ss-retry-btn:hover {
        background: #1565c0;
      }
      
      /* Cache Note */
      .ss-cache-note {
        margin-top: 12px;
        font-size: 12px;
        color: #9e9e9e;
        text-align: center;
      }
      
      /* Scrollbar Styling */
      .ss-modal-content::-webkit-scrollbar {
        width: 8px;
      }
      
      .ss-modal-content::-webkit-scrollbar-track {
        background: #f5f5f5;
        border-radius: 4px;
      }
      
      .ss-modal-content::-webkit-scrollbar-thumb {
        background: #bdbdbd;
        border-radius: 4px;
      }
      
      .ss-modal-content::-webkit-scrollbar-thumb:hover {
        background: #9e9e9e;
      }
    `;
    
    this.shadowRoot.appendChild(style);
  }
}

// ============================================================================
// EXPORTS
// ============================================================================



/***/ }),

/***/ 264:
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   A: () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
class ChipCooldown {
  constructor() {
    // Cooldown periods
    this.urlCooldown = 30 * 60 * 1000;      // 30 minutes for same URL
    this.originCooldown = 24 * 60 * 60 * 1000; // 24 hours for dismissed origins
  }
  
  /**
   * Check all cooldowns for a chip type
   * @returns {object} { blocked: boolean, reason?: string }
   */
  async checkCooldowns(chipType) {
    // Check same-URL cooldown
    const urlCooldown = await this.isOnUrlCooldown(chipType);
    if (urlCooldown) {
      return { blocked: true, reason: 'url_cooldown' };
    }
    
    // Check origin dismissal
    const dismissed = await this.isDismissedOnOrigin(chipType);
    if (dismissed) {
      return { blocked: true, reason: 'user_dismissed' };
    }
    
    return { blocked: false };
  }
  
  /**
   * Check if chip is on URL cooldown
   */
  async isOnUrlCooldown(chipType) {
    const url = window.location.href;
    const cooldownKey = `chip_cooldown:${chipType}:${url}`;
    
    try {
      const result = await chrome.storage.local.get(cooldownKey);
      const lastShown = result[cooldownKey];
      
      if (!lastShown) return false;
      
      const now = Date.now();
      const remaining = (lastShown + this.urlCooldown) - now;
      
      if (remaining > 0) {
        console.log(`[ChipCooldown] ${chipType} on cooldown for ${Math.round(remaining/1000)}s`);
        
        // Track analytics
        this.trackEvent('chip_cooldown_active', {
          chipType,
          cooldownType: 'same_url',
          remainingMs: remaining
        });
        
        return true;
      }
      
      // Cooldown expired, remove it
      await chrome.storage.local.remove(cooldownKey);
      return false;
      
    } catch (error) {
      console.error('[ChipCooldown] Error checking URL cooldown:', error);
      return false;
    }
  }
  
  /**
   * Set URL cooldown for a chip
   */
  async setUrlCooldown(chipType) {
    const url = window.location.href;
    const cooldownKey = `chip_cooldown:${chipType}:${url}`;
    
    try {
      await chrome.storage.local.set({
        [cooldownKey]: Date.now()
      });
      
      console.log(`[ChipCooldown] Set ${chipType} cooldown for 30min`);
      
      this.trackEvent('chip_cooldown_set', {
        chipType,
        url,
        duration: '30min'
      });
      
    } catch (error) {
      console.error('[ChipCooldown] Error setting URL cooldown:', error);
    }
  }
  
  /**
   * Check if chip is dismissed on this origin
   */
  async isDismissedOnOrigin(chipType) {
    const origin = window.location.origin;
    const dismissalKey = `chip_dismissed:${chipType}:${origin}`;
    
    try {
      const result = await chrome.storage.local.get(dismissalKey);
      const dismissedAt = result[dismissalKey];
      
      if (!dismissedAt) return false;
      
      const now = Date.now();
      const remaining = (dismissedAt + this.originCooldown) - now;
      
      if (remaining > 0) {
        console.log(`[ChipCooldown] ${chipType} dismissed on origin for ${Math.round(remaining/3600000)}h`);
        return true;
      }
      
      // Dismissal expired, remove it
      await chrome.storage.local.remove(dismissalKey);
      return false;
      
    } catch (error) {
      console.error('[ChipCooldown] Error checking dismissal:', error);
      return false;
    }
  }
  
  /**
   * Dismiss chip on origin for 24 hours
   */
  async dismissChipOnOrigin(chipType) {
    const origin = window.location.origin;
    const dismissalKey = `chip_dismissed:${chipType}:${origin}`;
    
    try {
      await chrome.storage.local.set({
        [dismissalKey]: Date.now()
      });
      
      console.log(`[ChipCooldown] Dismissed ${chipType} on ${origin} for 24h`);
      
      this.trackEvent('chip_dismissed_by_user', {
        chipType,
        origin,
        duration: '24h'
      });
      
    } catch (error) {
      console.error('[ChipCooldown] Error setting dismissal:', error);
    }
  }
  
  /**
   * Unhide chip on origin (called from badge menu)
   */
  async unhideChipOnOrigin(chipType) {
    const origin = window.location.origin;
    const dismissalKey = `chip_dismissed:${chipType}:${origin}`;
    
    try {
      await chrome.storage.local.remove(dismissalKey);
      
      console.log(`[ChipCooldown] Unhid ${chipType} on ${origin}`);
      
      this.trackEvent('chip_unhidden_by_user', {
        chipType,
        origin
      });
      
      // Trigger re-evaluation
      if (window.chipManager) {
        window.chipManager.reevaluate(chipType);
      }
      
    } catch (error) {
      console.error('[ChipCooldown] Error unhiding:', error);
    }
  }
  
  /**
   * Get dismissal status for badge menu
   */
  async getDismissalStatus() {
    const origin = window.location.origin;
    
    const [healthDismissed, productDismissed] = await Promise.all([
      this.isDismissedOnOrigin('health'),
      this.isDismissedOnOrigin('product')
    ]);
    
    return {
      health: healthDismissed,
      product: productDismissed,
      origin
    };
  }
  
  /**
   * Track analytics event
   */
  trackEvent(eventName, data) {
    console.log(`[ChipCooldown] ${eventName}:`, data);
    
    if (typeof analytics !== 'undefined' && analytics.track) {
      analytics.track(eventName, data);
    }
  }
}

// Export classes
/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (ChipCooldown);

/***/ }),

/***/ 295:
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   A: () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
// extension/src/components/AssistModal.js
// User confirmation modal for borderline/generic subjects

class AssistModal {
  constructor() {
    this.modal = null;
    this.callback = null;
    this.chipType = null;
  }
  
  /**
   * Show the assist modal
   * @param {string} chipType - 'product' or 'health'
   * @param {string} subject - Pre-filled subject
   * @param {function} callback - Called with { action: 'confirm'|'dismiss', subject: string }
   */
  show(chipType, subject, callback) {
    this.chipType = chipType;
    this.callback = callback;
    
    // Remove any existing modal
    this.hide();
    
    // Create modal
    this.createModal(chipType, subject);
    
    // Add to page (inside shadow DOM if available)
    const shadowRoot = document.getElementById('safesignal-host')?.shadowRoot;
    if (shadowRoot) {
      shadowRoot.appendChild(this.modal);
    } else {
      document.body.appendChild(this.modal);
    }
    
    // Focus input
    const input = this.modal.querySelector('#assist-subject-input');
    if (input) {
      input.focus();
      input.select();
    }
    
    // Track analytics
    this.trackEvent('chip_assist_shown', {
      chipType,
      subject,
      reason: 'needs_confirmation'
    });
  }
  
  /**
   * Hide the modal
   */
  hide() {
    if (this.modal && this.modal.parentNode) {
      this.modal.parentNode.removeChild(this.modal);
    }
    this.modal = null;
    this.callback = null;
    this.chipType = null;
  }
  
  /**
   * Create the modal DOM
   */
  createModal(chipType, subject) {
    const modal = document.createElement('div');
    modal.className = 'assist-modal-overlay';
    
    // Determine button text based on chip type
    const buttonText = chipType === 'health' ? 'Check with CDC/NIH' : 'Check this product';
    const placeholder = chipType === 'health' ? 'e.g., Intermittent fasting' : 'e.g., Sony WH-1000XM5';
    
    modal.innerHTML = `
      <div class="assist-modal">
        <div class="assist-modal-header">
          What should we check?
        </div>
        <div class="assist-modal-body">
          <input 
            type="text" 
            id="assist-subject-input"
            class="assist-input"
            value="${this.escapeHtml(subject)}"
            placeholder="${placeholder}"
            maxlength="100"
          />
        </div>
        <div class="assist-modal-footer">
          <button class="assist-btn assist-btn-primary" id="assist-confirm">
            ${buttonText}
          </button>
          <button class="assist-btn assist-btn-secondary" id="assist-dismiss">
            Not now
          </button>
        </div>
      </div>
    `;
    
    // Add styles
    this.addStyles(modal);
    
    // Add event listeners
    this.attachEventListeners(modal, subject);
    
    this.modal = modal;
  }
  
  /**
   * Add modal styles
   */
  addStyles(modal) {
    const style = document.createElement('style');
    style.textContent = `
      .assist-modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2147483647;
        animation: fadeIn 0.2s ease;
      }
      
      .assist-modal {
        background: white;
        border-radius: 12px;
        padding: 20px;
        max-width: 400px;
        width: 90%;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
        animation: slideIn 0.3s ease;
      }
      
      .assist-modal-header {
        font-size: 18px;
        font-weight: 600;
        color: #1a1a1a;
        margin-bottom: 16px;
      }
      
      .assist-modal-body {
        margin-bottom: 20px;
      }
      
      .assist-input {
        width: 100%;
        padding: 12px 16px;
        font-size: 16px;
        border: 2px solid #e0e0e0;
        border-radius: 8px;
        outline: none;
        transition: border-color 0.2s;
      }
      
      .assist-input:focus {
        border-color: #2196f3;
      }
      
      .assist-modal-footer {
        display: flex;
        gap: 12px;
        justify-content: flex-end;
      }
      
      .assist-btn {
        padding: 10px 20px;
        font-size: 15px;
        font-weight: 600;
        border-radius: 8px;
        border: none;
        cursor: pointer;
        transition: all 0.2s;
        outline: none;
      }
      
      .assist-btn-primary {
        background: #2196f3;
        color: white;
      }
      
      .assist-btn-primary:hover {
        background: #1976d2;
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(33, 150, 243, 0.3);
      }
      
      .assist-btn-secondary {
        background: #f5f5f5;
        color: #666;
      }
      
      .assist-btn-secondary:hover {
        background: #e0e0e0;
      }
      
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      
      @keyframes slideIn {
        from { 
          transform: translateY(-20px);
          opacity: 0;
        }
        to {
          transform: translateY(0);
          opacity: 1;
        }
      }
    `;
    
    modal.appendChild(style);
  }
  
  /**
   * Attach event listeners to modal
   */
  attachEventListeners(modal, originalSubject) {
    const confirmBtn = modal.querySelector('#assist-confirm');
    const dismissBtn = modal.querySelector('#assist-dismiss');
    const input = modal.querySelector('#assist-subject-input');
    
    // Confirm button
    confirmBtn.addEventListener('click', () => {
      const newSubject = input.value.trim();
      if (newSubject) {
        const edited = newSubject !== originalSubject;
        
        this.trackEvent('chip_assist_confirmed', {
          chipType: this.chipType,
          originalSubject,
          confirmedSubject: newSubject,
          edited
        });
        
        if (this.callback) {
          this.callback({ action: 'confirm', subject: newSubject, edited });
        }
        
        this.hide();
      }
    });
    
    // Dismiss button
    dismissBtn.addEventListener('click', () => {
      this.trackEvent('chip_assist_dismissed', {
        chipType: this.chipType,
        subject: originalSubject
      });
      
      if (this.callback) {
        this.callback({ action: 'dismiss', subject: originalSubject });
      }
      
      this.hide();
    });
    
    // Enter key confirms
    input.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') {
        confirmBtn.click();
      } else if (e.key === 'Escape') {
        dismissBtn.click();
      }
    });
    
    // Click outside closes
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        dismissBtn.click();
      }
    });
  }
  
  /**
   * Helper: Escape HTML
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  /**
   * Helper: Track analytics event
   */
  trackEvent(eventName, data) {
    // Console logging for development
    console.log(`[AssistModal] ${eventName}:`, data);
    
    // Send to analytics if available
    if (typeof analytics !== 'undefined' && analytics.track) {
      analytics.track(eventName, data);
    }
  }
}

// Export for use in chipManager
/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (AssistModal);

/***/ }),

/***/ 317:
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   A: () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
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
/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (IntentScorer);

/***/ }),

/***/ 354:
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   A: () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _pageClassifier_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(737);
/* harmony import */ var _intentScorer_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(317);
/* harmony import */ var _subjectExtractor_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(431);
/* harmony import */ var _components_AssistModal_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(295);
/* harmony import */ var _chipCache_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(423);
/* harmony import */ var _chipCooldown_js__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(264);
// extension/src/services/chipManager.js
// Orchestrates all 3 gates and controls chip visibility
// IMPORTANT: Never affects badge - badge always shows








class ChipManager {
  constructor() {
    // Gate services
    this.pageClassifier = new _pageClassifier_js__WEBPACK_IMPORTED_MODULE_0__/* ["default"] */ .A();
    this.intentScorer = new _intentScorer_js__WEBPACK_IMPORTED_MODULE_1__/* ["default"] */ .A();
    this.subjectExtractor = new _subjectExtractor_js__WEBPACK_IMPORTED_MODULE_2__/* ["default"] */ .A();
    
    // UI components
    this.assistModal = new _components_AssistModal_js__WEBPACK_IMPORTED_MODULE_3__/* ["default"] */ .A();
    
    // Caching & cooldowns
    this.cache = new _chipCache_js__WEBPACK_IMPORTED_MODULE_4__/* ["default"] */ .A();
    this.cooldown = new _chipCooldown_js__WEBPACK_IMPORTED_MODULE_5__/* ["default"] */ .A();
    
    // Analytics tracking
    this.lastIntentScores = {
      product: null,
      health: null
    };
    
    // Current chip states
    this.chipStates = {
      product: { visible: false, subject: null },
      health: { visible: false, subject: null }
    };
  }
  
  /**
   * Main entry point - evaluate if chips should be shown
   * Called on page load and SPA navigation
   */
  async evaluateChips() {
    console.log('[ChipManager] ========== EVALUATING CHIPS ==========');
    const startTime = performance.now();
    
    // Run both chip evaluations in parallel
    const [productResult, healthResult] = await Promise.all([
      this.shouldShowChip('product'),
      this.shouldShowChip('health')
    ]);
    
    const evalTime = performance.now() - startTime;
    console.log(`[ChipManager] Evaluation complete in ${evalTime.toFixed(0)}ms`, {
      product: productResult,
      health: healthResult
    });
    
    // Update UI based on results
    this.updateChipDisplay('product', productResult);
    this.updateChipDisplay('health', healthResult);
  }
  
  /**
   * Determine if a chip should be shown (runs all 3 gates)
   * @param {string} chipType - 'product' or 'health'
   * @returns {object} { show: boolean, state: string, subject?: string, reason?: string }
   */
  async shouldShowChip(chipType) {
    console.log(`[ChipManager] Checking ${chipType} chip...`);
    
    // ==================== GATE 0: Page Type ====================
    const pageType = this.pageClassifier.classify();
    console.log(`[ChipManager] Gate 0 - Page type: ${pageType}`);
    
    // Block chips on SERPs, portals, and ambiguous pages
    if (['serp', 'portal', 'ambiguous'].includes(pageType)) {
      this.trackGateBlocked(0, chipType, 'wrong_page_type', { pageType });
      return { show: false, reason: 'wrong_page_type', pageType };
    }
    
    // Check page type matches chip type
    if (chipType === 'product' && pageType !== 'product') {
      this.trackGateBlocked(0, chipType, 'not_product_page', { pageType });
      return { show: false, reason: 'not_product_page' };
    }
    
    if (chipType === 'health' && pageType !== 'article') {
      this.trackGateBlocked(0, chipType, 'not_health_article', { pageType });
      return { show: false, reason: 'not_health_article' };
    }
    
    // ==================== CHECK COOLDOWNS ====================
    // Before Gate 1, check if we're on cooldown
    const cooldownStatus = await this.cooldown.checkCooldowns(chipType);
    if (cooldownStatus.blocked) {
      console.log(`[ChipManager] ${chipType} chip on cooldown:`, cooldownStatus.reason);
      return { show: false, reason: cooldownStatus.reason };
    }
    
    // ==================== GATE 1: Intent Score ====================
    const intentResult = chipType === 'product' 
      ? await this.intentScorer.scoreProductIntent()
      : await this.intentScorer.scoreHealthIntent();
    
    const { score, threshold, signals } = intentResult;
    this.lastIntentScores[chipType] = score;
    
    console.log(`[ChipManager] Gate 1 - Intent score: ${score.toFixed(2)} (threshold: ${threshold})`);
    
    // Log borderline cases for future tuning
    if (score >= 0.55 && score < threshold) {
      console.warn(`[ChipManager] BORDERLINE ${chipType} case:`, {
        score,
        threshold,
        gap: threshold - score,
        url: window.location.href
      });
    }
    
    // Check if intent is too low
    if (score < threshold) {
      this.trackGateBlocked(1, chipType, 'low_intent', { score, threshold, signals });
      return { show: false, reason: 'low_intent', score };
    }
    
    // ==================== GATE 2: Subject Specificity ====================
    const extraction = await this.subjectExtractor.extractSubject(chipType);
    console.log(`[ChipManager] Gate 2 - Subject extraction:`, extraction);
    
    // If extraction failed completely
    if (!extraction.subject) {
      this.trackGateBlocked(2, chipType, 'no_subject', {});
      return { show: false, reason: 'no_subject' };
    }
    
    // If subject needs confirmation (generic/borderline)
    if (extraction.needsConfirm) {
      this.trackGateBlocked(2, chipType, 'needs_confirmation', {
        subject: extraction.subject,
        failReason: extraction.failReason
      });
      
      // Show assist modal for user confirmation
      return {
        show: true,
        state: 'needs_confirm',
        subject: extraction.subject,
        failReason: extraction.failReason
      };
    }
    
    // ==================== ALL GATES PASSED ====================
    this.trackGatesPassed(chipType, score, extraction.subject);
    
    // Set cooldown for this URL
    await this.cooldown.setUrlCooldown(chipType);
    
    return {
      show: true,
      state: 'ready',
      subject: extraction.subject,
      confidence: extraction.confidence
    };
  }
  
  /**
   * Update chip display based on evaluation result
   */
  updateChipDisplay(chipType, result) {
    const chipElement = this.getChipElement(chipType);
    if (!chipElement) return;
    
    if (!result.show) {
      // Hide chip
      chipElement.style.display = 'none';
      chipElement.classList.remove('visible');
      this.chipStates[chipType] = { visible: false, subject: null };
      
    } else if (result.state === 'needs_confirm') {
      // Show assist modal
      chipElement.style.display = 'none'; // Hide chip until confirmed
      
      this.assistModal.show(chipType, result.subject, (response) => {
        if (response.action === 'confirm') {
          // User confirmed - show chip with edited subject
          this.showChipWithSubject(chipType, response.subject);
        } else {
          // User dismissed - set dismissal cooldown
          this.cooldown.dismissChipOnOrigin(chipType);
        }
      });
      
    } else if (result.state === 'ready') {
      // Show chip immediately
      this.showChipWithSubject(chipType, result.subject);
    }
  }
  
  /**
   * Show chip with specific subject
   */
  showChipWithSubject(chipType, subject) {
    const chipElement = this.getChipElement(chipType);
    if (!chipElement) return;
    
    // Update chip content if needed
    const subjectSpan = chipElement.querySelector('.chip-subject');
    if (subjectSpan) {
      subjectSpan.textContent = this.truncateSubject(subject);
    }
    
    // Show chip
    chipElement.style.display = 'flex';
    chipElement.classList.add('visible');
    chipElement.setAttribute('data-subject', subject);
    
    this.chipStates[chipType] = { visible: true, subject };
    
    // Update chips wrapper visibility
    this.updateChipsWrapperVisibility();
    
    console.log(`[ChipManager] ${chipType} chip shown with subject: ${subject}`);
  }
  
  /**
   * Get chip DOM element
   */
    getChipElement(chipType) {
        // Get from the callbacks provided by content.js
        if (this.chipElements && this.chipElements[chipType]) {
            return this.chipElements[chipType]();
        }
        return null;
    }
  
  /**
   * Update chips wrapper visibility
   */
    updateChipsWrapperVisibility() {
        if (this.chipElements && this.chipElements.wrapper) {
            const wrapper = this.chipElements.wrapper();
            if (!wrapper) return;
            
            const hasVisibleChips = this.chipStates.product.visible || this.chipStates.health.visible;
            
            if (hasVisibleChips) {
                wrapper.classList.add('visible');
            } else {
                wrapper.classList.remove('visible');
            }
        }
    }
  
  /**
   * Truncate subject for display
   */
  truncateSubject(subject) {
    const maxLength = 40;
    if (subject.length <= maxLength) return subject;
    return subject.substring(0, maxLength - 3) + '...';
  }
  
  /**
   * Re-evaluate chips (called after unhide or variant change)
   */
  async reevaluate(chipType = null) {
    console.log(`[ChipManager] Re-evaluating ${chipType || 'all'} chips`);
    
    if (chipType) {
      // Re-evaluate specific chip
      const result = await this.shouldShowChip(chipType);
      this.updateChipDisplay(chipType, result);
    } else {
      // Re-evaluate all chips
      await this.evaluateChips();
    }
  }
  
  /**
   * Handle variant change (product pages)
   */
  async handleVariantChange() {
    console.log('[ChipManager] Variant changed, clearing product cache');
    
    // Clear product cache for this page
    await this.cache.clearProductCache(window.location.hostname);
    
    // Re-evaluate product chip
    await this.reevaluate('product');
    
    this.trackEvent('product_variant_changed', {
      hostname: window.location.hostname,
      triggerReason: 'user_selected_variant'
    });
  }
  
  /**
   * Get last intent score (for debugging)
   */
  getLastIntentScore(chipType) {
    return this.lastIntentScores[chipType];
  }
  
  // ==================== ANALYTICS TRACKING ====================
  
  trackGateBlocked(gate, chipType, reason, details) {
    const event = {
      gate,
      chipType,
      reason,
      ...details,
      url: window.location.href,
      timestamp: new Date().toISOString()
    };
    
    console.log(`[ChipManager] Gate ${gate} blocked:`, event);
    
    if (typeof analytics !== 'undefined' && analytics.track) {
      analytics.track('chip_gate_blocked', event);
    }
  }
  
  trackGatesPassed(chipType, score, subject) {
    const event = {
      chipType,
      score,
      subject,
      url: window.location.href,
      timestamp: new Date().toISOString()
    };
    
    console.log('[ChipManager] All gates passed:', event);
    
    if (typeof analytics !== 'undefined' && analytics.track) {
      analytics.track('chip_gates_passed', event);
    }
  }
  
  trackEvent(eventName, data) {
    console.log(`[ChipManager] ${eventName}:`, data);
    
    if (typeof analytics !== 'undefined' && analytics.track) {
      analytics.track(eventName, data);
    }
  }
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (ChipManager);

/***/ }),

/***/ 423:
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   A: () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
// extension/src/services/chipCache.js
// Caching service for chip scan results

class ChipCache {
  constructor() {
    this.cacheTimeout = 30 * 60 * 1000; // 30 minutes
    this.storageKey = 'safesignal_scan_cache';
  }
  
  /**
   * Get cache key for a scan
   */
  getCacheKey(chipType, subject, variant = null) {
    const hostname = window.location.hostname;
    const normalizedSubject = this.normalizeForCache(subject);
    const variantSuffix = variant ? `:${this.normalizeForCache(variant)}` : '';
    
    return `${chipType}_scan:${hostname}:${normalizedSubject}${variantSuffix}`;
  }
  
  /**
   * Normalize text for cache key
   */
  normalizeForCache(text) {
    if (!text) return '';
    return text.toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }
  
  /**
   * Get cached scan result
   */
  async getCachedScan(cacheKey) {
    try {
      const result = await chrome.storage.local.get(this.storageKey);
      const cache = result[this.storageKey] || {};
      
      const entry = cache[cacheKey];
      if (!entry) return null;
      
      // Check expiry
      const now = Date.now();
      if (now - entry.timestamp > this.cacheTimeout) {
        // Expired, remove it
        delete cache[cacheKey];
        await chrome.storage.local.set({ [this.storageKey]: cache });
        return null;
      }
      
      console.log('[ChipCache] Cache hit:', cacheKey);
      return entry.data;
      
    } catch (error) {
      console.error('[ChipCache] Error reading cache:', error);
      return null;
    }
  }
  
  /**
   * Set cached scan result
   */
  async setCachedScan(cacheKey, data) {
    try {
      const result = await chrome.storage.local.get(this.storageKey);
      const cache = result[this.storageKey] || {};
      
      cache[cacheKey] = {
        data,
        timestamp: Date.now()
      };
      
      // Limit cache size (keep most recent 50 entries)
      const entries = Object.entries(cache);
      if (entries.length > 50) {
        entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
        const keepEntries = entries.slice(0, 50);
        const newCache = Object.fromEntries(keepEntries);
        await chrome.storage.local.set({ [this.storageKey]: newCache });
      } else {
        await chrome.storage.local.set({ [this.storageKey]: cache });
      }
      
      console.log('[ChipCache] Cached result:', cacheKey);
      
    } catch (error) {
      console.error('[ChipCache] Error writing cache:', error);
    }
  }
  
  /**
   * Clear cache for a specific hostname
   */
  async clearHostnameCache(hostname) {
    try {
      const result = await chrome.storage.local.get(this.storageKey);
      const cache = result[this.storageKey] || {};
      
      const keysToDelete = Object.keys(cache).filter(key => 
        key.includes(`:${hostname}:`)
      );
      
      keysToDelete.forEach(key => delete cache[key]);
      
      await chrome.storage.local.set({ [this.storageKey]: cache });
      
      console.log(`[ChipCache] Cleared ${keysToDelete.length} entries for ${hostname}`);
      
    } catch (error) {
      console.error('[ChipCache] Error clearing cache:', error);
    }
  }
  
  /**
   * Clear product cache (called on variant change)
   */
  async clearProductCache(hostname) {
    try {
      const result = await chrome.storage.local.get(this.storageKey);
      const cache = result[this.storageKey] || {};
      
      const keysToDelete = Object.keys(cache).filter(key => 
        key.startsWith('product_scan:') && key.includes(`:${hostname}:`)
      );
      
      keysToDelete.forEach(key => delete cache[key]);
      
      await chrome.storage.local.set({ [this.storageKey]: cache });
      
      console.log(`[ChipCache] Cleared ${keysToDelete.length} product entries`);
      
    } catch (error) {
      console.error('[ChipCache] Error clearing product cache:', error);
    }
  }
}
/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (ChipCache);  // ← ADD THIS LINE



/***/ }),

/***/ 431:
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   A: () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
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
/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (SubjectExtractor);

/***/ }),

/***/ 611:
/***/ ((module, __unused_webpack___webpack_exports__, __webpack_require__) => {

/* harmony import */ var _services_chipManager_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(354);
/* harmony import */ var _scanners_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(63);
/* module decorator */ module = __webpack_require__.hmd(module);
// SafeSignal Content Script - Fixed Visibility Edition + Scanner Wiring
// Version: 4.1-visibility-fix + scanners

const SAFESIGNAL_BUILD = 'content-2025-10-03-v4.1-scanner-wired';
const API_BASE_URL = 'http://localhost:8000';

console.info('[SafeSignal] Build:', SAFESIGNAL_BUILD);
// services
// CORRECT - go up one level, then into services
  // ✅ Default import





// components


// ← ADDED: Import scanner modules


class SafeSignalBadge {
    constructor() {
        // Core elements
        this.host = null;
        this.root = null;
        
        // State management
        this.currentState = 'checking';
        this.contextData = null;
        this.isMenuOpen = false;
        this.activeModal = null;
        
        // Positioning
        this.position = 'bottom-right';
        
        // Size mode (elder-friendly defaults)
        this.sizeMode = 'large';
        
        // SPA detection
        this.currentUrl = null; // Start as null so first check always runs
        this.mutationObserver = null;
        this.pageDebounceTimer = null;
        this.lastCheckByUrl = new Map();
        this.checkCooldown = 30 * 60 * 1000;
        
        // ← ADDED: Scanner services (initialized after Shadow DOM creation)
        this.apiClient = null;
        this.scanner = null;
        this.scannerUI = null;
        
        // Context detection
        this.contextProbe = new SafeSignalContextProbe();
        
        // User preferences
        this.userPreferences = {
            position: 'bottom-right',
            sizeMode: 'large',
            miniChipsEnabled: true
        };
        this.chipManager = new _services_chipManager_js__WEBPACK_IMPORTED_MODULE_0__/* ["default"] */ .A();  // ✅ Create new instance
        
        this.init();
    }
    
    async init() {
        if (this.shouldSkipInjection()) return;
        
        await this.loadUserPreferences();
        this.createBadge();
        chipManager.chipElements = {
            product: () => this.root.querySelector('.chip-product'),
            health: () => this.root.querySelector('.chip-health'),
            wrapper: () => this.chipsWrapper
        };
        // ← ADDED: Initialize scanners after badge creation (needs this.root)
        this.initScanners();
        
        this.initSpaDetection();
        this.setupKeyboardShortcuts();
        this.setupResizeHandler();
        
        console.log('[SafeSignal] Badge initialized and visible');
        this.checkIfPageChanged('initial_load');
    }
    
    shouldSkipInjection() {
        if (document.getElementById('safesignal-host')) {
            console.log('[SafeSignal] Badge already exists');
            return true;
        }
        
        const protocol = window.location.protocol;
        if (['chrome:', 'chrome-extension:', 'moz-extension:', 'about:'].includes(protocol)) {
            return true;
        }
        
        if (window.top !== window) {
            console.log('[SafeSignal] Skipping iframe');
            return true;
        }
        
        return false;
    }
    
    // ← ADDED: Scanner initialization
    initScanners() {
        try {
            this.apiClient = new _scanners_js__WEBPACK_IMPORTED_MODULE_1__/* .APIClient */ .Q9(API_BASE_URL);
            this.scanner = new _scanners_js__WEBPACK_IMPORTED_MODULE_1__/* .PageScanner */ .Y7(this.apiClient);
            this.scannerUI = new _scanners_js__WEBPACK_IMPORTED_MODULE_1__/* .ScannerUI */ .vk(this.scanner, this.root);
            console.log('[SafeSignal] ✅ Scanners initialized');
            this.chipManager.chipElements = {
                product: this.root.querySelector('.chip-product'),
                health: this.root.querySelector('.chip-health'),
                wrapper: this.chipsWrapper
            };
        } catch (error) {
            console.error('[SafeSignal] Scanner initialization failed:', error);
        }
    }
    
    // ==================== BADGE CREATION ====================
    
    createBadge() {
        // Create host container
        this.host = document.createElement('div');
        this.host.setAttribute('id', 'safesignal-host');
        this.root = this.host.attachShadow({ mode: 'open' });
        
        // Get size configuration
        const sizes = {
            normal: { badge: 56, font: 18, chip: 32, chipFont: 14 },
            large: { badge: 64, font: 20, chip: 36, chipFont: 15 },
            xl: { badge: 72, font: 22, chip: 40, chipFont: 16 }
        };
        const config = sizes[this.sizeMode] || sizes.large;
        
        // Create Shadow DOM structure with all your original CSS
        this.root.innerHTML = `
            <style>
                * {
                    margin: 0;
                    padding: 0;
                    box-sizing: border-box;
                }
                
                /* Main container - FIXED positioning */
                .safesignal-container {
                    position: fixed !important;
                    z-index: 2147483647 !important;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif !important;
                    pointer-events: auto !important;
                    display: flex !important;
                    flex-direction: column !important;
                    align-items: center !important;
                    gap: 8px !important;
                }
                
                /* Position classes */
                .pos-top-left { top: 20px !important; left: 20px !important; }
                .pos-top-right { top: 20px !important; right: 20px !important; }
                .pos-bottom-left { bottom: 20px !important; left: 20px !important; }
                .pos-bottom-right { bottom: 20px !important; right: 20px !important; }
                .pos-mid-left { top: 50% !important; left: 20px !important; transform: translateY(-50%) !important; }
                .pos-mid-right { top: 50% !important; right: 20px !important; transform: translateY(-50%) !important; }
                
                /* Mini chips wrapper */
                .chips-wrapper {
                    display: none;
                    flex-direction: column;
                    gap: 6px;
                    max-width: 280px;
                }
                
                .chips-wrapper.visible {
                    display: flex;
                }
                
                .mini-chip {
                    height: ${config.chip}px;
                    padding: 0 16px;
                    border-radius: ${config.chip / 2}px;
                    font-size: ${config.chipFont}px;
                    font-weight: 600;
                    color: white;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    white-space: nowrap;
                    transition: all 0.2s ease;
                    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
                }
                
                .mini-chip:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                }
                
                .chip-product {
                    background: linear-gradient(135deg, #2196f3 0%, #1976d2 100%);
                }
                
                .chip-health {
                    background: linear-gradient(135deg, #9c27b0 0%, #7b1fa2 100%);
                }
                
                /* Badge wrapper */
                .badge-wrapper {
                    position: relative;
                }
                
                /* Main badge */
                .badge {
                    height: ${config.badge}px;
                    min-width: ${config.badge}px;
                    padding: 0 20px;
                    padding-right: 48px;
                    border-radius: ${config.badge / 2}px;
                    font-size: ${config.font}px;
                    font-weight: 700;
                    color: white;
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    white-space: nowrap;
                    transition: all 0.2s ease;
                    position: relative;
                }
                
                .badge:hover {
                    transform: scale(1.02);
                    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
                }
                
                /* State colors */
                .state-checking .badge {
                    background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
                    animation: pulse 2s infinite;
                }
                
                .state-ok .badge {
                    background: linear-gradient(135deg, #10b981 0%, #059669 100%);
                }
                
                .state-warning .badge {
                    background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
                }
                
                .state-danger .badge {
                    background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
                }
                
                @keyframes pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.8; }
                }
                
                .badge-icon {
                    font-size: ${config.font + 2}px;
                    line-height: 1;
                }
                
                .badge-label {
                    font-size: ${config.font}px;
                    line-height: 1;
                }
                
                /* Menu toggle button */
                .menu-btn {
                    position: absolute;
                    right: 8px;
                    top: 50%;
                    transform: translateY(-50%);
                    width: 32px;
                    height: 32px;
                    background: rgba(255, 255, 255, 0.2);
                    border: none;
                    border-radius: 50%;
                    color: white;
                    font-size: 20px;
                    line-height: 1;
                    cursor: pointer;
                    transition: all 0.2s ease;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                
                .menu-btn:hover {
                    background: rgba(255, 255, 255, 0.3);
                }
                
                /* Menu panel */
                .menu {
                    position: absolute;
                    bottom: calc(100% + 12px);
                    right: 0;
                    background: white;
                    border-radius: 12px;
                    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
                    border: 1px solid #e5e7eb;
                    padding: 16px;
                    min-width: 220px;
                    display: none;
                    z-index: 1000;
                }
                
                .menu.open {
                    display: block;
                }
                
                /* Adjust menu position for top placements */
                .pos-top-left .menu,
                .pos-top-right .menu {
                    bottom: auto;
                    top: calc(100% + 12px);
                }
                
                .menu-section {
                    margin-bottom: 12px;
                }
                
                .menu-section:last-child {
                    margin-bottom: 0;
                }
                
                .menu-label {
                    font-size: 11px;
                    font-weight: 600;
                    color: #6b7280;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                    margin-bottom: 8px;
                }
                
                /* Position grid */
                .position-grid {
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 4px;
                }
                
                .pos-btn {
                    width: 32px;
                    height: 32px;
                    border: 1px solid #d1d5db;
                    border-radius: 6px;
                    background: white;
                    cursor: pointer;
                    transition: all 0.2s ease;
                    position: relative;
                }
                
                .pos-btn:hover {
                    background: #f3f4f6;
                    border-color: #9ca3af;
                }
                
                .pos-btn.active {
                    background: #7c3aed;
                    border-color: #7c3aed;
                }
                
                .pos-btn.active::after {
                    content: '✓';
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    color: white;
                    font-size: 14px;
                    font-weight: 700;
                }
                
                /* Size controls */
                .size-controls {
                    display: flex;
                    gap: 4px;
                }
                
                .size-btn {
                    flex: 1;
                    padding: 6px 12px;
                    border: 1px solid #d1d5db;
                    border-radius: 6px;
                    background: white;
                    font-size: 13px;
                    font-weight: 500;
                    cursor: pointer;
                    transition: all 0.2s ease;
                }
                
                .size-btn:hover {
                    background: #f3f4f6;
                    border-color: #9ca3af;
                }
                
                .size-btn.active {
                    background: #7c3aed;
                    color: white;
                    border-color: #7c3aed;
                }
                
                /* Modal overlay */
                .modal-overlay {
                    display: none;
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: rgba(0, 0, 0, 0.5);
                    z-index: 2147483646;
                    align-items: center;
                    justify-content: center;
                }
                
                .modal-overlay.visible {
                    display: flex;
                }
                
                .modal {
                    background: white;
                    border-radius: 16px;
                    padding: 24px;
                    max-width: 400px;
                    width: 90%;
                    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
                }
                
                .modal-title {
                    font-size: 20px;
                    font-weight: 700;
                    color: #111827;
                    margin-bottom: 12px;
                }
                
                .modal-body {
                    font-size: 16px;
                    line-height: 1.5;
                    color: #6b7280;
                    margin-bottom: 20px;
                }
                
                .modal-close {
                    width: 100%;
                    padding: 12px;
                    border-radius: 8px;
                    background: #7c3aed;
                    color: white;
                    font-size: 16px;
                    font-weight: 600;
                    border: none;
                    cursor: pointer;
                    transition: all 0.2s ease;
                }
                
                .modal-close:hover {
                    background: #6d28d9;
                }
                
                /* Accessibility */
                @media (prefers-reduced-motion: reduce) {
                    * {
                        transition: none !important;
                        animation: none !important;
                    }
                }
            </style>
            
            <!-- Main container with position class -->
            <div class="safesignal-container pos-bottom-right" id="main-container">
                <!-- Mini chips wrapper (will be populated dynamically) -->
                <div class="chips-wrapper" id="chips-wrapper"></div>
                
                <!-- Badge wrapper -->
                <div class="badge-wrapper">
                    <div class="badge state-checking" 
                         role="button" 
                         tabindex="0" 
                         aria-live="polite" 
                         aria-label="SafeSignal: Checking"
                         id="main-badge">
                        <span class="badge-icon">⧗</span>
                        <span class="badge-label">Checking</span>
                        <button class="menu-btn" 
                                aria-label="SafeSignal Menu"
                                aria-expanded="false"
                                id="menu-btn">
                            ⋯
                        </button>
                    </div>
                    
                    <!-- Menu -->
                    <div class="menu" id="menu" role="dialog">
                        <div class="menu-section">
                            <div class="menu-label">Position</div>
                            <div class="position-grid">
                                <button class="pos-btn" data-pos="top-left" title="Top Left"></button>
                                <button class="pos-btn" data-pos="top-center" title="Top Center" disabled style="opacity: 0.3"></button>
                                <button class="pos-btn" data-pos="top-right" title="Top Right"></button>
                                <button class="pos-btn" data-pos="mid-left" title="Middle Left"></button>
                                <button class="pos-btn" data-pos="mid-center" title="Center" disabled style="opacity: 0.3"></button>
                                <button class="pos-btn" data-pos="mid-right" title="Middle Right"></button>
                                <button class="pos-btn" data-pos="bottom-left" title="Bottom Left"></button>
                                <button class="pos-btn" data-pos="bottom-center" title="Bottom Center" disabled style="opacity: 0.3"></button>
                                <button class="pos-btn active" data-pos="bottom-right" title="Bottom Right"></button>
                            </div>
                        </div>
                        
                        <div class="menu-section">
                            <div class="menu-label">Size</div>
                            <div class="size-controls">
                                <button class="size-btn" data-size="normal">Normal</button>
                                <button class="size-btn active" data-size="large">Large</button>
                                <button class="size-btn" data-size="xl">XL</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- Modal -->
            <div class="modal-overlay" id="modal-overlay">
                <div class="modal" role="dialog" aria-modal="true">
                    <h2 class="modal-title" id="modal-title">Feature Coming Soon</h2>
                    <div class="modal-body" id="modal-body">
                        This feature is being developed and will be available soon.
                    </div>
                    <button class="modal-close" id="modal-close">Got it</button>
                </div>
            </div>
        `;
        
        // Add to page - CRITICAL: append to body
        document.body.appendChild(this.host);
        
        // Get element references
        this.container = this.root.getElementById('main-container');
        this.badge = this.root.getElementById('main-badge');
        this.menuBtn = this.root.getElementById('menu-btn');
        this.menu = this.root.getElementById('menu');
        this.chipsWrapper = this.root.getElementById('chips-wrapper');
        this.modalOverlay = this.root.getElementById('modal-overlay');
        
        // Initialize event listeners
        this.initEventListeners();
        
        // Apply saved position
        this.setPosition(this.userPreferences.position);
        
        // Apply saved size
        this.setSize(this.userPreferences.sizeMode);
        
        console.log('[SafeSignal] Badge created and should be visible');
    }
    
    // ==================== EVENT LISTENERS ====================
    
    initEventListeners() {
        // Badge click
        this.badge.addEventListener('click', (e) => {
            if (e.target === this.menuBtn || this.menuBtn.contains(e.target)) return;
            console.log('[SafeSignal] Badge clicked');
        });
        
        // Menu toggle
        this.menuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleMenu();
        });
        
        // Position buttons
        this.root.querySelectorAll('.pos-btn:not([disabled])').forEach(btn => {
            btn.addEventListener('click', () => {
                const position = btn.dataset.pos;
                this.setPosition(position);
                this.saveUserPreferences();
            });
        });
        
        // Size buttons
        this.root.querySelectorAll('.size-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const size = btn.dataset.size;
                this.setSize(size);
                this.saveUserPreferences();
            });
        });
        
        // Modal close
        this.root.getElementById('modal-close').addEventListener('click', () => {
            this.closeModal();
        });
        
        // Close menu on outside click
        document.addEventListener('click', (e) => {
            if (this.isMenuOpen && !this.host.contains(e.target)) {
                this.closeMenu();
            }
        });
    }
    
    // ==================== POSITION MANAGEMENT ====================
    
    setPosition(position) {
        const validPositions = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'mid-left', 'mid-right'];
        
        if (!validPositions.includes(position)) {
            position = 'bottom-right';
        }
        
        // Remove all position classes
        validPositions.forEach(pos => {
            this.container.classList.remove(`pos-${pos}`);
        });
        
        // Add new position class
        this.container.classList.add(`pos-${position}`);
        
        // Update active button
        this.root.querySelectorAll('.pos-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.pos === position);
        });
        
        this.position = position;
        this.userPreferences.position = position;
        
        console.log(`[SafeSignal] Position set to: ${position}`);
    }
    
    // ==================== SIZE MANAGEMENT ====================
    
    setSize(size) {
        const sizes = {
            normal: { badge: 56, font: 18, chip: 32, chipFont: 14 },
            large: { badge: 64, font: 20, chip: 36, chipFont: 15 },
            xl: { badge: 72, font: 22, chip: 40, chipFont: 16 }
        };
        
        const config = sizes[size] || sizes.large;
        
        // Update badge size
        this.badge.style.height = `${config.badge}px`;
        this.badge.style.minWidth = `${config.badge}px`;
        this.badge.style.borderRadius = `${config.badge / 2}px`;
        this.badge.style.fontSize = `${config.font}px`;
        
        // Update chips size
        this.root.querySelectorAll('.mini-chip').forEach(chip => {
            chip.style.height = `${config.chip}px`;
            chip.style.borderRadius = `${config.chip / 2}px`;
            chip.style.fontSize = `${config.chipFont}px`;
        });
        
        // Update active button
        this.root.querySelectorAll('.size-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.size === size);
        });
        
        this.sizeMode = size;
        this.userPreferences.sizeMode = size;
        
        console.log(`[SafeSignal] Size set to: ${size}`);
    }
    
    // ==================== MENU MANAGEMENT ====================
    
    toggleMenu() {
        if (this.isMenuOpen) {
            this.closeMenu();
        } else {
            this.openMenu();
        }
    }
    
    openMenu() {
        this.menu.classList.add('open');
        this.menuBtn.setAttribute('aria-expanded', 'true');
        this.isMenuOpen = true;
    }
    
    closeMenu() {
        this.menu.classList.remove('open');
        this.menuBtn.setAttribute('aria-expanded', 'false');
        this.isMenuOpen = false;
    }
    
    // ==================== MODAL MANAGEMENT ====================
    
    showModal(title, body) {
        this.root.getElementById('modal-title').textContent = title;
        this.root.getElementById('modal-body').textContent = body;
        this.modalOverlay.classList.add('visible');
        this.activeModal = this.modalOverlay;
    }
    
    closeModal() {
        this.modalOverlay.classList.remove('visible');
        this.activeModal = null;
    }
    
    // ==================== MINI CHIPS MANAGEMENT ====================
    
    updateMiniChips() {
        // Let the chip manager handle all gate logic
        this.chipManager.evaluateChips();
    }
    
        // ← ADDED: Scanner handlers
    async handleProductScan() {
        if (!this.scannerUI) {
            console.error('[SafeSignal] Scanner UI not initialized');
            return;
        }
        
        // Get the extracted subject from chip manager
        const extraction = await chipManager.subjectExtractor.extractSubject('product');
        if (!extraction.subject) {
            console.log('[SafeSignal] No product subject extracted');
            return;
        }
        
        console.log('[SafeSignal] 🛒 Starting product scan for:', extraction.subject);
        try {
            await this.scannerUI.handleProductScan(extraction.subject);
        } catch (error) {
            console.error('[SafeSignal] Product scan error:', error);
        }
    }

    // Similarly for handleHealthScan():
    async handleHealthScan() {
        if (!this.scannerUI) {
            console.error('[SafeSignal] Scanner UI not initialized');
            return;
        }
        
        // Get the extracted subject from chip manager
        const extraction = await chipManager.subjectExtractor.extractSubject('health');
        if (!extraction.subject) {
            console.log('[SafeSignal] No health subject extracted');
            return;
        }
        
        console.log('[SafeSignal] 🏥 Starting health scan for:', extraction.subject);
        try {
            await this.scannerUI.handleHealthScan(extraction.subject);
        } catch (error) {
            console.error('[SafeSignal] Health scan error:', error);
        }
    }
    
    // ==================== STATE MANAGEMENT ====================
    
    getStateIcon() {
        const icons = {
            checking: '⧗',
            ok: '✅',
            warning: '⚠️',
            danger: '❌'
        };
        return icons[this.currentState] || '❓';
    }
    
    getStateText() {
        const texts = {
            checking: 'Checking',
            ok: 'Looks Good',
            warning: 'Be Careful',
            danger: 'High Risk'
        };
        return texts[this.currentState] || 'Unknown';
    }
    
    updateBadgeState(state) {
        this.currentState = state;
        
        // Update badge state classes
        this.container.classList.remove('state-checking', 'state-ok', 'state-warning', 'state-danger');
        this.container.classList.add(`state-${state}`);
        
        // Update icon and text
        const icon = this.root.querySelector('.badge-icon');
        const label = this.root.querySelector('.badge-label');
        
        if (icon) icon.textContent = this.getStateIcon();
        if (label) label.textContent = this.getStateText();
        
        // Update ARIA label
        this.badge.setAttribute('aria-label', `SafeSignal: ${this.getStateText()}`);
        
        // Update mini chips based on new state
        this.updateMiniChips();
        
        console.log(`[SafeSignal] State updated to: ${state}`);
    }
    
    // ==================== PAGE CHANGE DETECTION ====================
    
    async checkIfPageChanged(trigger = 'unknown') {
        const url = window.location.href;
        
        // Skip if URL hasn't changed and not initial load
        if (this.currentUrl === url && trigger !== 'initial_load') {
            return;
        }
        
        // Check cooldown
        const lastCheck = this.lastCheckByUrl.get(url);
        if (lastCheck && (Date.now() - lastCheck) < this.checkCooldown) {
            console.log('[SafeSignal] Skipping check (cooldown)');
            return;
        }
        
        this.currentUrl = url;
        console.log(`[SafeSignal] Checking page (${trigger}): ${url}`);
        
        // Set checking state
        this.updateBadgeState('checking');
        
        try {
            // Simple heuristic analysis (your original logic)
            const pageText = document.body.innerText.toLowerCase();
            let state = 'ok';
            
            // Check for suspicious patterns
            const suspiciousTerms = [
                'urgent', 'act now', 'limited time', 'congratulations', 'claim your', 'verify account',
                'suspended', 'click here immediately', 'confirm identity'
            ];
            
            const warningTerms = [
                'sale', 'discount', 'offer', 'deal', 'subscribe',
                'download', 'update required', 'install'
            ];
            
            // Count suspicious indicators
            const suspiciousCount = suspiciousTerms.filter(term => pageText.includes(term)).length;
            const warningCount = warningTerms.filter(term => pageText.includes(term)).length;
            
            // Determine state based on indicators
            if (suspiciousCount >= 3) {
                state = 'danger';
            } else if (suspiciousCount >= 1 || warningCount >= 3) {
                state = 'warning';
            } else {
                // Check URL patterns
                const urlLower = url.toLowerCase();
                if (urlLower.includes('phishing') || urlLower.includes('suspicious')) {
                    state = 'danger';
                } else if (urlLower.includes('shop') || urlLower.includes('promo')) {
                    state = 'warning';
                }
            }
            
            console.log(`[SafeSignal] Analysis complete: ${state}`);
            this.updateBadgeState(state);
            this.lastCheckByUrl.set(url, Date.now());
            
        } catch (error) {
            console.error('[SafeSignal] Analysis failed:', error);
            this.updateBadgeState('ok'); // Default to safe on error
        }
    }
    
    // ==================== SPA DETECTION ====================
    
    initSpaDetection() {
        // Patch history API
        const originalPushState = history.pushState;
        const originalReplaceState = history.replaceState;
        
        history.pushState = (...args) => {
            originalPushState.apply(history, args);
            this.checkIfPageChanged('pushState');
        };
        
        history.replaceState = (...args) => {
            originalReplaceState.apply(history, args);
            this.checkIfPageChanged('replaceState');
        };
        
        // Listen to popstate
        window.addEventListener('popstate', () => {
            this.checkIfPageChanged('popstate');
        });
        
        // Mutation observer for content changes
        this.mutationObserver = new MutationObserver(() => {
            this.debouncedPageCheck();
        });
        
        this.mutationObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
        
        console.log('[SafeSignal] SPA detection enabled');
    }
    
    debouncedPageCheck() {
        clearTimeout(this.pageDebounceTimer);
        this.pageDebounceTimer = setTimeout(() => {
            this.checkIfPageChanged('mutation');
        }, 800);
    }
    
    // ==================== KEYBOARD SHORTCUTS ====================
    
    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Alt+S to toggle SafeSignal visibility
            if (e.altKey && e.key === 's') {
                e.preventDefault();
                this.toggleVisibility();
            }
            
            // Escape to close menu/modal
            if (e.key === 'Escape') {
                if (this.activeModal) {
                    this.closeModal();
                } else if (this.isMenuOpen) {
                    this.closeMenu();
                }
            }
        });
    }
    
    toggleVisibility() {
        if (this.host.style.display === 'none') {
            this.host.style.display = '';
            console.log('[SafeSignal] Badge shown');
        } else {
            this.host.style.display = 'none';
            console.log('[SafeSignal] Badge hidden');
        }
    }
    
    // ==================== RESIZE HANDLER ====================
    
    setupResizeHandler() {
        let resizeTimer;
        
        window.addEventListener('resize', () => {
            if (resizeTimer) {
                clearTimeout(resizeTimer);
            }
            
            resizeTimer = setTimeout(() => {
                // Ensure badge stays visible after resize
                const rect = this.container.getBoundingClientRect();
                if (rect.right > window.innerWidth || rect.bottom > window.innerHeight) {
                    console.log('[SafeSignal] Adjusting position after resize');
                    this.setPosition(this.position);
                }
            }, 250);
        });
    }
    
    // ==================== USER PREFERENCES ====================
    
    async loadUserPreferences() {
        try {
            const stored = await chrome.storage.sync.get([
                'position',
                'sizeMode',
                'miniChipsEnabled'
            ]);
            
            if (stored.position) {
                this.userPreferences.position = stored.position;
            }
            
            if (stored.sizeMode) {
                this.userPreferences.sizeMode = stored.sizeMode;
                this.sizeMode = stored.sizeMode;
            }
            
            if (stored.miniChipsEnabled !== undefined) {
                this.userPreferences.miniChipsEnabled = stored.miniChipsEnabled;
            }
            
            console.log('[SafeSignal] Preferences loaded:', this.userPreferences);
        } catch (error) {
            console.warn('[SafeSignal] Could not load preferences:', error);
            // Use defaults if storage fails
        }
    }
    
    async saveUserPreferences() {
        try {
            await chrome.storage.sync.set({
                position: this.userPreferences.position,
                sizeMode: this.userPreferences.sizeMode,
                miniChipsEnabled: this.userPreferences.miniChipsEnabled
            });
            
            console.log('[SafeSignal] Preferences saved');
        } catch (error) {
            console.warn('[SafeSignal] Could not save preferences:', error);
        }
    }
    
    // ==================== CLEANUP ====================
    
    destroy() {
        // Remove event listeners
        if (this.mutationObserver) {
            this.mutationObserver.disconnect();
        }
        
        // Remove DOM elements
        if (this.host && this.host.parentNode) {
            this.host.parentNode.removeChild(this.host);
        }
        
        // Clear maps
        this.lastCheckByUrl.clear();
        
        console.log('[SafeSignal] Badge destroyed');
    }
}

// ==================== CONTEXT PROBE (YOUR ORIGINAL) ====================

class SafeSignalContextProbe {
    constructor() {
        this.indicators = {
            product: {
                terms: ['price', 'buy now', 'add to cart', 'shop', 'deal', 'sale', 'discount'],
                selectors: [
                    '[itemtype*="Product"]',
                    '[data-price]',
                    'button[name="add-to-cart"]',
                    '.product-price',
                    '.price'
                ],
                patterns: [/\$\d+/, /€\d+/, /£\d+/]
            },
            health: {
                terms: ['symptom', 'treatment', 'cure', 'diagnosis', 'medical', 'health', 'doctor'],
                suspiciousTerms: ['miracle cure', 'guaranteed', 'breakthrough', 'secret'],
                selectors: [
                    'article[about*="health"]',
                    '.medical-content',
                    '[data-medical-info]'
                ]
            }
        };
    }
    
    detectContext() {
        const results = {
            product: { confidence: 0, signals: [] },
            health: { confidence: 0, signals: [] }
        };
        
        const pageText = this.getPageText();
        const pageTitle = document.title.toLowerCase();
        const pageUrl = window.location.href.toLowerCase();
        
        results.product = this.analyzeProductSignals(pageText, pageTitle, pageUrl);
        results.health = this.analyzeHealthSignals(pageText, pageTitle, pageUrl);
        
        return results;
    }
    
    getPageText() {
        const contentSelectors = ['main', 'article', '[role="main"]', '#content', '.content'];
        let text = '';
        
        for (const selector of contentSelectors) {
            const element = document.querySelector(selector);
            if (element) {
                text += (element.innerText || element.textContent || '') + ' ';
            }
        }
        
        if (!text.trim()) {
            const bodyText = document.body.innerText || document.body.textContent || '';
            text = bodyText;
        }
        
        return text.toLowerCase().slice(0, 5000);
    }
    
    analyzeProductSignals(pageText, pageTitle, pageUrl) {
        let confidence = 0;
        const signals = [];
        
        const termMatches = this.indicators.product.terms.filter(term => 
            pageText.includes(term) || pageTitle.includes(term)
        );
        
        if (termMatches.length > 0) {
            confidence += Math.min(termMatches.length * 0.1, 0.4);
            signals.push(`Found ${termMatches.length} shopping terms`);
        }
        
        const selectorMatches = this.indicators.product.selectors.filter(selector => {
            try {
                return document.querySelector(selector) !== null;
            } catch (e) {
                return false;
            }
        });
        
        if (selectorMatches.length > 0) {
            confidence += Math.min(selectorMatches.length * 0.2, 0.4);
            signals.push(`Found ${selectorMatches.length} product elements`);
        }
        
        const priceMatches = this.indicators.product.patterns.filter(pattern =>
            pattern.test(pageText)
        );
        
        if (priceMatches.length > 0) {
            confidence += 0.2;
            signals.push('Found price indicators');
        }
        
        if (/shop|store|product|cart|checkout|buy/.test(pageUrl)) {
            confidence += 0.2;
            signals.push('Shopping URL pattern');
        }
        
        return { confidence: Math.min(confidence, 1), signals };
    }
    
    analyzeHealthSignals(pageText, pageTitle, pageUrl) {
        let confidence = 0;
        const signals = [];
        
        const termMatches = this.indicators.health.terms.filter(term =>
            pageText.includes(term) || pageTitle.includes(term)
        );
        
        if (termMatches.length > 0) {
            confidence += Math.min(termMatches.length * 0.1, 0.4);
            signals.push(`Found ${termMatches.length} health terms`);
        }
        
        const suspiciousMatches = this.indicators.health.suspiciousTerms.filter(term =>
            pageText.includes(term)
        );
        
        if (suspiciousMatches.length > 0) {
            confidence += Math.min(suspiciousMatches.length * 0.15, 0.3);
            signals.push('Detected suspicious health claims');
        }
        
        const selectorMatches = this.indicators.health.selectors.filter(selector => {
            try {
                return document.querySelector(selector) !== null;
            } catch (e) {
                return false;
            }
        });
        
        if (selectorMatches.length > 0) {
            confidence += 0.2;
            signals.push('Found health-related markup');
        }
        
        if (/health|medical|medicine|treatment|symptom|drug/.test(pageUrl)) {
            confidence += 0.2;
            signals.push('Health URL pattern');
        }
        
        return { confidence: Math.min(confidence, 1), signals };
    }
}

// ==================== INITIALIZATION ====================

function initializeSafeSignal() {
    // Clean up any existing instance
    if (window.safeSignalInstance) {
        window.safeSignalInstance.destroy();
        window.safeSignalInstance = null;
    }
    
    // Create chipManager singleton FIRST
    if (!window.chipManager) {
        window.chipManager = new _services_chipManager_js__WEBPACK_IMPORTED_MODULE_0__/* ["default"] */ .A();
    }
    
    // Create new badge instance
    window.safeSignalInstance = new SafeSignalBadge();
    console.log('[SafeSignal] Extension initialized with scanners');
}

// Wait for DOM to be ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeSafeSignal);
} else {
    // DOM is already loaded, initialize immediately
    initializeSafeSignal();
}

// Handle dynamic iframe injections
if (window.self === window.top) {
    // Only in main window, not iframes
    console.log('[SafeSignal] Content script loaded in main window');
}

// Export for testing
if ( true && module.exports) {
    module.exports = { SafeSignalBadge, SafeSignalContextProbe };
}

/***/ }),

/***/ 737:
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   A: () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
// extension/src/services/pageClassifier.js
// Gate 0: Page Type Classification - Blocks chips on SERPs, portals, feeds
// NEVER affects badge - badge always shows on all pages

class PageClassifier {
  constructor() {
    // Known domains categorized by type
    this.knownDomains = {
      serp: [
        'google.com/search', 'bing.com/search', 'duckduckgo.com',
        'search.yahoo.com', 'ask.com', 'baidu.com', 'yandex.com',
        'reddit.com/search', 'twitter.com/search', 'facebook.com/search'
      ],
      portal: [
        'google.com', 'bing.com', 'yahoo.com', 'msn.com',
        'news.google.com', 'apple.news', 'flipboard.com', 'feedly.com',
        'reddit.com/r/all', 'reddit.com/r/popular', 'reddit.com',
        'twitter.com', 'facebook.com', 'instagram.com', 'linkedin.com/feed',
        'tiktok.com', 'pinterest.com', 'tumblr.com',
        'cnn.com', 'bbc.com', 'foxnews.com', 'nytimes.com',
        'target.com', 'walmart.com', 'amazon.com', 'ebay.com',
        'bestbuy.com', 'homedepot.com', 'costco.com'
      ],
      health: [
        'healthline.com', 'webmd.com', 'mayoclinic.org', 'medlineplus.gov',
        'cdc.gov', 'nih.gov', 'who.int', 'clevelandclinic.org'
      ]
    };
    
    // URL patterns for detection
    this.urlPatterns = {
      serp: [
        /\/search\b/i, /\/results\b/i, /[?&]q=/i, /[?&]query=/i,
        /\/find\b/i, /[?&]s=/i, /\/s\?/i
      ],
      portal: [
        /^\/$/,  // Root path
        /^\/news\/?$/i, /^\/trending\/?$/i, /^\/popular\/?$/i,
        /^\/feed\/?$/i, /^\/explore\/?$/i, /^\/discover\/?$/i,
        /^\/all\/?$/i, /^\/home\/?$/i
      ],
      category: [
        /\/c\/[^/]+$/i,  // Target category pages
        /\/category\/[^/]+$/i, /\/categories\//i,
        /\/shop\/[^/]+$/i, /\/department\/[^/]+$/i,
        /\/browse\/[^/]+$/i, /\/collection\/[^/]+$/i
      ],
      product: [
        /\/dp\/[A-Z0-9]+/i,  // Amazon
        /\/p\/[^/]+/i,  // Target
        /\/pd\/[^/]+/i, /\/product\/[^/]+/i,
        /\/item\/[^/]+/i, /\/ip\/[^/]+/i,  // Walmart
        /\/itm\/\d+/i  // eBay
      ],
      article: [
        /\/article\//i, /\/story\//i, /\/post\//i,
        /\/\d{4}\/\d{2}\//,  // Date-based URLs
        /\/health\/[^/]+\/[^/]+/i,  // Health articles
        /\/nutrition\/[^/]+/i, /\/conditions\/[^/]+/i
      ]
    };
  }
  
  /**
   * Main classification method
   * @returns {string} 'serp' | 'portal' | 'product' | 'health' | 'article' | 'ambiguous'
   */
  classify(url = window.location.href) {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.replace('www.', '');
    const pathname = urlObj.pathname;
    const fullPath = hostname + pathname;
    
    console.log('[PageClassifier] Analyzing:', fullPath);
    
    // 1. Check for SERP indicators
    if (this.isSERP(urlObj, hostname, pathname)) {
      return 'serp';
    }
    
    // 2. Check for portal/feed pages
    if (this.isPortal(urlObj, hostname, pathname)) {
      return 'portal';
    }
    
    // 3. Check for category/listing pages
    if (this.isCategoryPage(urlObj, hostname, pathname)) {
      return 'portal';  // Treat category pages as portals (no chips)
    }
    
    // 4. Check for product pages
    if (this.isProductPage(urlObj, hostname, pathname)) {
      return 'product';
    }
    
    // 5. Check for health/article pages
    if (this.isHealthArticle(urlObj, hostname, pathname)) {
      return 'article';
    }
    
    // 6. Check for general articles
    if (this.isArticle(urlObj, hostname, pathname)) {
      return 'article';
    }
    
    // Default to ambiguous (chips blocked)
    return 'ambiguous';
  }
  
  /**
   * SERP Detection
   */
  isSERP(urlObj, hostname, pathname) {
    // Check known SERP domains
    if (this.knownDomains.serp.some(domain => 
      (hostname + pathname).startsWith(domain)
    )) {
      console.log('[PageClassifier] Matched known SERP domain');
      return true;
    }
    
    // Check URL patterns
    if (this.urlPatterns.serp.some(pattern => pattern.test(urlObj.href))) {
      console.log('[PageClassifier] Matched SERP URL pattern');
      return true;
    }
    
    // Check query parameters
    const hasSearchQuery = urlObj.searchParams.has('q') || 
                          urlObj.searchParams.has('query') ||
                          urlObj.searchParams.has('search_query') ||
                          urlObj.searchParams.has('s');
    if (hasSearchQuery && pathname.includes('search')) {
      console.log('[PageClassifier] Detected search query params');
      return true;
    }
    
    // DOM-based SERP detection
    const serpSelectors = [
      '#rso .g',  // Google results
      '[data-hveid]',  // Google result items
      '.b_algo',  // Bing results
      '.search-result-item',
      '#search-results',
      '.results-list'
    ];
    
    for (const selector of serpSelectors) {
      try {
        const elements = document.querySelectorAll(selector);
        if (elements.length >= 3) {  // Multiple results indicate SERP
          console.log('[PageClassifier] Found SERP DOM elements:', selector);
          return true;
        }
      } catch (e) {
        // Selector might be invalid, continue
      }
    }
    
    // Check for search input + results pattern
    const hasSearchInput = document.querySelector('input[type="search"], input[name="q"], input[name="query"]');
    const hasMultipleLinks = document.querySelectorAll('a[href*="http"]').length > 20;
    if (hasSearchInput && hasMultipleLinks) {
      console.log('[PageClassifier] Detected search input + many links');
      return true;
    }
    
    return false;
  }
  
  /**
   * Portal/Feed Detection
   */
  isPortal(urlObj, hostname, pathname) {
    // Check known portal domains
    for (const domain of this.knownDomains.portal) {
      if (hostname === domain || hostname.endsWith('.' + domain)) {
        // Check if we're on homepage or section page
        if (pathname === '/' || pathname === '' || 
            this.urlPatterns.portal.some(p => p.test(pathname))) {
          console.log('[PageClassifier] Matched portal domain:', domain);
          return true;
        }
      }
    }
    
    // Special case: news site homepages and section pages
    const newsSites = ['cnn.com', 'bbc.com', 'nytimes.com', 'foxnews.com'];
    if (newsSites.some(site => hostname.includes(site))) {
      // Section pages like /health, /tech, /business
      if (pathname.match(/^\/[a-z]+\/?$/i) && !pathname.includes('article')) {
        console.log('[PageClassifier] News section page detected');
        return true;
      }
    }
    
    // Special case: e-commerce homepages
    const ecommerceSites = ['amazon.com', 'target.com', 'walmart.com', 'ebay.com'];
    if (ecommerceSites.some(site => hostname.includes(site))) {
      if (pathname === '/' || pathname === '') {
        console.log('[PageClassifier] E-commerce homepage detected');
        return true;
      }
    }
    
    // Social media feeds
    const socialPatterns = [
      /twitter\.com\/?$/,
      /facebook\.com\/?$/,
      /instagram\.com\/?$/,
      /linkedin\.com\/feed/,
      /reddit\.com\/r\/\w+\/?$/
    ];
    if (socialPatterns.some(pattern => pattern.test(hostname + pathname))) {
      console.log('[PageClassifier] Social media feed detected');
      return true;
    }
    
    // DOM-based portal detection
    const feedIndicators = [
      '.feed', '.timeline', '.stream',
      '[data-testid="primaryColumn"]',  // Twitter feed
      '[role="feed"]', '.news-feed'
    ];
    
    let feedElementCount = 0;
    for (const selector of feedIndicators) {
      try {
        if (document.querySelector(selector)) {
          feedElementCount++;
        }
      } catch (e) {}
    }
    
    if (feedElementCount >= 2) {
      console.log('[PageClassifier] Multiple feed elements found');
      return true;
    }
    
    return false;
  }
  
  /**
   * Category/Listing Page Detection
   */
  isCategoryPage(urlObj, hostname, pathname) {
    // URL pattern matching
    if (this.urlPatterns.category.some(pattern => pattern.test(pathname))) {
      console.log('[PageClassifier] Category URL pattern matched');
      return true;
    }
    
    // Look for product grids (multiple product cards)
    const productCards = document.querySelectorAll(
      '[class*="product-card"], [class*="productCard"], ' +
      '[class*="product-item"], [class*="item-card"], ' +
      '[data-testid*="product"], [data-product-id]'
    );
    
    if (productCards.length >= 6) {  // Multiple products = category page
      console.log('[PageClassifier] Product grid detected:', productCards.length, 'items');
      return true;
    }
    
    // Check for pagination (indicates listing)
    const paginationExists = document.querySelector(
      '.pagination, [class*="pagination"], ' +
      'nav[aria-label*="pagination"], .page-numbers'
    );
    
    if (paginationExists && productCards.length > 0) {
      console.log('[PageClassifier] Category page with pagination detected');
      return true;
    }
    
    return false;
  }
  
  /**
   * Product Page Detection
   */
  isProductPage(urlObj, hostname, pathname) {
    // URL pattern matching
    if (this.urlPatterns.product.some(pattern => pattern.test(pathname))) {
      console.log('[PageClassifier] Product URL pattern matched');
      
      // Additional validation: not a category page
      if (!this.isCategoryPage(urlObj, hostname, pathname)) {
        return true;
      }
    }
    
    // Check for JSON-LD Product schema
    const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of jsonLdScripts) {
      try {
        const data = JSON.parse(script.textContent);
        if (data['@type'] === 'Product' || 
            (Array.isArray(data['@graph']) && 
             data['@graph'].some(item => item['@type'] === 'Product'))) {
          console.log('[PageClassifier] Product schema found');
          return true;
        }
      } catch (e) {}
    }
    
    // DOM-based product detection
    const priceElement = document.querySelector(
      '[class*="price"], [itemprop="price"], ' +
      '[data-price], .product-price'
    );
    const addToCartBtn = document.querySelector(
      'button[class*="add-to-cart"], button[class*="addToCart"], ' +
      'button[id*="add-to-cart"], [data-testid*="add-to-cart"]'
    );
    
    if (priceElement && addToCartBtn) {
      // Check they're near each other (within 3 parent levels)
      let element = priceElement;
      let levelsUp = 0;
      while (element && levelsUp < 3) {
        element = element.parentElement;
        if (element && element.contains(addToCartBtn)) {
          console.log('[PageClassifier] Price + Add to Cart found together');
          return true;
        }
        levelsUp++;
      }
    }
    
    // Check for product title + price + buy button pattern
    const hasProductTitle = document.querySelector('h1[class*="product"], h1[itemprop="name"]');
    const hasBuyButton = addToCartBtn || document.querySelector('button[class*="buy"]');
    if (hasProductTitle && priceElement && hasBuyButton) {
      console.log('[PageClassifier] Product page elements detected');
      return true;
    }
    
    return false;
  }
  
  /**
   * Health Article Detection
   */
  isHealthArticle(urlObj, hostname, pathname) {
    // Known health sites
    if (this.knownDomains.health.some(domain => hostname.includes(domain))) {
      // Check if it's an article (not homepage or section)
      if (pathname.length > 10 && !this.isPortal(urlObj, hostname, pathname)) {
        console.log('[PageClassifier] Health site article detected');
        return true;
      }
    }
    
    // Health-related URL patterns
    const healthPatterns = [
      /\/health\//i, /\/conditions\//i, /\/diseases\//i,
      /\/treatment\//i, /\/symptoms\//i, /\/medical\//i,
      /\/nutrition\//i, /\/wellness\//i, /\/fitness\//i
    ];
    
    if (healthPatterns.some(pattern => pattern.test(pathname)) && 
        this.isArticle(urlObj, hostname, pathname)) {
      console.log('[PageClassifier] Health article URL pattern matched');
      return true;
    }
    
    return false;
  }
  
  /**
   * General Article Detection
   */
  isArticle(urlObj, hostname, pathname) {
    // Check for article schema
    const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of jsonLdScripts) {
      try {
        const data = JSON.parse(script.textContent);
        if (['Article', 'NewsArticle', 'BlogPosting', 'MedicalWebPage'].includes(data['@type'])) {
          console.log('[PageClassifier] Article schema found');
          return true;
        }
      } catch (e) {}
    }
    
    // Check for article elements
    const articleElement = document.querySelector('article, [role="article"]');
    const hasHeadline = document.querySelector('h1');
    const hasAuthor = document.querySelector('[class*="author"], [rel="author"], .byline');
    const hasDate = document.querySelector('time, [class*="publish"], [class*="date"]');
    
    if (articleElement && hasHeadline && (hasAuthor || hasDate)) {
      console.log('[PageClassifier] Article structure detected');
      return true;
    }
    
    // URL patterns for articles
    if (this.urlPatterns.article.some(pattern => pattern.test(pathname))) {
      // Additional check: has substantial content
      const mainContent = document.querySelector('main, article, .content');
      if (mainContent && mainContent.textContent.length > 500) {
        console.log('[PageClassifier] Article URL pattern with content');
        return true;
      }
    }
    
    return false;
  }
}

// Export for use in chipManager
/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (PageClassifier);

/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			id: moduleId,
/******/ 			loaded: false,
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		__webpack_modules__[moduleId](module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Flag the module as loaded
/******/ 		module.loaded = true;
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/define property getters */
/******/ 	(() => {
/******/ 		// define getter functions for harmony exports
/******/ 		__webpack_require__.d = (exports, definition) => {
/******/ 			for(var key in definition) {
/******/ 				if(__webpack_require__.o(definition, key) && !__webpack_require__.o(exports, key)) {
/******/ 					Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
/******/ 				}
/******/ 			}
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/harmony module decorator */
/******/ 	(() => {
/******/ 		__webpack_require__.hmd = (module) => {
/******/ 			module = Object.create(module);
/******/ 			if (!module.children) module.children = [];
/******/ 			Object.defineProperty(module, 'exports', {
/******/ 				enumerable: true,
/******/ 				set: () => {
/******/ 					throw new Error('ES Modules may not assign module.exports or exports.*, Use ESM export syntax, instead: ' + module.id);
/******/ 				}
/******/ 			});
/******/ 			return module;
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/hasOwnProperty shorthand */
/******/ 	(() => {
/******/ 		__webpack_require__.o = (obj, prop) => (Object.prototype.hasOwnProperty.call(obj, prop))
/******/ 	})();
/******/ 	
/************************************************************************/
/******/ 	
/******/ 	// startup
/******/ 	// Load entry module and return exports
/******/ 	// This entry module is referenced by other modules so it can't be inlined
/******/ 	__webpack_require__(611);
/******/ 	__webpack_require__(737);
/******/ 	__webpack_require__(317);
/******/ 	__webpack_require__(431);
/******/ 	__webpack_require__(354);
/******/ 	__webpack_require__(423);
/******/ 	__webpack_require__(264);
/******/ 	var __webpack_exports__ = __webpack_require__(295);
/******/ 	
/******/ })()
;
//# sourceMappingURL=content.js.map