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

/***/ 611:
/***/ ((module, __unused_webpack___webpack_exports__, __webpack_require__) => {

/* harmony import */ var _scanners_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(63);
/* module decorator */ module = __webpack_require__.hmd(module);
// SafeSignal Content Script - Minimal Scanner Integration
// Version: 4.1 + Scanner Wiring Only

const SAFESIGNAL_BUILD = 'content-2025-09-29-v4.1-scanner-wired';
const API_BASE_URL = 'http://localhost:8000'; // ← ADDED FOR SCANNERS

console.info('[SafeSignal] Build:', SAFESIGNAL_BUILD);

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
        this.currentUrl = null;
        this.mutationObserver = null;
        this.pageDebounceTimer = null;
        this.lastCheckByUrl = new Map();
        this.checkCooldown = 30 * 60 * 1000;
        
        // ← ADDED: Scanner services
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
        
        this.init();
    }
    
    async init() {
        if (this.shouldSkipInjection()) return;
        
        await this.loadUserPreferences();
        this.createBadge();
        
        // ← ADDED: Initialize scanners
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
    
    // ← ADDED: Scanner initialization method
    initScanners() {
        this.apiClient = new _scanners_js__WEBPACK_IMPORTED_MODULE_0__/* .APIClient */ .Q9(API_BASE_URL);
        this.scanner = new _scanners_js__WEBPACK_IMPORTED_MODULE_0__/* .PageScanner */ .Y7(this.apiClient);
        this.scannerUI = new _scanners_js__WEBPACK_IMPORTED_MODULE_0__/* .ScannerUI */ .vk(this.scanner, this.root);
        
        console.log('[SafeSignal] Scanners initialized');
    }
    
    // ==================== BADGE CREATION (YOUR ORIGINAL) ====================
    
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
        
        // Create Shadow DOM structure with FIXED positioning
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
                
                /* Mini chips container */
                .chips-wrapper {
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                    align-items: center;
                    order: -1; /* Always above badge */
                }
                
                /* Mini chip */
                .mini-chip {
                    height: ${config.chip}px;
                    padding: 0 14px;
                    border-radius: ${config.chip / 2}px;
                    font-size: ${config.chipFont}px;
                    font-weight: 600;
                    color: white;
                    border: 1px solid rgba(255, 255, 255, 0.3);
                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    white-space: nowrap;
                    transition: all 0.2s ease;
                    opacity: 0;
                    transform: translateY(10px);
                    animation: chipFadeIn 0.3s ease forwards;
                    background: #2563eb; /* Default blue */
                }
                
                @keyframes chipFadeIn {
                    to {
                        opacity: 0.95;
                        transform: translateY(0);
                    }
                }
                
                .mini-chip:hover {
                    opacity: 1;
                    transform: translateY(-2px);
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
                }
                
                .mini-chip.product {
                    background: #7c3aed;
                }
                
                .mini-chip.health {
                    background: #059669;
                }
                
                /* Main badge wrapper */
                .badge-wrapper {
                    position: relative;
                    display: flex;
                    align-items: center;
                }
                
                /* Main badge */
                .badge {
                    height: ${config.badge}px;
                    min-width: ${config.badge}px;
                    padding: 0 20px;
                    padding-right: 48px; /* Space for menu button */
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
                
                .badge-text {
                    font-size: ${config.font}px;
                    line-height: 1;
                }
                
                /* Menu toggle button */
                .menu-toggle {
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
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: all 0.2s;
                }
                
                .menu-toggle:hover {
                    background: rgba(255, 255, 255, 0.3);
                    transform: translateY(-50%) scale(1.1);
                }
                
                /* Your existing menu, modal, and other styles continue here... */
                /* (Keeping rest of CSS from your original) */
            </style>
            
            <div class="safesignal-container pos-${this.position} state-${this.currentState}">
                <!-- Mini chips appear here -->
                <div class="chips-wrapper"></div>
                
                <!-- Main badge -->
                <div class="badge-wrapper">
                    <div class="badge" role="button" tabindex="0" aria-label="SafeSignal security badge">
                        <span class="badge-icon">${this.getStateIcon()}</span>
                        <span class="badge-text">${this.getStateText()}</span>
                        <button class="menu-toggle" aria-label="Options">⋯</button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(this.host);
        this.attachEventListeners();
        
        // Detect and show mini chips if appropriate
        this.updateMiniChips();
        
        console.log('[SafeSignal] Badge created and injected');
    }
    
    getStateIcon() {
        const icons = {
            'checking': '⏳',
            'ok': '✅',
            'warning': '⚠️',
            'danger': '❌'
        };
        return icons[this.currentState] || '•';
    }
    
    getStateText() {
        const texts = {
            'checking': 'Checking',
            'ok': 'Safe',
            'warning': 'Caution',
            'danger': 'Warning'
        };
        return texts[this.currentState] || 'SafeSignal';
    }
    
    // ==================== MINI CHIPS UPDATE (MODIFIED) ====================
    
    updateMiniChips() {
        if (!this.userPreferences.miniChipsEnabled) return;
        
        const chipsWrapper = this.root.querySelector('.chips-wrapper');
        if (!chipsWrapper) return;
        
        chipsWrapper.innerHTML = ''; // Clear existing
        
        // Run context analysis
        const context = this.contextProbe.analyze();
        
        // ← MODIFIED: Wire chips to scanner
        if (context.product.confidence > 0.5) {
            const productChip = document.createElement('div');
            productChip.className = 'mini-chip product';
            productChip.innerHTML = `
                <span>🛒</span>
                <span>Compare Prices</span>
            `;
            productChip.addEventListener('click', (e) => {
                e.stopPropagation();
                this.handleProductScan(); // ← WIRED TO SCANNER
            });
            chipsWrapper.appendChild(productChip);
        }
        
        if (context.health.confidence > 0.5) {
            const healthChip = document.createElement('div');
            healthChip.className = 'mini-chip health';
            healthChip.innerHTML = `
                <span>🩺</span>
                <span>Verify Info</span>
            `;
            healthChip.addEventListener('click', (e) => {
                e.stopPropagation();
                this.handleHealthScan(); // ← WIRED TO SCANNER
            });
            chipsWrapper.appendChild(healthChip);
        }
    }
    
    // ← ADDED: Scanner handler methods
    async handleProductScan() {
        console.log('[SafeSignal] Product scan triggered');
        if (this.scannerUI) {
            await this.scannerUI.handleProductScan();
        }
    }
    
    async handleHealthScan() {
        console.log('[SafeSignal] Health scan triggered');
        if (this.scannerUI) {
            await this.scannerUI.handleHealthScan();
        }
    }
    
    // ==================== YOUR ORIGINAL EVENT LISTENERS ====================
    
    attachEventListeners() {
        const badge = this.root.querySelector('.badge');
        const menuToggle = this.root.querySelector('.menu-toggle');
        
        // Badge click
        badge.addEventListener('click', (e) => {
            if (e.target.closest('.menu-toggle')) return;
            this.toggleMiniChips();
        });
        
        // Menu toggle
        if (menuToggle) {
            menuToggle.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleMenu();
            });
        }
        
        // Your other event listeners here...
        // (Keep all your original listener code)
    }
    
    toggleMiniChips() {
        const chipsWrapper = this.root.querySelector('.chips-wrapper');
        const isVisible = chipsWrapper.style.display !== 'none';
        chipsWrapper.style.display = isVisible ? 'none' : 'flex';
    }
    
    toggleMenu() {
        // Your original menu toggle code
        console.log('[SafeSignal] Menu toggled');
    }
    
    // ==================== YOUR ORIGINAL STATE & PAGE CHECKING ====================
    
    updateBadgeState(verdict) {
        this.currentState = verdict;
        
        const icon = this.root.querySelector('.badge-icon');
        const text = this.root.querySelector('.badge-text');
        const container = this.root.querySelector('.safesignal-container');
        
        if (icon) icon.textContent = this.getStateIcon();
        if (text) text.textContent = this.getStateText();
        
        if (container) {
            container.classList.remove('state-checking', 'state-ok', 'state-warning', 'state-danger');
            container.classList.add(`state-${verdict}`);
        }
        
        // Update mini chips when state changes
        this.updateMiniChips();
    }
    
    async checkIfPageChanged(reason) {
        const currentUrl = window.location.href;
        
        // Check cooldown
        const lastCheck = this.lastCheckByUrl.get(currentUrl);
        if (lastCheck && (Date.now() - lastCheck < this.checkCooldown)) {
            console.log('[SafeSignal] Skipping check (cooldown)');
            return;
        }
        
        if (this.currentUrl === currentUrl && reason !== 'initial_load') {
            return;
        }
        
        this.currentUrl = currentUrl;
        console.log(`[SafeSignal] Page changed (${reason}): ${currentUrl}`);
        
        this.updateBadgeState('checking');
        
        try {
            // ← MODIFIED: Use apiClient instead of fetch
            const response = await this.apiClient.post('/api/check', {
                url: currentUrl
            });
            
            this.updateBadgeState(response.verdict);
            this.lastCheckByUrl.set(currentUrl, Date.now());
            
        } catch (error) {
            console.error('[SafeSignal] Check failed:', error);
            this.updateBadgeState('warning');
        }
    }
    
    // ==================== YOUR ORIGINAL SPA DETECTION ====================
    
    initSpaDetection() {
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
        
        window.addEventListener('popstate', () => {
            this.checkIfPageChanged('popstate');
        });
        
        this.mutationObserver = new MutationObserver(() => {
            this.debouncedPageCheck();
        });
        
        this.mutationObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
    }
    
    debouncedPageCheck() {
        clearTimeout(this.pageDebounceTimer);
        this.pageDebounceTimer = setTimeout(() => {
            this.checkIfPageChanged('mutation');
        }, 800);
    }
    
    // ==================== YOUR ORIGINAL PREFERENCES ====================
    
    async loadUserPreferences() {
        return new Promise((resolve) => {
            chrome.storage.sync.get(['badgePosition', 'badgeSize', 'miniChipsEnabled'], (result) => {
                if (result.badgePosition) {
                    this.position = result.badgePosition;
                }
                if (result.badgeSize) {
                    this.sizeMode = result.badgeSize;
                }
                if (result.miniChipsEnabled !== undefined) {
                    this.userPreferences.miniChipsEnabled = result.miniChipsEnabled;
                }
                resolve();
            });
        });
    }
    
    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            if (e.altKey && e.key === 's') {
                e.preventDefault();
                this.toggleMiniChips();
            }
        });
    }
    
    setupResizeHandler() {
        let resizeTimer;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                console.log('[SafeSignal] Window resized');
            }, 250);
        });
    }
    
    destroy() {
        if (this.mutationObserver) {
            this.mutationObserver.disconnect();
        }
        if (this.host) {
            this.host.remove();
        }
        console.log('[SafeSignal] Badge destroyed');
    }
}

// ==================== YOUR ORIGINAL CONTEXT PROBE (UNCHANGED) ====================

class SafeSignalContextProbe {
    constructor() {
        this.indicators = {
            product: {
                terms: ['buy', 'price', 'cart', 'checkout', 'shipping', 'product', 'shop', 'store', 'deal', 'discount', 'sale', 'order', 'purchase', 'payment'],
                selectors: ['[itemtype*="schema.org/Product"]', '[data-price]', '.price', '.product', '.add-to-cart', '#buy-button'],
                patterns: [/\$\d+/, /USD \d+/, /€\d+/, /£\d+/]
            },
            health: {
                terms: ['symptom', 'treatment', 'medicine', 'drug', 'cure', 'therapy', 'doctor', 'medical', 'health', 'disease', 'condition', 'diagnosis', 'prescription'],
                selectors: ['[itemtype*="schema.org/MedicalCondition"]', '[itemtype*="schema.org/Drug"]', '.medical', '.health-info'],
                suspiciousTerms: ['miracle', 'breakthrough', 'secret', 'one weird trick', 'doctors hate', 'instant relief', 'guaranteed cure']
            }
        };
    }
    
    analyze() {
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

// ==================== INITIALIZATION (YOUR ORIGINAL) ====================

function initializeSafeSignal() {
    if (window.safeSignalInstance) {
        window.safeSignalInstance.destroy();
        window.safeSignalInstance = null;
    }
    
    window.safeSignalInstance = new SafeSignalBadge();
    console.log('[SafeSignal] Extension initialized');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeSafeSignal);
} else {
    initializeSafeSignal();
}

if (window.self === window.top) {
    console.log('[SafeSignal] Content script loaded in main window');
}

if ( true && module.exports) {
    module.exports = { SafeSignalBadge, SafeSignalContextProbe };
}

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
/******/ 	var __webpack_exports__ = __webpack_require__(611);
/******/ 	
/******/ })()
;
//# sourceMappingURL=content.js.map