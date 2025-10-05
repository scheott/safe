// extension/tests/chipGates.test.js
// Comprehensive test suite for the 3-gate chip system
// Run with Jest or similar test framework

import { jest } from '@jest/globals';
import PageClassifier from '../src/services/pageClassifier.js';
import IntentScorer from '../src/services/intentScorer.js';
import SubjectExtractor from '../src/services/subjectExtractor.js';
import ChipManager from '../src/services/chipManager.js';

describe('Chip Gating System - Complete Test Suite', () => {
  
  let pageClassifier;
  let intentScorer;
  let subjectExtractor;
  let chipManager;
  
  beforeEach(() => {
    // Reset DOM
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    
    // Reset URL
    delete window.location;
    window.location = new URL('https://example.com');
    
    // Initialize services
    pageClassifier = new PageClassifier();
    intentScorer = new IntentScorer();
    subjectExtractor = new SubjectExtractor();
    chipManager = new ChipManager();
    
    // Mock chrome.storage API
    global.chrome = {
      storage: {
        local: {
          get: jest.fn().mockResolvedValue({}),
          set: jest.fn().mockResolvedValue({}),
          remove: jest.fn().mockResolvedValue({})
        }
      }
    };
  });
  
  // ========================================
  // GATE 0: Page Type Classification Tests
  // ========================================
  
  describe('Gate 0: Page Type Classification', () => {
    
    test('Google SERP blocks chips', () => {
      window.location = new URL('https://www.google.com/search?q=vitamin+d+benefits');
      document.body.innerHTML = `
        <div id="rso">
          <div class="g">Result 1</div>
          <div class="g">Result 2</div>
          <div class="g">Result 3</div>
        </div>
      `;
      
      const pageType = pageClassifier.classify();
      expect(pageType).toBe('serp');
    });
    
    test('News portal homepage blocks chips', () => {
      window.location = new URL('https://news.google.com');
      
      const pageType = pageClassifier.classify();
      expect(pageType).toBe('portal');
    });
    
    test('CNN homepage blocks chips', () => {
      window.location = new URL('https://www.cnn.com');
      
      const pageType = pageClassifier.classify();
      expect(pageType).toBe('portal');
    });
    
    test('CNN Health section page blocks chips', () => {
      window.location = new URL('https://www.cnn.com/health');
      
      const pageType = pageClassifier.classify();
      expect(pageType).toBe('portal');
    });
    
    test('CNN Health article allows health chip', () => {
      window.location = new URL('https://www.cnn.com/health/article/intermittent-fasting-benefits');
      document.body.innerHTML = `
        <article>
          <h1>Intermittent Fasting Benefits</h1>
          <time>2024-01-15</time>
          <p>Article content...</p>
        </article>
      `;
      
      const pageType = pageClassifier.classify();
      expect(pageType).toBe('article');
    });
    
    test('Target homepage blocks chips', () => {
      window.location = new URL('https://www.target.com');
      
      const pageType = pageClassifier.classify();
      expect(pageType).toBe('portal');
    });
    
    test('Target category page blocks chips', () => {
      window.location = new URL('https://www.target.com/c/bedding');
      document.body.innerHTML = `
        <div class="product-grid">
          ${Array(12).fill('<div class="product-card">Product</div>').join('')}
        </div>
      `;
      
      const pageType = pageClassifier.classify();
      expect(pageType).toBe('portal');
    });
    
    test('Amazon product page allows product chip', () => {
      window.location = new URL('https://www.amazon.com/dp/B08N5WRWNW');
      document.body.innerHTML = `
        <h1 id="productTitle">Sony WH-1000XM5</h1>
        <span class="a-price">$349.99</span>
        <button id="add-to-cart-button">Add to Cart</button>
      `;
      
      const pageType = pageClassifier.classify();
      expect(pageType).toBe('product');
    });
    
    test('Healthline article allows health chip', () => {
      window.location = new URL('https://www.healthline.com/nutrition/intermittent-fasting-guide');
      document.body.innerHTML = `
        <article>
          <h1>Intermittent Fasting Guide</h1>
          <div class="byline">Medically reviewed by...</div>
        </article>
      `;
      
      const pageType = pageClassifier.classify();
      expect(pageType).toBe('article');
    });
  });
  
  // ========================================
  // GATE 1: Intent Scoring Tests
  // ========================================
  
  describe('Gate 1: Intent Scoring', () => {
    
    test('Low product intent (0.3) blocks chip', async () => {
      window.location = new URL('https://example.com/product/some-item');
      document.body.innerHTML = `
        <nav aria-label="breadcrumb">
          <ol><li>Home</li><li>Category</li><li>Some Item</li></ol>
        </nav>
      `;
      
      const result = await intentScorer.scoreProductIntent();
      expect(result.score).toBeLessThan(0.85);
      expect(result.score).toBeCloseTo(0.3, 1); // URL (0.2) + breadcrumb (0.1)
    });
    
    test('High product intent (0.9) passes', async () => {
      document.body.innerHTML = `
        <script type="application/ld+json">
        {"@type": "Product", "name": "Sony Headphones"}
        </script>
        <div class="product-price">$299</div>
        <button class="add-to-cart">Add to Cart</button>
      `;
      window.location = new URL('https://store.com/product/sony-headphones');
      
      const result = await intentScorer.scoreProductIntent();
      expect(result.score).toBeGreaterThanOrEqual(0.85);
      expect(result.score).toBeCloseTo(0.9, 1); // Schema (0.4) + UI (0.3) + URL (0.2)
    });
    
    test('Medical terms without pairing blocks health chip', async () => {
      document.body.innerHTML = `
        <article>
          <h1>Recent Studies on Vitamins</h1>
          <p>This article mentions vitamin D, vitamin C, and various supplements.</p>
          <p>Researchers are studying these compounds.</p>
        </article>
      `;
      
      const result = await intentScorer.scoreHealthIntent();
      expect(result.score).toBeLessThan(0.75);
      // No condition+therapy+claim pairing
    });
    
    test('Paired medical terms with claims passes health intent', async () => {
      document.body.innerHTML = `
        <script type="application/ld+json">
        {"@type": "Article", "headline": "Vitamin D and Sleep"}
        </script>
        <article>
          <h1>Vitamin D Treats Sleep Quality Issues</h1>
          <p>Recent research shows that vitamin D supplementation can help improve sleep quality in patients with insomnia.</p>
          <p>The treatment has been shown to reduce symptoms effectively.</p>
        </article>
      `;
      window.location = new URL('https://health.com/health/vitamin-d-sleep');
      
      const result = await intentScorer.scoreHealthIntent();
      expect(result.score).toBeGreaterThanOrEqual(0.75);
      // Schema (0.3) + URL (0.3) + paired terms (0.3) = 0.9
    });
    
    test('Borderline cases are logged', async () => {
      const consoleSpy = jest.spyOn(console, 'warn');
      
      document.body.innerHTML = `
        <div class="product-price">$99</div>
        <button class="buy-now">Buy Now</button>
      `;
      window.location = new URL('https://shop.com/product/item');
      
      const result = await intentScorer.scoreProductIntent();
      expect(result.score).toBeCloseTo(0.5, 1); // UI (0.3) + URL (0.2)
      
      // Should log borderline case
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('BORDERLINE'),
        expect.objectContaining({
          score: expect.any(Number),
          threshold: 0.85
        })
      );
    });
  });
  
  // ========================================
  // GATE 2: Subject Specificity Tests
  // ========================================
  
  describe('Gate 2: Subject Specificity', () => {
    
    test('Brand-only subject "Apple" fails', async () => {
      document.body.innerHTML = `
        <script type="application/ld+json">
        {"@type": "Product", "name": "Apple"}
        </script>
        <h1>Apple</h1>
      `;
      
      const result = await subjectExtractor.extractSubject('product');
      expect(result.needsConfirm).toBe(true);
      expect(result.failReason).toBe('brand_only');
      expect(result.subject).toBe('Apple');
    });
    
    test('Generic health subject fails', async () => {
      document.body.innerHTML = `
        <article>
          <h1>Health</h1>
        </article>
      `;
      
      const result = await subjectExtractor.extractSubject('health');
      expect(result.needsConfirm).toBe(true);
      expect(result.failReason).toBe('contains_generic_term');
    });
    
    test('Specific product subject passes', async () => {
      document.body.innerHTML = `
        <script type="application/ld+json">
        {"@type": "Product", "name": "Sony WH-1000XM5 Noise Cancelling Headphones"}
        </script>
      `;
      
      const result = await subjectExtractor.extractSubject('product');
      expect(result.needsConfirm).toBe(false);
      expect(result.subject).toContain('Sony WH-1000XM5');
      expect(result.confidence).toBe('high');
    });
    
    test('Specific health subject passes', async () => {
      document.body.innerHTML = `
        <article>
          <h1>Intermittent Fasting and Sleep Quality</h1>
        </article>
      `;
      
      const result = await subjectExtractor.extractSubject('health');
      expect(result.needsConfirm).toBe(false);
      expect(result.subject).toContain('Intermittent Fasting');
      expect(result.confidence).toBe('high');
    });
    
    test('Subject longer than 8 words gets truncated', async () => {
      const longTitle = 'This is a very long product title with more than eight words in it';
      document.body.innerHTML = `
        <h1>${longTitle}</h1>
      `;
      
      const result = await subjectExtractor.extractSubject('product');
      const wordCount = result.subject.split(/\s+/).length;
      expect(wordCount).toBeLessThanOrEqual(8);
    });
    
    test('Amazon variant selection updates subject', async () => {
      window.location = new URL('https://www.amazon.com/dp/B08N5WRWNW');
      document.body.innerHTML = `
        <h1 id="productTitle">Sony WH-1000XM5</h1>
        <span id="native_dropdown_selected_size_name">Black</span>
      `;
      
      const result = await subjectExtractor.extractSubject('product');
      expect(result.subject).toContain('Black');
      expect(result.extractionMethod).toBe('adapter_amazon_com');
    });
  });
  
  // ========================================
  // Integration: Full Gate Flow Tests
  // ========================================
  
  describe('Integration: Full Gate Flow', () => {
    
    test('All gates pass → chip shows', async () => {
      // Setup: Amazon product page with all signals
      window.location = new URL('https://www.amazon.com/dp/B08N5WRWNW');
      document.body.innerHTML = `
        <script type="application/ld+json">
        {"@type": "Product", "name": "Sony WH-1000XM5 Headphones"}
        </script>
        <h1 id="productTitle">Sony WH-1000XM5 Headphones</h1>
        <span class="a-price">$349.99</span>
        <button id="add-to-cart-button">Add to Cart</button>
      `;
      
      const result = await chipManager.shouldShowChip('product');
      
      expect(result.show).toBe(true);
      expect(result.state).toBe('ready');
      expect(result.subject).toContain('Sony WH-1000XM5');
    });
    
    test('Gate 0 blocks on SERP', async () => {
      window.location = new URL('https://www.google.com/search?q=headphones');
      document.body.innerHTML = `
        <div id="rso">
          <div class="g">Result 1</div>
          <div class="g">Result 2</div>
        </div>
      `;
      
      const result = await chipManager.shouldShowChip('product');
      
      expect(result.show).toBe(false);
      expect(result.reason).toBe('wrong_page_type');
      expect(result.pageType).toBe('serp');
    });
    
    test('Gate 1 blocks on low intent', async () => {
      window.location = new URL('https://store.com/product/item');
      document.body.innerHTML = `
        <h1>Some Product</h1>
        <p>Product description</p>
      `;
      
      const result = await chipManager.shouldShowChip('product');
      
      expect(result.show).toBe(false);
      expect(result.reason).toBe('low_intent');
      expect(result.score).toBeLessThan(0.85);
    });
    
    test('Gate 2 triggers assist modal for generic subject', async () => {
      window.location = new URL('https://www.target.com/p/product');
      document.body.innerHTML = `
        <script type="application/ld+json">
        {"@type": "Product", "name": "Target"}
        </script>
        <h1>Target</h1>
        <button class="add-to-cart">Add to Cart</button>
        <span class="product-price">$19.99</span>
      `;
      
      const result = await chipManager.shouldShowChip('product');
      
      expect(result.show).toBe(true);
      expect(result.state).toBe('needs_confirm');
      expect(result.failReason).toBe('brand_only');
    });
  });
  
  // ========================================
  // Cooldown & Caching Tests
  // ========================================
  
  describe('Cooldowns and Caching', () => {
    
    test('Same URL cooldown blocks repeat chips', async () => {
      const cooldown = chipManager.cooldown;
      
      // Set cooldown
      await cooldown.setUrlCooldown('product');
      
      // Check cooldown
      const status = await cooldown.checkCooldowns('product');
      expect(status.blocked).toBe(true);
      expect(status.reason).toBe('url_cooldown');
    });
    
    test('User dismissal blocks chips for 24h', async () => {
      const cooldown = chipManager.cooldown;
      
      // Dismiss chip
      await cooldown.dismissChipOnOrigin('health');
      
      // Check dismissal
      const status = await cooldown.checkCooldowns('health');
      expect(status.blocked).toBe(true);
      expect(status.reason).toBe('user_dismissed');
    });
    
    test('Unhide removes dismissal', async () => {
      const cooldown = chipManager.cooldown;
      
      // Dismiss then unhide
      await cooldown.dismissChipOnOrigin('health');
      await cooldown.unhideChipOnOrigin('health');
      
      // Should not be blocked
      const status = await cooldown.checkCooldowns('health');
      expect(status.blocked).toBe(false);
    });
    
    test('Cache returns saved scan results', async () => {
      const cache = chipManager.cache;
      
      const testData = { 
        product_name: 'Test Product',
        advisory: 'Test advisory' 
      };
      
      const cacheKey = cache.getCacheKey('product', 'Test Product');
      await cache.setCachedScan(cacheKey, testData);
      
      const retrieved = await cache.getCachedScan(cacheKey);
      expect(retrieved).toEqual(testData);
    });
  });
  
  // ========================================
  // Visual Preservation Tests
  // ========================================
  
  describe('Visual Preservation', () => {
    
    test('Badge element is never modified', () => {
      // Create mock badge
      document.body.innerHTML = `
        <div id="safesignal-host">
          <div class="badge" style="width: 48px; height: 48px;">Badge</div>
        </div>
      `;
      
      const badgeBefore = document.querySelector('.badge').outerHTML;
      
      // Run chip evaluation
      chipManager.evaluateChips();
      
      const badgeAfter = document.querySelector('.badge').outerHTML;
      expect(badgeAfter).toBe(badgeBefore);
    });
    
    test('Chip styling matches existing design', () => {
      document.body.innerHTML = `
        <div class="chip-product" style="display: none;">
          <span class="chip-subject">Product</span>
        </div>
      `;
      
      const chip = document.querySelector('.chip-product');
      
      // Show chip
      chipManager.showChipWithSubject('product', 'Test Product');
      
      // Check that only display and subject changed
      expect(chip.style.display).toBe('flex');
      expect(chip.querySelector('.chip-subject').textContent).toContain('Test Product');
      
      // Other styles should be unchanged
      expect(chip.className).toBe('chip-product');
    });
  });
  
  // ========================================
  // Analytics Tracking Tests  
  // ========================================
  
  describe('Analytics Tracking', () => {
    
    test('Gate blocks are tracked', async () => {
      const trackSpy = jest.fn();
      global.analytics = { track: trackSpy };
      
      window.location = new URL('https://www.google.com/search?q=test');
      
      await chipManager.shouldShowChip('product');
      
      expect(trackSpy).toHaveBeenCalledWith(
        'chip_gate_blocked',
        expect.objectContaining({
          gate: 0,
          chipType: 'product',
          reason: 'wrong_page_type'
        })
      );
    });
    
    test('Successful gate passes are tracked', async () => {
      const trackSpy = jest.fn();
      global.analytics = { track: trackSpy };
      
      // Setup passing scenario
      window.location = new URL('https://www.amazon.com/dp/TEST123');
      document.body.innerHTML = `
        <script type="application/ld+json">
        {"@type": "Product", "name": "Test Product XL"}
        </script>
        <div class="a-price">$99</div>
        <button id="add-to-cart-button">Add</button>
      `;
      
      await chipManager.shouldShowChip('product');
      
      expect(trackSpy).toHaveBeenCalledWith(
        'chip_gates_passed',
        expect.objectContaining({
          chipType: 'product',
          subject: expect.stringContaining('Test Product')
        })
      );
    });
  });
});