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
        
        // SPA Detection properties
        this.currentUrl = window.location.href;
        this.currentSignature = null;
        this.mutationObserver = null;
        this.pageDebounceTimer = null;
        this.contentDebounceTimer = null;
        this.lastCheck = 0;
        this.checkCooldown = 30 * 60 * 1000; // 30 minutes
        this.sessionUpdateCounts = new Map();
        this.cleanupHandlers = [];
        
        // UI state
        this.isMenuOpen = false;
        this.isDragging = false;
        this.isCompact = false;
        this.dragStartPos = null;
        this.longPressTimer = null;
        this.scrollTimer = null;
        this.suppressNextClickUntil = 0;
        this._dragArmedUntil = 0;
        this._onDocPointerMove = null;
        this._onDocPointerUp = null;
        this._onDocPointerCancel = null;
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
        this.setupScrollDetection();
        
        // Apply saved positioning
        this.applyPositioning(this.userPreferences.positioning);
        
        this.checkIfPageChanged('initial_load');
        
        console.log('SafeSignal: Phase 1.4+ Enhanced positioning & controls active');
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
        const padding = 16; // Safe edge padding
        const systemBarHeight = 80; // Bottom system bar clearance
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
        
        // Apply safe bounds
        finalX = Math.max(12, Math.min(finalX, window.innerWidth - badgeW - 12));
        finalY = Math.max(12, Math.min(finalY, window.innerHeight - badgeH - 12));
        
        // Check for collision avoidance
        const collisionResult = this.applyCollisionAvoidance(finalX, finalY, badgeW, badgeH);
        finalX = collisionResult.x;
        finalY = collisionResult.y;
        
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
        
        // Apply size adjustment for mid positions
        if (anchor.includes('mid')) {
            badge.classList.add('mid-position');
        } else {
            badge.classList.remove('mid-position');
        }
        
        console.log('SafeSignal: Applied positioning:', { anchor, offsetX, offsetY, finalX, finalY });
    }

    applyCollisionAvoidance(x, y, badgeW, badgeH) {
        // Check for overlapping high-z fixed elements
        const elementsAtPosition = document.elementsFromPoint(
            x + badgeW / 2, 
            y + badgeH / 2
        ).filter(el => el !== this.badgeContainer);
        
        const hasCollision = elementsAtPosition.some(el => {
            const style = window.getComputedStyle(el);
            return style.position === 'fixed' && 
                   style.zIndex !== 'auto' && 
                   parseInt(style.zIndex) > 1000;
        });
        
        if (hasCollision) {
            // Apply small nudge without overwriting saved offsets
            const nudgeX = x + 12 > window.innerWidth / 2 ? -12 : 12;
            const nudgeY = y + 12 > window.innerHeight / 2 ? -12 : 12;
            
            return {
                x: Math.max(12, Math.min(x + nudgeX, window.innerWidth - badgeW - 12)),
                y: Math.max(12, Math.min(y + nudgeY, window.innerHeight - badgeH - 12))
            };
        }
        
        return { x, y };
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

    findNearestAnchor(x, y) {
        const anchorPositions = this.getAnchorPositions();
        let nearestAnchor = 'bottom-right';
        let minDistance = Infinity;
        
        Object.entries(anchorPositions).forEach(([anchor, pos]) => {
            const distance = Math.sqrt(Math.pow(x - pos.x, 2) + Math.pow(y - pos.y, 2));
            if (distance < minDistance) {
                minDistance = distance;
                nearestAnchor = anchor;
            }
        });
        
        return nearestAnchor;
    }

    calculateOffsetFromAnchor(centerX, centerY, anchor) {
        const anchorPositions = this.getAnchorPositions();
        const anchorPos = anchorPositions[anchor];
        const { width: badgeW, height: badgeH } = this.getBadgeRect();
        
        // Convert the badge center position into the same "top/left" placement frame used by applyPositioning
        let targetX = centerX, targetY = centerY;
        if (anchor.includes('right')) targetX -= badgeW;
        if (anchor.includes('bottom')) targetY -= badgeH;
        if (anchor.includes('mid')) targetY -= badgeH / 2;
        
        return { 
            offsetX: Math.round(targetX - anchorPos.x), 
            offsetY: Math.round(targetY - anchorPos.y) 
        };
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
                    touch-action: none;
                }
                
                @media (prefers-reduced-motion: reduce) {
                    .badge {
                        transition: none;
                        animation: none !important;
                    }
                }
                
                .badge.mid-position {
                    transform: scale(0.85);
                }
                
                .badge.mid-position:hover {
                    transform: scale(0.9);
                }
                
                .badge.compact {
                    width: 2rem;
                    height: 2rem;
                    font-size: 1rem;
                    opacity: 0.8;
                }
                
                .badge.compact:hover {
                    width: 3rem;
                    height: 3rem;
                    font-size: 1.25rem;
                    opacity: 1;
                }
                
                .badge-status {
                    position: absolute;
                    bottom: -45px;
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
                    z-index: 2147483648;
                    max-width: 200px;
                    word-wrap: break-word;
                    white-space: normal;
                    text-align: center;
                    line-height: 1.2;
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
                    z-index: 2147483649;
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
                    z-index: 2147483650;
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
                
                .badge.near-input {
                    opacity: 0.6;
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
                        aria-label="Open badge options menu">⋯</button>
                
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
            if (performance.now() < this.suppressNextClickUntil) return;
            if (!this.isMenuOpen && !this.isDragging) {
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
            });
        };
        window.addEventListener('resize', onResize);
        this.cleanupHandlers.push(() => window.removeEventListener('resize', onResize));
        
        // Input proximity detection
        setInterval(() => {
            this.checkInputProximity();
        }, 1000);
    }

    checkInputProximity() {
        if (this.isDragging || this.isMenuOpen) return;
        
        const badge = this.shadowRoot.querySelector('.badge');
        const rect = badge.getBoundingClientRect();
        
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
            badge.classList.add('near-input');
        } else {
            badge.classList.remove('near-input');
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

    // === SCROLL DETECTION & AUTO-MINIMIZE ===

    setupScrollDetection() {
        let scrollTimeout;
        let isScrolling = false;
        
        const handleScroll = () => {
            if (!isScrolling) {
                isScrolling = true;
                // Start compact mode after 1 second of scrolling
                this.scrollTimer = setTimeout(() => {
                    this.setCompactMode(true);
                }, 1000);
            }
            
            // Reset the timer
            clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(() => {
                isScrolling = false;
                clearTimeout(this.scrollTimer);
                // Exit compact mode after 2 seconds of no scrolling
                setTimeout(() => {
                    this.setCompactMode(false);
                }, 2000);
            }, 150);
        };
        
        window.addEventListener('scroll', handleScroll, { passive: true });
        this.cleanupHandlers.push(() => {
            window.removeEventListener('scroll', handleScroll);
            clearTimeout(this.scrollTimer);
        });
    }

    setCompactMode(compact) {
        if (this.isCompact === compact) return;
        
        this.isCompact = compact;
        const badge = this.shadowRoot.querySelector('.badge');
        
        if (compact) {
            badge.classList.add('compact');
        } else {
            badge.classList.remove('compact');
        }
        
        console.log('SafeSignal: Compact mode:', compact);
    }

    // === KEYBOARD NAVIGATION ===

    handleKeyboardNavigation(e) {
        if (!this.isVisible) return;
        
        const step = e.shiftKey ? 24 : 8;
        let deltaX = 0;
        let deltaY = 0;
        
        switch (e.key) {
            case 'ArrowLeft':
                deltaX = -step;
                break;
            case 'ArrowRight':
                deltaX = step;
                break;
            case 'ArrowUp':
                deltaY = -step;
                break;
            case 'ArrowDown':
                deltaY = step;
                break;
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
            default:
                return;
        }
        
        if (deltaX !== 0 || deltaY !== 0) {
            e.preventDefault();
            
            const newPositioning = {
                ...this.positioning,
                offsetX: this.positioning.offsetX + deltaX,
                offsetY: this.positioning.offsetY + deltaY
            };
            
            this.applyPositioning(newPositioning);
            this.savePositioningPreference(newPositioning);
        }
    }

    // === MENU SYSTEM ===

    toggleMenu() {
        this.isMenuOpen = !this.isMenuOpen;
        const menu = this.shadowRoot.querySelector('.badge-menu');
        const badge = this.shadowRoot.querySelector('.badge');
        
        if (this.isMenuOpen) {
            menu.classList.add('open');
            badge.classList.add('menu-open');
            const firstButton = menu.querySelector('.menu-item, .position-option');
            if (firstButton) firstButton.focus();
        } else {
            menu.classList.remove('open');
            badge.classList.remove('menu-open');
        }
    }

    closeMenu() {
        if (this.isMenuOpen) {
            this.isMenuOpen = false;
            const menu = this.shadowRoot.querySelector('.badge-menu');
            const badge = this.shadowRoot.querySelector('.badge');
            menu.classList.remove('open');
            badge.classList.remove('menu-open');
        }
    }

    handlePositionSelect(anchor) {
        const newPositioning = { anchor, offsetX: 0, offsetY: 0 };
        this.applyPositioning(newPositioning);
        this.savePositioningPreference(newPositioning);
        this.closeMenu();
        this.showPositionConfirmation(anchor);
    }

    showPositionConfirmation(message) {
        const statusEl = this.shadowRoot.querySelector('.badge-status');
        const badge = this.shadowRoot.querySelector('.badge');
        
        if (typeof message === 'string') {
            statusEl.textContent = message;
        } else {
            const friendlyNames = {
                'bottom-right': 'Bottom Right',
                'bottom-left': 'Bottom Left', 
                'top-right': 'Top Right',
                'top-left': 'Top Left',
                'mid-right': 'Middle Right',
                'mid-left': 'Middle Left'
            };
            statusEl.textContent = `Moved to ${friendlyNames[message]}`;
        }
        
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

    // === SPA DETECTION SYSTEM ===

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
        
        this.setupMutationObserver();
        this.updateContentSignature();
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
            this.currentSignature = null;
            this.sessionUpdateCounts.clear();
            this.debouncedPageCheck('url_change');
        }
    }

    setupMutationObserver() {
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

        this.mutationObserver = new MutationObserver((mutations) => {
            this.handleDOMChanges(mutations);
        });

        this.mutationObserver.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: false
        });
        
        console.log('SafeSignal: MutationObserver active');
    }

    handleDOMChanges(mutations) {
        const significantMutations = mutations.filter(mutation => {
            const target = mutation.target;
            
            if (this.isNoisyElement(target)) {
                this.trackNoisyUpdate(target);
                return false;
            }
            
            if (target.isContentEditable || 
                target.tagName === 'TEXTAREA' || 
                target.tagName === 'INPUT') {
                return false;
            }
            
            if (mutation.type === 'childList' && 
                mutation.addedNodes.length === 1 &&
                mutation.addedNodes[0].nodeType === Node.TEXT_NODE &&
                mutation.addedNodes[0].textContent.trim().length < 20) {
                return false;
            }
            
            return true;
        });

        if (significantMutations.length > 0) {
            this.debouncedContentCheck();
        }
    }

    isNoisyElement(element) {
        if (!element || !element.closest) return false;
        
        const noisyTokens = new Set([
            'ad', 'ads', 'advert', 'advertisement', 'sponsored', 'sponsor',
            'promo', 'promotion', 'banner', 'popup', 'modal', 'overlay',
            'carousel', 'slider', 'ticker', 'widget', 'sidebar',
            'chat', 'live-chat', 'notification', 'toast', 'snackbar'
        ]);
        
        if (element.classList) {
            for (const className of element.classList) {
                if (noisyTokens.has(className.toLowerCase())) {
                    return true;
                }
            }
        }
        
        if (element.id) {
            const id = element.id.toLowerCase();
            if (noisyTokens.has(id) || id.includes('google_ads') || id.includes('adsystem')) {
                return true;
            }
        }
        
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
        const elementKey = this.getElementKey(element);
        const count = this.sessionUpdateCounts.get(elementKey) || 0;
        this.sessionUpdateCounts.set(elementKey, count + 1);
        
        if (count > 5) {
            console.log('SafeSignal: Ignoring noisy element:', elementKey, 'updates:', count);
        }
    }

    getElementKey(element) {
        const tag = element.tagName || 'TEXT';
        const id = element.id || '';
        const className = element.className || '';
        return `${tag}#${id}.${className}`.substring(0, 50);
    }

    debouncedPageCheck(reason) {
        clearTimeout(this.pageDebounceTimer);
        this.pageDebounceTimer = setTimeout(() => {
            this.checkIfPageChanged(reason);
        }, 800);
    }

    debouncedContentCheck() {
        clearTimeout(this.contentDebounceTimer);
        this.contentDebounceTimer = setTimeout(() => {
            this.checkIfContentChanged('content_mutation');
        }, 500);
    }

    async checkIfPageChanged(reason) {
        console.log(`SafeSignal: Checking page change (${reason})`);
        
        if (reason === 'url_change' || reason === 'initial_load') {
            this.updateContentSignature();
            await this.performPageAnalysis(reason);
            return;
        }
        
        const now = Date.now();
        const timeSinceLastCheck = now - this.lastCheck;
        
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
        const mainContentEl = this.findMainContentElement();
        if (!mainContentEl) {
            return 'no-content';
        }

        const text = mainContentEl.textContent || '';
        const len = text.length;
        
        if (len < 800) {
            return 'content-too-small';
        }

        if (this.currentSignature) {
            const prevLen = parseInt(this.currentSignature.split('|')[0], 10);
            if (Math.abs(len - prevLen) < 50) {
                return this.currentSignature;
            }
        }

        const first1000 = text.substring(0, 1000);
        const last1000 = text.substring(Math.max(0, len - 1000));
        const linkCount = Math.min(mainContentEl.querySelectorAll('a').length, 500);
        
        const h1 = this.simpleHash(first1000);
        const h2 = this.simpleHash(last1000);
        
        const signature = `${len}|${h1}|${h2}|${linkCount}`;
        return signature;
    }

    findMainContentElement() {
        const selectors = [
            '[role="main"]', 'main', 'article',
            '.main-content', '#main-content', '.content', '#content'
        ];

        for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (el && el.textContent.length >= 800) {
                return el;
            }
        }

        const candidates = Array.from(document.querySelectorAll('div')).filter(div => {
            const textLen = div.textContent.length;
            return textLen >= 800 && !this.isNoisyElement(div);
        });

        if (candidates.length === 0) return document.body;

        return candidates.reduce((largest, current) => {
            return current.textContent.length > largest.textContent.length ? current : largest;
        });
    }

    simpleHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash);
    }

    updateContentSignature() {
        this.currentSignature = this.generateContentSignature();
        console.log('SafeSignal: Content signature updated:', this.currentSignature);
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
        if (this.mutationObserver) {
            this.mutationObserver.disconnect();
            this.mutationObserver = null;
        }
        
        [this.pageDebounceTimer, this.contentDebounceTimer, this.scrollTimer, this.longPressTimer].forEach(timer => {
            if (timer) clearTimeout(timer);
        });
        
        this.cleanupHandlers.forEach(cleanup => {
            try {
                cleanup();
            } catch (e) {
                console.warn('SafeSignal: Cleanup error:', e);
            }
        });
        this.cleanupHandlers = [];
        
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