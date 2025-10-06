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
export default PageClassifier;