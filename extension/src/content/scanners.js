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

export { PageScanner, ScannerUI, APIClient };