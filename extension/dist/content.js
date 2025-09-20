/******/ (() => { // webpackBootstrap
// SafeSignal Content Script - Phase 1.2: Shadow DOM Badge
// Replace the content in extension/src/content/content.js
console.log('SafeSignal: Content script Phase 1.2 loaded on', window.location.hostname);

class SafeSignalBadge {
    constructor() {
        this.shadowRoot = null;
        this.badgeContainer = null;
        this.currentState = 'checking'; // checking, ok, warning, danger
        this.isVisible = true;
        this.position = 'bottom-right'; // Will be loaded from storage later
        
        this.init();
    }

    init() {
        // Don't inject on chrome:// pages or extension pages
        if (this.shouldSkipInjection()) {
            return;
        }

        this.createShadowDOMBadge();
        this.attachEventListeners();
        
        // Simulate different states for testing (Phase 1.2 dummy data)
        this.simulateStates();
        
        console.log('SafeSignal: Phase 1.2 Shadow DOM badge injected');
    }

    shouldSkipInjection() {
        const protocol = window.location.protocol;
        return protocol === 'chrome:' || 
               protocol === 'chrome-extension:' ||
               protocol === 'moz-extension:' ||
               protocol === 'about:';
    }

    createShadowDOMBadge() {
        // Create container element
        this.badgeContainer = document.createElement('div');
        this.badgeContainer.id = 'safesignal-badge-container';
        
        // Create Shadow DOM to isolate our styles
        this.shadowRoot = this.badgeContainer.attachShadow({ mode: 'closed' });
        
        // Create badge structure
        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    all: initial;
                    /* Ensure we don't inherit any page styles */
                }
                
                .badge {
                    position: fixed;
                    width: 3rem; /* 48px at default zoom, scales with rem */
                    height: 3rem;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                    font-size: 1.25rem; /* 20px, scales with zoom */
                    font-weight: 600;
                    cursor: pointer;
                    user-select: none;
                    z-index: 2147483647; /* Maximum safe z-index */
                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15), 0 1px 3px rgba(0, 0, 0, 0.1);
                    transition: all 0.2s ease;
                    transform: scale(1);
                    backdrop-filter: blur(8px);
                }
                
                .badge:hover {
                    transform: scale(1.05);
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2), 0 2px 6px rgba(0, 0, 0, 0.15);
                }
                
                .badge:active {
                    transform: scale(0.95);
                }
                
                /* State-specific styles */
                .badge.checking {
                    background: linear-gradient(135deg, #6b7280 0%, #9ca3af 100%);
                    color: white;
                    animation: pulse 2s infinite;
                }
                
                .badge.ok {
                    background: linear-gradient(135deg, #10b981 0%, #34d399 100%);
                    color: white;
                }
                
                .badge.warning {
                    background: linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%);
                    color: white;
                }
                
                .badge.danger {
                    background: linear-gradient(135deg, #ef4444 0%, #f87171 100%);
                    color: white;
                }
                
                /* Position classes */
                .position-bottom-right {
                    bottom: 1.25rem; /* 20px */
                    right: 1.25rem;
                }
                
                .position-bottom-left {
                    bottom: 1.25rem;
                    left: 1.25rem;
                }
                
                .position-top-right {
                    top: 1.25rem;
                    right: 1.25rem;
                }
                
                .position-top-left {
                    top: 1.25rem;
                    left: 1.25rem;
                }
                
                .position-mid-right {
                    top: 50%;
                    right: 1.25rem;
                    transform: translateY(-50%);
                }
                
                .position-mid-left {
                    top: 50%;
                    left: 1.25rem;
                    transform: translateY(-50%);
                }
                
                .position-mid-right:hover,
                .position-mid-left:hover {
                    transform: translateY(-50%) scale(1.05);
                }
                
                .position-mid-right:active,
                .position-mid-left:active {
                    transform: translateY(-50%) scale(0.95);
                }
                
                /* Animations */
                @keyframes pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.7; }
                }
                
                /* Collision avoidance nudge */
                .nudged {
                    transform: translate(-16px, -16px);
                }
                
                .position-mid-right.nudged,
                .position-mid-left.nudged {
                    transform: translateY(-50%) translate(-16px, -16px);
                }
                
                /* Accessibility */
                .badge:focus {
                    outline: 2px solid #3b82f6;
                    outline-offset: 2px;
                }
                
                /* Hidden state */
                .badge.hidden {
                    display: none;
                }
            </style>
            
            <div class="badge checking position-bottom-right" 
                 role="button" 
                 tabindex="0"
                 aria-label="SafeSignal security indicator"
                 title="SafeSignal - Checking page safety">
                <span class="badge-icon">S</span>
            </div>
        `;
        
        // Insert into page
        document.body.appendChild(this.badgeContainer);
        
        // Apply collision detection
        this.handleCollisionDetection();
    }

    attachEventListeners() {
        const badge = this.shadowRoot.querySelector('.badge');
        
        // Click handler
        badge.addEventListener('click', (e) => {
            e.stopPropagation();
            this.handleBadgeClick();
        });
        
        // Keyboard handler
        badge.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                this.handleBadgeClick();
            }
        });
        
        // Handle window resize for collision detection
        window.addEventListener('resize', () => {
            this.handleCollisionDetection();
        });
    }

    handleBadgeClick() {
        // For Phase 1.2, just show current state info
        const stateMessages = {
            checking: 'SafeSignal is checking this page...',
            ok: 'SafeSignal: This page appears safe ✅\n\nPhase 1.2 - Shadow DOM implementation working!',
            warning: 'SafeSignal: Exercise caution on this page ⚠️\n\nPhase 1.2 - Warning state demo',
            danger: 'SafeSignal: This page shows risk signals ❌\n\nPhase 1.2 - Danger state demo'
        };
        
        alert(stateMessages[this.currentState] || 'SafeSignal badge clicked');
        
        // Log for development
        console.log('SafeSignal: Badge clicked, current state:', this.currentState);
    }

    setState(newState, options = {}) {
        if (!['checking', 'ok', 'warning', 'danger'].includes(newState)) {
            console.warn('SafeSignal: Invalid state:', newState);
            return;
        }

        this.currentState = newState;
        const badge = this.shadowRoot.querySelector('.badge');
        const icon = this.shadowRoot.querySelector('.badge-icon');
        
        // Remove all state classes
        badge.classList.remove('checking', 'ok', 'warning', 'danger');
        badge.classList.add(newState);
        
        // Update icon and aria-label
        const stateConfig = {
            checking: { icon: 'S', label: 'SafeSignal - Checking page safety', title: 'SafeSignal - Checking page safety' },
            ok: { icon: '✓', label: 'SafeSignal - Page appears safe', title: 'SafeSignal - Page appears safe' },
            warning: { icon: '⚠', label: 'SafeSignal - Exercise caution', title: 'SafeSignal - Exercise caution' },
            danger: { icon: '⚠', label: 'SafeSignal - Risk signals detected', title: 'SafeSignal - Risk signals detected' }
        };
        
        const config = stateConfig[newState];
        icon.textContent = config.icon;
        badge.setAttribute('aria-label', config.label);
        badge.setAttribute('title', config.title);
        
        console.log('SafeSignal: State changed to:', newState);
    }

    setPosition(position) {
        const validPositions = ['bottom-right', 'bottom-left', 'top-right', 'top-left', 'mid-right', 'mid-left'];
        
        if (!validPositions.includes(position)) {
            console.warn('SafeSignal: Invalid position:', position);
            return;
        }
        
        const badge = this.shadowRoot.querySelector('.badge');
        
        // Remove all position classes
        validPositions.forEach(pos => {
            badge.classList.remove(`position-${pos}`);
        });
        
        // Add new position class
        badge.classList.add(`position-${position}`);
        this.position = position;
        
        // Recheck collision detection
        this.handleCollisionDetection();
        
        console.log('SafeSignal: Position changed to:', position);
    }

    hide() {
        const badge = this.shadowRoot.querySelector('.badge');
        badge.classList.add('hidden');
        this.isVisible = false;
    }

    show() {
        const badge = this.shadowRoot.querySelector('.badge');
        badge.classList.remove('hidden');
        this.isVisible = true;
    }

    handleCollisionDetection() {
        // Basic collision detection - check for overlapping elements
        // This is a simplified version - Phase 1.3 will enhance this
        const badge = this.shadowRoot.querySelector('.badge');
        const rect = badge.getBoundingClientRect();
        
        // Get elements at badge position (excluding our own badge)
        const elementsAtPosition = document.elementsFromPoint(
            rect.left + rect.width / 2, 
            rect.top + rect.height / 2
        ).filter(el => el !== this.badgeContainer);
        
        // Simple heuristic: if there are other visible elements at our position, nudge
        const hasCollision = elementsAtPosition.some(el => {
            const style = window.getComputedStyle(el);
            return style.position === 'fixed' && 
                   style.zIndex !== 'auto' && 
                   parseInt(style.zIndex) > 1000;
        });
        
        if (hasCollision) {
            badge.classList.add('nudged');
            console.log('SafeSignal: Collision detected, badge nudged');
        } else {
            badge.classList.remove('nudged');
        }
    }

    // Phase 1.2 Demo: Simulate different states for testing
    simulateStates() {
        // Start in checking state
        setTimeout(() => {
            // Simulate different outcomes based on domain for demo
            const hostname = window.location.hostname.toLowerCase();
            
            if (hostname.includes('google') || hostname.includes('wikipedia') || hostname.includes('github')) {
                this.setState('ok');
            } else if (hostname.includes('test') || hostname.includes('example')) {
                this.setState('warning');
            } else if (hostname.includes('malware') || hostname.includes('phishing')) {
                this.setState('danger');
            } else {
                // Random state for demo
                const states = ['ok', 'warning', 'danger'];
                const randomState = states[Math.floor(Math.random() * states.length)];
                this.setState(randomState);
            }
        }, 2000); // 2 second delay to show checking state
    }

    destroy() {
        if (this.badgeContainer && this.badgeContainer.parentNode) {
            this.badgeContainer.parentNode.removeChild(this.badgeContainer);
        }
        console.log('SafeSignal: Badge destroyed');
    }
}

// Initialize badge when DOM is ready
let safesignalBadge = null;

function initializeBadge() {
    // Clean up any existing badge
    if (safesignalBadge) {
        safesignalBadge.destroy();
    }
    
    // Create new badge
    safesignalBadge = new SafeSignalBadge();
}

// Wait for DOM to be ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeBadge);
} else {
    initializeBadge();
}

// Clean up on page unload
window.addEventListener('beforeunload', () => {
    if (safesignalBadge) {
        safesignalBadge.destroy();
    }
});

// Export for potential Phase 1.3 usage
if (typeof window !== 'undefined') {
    window.SafeSignalBadge = SafeSignalBadge;
}
/******/ })()
;
//# sourceMappingURL=content.js.map