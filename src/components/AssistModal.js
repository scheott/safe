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
export default AssistModal;