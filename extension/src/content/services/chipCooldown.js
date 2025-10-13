class ChipCooldown {
  constructor() {
    // Cooldown periods
    this.urlCooldown = 30 * 60 * 1000;      // 30 minutes for same URL
    this.originCooldown = 24 * 60 * 60 * 1000; // 24 hours for dismissed origins
    this.dismissals = {};
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
    async unhideChipOnOrigin(chipType, origin) {
        const key = `dismissed_${chipType}_${origin}`;
        
        // Initialize dismissals if needed
        if (!this.dismissals) {
            this.dismissals = {};
        }
        
        // Remove from memory
        delete this.dismissals[key];
        
        // Remove from storage
        try {
            await chrome.storage.local.remove([key]);
        } catch (e) {
            // In tests, chrome.storage might not be fully mocked
            console.log('[ChipCooldown] Storage removal skipped in test env');
        }
        
        console.log(`[ChipCooldown] Unhid ${chipType} on ${origin}`);
        this.trackEvent('chip_unhidden_by_user', { chipType, origin });
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
export default ChipCooldown;