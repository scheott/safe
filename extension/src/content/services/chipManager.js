// extension/src/services/chipManager.js
// Orchestrates all 3 gates and controls chip visibility
// IMPORTANT: Never affects badge - badge always shows

import PageClassifier from './pageClassifier.js';
import IntentScorer from './intentScorer.js';
import SubjectExtractor from './subjectExtractor.js';
import AssistModal from '../components/AssistModal.js';
import ChipCache from './chipCache.js';
import ChipCooldown from './chipCooldown.js';

class ChipManager {
  constructor() {
    // Gate services
    this.pageClassifier = new PageClassifier();
    this.intentScorer = new IntentScorer();
    this.subjectExtractor = new SubjectExtractor();
    
    // UI components
    this.assistModal = new AssistModal();
    
    // Caching & cooldowns
    this.cache = new ChipCache();
    this.cooldown = new ChipCooldown();
    
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

export default ChipManager;