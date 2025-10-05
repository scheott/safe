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

// ============================================================================

// extension/src/services/chipCooldown.js
// Cooldown management to prevent nagging

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
export { ChipCache, ChipCooldown };
export default ChipCooldown;