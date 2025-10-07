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
export default ChipCache;  // ← ADD THIS LINE

