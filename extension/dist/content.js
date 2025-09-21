/******/ (() => { // webpackBootstrap
class SafeSignalBadge {
    constructor() {
        this.shadowRoot = null;
        this.badgeContainer = null;
        this.currentState = 'checking';
        this.isVisible = true;
        
        // Enhanced positioning system
        this.positioning = {
            anchor: 'bottom-right',
            offsetX: 0,
            offsetY: 0
        };
        
        // SPA Detection properties (simplified)
        this.currentUrl = window.location.href;
        this.currentSignature = null;
        this.mutationObserver = null;
        this.pageDebounceTimer = null;
        this.lastCheck = 0;
        this.checkCooldown = 30 * 60 * 1000; // 30 minutes
        this.cleanupHandlers = [];
        
        // UI state
        this.isMenuOpen = false;
        this.proximityCheckInterval = null; // Track the interval
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
        this.setupSPADetection();
        
        // Apply saved positioning
        this.applyPositioning(this.userPreferences.positioning);
        
        this.checkIfPageChanged('initial_load');
        
        console.log('SafeSignal: Enhanced badge active (simplified)');
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
        const padding = 20; // Increased for better safe margins
        const systemBarHeight = 100; // More conservative for mobile
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
        this.positioning = { anchor, offsetX, offsetY };
        
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
            if (!chrome?.storage?.sync) {
                console.warn('SafeSignal: Chrome storage not available, using defaults');
                return;
            }
            
            const result = await chrome.storage.sync.get([
                'safesignal_positioning',
                'safesignal_hidden_sites',
                'safesignal_positions' // Legacy key for migration
            ]);
            
            const origin = this.getOriginKey();
            
            // Migrate old key if present
            if (!result.safesignal_positioning?.[origin] && result.safesignal_positions?.[origin]) {
                const anchor = result.safesignal_positions[origin];
                const newPositioning = { 
                    ...(result.safesignal_positioning || {}), 
                    [origin]: { anchor, offsetX: 0, offsetY: 0 } 
                };
                await chrome.storage.sync.set({ 
                    safesignal_positioning: newPositioning
                });
                console.log('SafeSignal: Migrated legacy position data for', origin);
            }
            
            const positioningData = result.safesignal_positioning || {};
            const hiddenSites = result.safesignal_hidden_sites || [];
            
            this.userPreferences.positioning = positioningData[origin] || 
                { anchor: 'bottom-right', offsetX: 0, offsetY: 0 };
            this.userPreferences.hiddenSites = new Set(hiddenSites);
            
            console.log('SafeSignal: Loaded preferences:', this.userPreferences);
        } catch (e) {
            console.warn('SafeSignal: Could not load preferences:', e);
        }
    }

    async savePositioningPreference(positioning) {
        try {
            if (!chrome?.storage?.sync) {
                console.warn('SafeSignal: Chrome storage not available');
                return;
            }
            
            const result = await chrome.storage.sync.get(['safesignal_positioning']);
            const positioningData = result.safesignal_positioning || {};
            
            const origin = this.getOriginKey();
            positioningData[origin] = positioning;
            
            await chrome.storage.sync.set({
                safesignal_positioning: positioningData
            });
            
            this.userPreferences.positioning = positioning;
            console.log('SafeSignal: Saved positioning preference:', positioning, 'for', origin);
        } catch (e) {
            console.warn('SafeSignal: Could not save positioning preference:', e);
        }
    }

    async toggleSiteVisibility() {
        try {
            if (!chrome?.storage?.sync) {
                console.warn('SafeSignal: Chrome storage not available');
                return;
            }
            
            const origin = this.getOriginKey();
            const result = await chrome.storage.sync.get(['safesignal_hidden_sites']);
            const hiddenSites = new Set(result.safesignal_hidden_sites || []);
            
            if (hiddenSites.has(origin)) {
                hiddenSites.delete(origin);
                await chrome.storage.sync.set({
                    safesignal_hidden_sites: Array.from(hiddenSites)
                });
                
                console.log('SafeSignal: Unhidden site:', origin);
                this.show();
            } else {
                hiddenSites.add(origin);
                await chrome.storage.sync.set({
                    safesignal_hidden_sites: Array.from(hiddenSites)
                });
                
                console.log('SafeSignal: Hidden site:', origin);
                this.hide();
                setTimeout(() => this.destroy(), 100);
            }
            
            this.userPreferences.hiddenSites = hiddenSites;
        } catch (e) {
            console.warn('SafeSignal: Could not toggle site visibility:', e);
        }
    }

    isSiteHidden() {
        const origin = this.getOriginKey();
        return this.userPreferences.hiddenSites.has(origin);
    }

    // === BADGE CREATION ===

    createShadowDOMBadge() {
        this.badgeContainer = document.createElement('div');
        this.badgeContainer.id = 'safesignal-badge-container';
        // Use open mode for dev/debugging - change to 'closed' for production
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
                    z-index: 999999; /* Reduced from 2147483647 */
                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15), 0 1px 3px rgba(0, 0, 0, 0.1);
                    transition: all 0.2s ease;
                    transform: scale(1);
                    /* Removed backdrop-filter for lighter feel */
                    touch-action: manipulation; /* Better for touch, allows page pan */
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
                    white-space: nowrap;
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
                
                /* Smart status positioning - above if at bottom, below if at top */
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
                    position: absolute;
                    top: 100%;
                    right: 0;
                    background: white;
                    border-radius: 12px;
                    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15), 0 4px 16px rgba(0, 0, 0, 0.1);
                    padding: 12px;
                    min-width: 220px;
                    opacity: 0;
                    transform: translateY(-10px) scale(0.95);
                    pointer-events: none;
                    transition: all 0.2s ease;
                    z-index: 1000002;
                    border: 1px solid rgba(0, 0, 0, 0.08);
                }
                
                .badge-menu.open {
                    opacity: 1;
                    transform: translateY(0) scale(1);
                    pointer-events: auto;
                }
                
                .menu-section {
                    margin-bottom: 12px;
                }
                
                .menu-section:last-child {
                    margin-bottom: 0;
                }
                
                .menu-label {
                    font-size: 0.75rem;
                    font-weight: 600;
                    color: #6b7280;
                    margin-bottom: 8px;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                }
                
                .position-grid {
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 6px;
                    margin-bottom: 12px;
                }
                
                .position-option {
                    width: 36px;
                    height: 36px;
                    border: 2px solid #e5e7eb;
                    border-radius: 8px;
                    background: #f9fafb;
                    cursor: pointer;
                    position: relative;
                    transition: all 0.15s ease;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                
                .position-option:hover {
                    border-color: #3b82f6;
                    background: #eff6ff;
                    transform: scale(1.05);
                }
                
                .position-option.active {
                    border-color: #3b82f6;
                    background: #3b82f6;
                }
                
                .position-option::after {
                    content: '';
                    position: absolute;
                    width: 8px;
                    height: 8px;
                    background: #6b7280;
                    border-radius: 50%;
                    transition: background 0.15s ease;
                }
                
                .position-option.active::after {
                    background: white;
                }
                
                .position-option[data-position="top-left"]::after {
                    top: 6px;
                    left: 6px;
                }
                
                .position-option[data-position="top-right"]::after {
                    top: 6px;
                    right: 6px;
                }
                
                .position-option[data-position="mid-left"]::after {
                    top: 50%;
                    left: 6px;
                    transform: translateY(-50%);
                }
                
                .position-option[data-position="mid-right"]::after {
                    top: 50%;
                    right: 6px;
                    transform: translateY(-50%);
                }
                
                .position-option[data-position="bottom-left"]::after {
                    bottom: 6px;
                    left: 6px;
                }
                
                .position-option[data-position="bottom-right"]::after {
                    bottom: 6px;
                    right: 6px;
                }
                
                .menu-item {
                    width: 100%;
                    padding: 10px 14px;
                    border: none;
                    background: #f9fafb;
                    color: #374151;
                    font-size: 0.875rem;
                    border-radius: 8px;
                    cursor: pointer;
                    transition: all 0.15s ease;
                    text-align: left;
                    font-family: inherit;
                }
                
                .menu-item:hover {
                    background: #f3f4f6;
                    color: #111827;
                    transform: translateY(-1px);
                }
                
                .menu-item.danger {
                    color: #dc2626;
                }
                
                .menu-item.danger:hover {
                    background: #fef2f2;
                    color: #991b1b;
                }
                
                .badge:hover {
                    transform: scale(1.05);
                    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2), 0 2px 8px rgba(0, 0, 0, 0.15);
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
            </style>
            
            <div class="badge checking" 
                 role="button" 
                 tabindex="0"
                 aria-label="SafeSignal security indicator"
                 aria-live="polite"
                 title="SafeSignal - Checking page safety">
                <span class="badge-icon">S</span>
                <div class="badge-status" role="status" aria-live="polite">Checking...</div>
                
                <button class="menu-button" 
                        type="button"
                        title="Badge options"
                        aria-label="Open badge options menu"
                        aria-expanded="false">⋯</button>
                
                <div class="badge-menu" role="menu" aria-label="Badge options">
                    <div class="menu-section">
                        <div class="menu-label">Position</div>
                        <div class="position-grid" role="group" aria-label="Badge position options">
                            <button class="position-option" 
                                    data-position="top-left" 
                                    type="button"
                                    title="Top Left"
                                    aria-label="Move badge to top left"></button>
                            <div></div>
                            <button class="position-option" 
                                    data-position="top-right" 
                                    type="button"
                                    title="Top Right"
                                    aria-label="Move badge to top right"></button>
                            <button class="position-option" 
                                    data-position="mid-left" 
                                    type="button"
                                    title="Middle Left"
                                    aria-label="Move badge to middle left"></button>
                            <div></div>
                            <button class="position-option" 
                                    data-position="mid-right" 
                                    type="button"
                                    title="Middle Right"
                                    aria-label="Move badge to middle right"></button>
                            <button class="position-option" 
                                    data-position="bottom-left" 
                                    type="button"
                                    title="Bottom Left"
                                    aria-label="Move badge to bottom left"></button>
                            <div></div>
                            <button class="position-option active" 
                                    data-position="bottom-right" 
                                    type="button"
                                    title="Bottom Right"
                                    aria-label="Move badge to bottom right"></button>
                        </div>
                    </div>
                    
                    <div class="menu-section">
                        <button class="menu-item danger" 
                                type="button"
                                role="menuitem"
                                data-action="hide-site">Hide on this site</button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(this.badgeContainer);
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
        
        // Menu actions
        const hideSiteButton = this.shadowRoot.querySelector('[data-action="hide-site"]');
        hideSiteButton.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleSiteVisibility();
        });
        
        // Close menu when clicking outside
        document.addEventListener('click', () => {
            this.closeMenu();
        });
        
        // Prevent menu clicks from closing menu
        menu.addEventListener('click', (e) => {
            e.stopPropagation();
        });
        
        // Window resize handler with throttling
        let resizeRaf = null;
        const onResize = () => {
            if (resizeRaf) return;
            resizeRaf = requestAnimationFrame(() => {
                resizeRaf = null;
                this.applyPositioning(this.positioning);
                this.updateStatusBubblePosition(); // Check if we need to flip status bubble
            });
        };
        window.addEventListener('resize', onResize);
        this.cleanupHandlers.push(() => window.removeEventListener('resize', onResize));
        
        // Input proximity detection with proper cleanup tracking
        this.proximityCheckInterval = setInterval(() => {
            this.checkInputProximity();
        }, 2000); // Reduced frequency
        this.cleanupHandlers.push(() => clearInterval(this.proximityCheckInterval));
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
        
        // For now, just log this - in the future could show hint in menu
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

    // === KEYBOARD NAVIGATION ===

    handleKeyboardNavigation(e) {
        if (!this.isVisible) return;
        
        switch (e.key) {
            case 'Enter':
            case ' ':
                if (!this.isMenuOpen) {
                    this.toggleMenu();
                }
                e.preventDefault();
                return;
            case 'Escape':
                this.closeMenu();
                e.preventDefault();
                return;
        }
    }

    // === MENU SYSTEM ===

    toggleMenu() {
        this.isMenuOpen = !this.isMenuOpen;
        const menu = this.shadowRoot.querySelector('.badge-menu');
        const badge = this.shadowRoot.querySelector('.badge');
        const menuButton = this.shadowRoot.querySelector('.menu-button');
        
        if (this.isMenuOpen) {
            menu.classList.add('open');
            badge.classList.add('menu-open');
            menuButton.setAttribute('aria-expanded', 'true');
            
            // Focus first interactive element in menu
            const firstButton = menu.querySelector('.menu-item, .position-option');
            if (firstButton) firstButton.focus();
        } else {
            menu.classList.remove('open');
            badge.classList.remove('menu-open');
            menuButton.setAttribute('aria-expanded', 'false');
            
            // Return focus to menu button
            menuButton.focus();
        }
    }

    closeMenu() {
        if (this.isMenuOpen) {
            this.isMenuOpen = false;
            const menu = this.shadowRoot.querySelector('.badge-menu');
            const badge = this.shadowRoot.querySelector('.badge');
            const menuButton = this.shadowRoot.querySelector('.menu-button');
            
            menu.classList.remove('open');
            badge.classList.remove('menu-open');
            menuButton.setAttribute('aria-expanded', 'false');
        }
    }

    handlePositionSelect(anchor) {
        const newPositioning = { anchor, offsetX: 0, offsetY: 0 };
        this.applyPositioning(newPositioning);
        this.savePositioningPreference(newPositioning);
        this.closeMenu();
        this.showPositionConfirmation(anchor);
    }

    showPositionConfirmation(anchor) {
        const statusEl = this.shadowRoot.querySelector('.badge-status');
        const badge = this.shadowRoot.querySelector('.badge');
        
        const friendlyNames = {
            'bottom-right': 'Bottom Right',
            'bottom-left': 'Bottom Left', 
            'top-right': 'Top Right',
            'top-left': 'Top Left',
            'mid-right': 'Middle Right',
            'mid-left': 'Middle Left'
        };
        
        statusEl.textContent = `Moved to ${friendlyNames[anchor]}`;
        
        // Update status bubble position before showing
        this.updateStatusBubblePosition();
        
        badge.classList.add('show-status');
        
        setTimeout(() => {
            badge.classList.remove('show-status');
        }, 2000);
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

    // === SIMPLIFIED SPA DETECTION ===

    setupSPADetection() {
        this.patchHistoryAPI();
        
        const popstateHandler = () => this.handleURLChange('popstate');
        window.addEventListener('popstate', popstateHandler);
        this.cleanupHandlers.push(() => window.removeEventListener('popstate', popstateHandler));
        
        const hashchangeHandler = () => this.handleURLChange('hashchange');
        window.addEventListener('hashchange', hashchangeHandler);
        this.cleanupHandlers.push(() => window.removeEventListener('hashchange', hashchangeHandler));
        
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
        
        // Simplified: No mutation observer for now to reduce complexity
        console.log('SafeSignal: Simplified SPA detection active (history changes only)');
    }

    patchHistoryAPI() {
        const originalPushState = history.pushState;
        const originalReplaceState = history.replaceState;
        
        history.pushState = (...args) => {
            originalPushState.apply(history, args);
            this.handleURLChange('pushState');
        };
        
        history.replaceState = (...args) => {
            originalReplaceState.apply(history, args);
            this.handleURLChange('replaceState');
        };
        
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
            this.debouncedPageCheck('url_change');
        }
    }

    debouncedPageCheck(reason) {
        clearTimeout(this.pageDebounceTimer);
        this.pageDebounceTimer = setTimeout(() => {
            this.checkIfPageChanged(reason);
        }, 800);
    }

    async checkIfPageChanged(reason) {
        console.log(`SafeSignal: Checking page change (${reason})`);
        
        const now = Date.now();
        const timeSinceLastCheck = now - this.lastCheck;
        
        // Always allow initial load and URL changes
        if (reason === 'url_change' || reason === 'initial_load') {
            await this.performPageAnalysis(reason);
            return;
        }
        
        if (timeSinceLastCheck < this.checkCooldown) {
            console.log(`SafeSignal: Skipping check, cooldown active (${Math.round((this.checkCooldown - timeSinceLastCheck) / 1000)}s remaining)`);
            return;
        }
        
        await this.performPageAnalysis(reason);
    }

    async performPageAnalysis(reason) {
        this.lastCheck = Date.now();
        console.log(`SafeSignal: Performing page analysis (${reason})`);
        
        this.setState('checking');
        await this.simulateAnalysis();
        this.determinePageState();
    }

    async simulateAnalysis() {
        const delay = Math.random() * 1000 + 500;
        await new Promise(resolve => setTimeout(resolve, delay));
    }

    determinePageState() {
        const url = window.location.href.toLowerCase();
        const hostname = window.location.hostname.toLowerCase();
        const path = window.location.pathname.toLowerCase();
        
        if (hostname.includes('google') || hostname.includes('wikipedia') || hostname.includes('github')) {
            this.setState('ok');
        } else if (path.includes('/login') || path.includes('/signin') || path.includes('/payment')) {
            this.setState('warning');
        } else if (url.includes('?utm_') || path.includes('/ad/') || hostname.includes('doubleclick')) {
            this.setState('warning');
        } else if (hostname.includes('malware') || hostname.includes('phishing') || path.includes('/scam')) {
            this.setState('danger');
        } else {
            const states = ['ok', 'warning', 'danger'];
            const weights = [0.7, 0.25, 0.05];
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

    destroy() {
        // Clear all timers
        [this.pageDebounceTimer, this.proximityCheckInterval].forEach(timer => {
            if (timer) clearTimeout(timer);
        });
        
        // Clear the proximity check interval specifically
        if (this.proximityCheckInterval) {
            clearInterval(this.proximityCheckInterval);
            this.proximityCheckInterval = null;
        }
        
        // Run all cleanup handlers
        this.cleanupHandlers.forEach(cleanup => {
            try {
                cleanup();
            } catch (e) {
                console.warn('SafeSignal: Cleanup error:', e);
            }
        });
        this.cleanupHandlers = [];
        
        // Remove the badge from DOM
        if (this.badgeContainer && this.badgeContainer.parentNode) {
            this.badgeContainer.parentNode.removeChild(this.badgeContainer);
        }
        
        console.log('SafeSignal: Badge destroyed and cleaned up');
    }
}

// Initialize badge when DOM is ready
let safesignalBadge = null;

async function initializeBadge() {
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
/******/ })()
;
//# sourceMappingURL=content.js.map