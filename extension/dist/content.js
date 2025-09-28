/******/ (() => { // webpackBootstrap
// SafeSignal Content Script - Enhanced Badge Implementation
// Injects a floating badge on web pages to show safety status

// ---- VERSION STAMP FOR DEBUGGING ----
const SAFESIGNAL_BUILD = 'content-2025-09-28-16:45'; // bump each build
console.info('[SafeSignal] build:', SAFESIGNAL_BUILD);

class SafeSignalBadge {
    constructor() {
        this.shadowRoot = null;
        this.badgeContainer = null;
        this.currentState = 'checking';
        this.positionState = { anchor: 'bottom-right', offsetX: 0, offsetY: 0 };
        
        // Positioning helper (will be initialized after shadow root)
        this.positioning = null;
        
        // SPA Detection properties
        this.currentUrl = window.location.href;
        this.currentSignature = null;
        this.mutationObserver = null;
        this.pageDebounceTimer = null;
        this.lastCheckByUrl = new Map(); // Per-URL cooldown tracking
        this.checkCooldown = 30 * 60 * 1000; // 30 minutes
        this.cleanupHandlers = [];
        this.pageHidden = false;
        
        // UI state
        this.isMenuOpen = false;
        this.proximityCheckInterval = null;
        this.userPreferences = {
            positioning: { anchor: 'bottom-right', offsetX: 0, offsetY: 0 },
            hiddenSites: new Set()
        };
        
        this.init();
    }

    async init() {
        if (this.shouldSkipInjection()) {
            return;
        }

        await this.loadUserPreferences();
        
        if (this.isSiteHidden()) {
            console.log('SafeSignal: Badge hidden on this site per user preference');
            return;
        }

        this.createShadowDOMBadge();
        this.attachEventListeners();
        
        // Initialize positioning helper after shadow root AND event listeners are created
        this.positioning = new SafeSignalBadgePositioning(this.shadowRoot);
        this.setupSPADetection();
        
        // Apply saved positioning
        this.applyPositioning(this.userPreferences.positioning);
        
        // Position status bubble correctly on first paint
        this.updateStatusBubblePosition();
        
        this.checkIfPageChanged('initial_load');
        
        console.log('SafeSignal: Badge active');
    }

    shouldSkipInjection() {
        const protocol = window.location.protocol;
        
        if (protocol === 'chrome:' || 
            protocol === 'chrome-extension:' ||
            protocol === 'moz-extension:' ||
            protocol === 'about:') {
            return true;
        }
        
        if (window.top !== window) {
            console.log('SafeSignal: Skipping injection in embedded frame');
            return true;
        }
        
        return false;
    }

    // === UTILITY METHODS ===
    
    getOriginKey() {
        return `${window.location.protocol}//${window.location.host}`;
    }

    // === ENHANCED POSITIONING SYSTEM ===
    
    getBadgeRect() {
        const el = this.shadowRoot?.querySelector('.badge');
        return el ? el.getBoundingClientRect() : { width: 48, height: 48, left: 0, top: 0 };
    }
    
    getAnchorPositions() {
        const padding = 20;
        const systemBarHeight = 100;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        
        return {
            'top-left': { x: padding, y: padding },
            'top-right': { x: viewportWidth - padding, y: padding },
            'mid-left': { x: padding, y: viewportHeight / 2 },
            'mid-right': { x: viewportWidth - padding, y: viewportHeight / 2 },
            'bottom-left': { x: padding, y: viewportHeight - systemBarHeight },
            'bottom-right': { x: viewportWidth - padding, y: viewportHeight - systemBarHeight }
        };
    }

    applyPositioning(positioning) {
        if (!this.shadowRoot) return;
        
        const { anchor, offsetX = 0, offsetY = 0 } = positioning;
        const anchorPositions = this.getAnchorPositions();
        const anchorPos = anchorPositions[anchor] || anchorPositions['bottom-right'];
        
        const badge = this.shadowRoot.querySelector('.badge');
        if (!badge) return;
        
        const { width: badgeW, height: badgeH } = this.getBadgeRect();
        
        // Calculate final position
        let finalX = anchorPos.x + offsetX;
        let finalY = anchorPos.y + offsetY;
        
        // Adjust for badge size based on anchor
        if (anchor.includes('right')) finalX -= badgeW;
        if (anchor.includes('bottom')) finalY -= badgeH;
        if (anchor.includes('mid')) {
            if (anchor.includes('left') || anchor.includes('right')) {
                finalY -= badgeH / 2;
            }
        }
        
        // Apply safe bounds with more margin
        finalX = Math.max(16, Math.min(finalX, window.innerWidth - badgeW - 16));
        finalY = Math.max(16, Math.min(finalY, window.innerHeight - badgeH - 16));
        
        // Apply position
        badge.style.position = 'fixed';
        badge.style.left = `${finalX}px`;
        badge.style.top = `${finalY}px`;
        badge.style.right = 'auto';
        badge.style.bottom = 'auto';
        
        // Update internal state
        this.positionState = { anchor, offsetX, offsetY };
        
        // Update active state in UI
        this.updatePositionGridUI(anchor);
        
        console.log('SafeSignal: Applied positioning:', { anchor, offsetX, offsetY, finalX, finalY });
    }

    updatePositionGridUI(activeAnchor) {
        if (!this.shadowRoot) return;
        
        const positionOptions = this.shadowRoot.querySelectorAll('.position-option');
        positionOptions.forEach(option => {
            option.classList.remove('active');
            if (option.dataset.position === activeAnchor) {
                option.classList.add('active');
            }
        });
    }

    // === STORAGE & PREFERENCES ===

    async loadUserPreferences() {
        try {
            const origin = this.getOriginKey();
            
            // Safe cross-browser storage check with runtime validation
            const storage =
                (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id && chrome.storage?.sync) ||
                (typeof browser !== 'undefined' && browser.storage?.sync);
            
            if (!storage) {
                console.warn('SafeSignal: Browser storage not available or extension context invalidated');
                return;
            }
            
            const result = await storage.get(['safesignal_positioning', 'safesignal_hidden_sites']);
            
            const positioningData = result.safesignal_positioning || {};
            if (positioningData[origin]) {
                this.userPreferences.positioning = positioningData[origin];
            }
            
            const hiddenSites = new Set(result.safesignal_hidden_sites || []);
            this.userPreferences.hiddenSites = hiddenSites;
            
            console.log('SafeSignal: Loaded preferences:', this.userPreferences);
        } catch (e) {
            console.warn('SafeSignal: Could not load preferences (extension context may be invalidated):', e);
        }
    }

    async savePositioningPreference(positioning) {
        try {
            // Safe cross-browser storage check with runtime validation
            const storage =
                (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id && chrome.storage?.sync) ||
                (typeof browser !== 'undefined' && browser.storage?.sync);
            
            if (!storage) {
                console.warn('SafeSignal: Browser storage not available or extension context invalidated');
                return;
            }
            
            const result = await storage.get(['safesignal_positioning']);
            const positioningData = result.safesignal_positioning || {};
            
            const origin = this.getOriginKey();
            positioningData[origin] = positioning;
            
            await storage.set({
                safesignal_positioning: positioningData
            });
            
            this.userPreferences.positioning = positioning;
            console.log('SafeSignal: Saved positioning preference:', positioning, 'for', origin);
        } catch (e) {
            console.warn('SafeSignal: Could not save positioning preference (extension context may be invalidated):', e);
        }
    }

    isSiteHidden() {
        const origin = this.getOriginKey();
        return this.userPreferences.hiddenSites.has(origin);
    }

    // === BADGE CREATION ===

    createShadowDOMBadge() {
        // Mount to documentElement to avoid body transform issues
        this.badgeContainer = document.createElement('div');
        this.badgeContainer.id = 'safesignal-badge-container';
        this.badgeContainer.setAttribute('data-safesignal-build', SAFESIGNAL_BUILD); // Debug stamp
        this.shadowRoot = this.badgeContainer.attachShadow({ mode: 'open' });
        
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
                    z-index: 999999;
                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15), 0 1px 3px rgba(0, 0, 0, 0.1);
                    transition: all 0.2s ease;
                    transform: scale(1);
                    touch-action: manipulation;
                }
                
                .badge:hover {
                    transform: scale(1.05);
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2), 0 2px 6px rgba(0, 0, 0, 0.15);
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
                
                @keyframes pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.7; }
                }
                
                .badge:focus {
                    outline: 3px solid #3b82f6;
                    outline-offset: 2px;
                }
                
                .badge.hidden {
                    display: none;
                }
                
                @media (prefers-reduced-motion: reduce) {
                    .badge {
                        transition: none;
                        animation: none !important;
                    }
                }
                
                .badge-status {
                    position: absolute;
                    left: 50%;
                    transform: translateX(-50%);
                    background: rgba(0, 0, 0, 0.9);
                    color: white;
                    padding: 8px 12px;
                    border-radius: 8px;
                    font-size: 0.75rem;
                    pointer-events: none;
                    opacity: 0;
                    transition: opacity 0.2s ease;
                    z-index: 1000000;
                    max-width: 200px;
                    word-wrap: break-word;
                    white-space: normal;
                    text-align: center;
                    line-height: 1.2;
                }
                
                .badge.bottom-positioned .badge-status {
                    bottom: 100%;
                    margin-bottom: 8px;
                }
                
                .badge.top-positioned .badge-status {
                    top: 100%;
                    margin-top: 8px;
                }
                
                .badge.show-status .badge-status {
                    opacity: 1;
                }
                
                .menu-button {
                    position: absolute;
                    top: -8px;
                    right: -8px;
                    width: 20px;
                    height: 20px;
                    border-radius: 50%;
                    background: rgba(0, 0, 0, 0.7);
                    color: white;
                    border: none;
                    font-size: 12px;
                    font-weight: bold;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    opacity: 0;
                    transition: opacity 0.2s ease;
                    z-index: 1000001;
                }
                
                .badge:hover .menu-button,
                .badge:focus .menu-button {
                    opacity: 1;
                }
                
                .menu-button:hover {
                    background: rgba(0, 0, 0, 0.9);
                    transform: scale(1.1);
                }
                
                .badge-menu {
                    position: fixed;
                    background: white;
                    border: 1px solid #e1e5e9;
                    border-radius: 8px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                    padding: 12px;
                    min-width: 140px;
                    z-index: 2147483646;
                    contain: paint;
                    opacity: 0;
                    visibility: hidden;
                    transition: opacity 0.2s ease, visibility 0.2s ease;
                    font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                }
                
                .badge-menu.show {
                    opacity: 1;
                    visibility: visible;
                }
                
                .menu-section {
                    margin-bottom: 8px;
                }
                
                .menu-section:last-child {
                    margin-bottom: 0;
                }
                
                .menu-label {
                    font-size: 0.75rem;
                    font-weight: 600;
                    color: #6b7280;
                    margin-bottom: 6px;
                    text-transform: uppercase;
                    letter-spacing: 0.025em;
                }
                
                .position-grid {
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 4px;
                    width: 60px;
                    height: 48px;
                }
                
                .position-option {
                    width: 16px;
                    height: 12px;
                    border: 1px solid #d1d5db;
                    border-radius: 2px;
                    background: #f9fafb;
                    cursor: pointer;
                    transition: all 0.1s ease;
                }
                
                .position-option:hover {
                    background: #e5e7eb;
                    border-color: #9ca3af;
                }
                
                .position-option.active {
                    background: #3b82f6;
                    border-color: #2563eb;
                }
                
                .menu-item {
                    width: 100%;
                    padding: 8px 12px;
                    border: none;
                    background: none;
                    text-align: left;
                    font-size: 0.875rem;
                    color: #374151;
                    cursor: pointer;
                    border-radius: 4px;
                    transition: background-color 0.1s ease;
                }
                
                .menu-item:hover {
                    background: #f3f4f6;
                }
                
                .menu-item.danger {
                    color: #dc2626;
                }
                
                .menu-item.danger:hover {
                    background: #fef2f2;
                }
            </style>
            
            <div class="badge" role="button" tabindex="0" aria-label="SafeSignal - Page safety indicator">
                <span class="badge-icon">S</span>
                <div class="badge-status" role="status" aria-live="polite">Checking...</div>
                
                <button class="menu-button" 
                        type="button"
                        title="Move badge"
                        aria-label="Move badge to different position"
                        aria-expanded="false">⋯</button>
                
                <div class="badge-menu" role="menu" aria-label="Badge position options">
                    <div class="menu-section">
                        <div class="menu-label">Move Badge</div>
                        <div class="position-grid" role="group" aria-label="Position options">
                            <button class="position-option" 
                                    data-position="top-left" 
                                    type="button"
                                    title="Top Left"
                                    aria-label="Top left corner"></button>
                            <div></div>
                            <button class="position-option" 
                                    data-position="top-right" 
                                    type="button"
                                    title="Top Right"
                                    aria-label="Top right corner"></button>
                            <button class="position-option" 
                                    data-position="mid-left" 
                                    type="button"
                                    title="Middle Left"
                                    aria-label="Middle left side"></button>
                            <div></div>
                            <button class="position-option" 
                                    data-position="mid-right" 
                                    type="button"
                                    title="Middle Right"
                                    aria-label="Middle right side"></button>
                            <button class="position-option" 
                                    data-position="bottom-left" 
                                    type="button"
                                    title="Bottom Left"
                                    aria-label="Bottom left corner"></button>
                            <div></div>
                            <button class="position-option active" 
                                    data-position="bottom-right" 
                                    type="button"
                                    title="Bottom Right"
                                    aria-label="Move badge to bottom right"></button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        // Mount to documentElement to avoid body transform issues
        document.documentElement.appendChild(this.badgeContainer);
    }

    attachEventListeners() {
        const badge = this.shadowRoot.querySelector('.badge');
        const menuButton = this.shadowRoot.querySelector('.menu-button');
        const menu = this.shadowRoot.querySelector('.badge-menu');
        
        // Badge interactions
        badge.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!this.isMenuOpen) {
                this.handleBadgeClick();
            }
        });
        
        // Keyboard navigation
        badge.addEventListener('keydown', (e) => {
            this.handleKeyboardNavigation(e);
        });
        
        // Menu button
        menuButton.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            this.toggleMenu();
        });
        
        // Position options
        const positionOptions = this.shadowRoot.querySelectorAll('.position-option');
        positionOptions.forEach(option => {
            option.addEventListener('click', (e) => {
                e.stopPropagation();
                const anchor = option.dataset.position;
                this.handlePositionSelect(anchor);
            });
        });
        
        // Close menu when clicking outside
        const onDocClick = () => { 
            if (this.isMenuOpen) this.closeMenu(); 
        };
        document.addEventListener('click', onDocClick);
        this.cleanupHandlers.push(() => document.removeEventListener('click', onDocClick));
        
        // Prevent menu clicks from closing menu
        menu.addEventListener('click', (e) => {
            e.stopPropagation();
        });
        
        // Listen for custom events from portaled menu
        document.addEventListener('safesignal-position-select', (e) => {
            this.handlePositionSelect(e.detail.anchor);
        });
        
        // Window resize handler with throttling
        let resizeRaf = null;
        const onResize = () => {
            if (resizeRaf) return;
            resizeRaf = requestAnimationFrame(() => {
                resizeRaf = null;
                this.applyPositioning(this.positionState);
                this.updateStatusBubblePosition();
                
                // Reposition context buttons on resize
                if (this.contextButtons.length > 0) {
                    this.updateContextButtons();
                }
                
                // Reposition menu if open
                if (this.isMenuOpen) {
                    this.positionMenu();
                }
            });
        };
        window.addEventListener('resize', onResize);
        this.cleanupHandlers.push(() => window.removeEventListener('resize', onResize));
        
        // Listen to visual viewport changes (mobile keyboard)
        if (window.visualViewport) {
            const onViewportChange = () => {
                if (this.isMenuOpen) {
                    this.positionMenu();
                }
            };
            window.visualViewport.addEventListener('resize', onViewportChange);
            this.cleanupHandlers.push(() => 
                window.visualViewport?.removeEventListener('resize', onViewportChange)
            );
        }
        
        // Visibility change handler for performance
        const onVisibilityChange = () => {
            this.pageHidden = document.hidden;
        };
        document.addEventListener('visibilitychange', onVisibilityChange);
        this.cleanupHandlers.push(() => document.removeEventListener('visibilitychange', onVisibilityChange));
        
        // Input proximity detection with proper cleanup tracking
        this.proximityCheckInterval = setInterval(() => {
            this.checkInputProximity();
        }, 2000);
        this.cleanupHandlers.push(() => {
            if (this.proximityCheckInterval) {
                clearInterval(this.proximityCheckInterval);
                this.proximityCheckInterval = null;
            }
        });
    }

    checkInputProximity() {
        if (!this.shadowRoot || this.isMenuOpen) return;
        
        const badge = this.shadowRoot.querySelector('.badge');
        if (!badge) return;
        
        const rect = badge.getBoundingClientRect();
        
        // Check if badge overlaps with any input elements
        const elementsNearby = document.elementsFromPoint(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2
        );
        
        const nearInput = elementsNearby.some(el => {
            return el.tagName === 'INPUT' || 
                   el.tagName === 'TEXTAREA' || 
                   el.isContentEditable;
        });
        
        if (nearInput) {
            console.log('SafeSignal: Badge near input field');
        }
    }

    updateStatusBubblePosition() {
        const badge = this.shadowRoot?.querySelector('.badge');
        if (!badge) return;
        
        const rect = badge.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        
        // Remove existing positioning classes
        badge.classList.remove('bottom-positioned', 'top-positioned');
        
        // If badge is in bottom half of screen, show status above
        if (rect.bottom > viewportHeight * 0.6) {
            badge.classList.add('bottom-positioned');
        } else {
            badge.classList.add('top-positioned');
        }
    }

    handleBadgeClick() {
        const badge = this.shadowRoot.querySelector('.badge');
        const statusEl = this.shadowRoot.querySelector('.badge-status');
        
        const stateMessages = {
            checking: 'Analyzing page...',
            ok: 'Page appears safe ✅',
            warning: 'Exercise caution ⚠️',
            danger: 'Risk signals detected ❌'
        };
        
        const message = stateMessages[this.currentState] || 'SafeSignal active';
        statusEl.textContent = message;
        
        // Update status bubble position before showing
        this.updateStatusBubblePosition();
        
        badge.classList.add('show-status');
        
        setTimeout(() => {
            badge.classList.remove('show-status');
        }, 3000);
        
        console.log('SafeSignal: Badge clicked, current state:', this.currentState);
    }

    setState(newState, options = {}) {
        if (!this.shadowRoot) return;
        
        const badge = this.shadowRoot.querySelector('.badge');
        const icon = this.shadowRoot.querySelector('.badge-icon');
        
        // Remove existing state classes
        badge.classList.remove('checking', 'ok', 'warning', 'danger');
        
        // Add new state
        badge.classList.add(newState);
        this.currentState = newState;
        
        // Update icon and aria-label
        const states = {
            checking: { icon: 'S', label: 'SafeSignal - Checking page safety' },
            ok: { icon: '✓', label: 'SafeSignal - Page appears safe' },
            warning: { icon: '⚠', label: 'SafeSignal - Exercise caution on this page' },
            danger: { icon: '✗', label: 'SafeSignal - Risk signals detected on this page' }
        };
        
        if (states[newState]) {
            icon.textContent = states[newState].icon;
            badge.setAttribute('aria-label', states[newState].label);
        }
        
        console.log('SafeSignal: State changed to:', newState);
    }

    handleKeyboardNavigation(e) {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            this.handleBadgeClick();
        } else if (e.key === 'Escape' && this.isMenuOpen) {
            this.closeMenu();
        }
    }

    // === MENU SYSTEM ===

    toggleMenu() {
        if (this.isMenuOpen) {
            this.closeMenu();
        } else {
            this.openMenu();
        }
    }

    openMenu() {
        if (!this.shadowRoot || this.isMenuOpen) return;
        
        const menu = this.shadowRoot.querySelector('.badge-menu');
        const menuButton = this.shadowRoot.querySelector('.menu-button');
        
        if (!menu) return;
        
        menu.classList.add('show');
        menuButton.setAttribute('aria-expanded', 'true');
        this.isMenuOpen = true;
        this.positioning.activeMenuEl = menu; // Track active menu
        
        // Position menu relative to badge
        this.positionMenu();
        
        console.log('SafeSignal: Menu opened');
    }

    closeMenu() {
        if (!this.shadowRoot || !this.isMenuOpen) return;
        
        const menu = this.shadowRoot.querySelector('.badge-menu');
        const menuButton = this.shadowRoot.querySelector('.menu-button');
        
        if (!menu) return;
        
        menu.classList.remove('show');
        menuButton.setAttribute('aria-expanded', 'false');
        this.isMenuOpen = false;
        this.positioning.activeMenuEl = null; // Clear active menu reference
        
        console.log('SafeSignal: Menu closed');
    }

    positionMenu() {
        const menu = this.shadowRoot.querySelector('.badge-menu');
        const badge = this.shadowRoot.querySelector('.badge');
        
        if (!menu || !badge) return;
        
        const badgeRect = badge.getBoundingClientRect();
        const menuRect = menu.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        
        // Calculate preferred position (to the right of badge)
        let left = badgeRect.right + 8;
        let top = badgeRect.top;
        
        // Adjust if menu would go off-screen
        if (left + menuRect.width > viewportWidth - 16) {
            // Position to the left instead
            left = badgeRect.left - menuRect.width - 8;
        }
        
        if (top + menuRect.height > viewportHeight - 16) {
            // Position above badge
            top = badgeRect.bottom - menuRect.height;
        }
        
        // Ensure menu stays within viewport
        left = Math.max(16, Math.min(left, viewportWidth - menuRect.width - 16));
        top = Math.max(16, Math.min(top, viewportHeight - menuRect.height - 16));
        
        menu.style.left = `${left}px`;
        menu.style.top = `${top}px`;
    }

    handlePositionSelect(anchor) {
        const newPositioning = { anchor, offsetX: 0, offsetY: 0 };
        this.applyPositioning(newPositioning);
        this.savePositioningPreference(newPositioning);
        this.closeMenu();
        
        console.log('SafeSignal: Position selected:', anchor);
    }

    // === SPA DETECTION ===

    setupSPADetection() {
        // Patch history methods with error handling
        try {
            const originalPushState = history.pushState;
            const originalReplaceState = history.replaceState;
            
            history.pushState = (...args) => {
                originalPushState.apply(history, args);
                this.checkIfPageChanged('url_change');
            };
            
            history.replaceState = (...args) => {
                originalReplaceState.apply(history, args);
                this.checkIfPageChanged('url_change');
            };
            
            // Listen for popstate events
            const onPopState = () => {
                this.checkIfPageChanged('url_change');
            };
            window.addEventListener('popstate', onPopState);
            
            // Cleanup
            this.cleanupHandlers.push(() => {
                history.pushState = originalPushState;
                history.replaceState = originalReplaceState;
                window.removeEventListener('popstate', onPopState);
            });
            
            console.log('SafeSignal: SPA detection enabled');
        } catch (e) {
            console.warn('SafeSignal: Could not patch history methods:', e);
        }
    }

    generateContentSignature() {
        try {
            // Find main content areas
            const mainSelectors = ['[role="main"]', 'main', 'article', '#main', '.main-content'];
            let mainElement = null;
            
            for (const selector of mainSelectors) {
                mainElement = document.querySelector(selector);
                if (mainElement) break;
            }
            
            // Fallback to largest text container
            if (!mainElement) {
                const candidates = document.querySelectorAll('div, section, article');
                let maxLength = 0;
                for (const el of candidates) {
                    const textLength = (el.textContent || '').length;
                    if (textLength > maxLength) {
                        maxLength = textLength;
                        mainElement = el;
                    }
                }
            }
            
            if (!mainElement) return 'no-content';
            
            const text = mainElement.textContent || '';
            const len = text.length;
            
            if (len === 0) return 'empty';
            
            // Simple hash of first/last 1000 chars + link count
            const first1k = text.substring(0, 1000);
            const last1k = text.substring(Math.max(0, len - 1000));
            const linkCount = mainElement.querySelectorAll('a').length;
            
            // Simple hash function
            const hash = (str) => {
                let hash = 0;
                for (let i = 0; i < str.length; i++) {
                    const char = str.charCodeAt(i);
                    hash = ((hash << 5) - hash) + char;
                    hash = hash & hash; // Convert to 32-bit integer
                }
                return hash;
            };
            
            const h1 = hash(first1k);
            const h2 = hash(last1k);
            
            return `${len}|${h1}|${h2}|${linkCount}`;
        } catch (e) {
            console.warn('SafeSignal: Error generating content signature:', e);
            return 'error';
        }
    }

    checkIfPageChanged(trigger) {
        // Skip checks when tab is hidden (save CPU)
        if (this.pageHidden && trigger !== 'initial_load') {
            console.log('SafeSignal: Skipping check - tab hidden');
            return;
        }
        
        const newUrl = window.location.href;
        const newSignature = this.generateContentSignature();
        
        let hasChanged = false;
        
        // Check URL change
        if (newUrl !== this.currentUrl) {
            console.log('SafeSignal: URL changed:', this.currentUrl, '→', newUrl);
            this.currentUrl = newUrl;
            hasChanged = true;
        }
        
        // Check content change
        if (newSignature !== this.currentSignature) {
            console.log('SafeSignal: Content signature changed:', this.currentSignature, '→', newSignature);
            this.currentSignature = newSignature;
            hasChanged = true;
        }
        
        // Per-URL cooldown check
        const now = Date.now();
        const urlKey = newUrl; // Include fragment for SPA state tracking
        const lastCheck = this.lastCheckByUrl.get(urlKey) || 0;
        
        if (hasChanged || trigger === 'initial_load') {
            if (now - lastCheck < this.checkCooldown && trigger !== 'initial_load') {
                console.log('SafeSignal: Skipping check due to cooldown for URL:', urlKey);
                return;
            }
            
            this.lastCheckByUrl.set(urlKey, now);
            this.performSecurityCheck(trigger);
        }
    }

    async performSecurityCheck(trigger) {
        console.log('SafeSignal: Performing security check, trigger:', trigger);
        
        // Set checking state
        this.setState('checking');
        
        try {
            // Placeholder for API call
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Simulate different outcomes based on domain (for testing)
            const hostname = window.location.hostname.toLowerCase();
            let newState = 'ok';
            
            // Simple demo logic - replace with actual API call
            if (hostname.includes('phishing') || hostname.includes('scam')) {
                newState = 'danger';
            } else if (hostname.includes('suspicious') || hostname.includes('warning')) {
                newState = 'warning';
            }
            
            // Kill demo randomness behind a flag
            const DEV_DEMO = false;
            if (DEV_DEMO && Math.random() > 0.8) {
                newState = 'warning';
            }
            
            this.setState(newState);
            
        } catch (error) {
            console.error('SafeSignal: Security check failed:', error);
            this.setState('warning');
        }
    }

    // === UTILITY METHODS ===

    show() {
        if (this.shadowRoot) {
            const badge = this.shadowRoot.querySelector('.badge');
            if (badge) {
                badge.classList.remove('hidden');
            }
        }
    }

    hide() {
        if (this.shadowRoot) {
            const badge = this.shadowRoot.querySelector('.badge');
            if (badge) {
                badge.classList.add('hidden');
            }
        }
    }

    destroy() {
        console.log('SafeSignal: Destroying badge instance');
        
        // Clean up all event listeners and intervals
        this.cleanupHandlers.forEach(cleanup => {
            try {
                cleanup();
            } catch (e) {
                console.warn('SafeSignal: Error during cleanup:', e);
            }
        });
        
        // Clear timers
        if (this.pageDebounceTimer) {
            clearTimeout(this.pageDebounceTimer);
            this.pageDebounceTimer = null;
        }
        
        if (this.proximityCheckInterval) {
            clearInterval(this.proximityCheckInterval);
            this.proximityCheckInterval = null;
        }
        
        // Disconnect mutation observer
        if (this.mutationObserver) {
            this.mutationObserver.disconnect();
            this.mutationObserver = null;
        }
        
        // Remove DOM elements
        if (this.badgeContainer && this.badgeContainer.parentNode) {
            this.badgeContainer.parentNode.removeChild(this.badgeContainer);
        }
        
        // Clear references
        this.shadowRoot = null;
        this.badgeContainer = null;
        this.positioning = null;
    }
}

// Enhanced Badge with Context Detection
class SafeSignalBadgeEnhanced extends SafeSignalBadge {
    constructor() {
        super();
        
        // Context detection
        this.contextProbe = new SafeSignalContextProbe();
        this.contextData = null;
        this.contextButtons = [];
        this._lastProbeTs = 0; // Throttle context probes
    }

    async init() {
        if (this.shouldSkipInjection()) {
            return;
        }

        await this.loadUserPreferences();
        
        if (this.isSiteHidden()) {
            console.log('SafeSignal: Badge hidden on this site per user preference');
            return;
        }

        this.createShadowDOMBadge();
        this.attachEventListeners();
        
        // Initialize positioning helper after shadow root AND event listeners are created
        this.positioning = new SafeSignalBadgePositioning(this.shadowRoot);
        this.setupSPADetection();
        this.setupContentObserver();
        
        // Apply saved positioning
        this.applyPositioning(this.userPreferences.positioning);
        
        this.checkIfPageChanged('initial_load');
        
        console.log('SafeSignal: Enhanced badge active - Build:', SAFESIGNAL_BUILD);
    }

    setupContentObserver() {
        if (this.mutationObserver) return;
        
        const target = document.body;
        const isInteresting = (node) => {
            if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
            const text = (node.textContent || '').toLowerCase();
            // Enhanced scan for commerce/health terms
            return /\$\d|add to cart|buy now|checkout|supplement|treats|prevents|miracle|dosage|clinical|bag|basket|subscribe & save|side effects|contraindications/.test(text);
        };

        this.mutationObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if ([...mutation.addedNodes].some(isInteresting)) {
                    this.checkIfPageChanged('content_mutation');
                    break;
                }
            }
        });

        this.mutationObserver.observe(target, { childList: true, subtree: true });
        this.cleanupHandlers.push(() => { 
            if (this.mutationObserver) {
                this.mutationObserver.disconnect(); 
                this.mutationObserver = null;
            }
        });
    }

    checkIfPageChanged(trigger) {
        // Debounce content mutations
        if (trigger === 'content_mutation') {
            if (this.pageDebounceTimer) {
                clearTimeout(this.pageDebounceTimer);
            }
            this.pageDebounceTimer = setTimeout(() => {
                this.pageDebounceTimer = null;
                super.checkIfPageChanged(trigger);
                this.updateContextButtons();
            }, 800);
            return;
        }
        
        super.checkIfPageChanged(trigger);
        this.updateContextButtons();
        
        // Delayed re-probe for initial load (SPA content often loads later)
        if (trigger === 'initial_load') {
            setTimeout(() => {
                this.contextData = this.contextProbe.quickContextProbe();
                this.updateContextButtons();
            }, 1500);
        }
    }

    updateContextButtons() {
        if (!this.contextProbe) return;
        
        // Throttle heavy context scans
        const now = Date.now();
        if (now - this._lastProbeTs < 1500) return; // throttle ~1.5s
        this._lastProbeTs = now;
        
        this.contextData = this.contextProbe.quickContextProbe();
        
        // Clear existing context buttons
        this.clearContextButtons();
        
        const { isProduct, productConfidence, isHealth, healthConfidence } = this.contextData;
        
        // Lower thresholds as suggested
        if (isProduct && productConfidence >= 0.6) {
            this.addContextButton('safer-deals', 'Find Safer Deals', '#10b981');
        }
        
        if (isHealth && healthConfidence >= 0.6) {
            this.addContextButton('health-scan', 'Health Fact Scan', '#3b82f6');
        }
    }

    clearContextButtons() {
        this.contextButtons.forEach(button => {
            if (button.parentNode) {
                button.parentNode.removeChild(button);
            }
        });
        this.contextButtons = [];
    }

    addContextButton(type, text, color) {
        if (!this.shadowRoot) return;
        
        const badge = this.shadowRoot.querySelector('.badge');
        if (!badge) return;
        
        // Check if badge is in lower half to avoid off-screen buttons
        const badgeRect = this.getBadgeRect();
        const placeAbove = (badgeRect.bottom > window.innerHeight * 0.6);
        
        // Stack multiple buttons with small gap
        const buttonIndex = this.contextButtons.length;
        const stackOffset = buttonIndex * 28;
        
        const button = document.createElement('div');
        button.className = `context-button context-button-${type}`;
        button.textContent = text;
        button.setAttribute('role', 'button');
        button.setAttribute('tabindex', '0');
        button.style.cssText = `
            position: absolute;
            ${placeAbove ? 'bottom: calc(100% + 8px);' : 'top: calc(100% + 8px);'}
            left: 50%;
            transform: translateX(-50%) translateY(${placeAbove ? -stackOffset : stackOffset}px);
            background: ${color};
            color: white;
            padding: 6px 12px;
            border-radius: 16px;
            font-size: 0.75rem;
            font-weight: 500;
            cursor: pointer;
            white-space: nowrap;
            opacity: 0;
            transition: opacity 0.2s ease, transform 0.2s ease;
            z-index: 1000000;
            pointer-events: auto;
        `;
        
        const handleClick = (e) => {
            e.stopPropagation();
            this.handleContextButtonClick(type);
        };
        
        const handleKeydown = (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                this.handleContextButtonClick(type);
            }
        };
        
        button.addEventListener('click', handleClick);
        button.addEventListener('keydown', handleKeydown);
        
        button.addEventListener('mouseenter', () => {
            button.style.opacity = '1';
        });
        
        button.addEventListener('mouseleave', () => {
            button.style.opacity = '0.9';
        });
        
        badge.appendChild(button);
        this.contextButtons.push(button);
        
        // Light fade-in for discoverability
        requestAnimationFrame(() => {
            button.style.opacity = '0.9';
        });
    }

    handleContextButtonClick(type) {
        console.log('SafeSignal: Context button clicked:', type);
        
        // Show coming soon message for now
        const badge = this.shadowRoot.querySelector('.badge');
        const statusEl = this.shadowRoot.querySelector('.badge-status');
        
        const messages = {
            'safer-deals': 'Coming soon: Price comparison & safety scores',
            'health-scan': 'Coming soon: Health claim verification'
        };
        
        statusEl.textContent = messages[type] || 'Feature coming soon';
        this.updateStatusBubblePosition();
        
        badge.classList.add('show-status');
        
        setTimeout(() => {
            badge.classList.remove('show-status');
        }, 4000);
    }
}

// Context Detection Utility
class SafeSignalContextProbe {
    constructor() {
        this.productIndicators = {
            priceSelectors: [
                '[class*="price"]', '[id*="price"]', '.cost', '.amount',
                '[class*="dollar"]', '[class*="currency"]'
            ],
            actionSelectors: [
                '[class*="cart"]', '[class*="buy"]', '[class*="purchase"]',
                '[class*="checkout"]', '[class*="order"]'
            ],
            shoppingTerms: [
                'add to cart', 'buy now', 'purchase', 'checkout', 'order now',
                'price', 'sale', 'discount', 'shipping', 'delivery',
                'add to bag', 'cart', 'basket', 'subscribe & save', 'bag'
            ],
            productCategories: [
                'clothing', 'electronics', 'books', 'home', 'garden',
                'appliance', 'phone', 'laptop', 'tv', 'printer', 'wearable'
            ]
        };

        this.healthIndicators = {
            healthSelectors: [
                '[class*="supplement"]', '[class*="vitamin"]', '[class*="health"]',
                '[class*="medical"]', '[class*="medicine"]'
            ],
            healthTerms: [
                'supplement', 'vitamin', 'health', 'medicine', 'treatment',
                'cure', 'heal', 'therapy', 'clinical', 'medical',
                'clinical trial', 'randomized', 'placebo', 'dosage', 'side effects',
                'contraindications'
            ],
            suspiciousHealth: [
                'miracle cure', 'instant relief', 'guaranteed results',
                'doctors hate this', 'secret remedy', 'breakthrough',
                'ancient remedy', 'one weird trick', 'miracle pill'
            ]
        };
    }

    quickContextProbe() {
        const pageText = document.body.textContent.toLowerCase();
        const pageHTML = document.body.innerHTML.toLowerCase();
        
        // Product detection
        const productScore = this.calculateProductScore(pageText, pageHTML);
        const isProduct = productScore > 0.6;
        
        // Health detection  
        const healthScore = this.calculateHealthScore(pageText, pageHTML);
        const isHealth = healthScore > 0.6;
        
        return {
            isProduct,
            productConfidence: productScore,
            isHealth,
            healthConfidence: healthScore,
            pageType: this.determinePageType(isProduct, isHealth, productScore, healthScore)
        };
    }

    calculateProductScore(pageText, pageHTML) {
        let score = 0;
        
        // Check for price indicators
        const priceRegex = /\$\d+|\$\d+\.\d+|price.*\$|\d+\.\d+.*usd/gi;
        const priceMatches = pageText.match(priceRegex);
        if (priceMatches && priceMatches.length > 0) {
            score += Math.min(priceMatches.length * 0.2, 0.5);
        }
        
        // Check for shopping terms
        let termMatches = 0;
        this.productIndicators.shoppingTerms.forEach(term => {
            if (pageText.includes(term)) termMatches++;
        });
        score += Math.min(termMatches * 0.1, 0.4);
        
        // Check for shopping action elements
        let actionElements = 0;
        this.productIndicators.actionSelectors.forEach(selector => {
            actionElements += document.querySelectorAll(selector).length;
        });
        score += Math.min(actionElements * 0.1, 0.3);
        
        return Math.min(score, 1.0);
    }

    calculateHealthScore(pageText, pageHTML) {
        let score = 0;
        
        // Check for health terms
        let healthTerms = 0;
        this.healthIndicators.healthTerms.forEach(term => {
            if (pageText.includes(term)) healthTerms++;
        });
        score += Math.min(healthTerms * 0.1, 0.5);
        
        // Check for suspicious health claims
        let suspiciousTerms = 0;
        this.healthIndicators.suspiciousHealth.forEach(term => {
            if (pageText.includes(term)) suspiciousTerms++;
        });
        score += Math.min(suspiciousTerms * 0.2, 0.4);
        
        // Check for health-related elements
        let healthElements = 0;
        this.healthIndicators.healthSelectors.forEach(selector => {
            healthElements += document.querySelectorAll(selector).length;
        });
        score += Math.min(healthElements * 0.1, 0.3);
        
        return Math.min(score, 1.0);
    }

    determinePageType(isProduct, isHealth, productScore, healthScore) {
        if (isProduct && isHealth) return 'health-product';
        if (isProduct) return 'product';
        if (isHealth) return 'health';
        return 'general';
    }
}

// Badge Positioning Helper (simplified version)
class SafeSignalBadgePositioning {
    constructor(shadowRoot) {
        this.shadowRoot = shadowRoot;
        this.activeMenuEl = null;
    }

    applyMenuPosition(menuEl, badgeRect) {
        // Simple menu positioning - you can expand this later
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        
        let left = badgeRect.right + 8;
        let top = badgeRect.top;
        
        // Keep menu in viewport
        if (left + 200 > viewportWidth) {
            left = badgeRect.left - 200 - 8;
        }
        
        if (top + 150 > viewportHeight) {
            top = badgeRect.bottom - 150;
        }
        
        left = Math.max(16, left);
        top = Math.max(16, top);
        
        menuEl.style.left = `${left}px`;
        menuEl.style.top = `${top}px`;
    }
}

// Initialize the badge system
function initializeBadge() {
    // Clean up any existing instances
    if (window.safesignalBadgeInstance) {
        window.safesignalBadgeInstance.destroy();
        window.safesignalBadgeInstance = null;
    }
    
    // Create new enhanced badge instance
    window.safesignalBadgeInstance = new SafeSignalBadgeEnhanced();
}

// Export classes for potential external use
if (typeof window !== 'undefined') {
    window.SafeSignalBadge = SafeSignalBadgeEnhanced;
    window.SafeSignalContextProbe = SafeSignalContextProbe;
    window.SafeSignalBadgePositioning = SafeSignalBadgePositioning;
}

// Auto-initialize when script loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeBadge);
} else {
    initializeBadge();
}
/******/ })()
;
//# sourceMappingURL=content.js.map