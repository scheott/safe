class SafeSignalBadge {
    constructor() {
        this.shadowRoot = null;
        this.badgeContainer = null;
        this.currentState = 'checking';
        this.isVisible = true;
        this.position = 'bottom-right';
        
        // SPA Detection properties
        this.currentUrl = window.location.href;
        this.currentSignature = null;
        this.mutationObserver = null;
        this.pageDebounceTimer = null;
        this.contentDebounceTimer = null;
        this.lastCheck = 0;
        this.checkCooldown = 30 * 60 * 1000; // 30 minutes
        this.sessionUpdateCounts = new Map(); // Track noisy DOM updates
        this.cleanupHandlers = []; // Track cleanup functions
        
        this.init();
    }

    init() {
        if (this.shouldSkipInjection()) {
            return;
        }

        this.createShadowDOMBadge();
        this.attachEventListeners();
        this.setupSPADetection();
        
        // Initial page check - FIXED: use correct method name
        this.checkIfPageChanged('initial_load');
        
        console.log('SafeSignal: Phase 1.3 SPA detection system active');
    }

    shouldSkipInjection() {
        const protocol = window.location.protocol;
        
        // Skip extension pages and non-web protocols
        if (protocol === 'chrome:' || 
            protocol === 'chrome-extension:' ||
            protocol === 'moz-extension:' ||
            protocol === 'about:') {
            return true;
        }
        
        // Skip if we're in an embedded frame (security consideration)
        if (window.top !== window) {
            console.log('SafeSignal: Skipping injection in embedded frame');
            return true;
        }
        
        return false;
    }

    // === SPA DETECTION SYSTEM ===
    
    setupSPADetection() {
        // 1. Patch history API to detect URL changes
        this.patchHistoryAPI();
        
        // 2. Listen for popstate events (back/forward)
        const popstateHandler = () => this.handleURLChange('popstate');
        window.addEventListener('popstate', popstateHandler);
        this.cleanupHandlers.push(() => window.removeEventListener('popstate', popstateHandler));
        
        // 3. Listen for hash changes (hash-only SPAs)
        const hashchangeHandler = () => this.handleURLChange('hashchange');
        window.addEventListener('hashchange', hashchangeHandler);
        this.cleanupHandlers.push(() => window.removeEventListener('hashchange', hashchangeHandler));
        
        // 4. Listen for page show/hide for BFCache handling
        const pageshowHandler = (e) => {
            if (e.persisted) {
                console.log('SafeSignal: Page restored from BFCache, re-initializing');
                this.checkIfPageChanged('bfcache_restore');
            }
        };
        const pagehideHandler = () => this.destroy();
        
        window.addEventListener('pageshow', pageshowHandler);
        window.addEventListener('pagehide', pagehideHandler);
        this.cleanupHandlers.push(() => {
            window.removeEventListener('pageshow', pageshowHandler);
            window.removeEventListener('pagehide', pagehideHandler);
        });
        
        // 5. Setup MutationObserver (with safety check)
        this.setupMutationObserver();
        
        // 6. Generate initial content signature
        this.updateContentSignature();
    }

    patchHistoryAPI() {
        // Monkey patch pushState and replaceState
        const originalPushState = history.pushState;
        const originalReplaceState = history.replaceState;
        
        history.pushState = (...args) => {
            originalPushState.apply(history, args);
            this.handleURLChange('pushState');
            // Emit custom event for other parts of the system
            window.dispatchEvent(new CustomEvent('safesignal:navigate', {
                detail: { source: 'pushState', url: window.location.href }
            }));
        };
        
        history.replaceState = (...args) => {
            originalReplaceState.apply(history, args);
            this.handleURLChange('replaceState');
            // Emit custom event for other parts of the system
            window.dispatchEvent(new CustomEvent('safesignal:navigate', {
                detail: { source: 'replaceState', url: window.location.href }
            }));
        };
        
        // Store original functions for cleanup
        this.cleanupHandlers.push(() => {
            history.pushState = originalPushState;
            history.replaceState = originalReplaceState;
        });
        
        console.log('SafeSignal: History API patched for SPA detection');
    }

    handleURLChange(source) {
        const newUrl = window.location.href;
        if (newUrl !== this.currentUrl) {
            console.log(`SafeSignal: URL changed (${source}):`, this.currentUrl, '→', newUrl);
            this.currentUrl = newUrl;
            
            // Reset signature since we're on a new URL
            this.currentSignature = null;
            this.sessionUpdateCounts.clear();
            
            // Trigger page check with debounce
            this.debouncedPageCheck('url_change');
        }
    }

    setupMutationObserver() {
        // Safety check: ensure document.body exists
        if (!document.body) {
            console.log('SafeSignal: document.body not ready, will retry after DOMContentLoaded');
            const retryHandler = () => {
                if (document.body) {
                    this.setupMutationObserver();
                }
            };
            document.addEventListener('DOMContentLoaded', retryHandler, { once: true });
            return;
        }

        // Watch for DOM changes that might indicate content updates
        this.mutationObserver = new MutationObserver((mutations) => {
            this.handleDOMChanges(mutations);
        });

        // Start observing - FIXED: removed characterData to reduce chattiness
        this.mutationObserver.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: false // Skip attribute changes to reduce noise
            // Removed characterData: true to reduce performance impact
        });
        
        console.log('SafeSignal: MutationObserver active');
    }

    handleDOMChanges(mutations) {
        // Filter out obviously noisy changes
        const significantMutations = mutations.filter(mutation => {
            const target = mutation.target;
            
            // Skip changes in known noisy elements
            if (this.isNoisyElement(target)) {
                this.trackNoisyUpdate(target);
                return false;
            }
            
            // Skip changes in form inputs (contenteditable, textarea, input)
            if (target.isContentEditable || 
                target.tagName === 'TEXTAREA' || 
                target.tagName === 'INPUT') {
                return false;
            }
            
            // Skip very small additions (likely insignificant)
            if (mutation.type === 'childList' && 
                mutation.addedNodes.length === 1 &&
                mutation.addedNodes[0].nodeType === Node.TEXT_NODE &&
                mutation.addedNodes[0].textContent.trim().length < 20) {
                return false;
            }
            
            return true;
        });

        if (significantMutations.length > 0) {
            // Debounced content change check - FIXED: separate timer
            this.debouncedContentCheck();
        }
    }

    isNoisyElement(element) {
        if (!element || !element.closest) return false;
        
        // FIXED: Use curated token list instead of overbroad substring matching
        const noisyTokens = new Set([
            'ad', 'ads', 'advert', 'advertisement', 'sponsored', 'sponsor',
            'promo', 'promotion', 'banner', 'popup', 'modal', 'overlay',
            'carousel', 'slider', 'ticker', 'widget', 'sidebar',
            'chat', 'live-chat', 'notification', 'toast', 'snackbar'
        ]);
        
        // Check element's own classes
        if (element.classList) {
            for (const className of element.classList) {
                if (noisyTokens.has(className.toLowerCase())) {
                    return true;
                }
            }
        }
        
        // Check element's ID
        if (element.id) {
            const id = element.id.toLowerCase();
            if (noisyTokens.has(id) || id.includes('google_ads') || id.includes('adsystem')) {
                return true;
            }
        }
        
        // Check parent elements for noisy containers
        try {
            const noisySelectors = [
                '[class*="google_ads"]', '[id*="google_ads"]',
                '[class*="adsystem"]', '[id*="adsystem"]',
                'iframe[src*="doubleclick"]', 'iframe[src*="googlesyndication"]'
            ];
            
            return noisySelectors.some(selector => {
                try {
                    return element.closest(selector) !== null;
                } catch (e) {
                    return false;
                }
            });
        } catch (e) {
            return false;
        }
    }

    trackNoisyUpdate(element) {
        // Track updates per element to identify truly noisy ones
        const elementKey = this.getElementKey(element);
        const count = this.sessionUpdateCounts.get(elementKey) || 0;
        this.sessionUpdateCounts.set(elementKey, count + 1);
        
        // Log elements that update more than 5 times per minute
        if (count > 5) {
            console.log('SafeSignal: Ignoring noisy element:', elementKey, 'updates:', count);
        }
    }

    getElementKey(element) {
        // Create a simple key for tracking element updates
        const tag = element.tagName || 'TEXT';
        const id = element.id || '';
        const className = element.className || '';
        return `${tag}#${id}.${className}`.substring(0, 50);
    }

    debouncedPageCheck(reason) {
        // FIXED: Use separate timer for page checks
        clearTimeout(this.pageDebounceTimer);
        this.pageDebounceTimer = setTimeout(() => {
            this.checkIfPageChanged(reason);
        }, 800); // 800ms debounce
    }

    debouncedContentCheck() {
        // FIXED: Use separate timer for content checks
        clearTimeout(this.contentDebounceTimer);
        this.contentDebounceTimer = setTimeout(() => {
            this.checkIfContentChanged('content_mutation');
        }, 500); // 500ms debounce for content
    }

    async checkIfPageChanged(reason) {
        console.log(`SafeSignal: Checking page change (${reason})`);
        
        // Always recheck on URL changes
        if (reason === 'url_change' || reason === 'initial_load') {
            this.updateContentSignature();
            await this.performPageAnalysis(reason);
            return;
        }
        
        // For other reasons, check cooldown
        const now = Date.now();
        const timeSinceLastCheck = now - this.lastCheck;
        const origin = this.getOriginKey();
        
        if (timeSinceLastCheck < this.checkCooldown) {
            console.log(`SafeSignal: Skipping check, cooldown active (${Math.round((this.checkCooldown - timeSinceLastCheck) / 1000)}s remaining)`);
            return;
        }
        
        this.updateContentSignature();
        await this.performPageAnalysis(reason);
    }

    async checkIfContentChanged(reason) {
        const newSignature = this.generateContentSignature();
        
        if (newSignature !== this.currentSignature) {
            console.log('SafeSignal: Content signature changed:', this.currentSignature, '→', newSignature);
            this.currentSignature = newSignature;
            
            // Check cooldown before analysis
            const now = Date.now();
            const timeSinceLastCheck = now - this.lastCheck;
            
            if (timeSinceLastCheck >= this.checkCooldown) {
                await this.performPageAnalysis(reason);
            } else {
                console.log('SafeSignal: Content changed but cooldown active');
            }
        }
    }

    generateContentSignature() {
        // Find main content area
        const mainContentEl = this.findMainContentElement();
        if (!mainContentEl) {
            return 'no-content';
        }

        const text = mainContentEl.textContent || '';
        const len = text.length;
        
        // Skip if content is too small
        if (len < 800) {
            return 'content-too-small';
        }

        // PERFORMANCE: Check if length changed significantly before expensive operations
        if (this.currentSignature) {
            const prevLen = parseInt(this.currentSignature.split('|')[0], 10);
            if (Math.abs(len - prevLen) < 50) { // Less than 50 chars changed, probably not significant
                return this.currentSignature;
            }
        }

        // Create signature from content characteristics
        const first1000 = text.substring(0, 1000);
        const last1000 = text.substring(Math.max(0, len - 1000));
        
        // PERFORMANCE: Cap link count to avoid expensive queries on huge DOMs
        const linkCount = Math.min(mainContentEl.querySelectorAll('a').length, 500);
        
        // Simple hash function (CRC32 would be better but this works for demo)
        const h1 = this.simpleHash(first1000);
        const h2 = this.simpleHash(last1000);
        
        const signature = `${len}|${h1}|${h2}|${linkCount}`;
        return signature;
    }

    findMainContentElement() {
        // Try to find the main content area using common selectors
        const selectors = [
            '[role="main"]',
            'main',
            'article',
            '.main-content',
            '#main-content',
            '.content',
            '#content'
        ];

        for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (el && el.textContent.length >= 800) {
                return el;
            }
        }

        // Fallback: find largest text container
        const candidates = Array.from(document.querySelectorAll('div')).filter(div => {
            const textLen = div.textContent.length;
            return textLen >= 800 && !this.isNoisyElement(div);
        });

        if (candidates.length === 0) return document.body;

        // Return the element with the most text content
        return candidates.reduce((largest, current) => {
            return current.textContent.length > largest.textContent.length ? current : largest;
        });
    }

    simpleHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return Math.abs(hash);
    }

    updateContentSignature() {
        this.currentSignature = this.generateContentSignature();
        console.log('SafeSignal: Content signature updated:', this.currentSignature);
    }

    getOriginKey() {
        return `${window.location.protocol}//${window.location.host}`;
    }

    async performPageAnalysis(reason) {
        this.lastCheck = Date.now();
        console.log(`SafeSignal: Performing page analysis (${reason})`);
        
        // Set to checking state
        this.setState('checking');
        
        // Simulate analysis delay
        await this.simulateAnalysis();
        
        // For demo: different outcomes based on URL path and content
        this.determinePageState();
    }

    async simulateAnalysis() {
        // Simulate network call delay
        const delay = Math.random() * 1000 + 500; // 500-1500ms
        await new Promise(resolve => setTimeout(resolve, delay));
    }

    determinePageState() {
        const url = window.location.href.toLowerCase();
        const hostname = window.location.hostname.toLowerCase();
        const path = window.location.pathname.toLowerCase();
        
        // Demo logic based on URL characteristics
        if (hostname.includes('google') || hostname.includes('wikipedia') || hostname.includes('github')) {
            this.setState('ok');
        } else if (path.includes('/login') || path.includes('/signin') || path.includes('/payment')) {
            this.setState('warning');
        } else if (url.includes('?utm_') || path.includes('/ad/') || hostname.includes('doubleclick')) {
            this.setState('warning');
        } else if (hostname.includes('malware') || hostname.includes('phishing') || path.includes('/scam')) {
            this.setState('danger');
        } else {
            // Random for demo
            const states = ['ok', 'warning', 'danger'];
            const weights = [0.7, 0.25, 0.05]; // Mostly OK, some warnings, few dangers
            const randomState = this.weightedRandomChoice(states, weights);
            this.setState(randomState);
        }
    }

    weightedRandomChoice(choices, weights) {
        const random = Math.random();
        let weightSum = 0;
        
        for (let i = 0; i < choices.length; i++) {
            weightSum += weights[i];
            if (random <= weightSum) {
                return choices[i];
            }
        }
        
        return choices[choices.length - 1];
    }

    // === EXISTING BADGE CODE (unchanged) ===

    createShadowDOMBadge() {
        this.badgeContainer = document.createElement('div');
        this.badgeContainer.id = 'safesignal-badge-container';
        this.shadowRoot = this.badgeContainer.attachShadow({ mode: 'closed' });
        
        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    all: initial;
                }
                
                .badge {
                    position: fixed;
                    width: 3rem;
                    height: 3rem;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                    font-size: 1.25rem;
                    font-weight: 600;
                    cursor: pointer;
                    user-select: none;
                    z-index: 2147483647;
                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15), 0 1px 3px rgba(0, 0, 0, 0.1);
                    transition: all 0.2s ease;
                    transform: scale(1);
                    backdrop-filter: blur(8px);
                }
                
                .badge-status {
                    position: absolute;
                    bottom: -40px;
                    left: 50%;
                    transform: translateX(-50%);
                    background: rgba(0, 0, 0, 0.9);
                    color: white;
                    padding: 8px 12px;
                    border-radius: 6px;
                    font-size: 0.75rem;
                    white-space: nowrap;
                    pointer-events: none;
                    opacity: 0;
                    transition: opacity 0.2s ease;
                    z-index: 2147483648;
                }
                
                .badge.show-status .badge-status {
                    opacity: 1;
                }
                
                .badge:hover {
                    transform: scale(1.05);
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2), 0 2px 6px rgba(0, 0, 0, 0.15);
                }
                
                .badge:active {
                    transform: scale(0.95);
                }
                
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
                
                .position-bottom-right {
                    bottom: 1.25rem;
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
                
                @keyframes pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.7; }
                }
                
                .nudged {
                    transform: translate(-16px, -16px);
                }
                
                .position-mid-right.nudged,
                .position-mid-left.nudged {
                    transform: translateY(-50%) translate(-16px, -16px);
                }
                
                .badge:focus {
                    outline: 2px solid #3b82f6;
                    outline-offset: 2px;
                }
                
                .badge.hidden {
                    display: none;
                }
            </style>
            
            <div class="badge checking position-bottom-right" 
                 role="button" 
                 tabindex="0"
                 aria-label="SafeSignal security indicator"
                 aria-live="polite"
                 title="SafeSignal - Checking page safety">
                <span class="badge-icon">S</span>
                <div class="badge-status" role="status" aria-live="polite">Checking...</div>
            </div>
        `;
        
        document.body.appendChild(this.badgeContainer);
        this.handleCollisionDetection();
    }

    attachEventListeners() {
        const badge = this.shadowRoot.querySelector('.badge');
        
        badge.addEventListener('click', (e) => {
            e.stopPropagation();
            this.handleBadgeClick();
        });
        
        badge.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                this.handleBadgeClick();
            }
        });
        
        window.addEventListener('resize', () => {
            this.handleCollisionDetection();
        });
    }

    handleBadgeClick() {
        // FIXED: Use non-blocking status display instead of alert()
        const badge = this.shadowRoot.querySelector('.badge');
        const statusEl = this.shadowRoot.querySelector('.badge-status');
        
        const stateMessages = {
            checking: 'Analyzing page...',
            ok: 'Page appears safe ✅',
            warning: 'Exercise caution ⚠️',
            danger: 'Risk signals detected ❌'
        };
        
        const message = stateMessages[this.currentState] || 'SafeSignal active';
        const details = `\nURL: ${this.currentUrl.substring(0, 50)}...\nLast check: ${new Date(this.lastCheck).toLocaleTimeString()}`;
        
        statusEl.textContent = message;
        badge.classList.add('show-status');
        
        // Hide status after 3 seconds
        setTimeout(() => {
            badge.classList.remove('show-status');
        }, 3000);
        
        console.log('SafeSignal: Badge clicked, current state:', this.currentState, details);
    }

    setState(newState, options = {}) {
        if (!['checking', 'ok', 'warning', 'danger'].includes(newState)) {
            console.warn('SafeSignal: Invalid state:', newState);
            return;
        }

        this.currentState = newState;
        const badge = this.shadowRoot.querySelector('.badge');
        const icon = this.shadowRoot.querySelector('.badge-icon');
        const statusEl = this.shadowRoot.querySelector('.badge-status');
        
        badge.classList.remove('checking', 'ok', 'warning', 'danger');
        badge.classList.add(newState);
        
        const stateConfig = {
            checking: { 
                icon: 'S', 
                label: 'SafeSignal - Checking page safety', 
                title: 'SafeSignal - Checking page safety',
                status: 'Checking...'
            },
            ok: { 
                icon: '✓', 
                label: 'SafeSignal - Page appears safe', 
                title: 'SafeSignal - Page appears safe',
                status: 'Safe'
            },
            warning: { 
                icon: '⚠', 
                label: 'SafeSignal - Exercise caution', 
                title: 'SafeSignal - Exercise caution',
                status: 'Caution'
            },
            danger: { 
                icon: '⚠', 
                label: 'SafeSignal - Risk signals detected', 
                title: 'SafeSignal - Risk signals detected',
                status: 'Risk detected'
            }
        };
        
        const config = stateConfig[newState];
        icon.textContent = config.icon;
        badge.setAttribute('aria-label', config.label);
        badge.setAttribute('title', config.title);
        statusEl.textContent = config.status;
        
        console.log('SafeSignal: State changed to:', newState);
    }

    setPosition(position) {
        const validPositions = ['bottom-right', 'bottom-left', 'top-right', 'top-left', 'mid-right', 'mid-left'];
        
        if (!validPositions.includes(position)) {
            console.warn('SafeSignal: Invalid position:', position);
            return;
        }
        
        const badge = this.shadowRoot.querySelector('.badge');
        
        validPositions.forEach(pos => {
            badge.classList.remove(`position-${pos}`);
        });
        
        badge.classList.add(`position-${position}`);
        this.position = position;
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
        const badge = this.shadowRoot.querySelector('.badge');
        const rect = badge.getBoundingClientRect();
        
        const elementsAtPosition = document.elementsFromPoint(
            rect.left + rect.width / 2, 
            rect.top + rect.height / 2
        ).filter(el => el !== this.badgeContainer);
        
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

    destroy() {
        // Clean up SPA detection
        if (this.mutationObserver) {
            this.mutationObserver.disconnect();
            this.mutationObserver = null;
        }
        
        // FIXED: Clean up both timers
        if (this.pageDebounceTimer) {
            clearTimeout(this.pageDebounceTimer);
            this.pageDebounceTimer = null;
        }
        
        if (this.contentDebounceTimer) {
            clearTimeout(this.contentDebounceTimer);
            this.contentDebounceTimer = null;
        }
        
        // Clean up all event listeners and patches
        this.cleanupHandlers.forEach(cleanup => {
            try {
                cleanup();
            } catch (e) {
                console.warn('SafeSignal: Cleanup error:', e);
            }
        });
        this.cleanupHandlers = [];
        
        // Clean up badge
        if (this.badgeContainer && this.badgeContainer.parentNode) {
            this.badgeContainer.parentNode.removeChild(this.badgeContainer);
        }
        
        console.log('SafeSignal: Badge destroyed, SPA detection cleaned up');
    }
}

// Initialize badge when DOM is ready
let safesignalBadge = null;

function initializeBadge() {
    if (safesignalBadge) {
        safesignalBadge.destroy();
    }
    
    safesignalBadge = new SafeSignalBadge();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeBadge);
} else {
    initializeBadge();
}

window.addEventListener('beforeunload', () => {
    if (safesignalBadge) {
        safesignalBadge.destroy();
    }
});

if (typeof window !== 'undefined') {
    window.SafeSignalBadge = SafeSignalBadge;
}