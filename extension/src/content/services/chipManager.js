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
      console.log(`[ChipManager] Low confidence (${extraction.confidence}) - showing with edit option`);
      
      this.trackGatesPassed(chipType, this.lastIntentScores[chipType], extraction.subject, {
        lowConfidence: true,
        failReason: extraction.failReason
      });
            
      return {
        show: true,
        state: 'ready_editable', // New state: chip shows but with edit UI
        subject: extraction.subject,
        confidence: extraction.confidence,
        needsEdit: true, // Flag to show "✏️ Edit" button
        failReason: extraction.failReason
      };
    }
    
    // ==================== ALL GATES PASSED ====================
    this.trackGatesPassed(chipType, this.lastIntentScores[chipType], extraction.subject);

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
      
    } else if (result.state === 'ready_editable') {
      // ELDER-FIRST: Show chip immediately with subtle edit button
      console.log(`[ChipManager] Showing ${chipType} chip with edit option`);
      this.showChipWithSubject(chipType, result.subject, {
        editable: true,
        confidence: result.confidence,
        failReason: result.failReason
      });
      
    } else if (result.state === 'ready') {
      // High confidence - show without edit button
      this.showChipWithSubject(chipType, result.subject, { editable: false });
    }
  }
  
  /**
   * Show chip with specific subject
   */
  showChipWithSubject(chipType, subject, options = {}) {
    const chipElement = this.getChipElement(chipType);
    if (!chipElement) {
      console.warn(`[ChipManager] Cannot show ${chipType} chip - element not found`);
      return;  // ✅ Don't set cooldown if chip doesn't exist
    }
    
    // Update chip content
    const subjectSpan = chipElement.querySelector('.chip-subject');
    if (subjectSpan) {
      subjectSpan.textContent = this.truncateSubject(subject);
    }
    
    // Add or remove edit button based on confidence
    if (options.editable) {
      this.addEditButton(chipElement, chipType, subject, options.failReason);
    } else {
      this.removeEditButton(chipElement);
    }
    
    // Show chip
    chipElement.style.display = 'flex';
    chipElement.classList.add('visible');
    chipElement.setAttribute('data-subject', subject);
    chipElement.setAttribute('data-confidence', options.confidence || 'high');
    
    this.chipStates[chipType] = { 
      visible: true, 
      subject,
      editable: options.editable 
    };
    
    this.updateChipsWrapperVisibility();
    
    console.log(`[ChipManager] ${chipType} chip shown${options.editable ? ' (editable)' : ''}: ${subject}`);
    
    // ✅ ADDED: Set cooldown ONLY after successful render
    this.cooldown.setUrlCooldown(chipType).catch(err => {
      console.error('[ChipManager] Failed to set cooldown:', err);
    });
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
  /**
   * Add subtle edit button to chip
   */
  addEditButton(chipElement, chipType, currentSubject, failReason) {
    // Remove existing edit button if present
    this.removeEditButton(chipElement);
    
    const editBtn = document.createElement('button');
    editBtn.className = 'chip-edit-btn';
    editBtn.innerHTML = '✏️';
    editBtn.title = 'Edit topic';
    editBtn.setAttribute('aria-label', 'Edit topic');
    
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.showInlineEditor(chipElement, chipType, currentSubject, failReason);
    });
    
    chipElement.appendChild(editBtn);
  }

  /**
   * Remove edit button from chip
   */
  removeEditButton(chipElement) {
    const existingBtn = chipElement.querySelector('.chip-edit-btn');
    if (existingBtn) {
      existingBtn.remove();
    }
  }

  /**
   * Show inline editor (replaces modal)
   */
  showInlineEditor(chipElement, chipType, currentSubject, failReason) {
    const editor = document.createElement('div');
    editor.className = 'chip-inline-editor';
    
    const reasonText = failReason === 'contains_generic_term' 
      ? 'Too generic. Make it more specific:'
      : failReason === 'brand_only'
      ? 'Add product details:'
      : 'Refine the topic:';
    
    editor.innerHTML = `
      <div class="editor-header">${reasonText}</div>
      <input type="text" 
            class="editor-input" 
            value="${currentSubject}"
            placeholder="${chipType === 'health' ? 'e.g., Intermittent fasting' : 'e.g., Sony WH-1000XM5'}"
            maxlength="80" />
      <div class="editor-actions">
        <button class="editor-save">Save</button>
        <button class="editor-cancel">Cancel</button>
      </div>
    `;
    
    // Replace chip content with editor
    const originalContent = chipElement.innerHTML;
    chipElement.innerHTML = '';
    chipElement.appendChild(editor);
    chipElement.classList.add('chip-editing');
    
    const input = editor.querySelector('.editor-input');
    const saveBtn = editor.querySelector('.editor-save');
    const cancelBtn = editor.querySelector('.editor-cancel');
    
    // Auto-focus and select
    input.focus();
    input.select();
    
    // Save handler
    const saveEdit = () => {
      const newSubject = input.value.trim();
      if (newSubject && newSubject !== currentSubject) {
        chipElement.classList.remove('chip-editing');
        this.showChipWithSubject(chipType, newSubject, { editable: false });
        this.showUndoNotification(chipType, currentSubject, newSubject);
        
        // Track edit
        if (window.trackEvent) {
          window.trackEvent('chip_edited', {
            chipType,
            oldSubject: currentSubject,
            newSubject,
            failReason
          });
        }
      } else {
        chipElement.innerHTML = originalContent;
        chipElement.classList.remove('chip-editing');
      }
    };
    
    // Cancel handler
    const cancelEdit = () => {
      chipElement.innerHTML = originalContent;
      chipElement.classList.remove('chip-editing');
    };
    
    saveBtn.addEventListener('click', saveEdit);
    cancelBtn.addEventListener('click', cancelEdit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveEdit();
      if (e.key === 'Escape') cancelEdit();
    });
  }

  /**
   * Show subtle undo notification (5 seconds)
   */
  showUndoNotification(chipType, oldSubject, newSubject) {
    const notification = document.createElement('div');
    notification.className = 'chip-undo-notification';
    notification.innerHTML = `
      <span>Updated to "${this.truncateSubject(newSubject)}"</span>
      <button class="undo-btn">Undo</button>
    `;
    
    const chipElement = this.getChipElement(chipType);
    const container = chipElement.closest('.chips-wrapper') || chipElement.parentElement;
    container.appendChild(notification);
    
    const undoBtn = notification.querySelector('.undo-btn');
    undoBtn.addEventListener('click', () => {
      this.showChipWithSubject(chipType, oldSubject, { editable: true });
      notification.remove();
      
      if (window.trackEvent) {
        window.trackEvent('chip_edit_undone', {
          chipType,
          restoredSubject: oldSubject
        });
      }
    });
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
      if (notification.parentElement) {
        notification.classList.add('fade-out');
        setTimeout(() => notification.remove(), 300);
      }
    }, 5000);
  }
}

export default ChipManager;