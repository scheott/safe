/******/ (() => { // webpackBootstrap
// SafeSignal Content Script - Elder-First Edition
// Version with all bug fixes applied

const SAFESIGNAL_BUILD = 'content-2025-09-28-v3.0-elder';
console.info('[SafeSignal] build:', SAFESIGNAL_BUILD);

class SafeSignalBadge {
    constructor() {
        // Fixed: Separate host from shadow root
        this.host = null;
        this.root = null;
        this.currentState = 'checking';
        this.positionState = { anchor: 'bottom-right', offsetX: 0, offsetY: 0 };
        
        // Shape and size settings
        this.sizeMode = 'normal'; // 'normal' | 'large' | 'xl'
        this.shape = 'pill'; // Always pill for elders
        
        // SPA Detection
        this.currentUrl = window.location.href;
        this.mutationObserver = null;
        this.pageDebounceTimer = null;
        this.lastCheckByUrl = new Map();
        this.checkCooldown = 30 * 60 * 1000;
        this.cleanupHandlers = [];
        
        // UI state
        this.isMenuOpen = false;
        this.activeModal = null;
        this.longPressTimer = null;
        
        // Context detection
        this.contextProbe = new SafeSignalContextProbe();
        this.contextData = null;
        
        this.userPreferences = {
            positioning: { anchor: 'bottom-right', offsetX: 0, offsetY: 0 },
            sizeMode: 'normal',
            shape: 'pill'
        };
        
        this.init();
    }

    async init() {
        if (this.shouldSkipInjection()) return;
        
        await this.loadUserPreferences();

        this.createShadowDOMBadge();
        this.initMenu();
        this.initSpaDetection();
        this.setupKeyboardShortcuts();
        this.setupResizeHandler();
        this.showActionChips(); // Show placeholders immediately
        
        this.setShape('pill');
        this.setSizeMode(this.userPreferences.sizeMode || 'normal');
        this.applyPositioning(this.userPreferences.positioning);
        
        console.log('SafeSignal: Badge active');
        this.checkIfPageChanged('initial_load');
    }

    shouldSkipInjection() {
        // Guard against double injection
        if (document.getElementById('safesignal-badge-host')) {
            console.log('SafeSignal: Badge already exists, skipping injection');
            return true;
        }
        
        const protocol = window.location.protocol;
        if (protocol === 'chrome:' || protocol === 'chrome-extension:' || 
            protocol === 'moz-extension:' || protocol === 'about:') {
            return true;
        }
        if (window.top !== window) {
            console.log('SafeSignal: Skipping injection in frame');
            return true;
        }
        return false;
    }

    isSiteHidden() {
        return false; // Feature removed
    }

    getOriginKey() {
        return `${window.location.protocol}//${window.location.host}`;
    }

    // ==================== SHADOW DOM CREATION ====================
    
    getSizeConfig() {
        const configs = {
            'normal': { height: 56, font: 18, button: 14, label: 'Normal' },
            'large':  { height: 64, font: 20, button: 16, label: 'Large' },
            'xl':     { height: 72, font: 22, button: 18, label: 'Extra Large' }
        };
        return configs[this.sizeMode] || configs['normal'];
    }

    createShadowDOMBadge() {
        this.host = document.createElement('div');
        this.host.setAttribute('id', 'safesignal-badge-host');
        this.root = this.host.attachShadow({ mode: 'open' });
        
        const config = this.getSizeConfig();
        
        this.root.innerHTML = `
            <style>
                :host {
                    /* Isolate from page cascades */
                    all: initial;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    
                    --ss-h: ${config.height}px;
                    --ss-font: ${config.font}px;
                    --ss-button: ${config.button}px;
                    --ss-radius: 24px;
                    --ss-pad-x: 14px;
                    
                    /* Spacing scale */
                    --space-2: 8px;
                    --space-3: 12px;
                    --space-4: 16px;
                    
                    /* Semantic colors */
                    --color-safe: #10B881;
                    --color-warning: #F5A623;
                    --color-danger: #EF4444;
                    --color-checking: #64748b;
                    --ink-on-dark: #FFFFFF;
                    
                    /* Chip colors - elder-friendly contrast */
                    --chip-product: #7c3aed;
                    --chip-product-hover: #6d28d9;
                    --chip-health: #2563EB;
                    --chip-health-hover: #1D4ED8;
                }
                
                * { box-sizing: border-box; }
                
                .badge {
                    position: fixed;
                    height: var(--ss-h);
                    min-width: var(--ss-h);
                    border-radius: var(--ss-radius);
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                    padding: 0 var(--ss-pad-x);
                    padding-right: calc(var(--ss-pad-x) + 36px); /* Extra space so ⋯ never crowds label */
                    font-size: var(--ss-font);
                    font-weight: 700;
                    cursor: pointer;
                    z-index: 2147483647;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                    border: 2px solid rgba(255,255,255,0.2);
                    transition: all 0.2s ease;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    user-select: none;
                }
                
                .badge:hover {
                    transform: scale(1.02);
                    box-shadow: 0 6px 16px rgba(0,0,0,0.2);
                }
                
                .badge:focus-visible {
                    outline: 3px solid rgba(59,130,246,0.6);
                    outline-offset: 2px;
                }
                
                .badge-icon {
                    font-size: 1.1em;
                    line-height: 1;
                }
                
                .badge-label {
                    font-size: 0.85em;
                    font-weight: 600;
                    letter-spacing: 0.02em;
                    white-space: nowrap;
                }
                
                .badge.state-ok {
                    background: var(--color-safe);
                    color: var(--ink-on-dark);
                }
                
                .badge.state-warning {
                    background: var(--color-warning);
                    color: var(--ink-on-dark);
                }
                
                .badge.state-danger {
                    background: var(--color-danger);
                    color: var(--ink-on-dark);
                }
                
                .badge.state-checking {
                    background: var(--color-checking);
                    color: var(--ink-on-dark);
                }
                
                /* Menu button - positioned dynamically to avoid text */
                .menu-button {
                    position: absolute;
                    width: 28px;
                    height: 28px;
                    background: rgba(0,0,0,0.7);
                    color: white;
                    border: none;
                    border-radius: 50%;
                    font-size: 14px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 1;
                    transition: all 0.15s ease;
                    padding: 0;
                }
                
                .menu-button:hover {
                    background: rgba(0,0,0,0.85);
                    transform: scale(1.08);
                }
                
                .menu-button:focus-visible {
                    outline: 3px solid rgba(59,130,246,0.6);
                    outline-offset: 2px;
                }
                
                /* Size controls - always visible */
                .size-controls {
                    position: fixed;
                    display: flex;
                    gap: 4px;
                    z-index: 2147483647;
                    opacity: 0.9;
                    transition: opacity 0.2s ease;
                }
                
                .size-controls:hover {
                    opacity: 1;
                }
                
                .size-button {
                    width: 44px;
                    height: 44px;
                    background: rgba(0,0,0,0.8);
                    color: white;
                    border: 2px solid rgba(255,255,255,0.2);
                    border-radius: 8px;
                    font-size: 24px;
                    font-weight: 700;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: all 0.15s ease;
                }
                
                .size-button:hover {
                    background: rgba(0,0,0,0.9);
                    transform: scale(1.05);
                }
                
                .size-button:disabled {
                    opacity: 0.4;
                    cursor: not-allowed;
                }
                
                .size-button:focus-visible {
                    outline: 3px solid rgba(59,130,246,0.6);
                    outline-offset: 2px;
                }
                
                /* Action chips - mini-badges above main badge */
                .action-chip {
                    position: absolute;
                    z-index: 10;
                    color: white;
                    height: 36px;
                    padding: 0 12px;
                    border-radius: 18px;
                    font-size: 14px;
                    font-weight: 600;
                    white-space: nowrap;
                    cursor: pointer;
                    border: 1px solid rgba(255,255,255,0.2);
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    transition: all 0.2s ease;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.12);
                    pointer-events: auto;
                    opacity: 0.95;
                }
                
                .action-chip-product {
                    background: var(--chip-product);
                }
                
                .action-chip-product:hover {
                    background: var(--chip-product-hover);
                    transform: translateY(-2px);
                    opacity: 1;
                }
                
                .action-chip-health {
                    background: var(--chip-health);
                }
                
                .action-chip-health:hover {
                    background: var(--chip-health-hover);
                    transform: translateY(-2px);
                    opacity: 1;
                }
                
                .action-chip:focus-visible {
                    outline: 3px solid rgba(59,130,246,0.6);
                    outline-offset: 2px;
                }
                
                /* Menu */
                .badge-menu {
                    position: fixed;
                    background: white;
                    border-radius: 12px;
                    box-shadow: 0 8px 32px rgba(0,0,0,0.12);
                    border: 1px solid #e5e7eb;
                    padding: 16px;
                    min-width: 220px;
                    z-index: 2147483647;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    display: none;
                }
                
                .menu-section {
                    margin-bottom: 16px;
                }
                
                .menu-section:last-child {
                    margin-bottom: 0;
                }
                
                .menu-label {
                    font-size: 14px;
                    font-weight: 600;
                    color: #374151;
                    margin-bottom: 8px;
                }
                
                .position-grid {
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 6px;
                    width: 90px;
                    height: 72px;
                }
                
                .position-option {
                    width: 100%;
                    height: 100%;
                    border: 2px solid #d1d5db;
                    border-radius: 4px;
                    background: #f9fafb;
                    cursor: pointer;
                    transition: all 0.15s ease;
                }
                
                .position-option:hover {
                    background: #e5e7eb;
                    border-color: #9ca3af;
                }
                
                .position-option.active {
                    background: #3b82f6;
                    border-color: #2563eb;
                }
                
                .position-option:focus-visible {
                    outline: 3px solid rgba(59,130,246,0.6);
                    outline-offset: 2px;
                }
                
                .menu-option-group {
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                }
                
                .menu-option {
                    padding: 10px 12px;
                    border: 2px solid #d1d5db;
                    border-radius: 6px;
                    background: white;
                    cursor: pointer;
                    font-size: 14px;
                    transition: all 0.15s ease;
                    text-align: center;
                    font-weight: 500;
                }
                
                .menu-option:hover {
                    background: #f3f4f6;
                    border-color: #9ca3af;
                }
                
                .menu-option:focus-visible {
                    outline: 3px solid rgba(59,130,246,0.6);
                    outline-offset: 2px;
                }
                
                .menu-option.active {
                    background: #3b82f6;
                    color: white;
                    border-color: #3b82f6;
                    font-weight: 600;
                }
                
                /* Modal */
                .modal-overlay {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(0,0,0,0.8);
                    z-index: 2147483646;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 20px;
                }
                
                .modal-content {
                    background: white;
                    border-radius: 16px;
                    max-width: 600px;
                    width: 100%;
                    max-height: 80vh;
                    overflow-y: auto;
                    padding: 32px;
                    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                }
                
                .modal-header {
                    font-size: 28px;
                    font-weight: 700;
                    color: #1f2937;
                    margin-bottom: 20px;
                }
                
                .modal-body {
                    font-size: 18px;
                    line-height: 1.6;
                    color: #374151;
                    margin-bottom: 24px;
                }
                
                .modal-close {
                    width: 100%;
                    padding: 16px;
                    background: #3b82f6;
                    color: white;
                    border: none;
                    border-radius: 8px;
                    font-size: 18px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: background 0.2s ease;
                }
                
                .modal-close:hover {
                    background: #2563eb;
                }
                
                .modal-close:focus-visible {
                    outline: 3px solid rgba(59,130,246,0.6);
                    outline-offset: 2px;
                }
                
                @media (prefers-contrast: high) {
                    .badge {
                        border-width: 3px;
                        border-color: currentColor;
                    }
                    
                    .badge.state-ok { background: #0f5132; }
                    .badge.state-warning { background: #8b5a00; }
                    .badge.state-danger { background: #7c1d20; }
                    .menu-option.active { outline: 2px solid #000; }
                }
                
                @media (prefers-reduced-motion: reduce) {
                    .badge, .menu-button, .menu-option, .action-chip,
                    .size-button, .size-controls {
                        transition: none !important;
                        animation: none !important;
                    }
                }
            </style>
            
            <div class="badge state-checking" role="button" tabindex="0" aria-live="polite" aria-label="SafeSignal: Checking">
                <span class="badge-icon">⧗</span>
                <span class="badge-label">Checking</span>
                <button class="menu-button" title="SafeSignal Settings" aria-label="SafeSignal Settings" aria-expanded="false">⋯</button>
            </div>
            
            <div class="size-controls">
                <button class="size-button size-minus" title="Smaller" aria-label="Make badge smaller">−</button>
                <button class="size-button size-plus" title="Larger" aria-label="Make badge larger">+</button>
            </div>
            
            <div class="badge-menu" role="dialog" aria-label="SafeSignal Settings">
                <div class="menu-section">
                    <div class="menu-label">Move Badge</div>
                    <div class="position-grid" role="group" aria-label="Position options">
                        <button class="position-option" data-position="top-left" title="Top Left" aria-label="Top left corner"></button>
                        <div></div>
                        <button class="position-option" data-position="top-right" title="Top Right" aria-label="Top right corner"></button>
                        <button class="position-option" data-position="mid-left" title="Middle Left" aria-label="Middle left side"></button>
                        <div></div>
                        <button class="position-option" data-position="mid-right" title="Middle Right" aria-label="Middle right side"></button>
                        <button class="position-option" data-position="bottom-left" title="Bottom Left" aria-label="Bottom left corner"></button>
                        <div></div>
                        <button class="position-option active" data-position="bottom-right" title="Bottom Right" aria-label="Bottom right corner"></button>
                    </div>
                </div>
            </div>
        `;
        
        document.documentElement.appendChild(this.host);
    }

    // ==================== MENU ====================
    
    initMenu() {
        const menuBtn = this.root.querySelector('.menu-button');
        const menu = this.root.querySelector('.badge-menu');
        let lastFocus = null;
        
        const openMenu = () => {
            lastFocus = document.activeElement;
            
            // Put in flow, measure, then position
            menu.style.visibility = 'hidden';
            menu.style.display = 'block';
            
            const { width: mw, height: mh } = menu.getBoundingClientRect();
            const br = this.root.querySelector('.badge').getBoundingClientRect();
            
            let left = br.right + 10;
            if (left + mw > window.innerWidth - 16) {
                left = Math.max(16, br.left - mw - 10);
            }
            let top = Math.min(Math.max(16, br.top), window.innerHeight - mh - 16);
            
            menu.style.left = `${left}px`;
            menu.style.top = `${top}px`;
            menu.style.visibility = 'visible';
            
            menu.setAttribute('tabindex', '-1');
            menuBtn.setAttribute('aria-expanded', 'true');
            this.isMenuOpen = true;
            
            requestAnimationFrame(() => menu.focus());
        };
        
        const closeMenu = () => {
            menu.style.display = 'none';
            menuBtn.setAttribute('aria-expanded', 'false');
            this.isMenuOpen = false;
            (lastFocus || menuBtn).focus();
        };
        
        menuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.isMenuOpen ? closeMenu() : openMenu();
        });
        
        // Bubble phase to avoid race with button click
        this._docClickHandler = (e) => {
            if (!this.isMenuOpen) return;
            const path = e.composedPath();
            if (!path.includes(menu) && !path.includes(menuBtn)) closeMenu();
        };
        document.addEventListener('click', this._docClickHandler); // bubble phase
        
        menu.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                closeMenu();
            }
            
            if (e.key === 'Tab') {
                const focusables = [...menu.querySelectorAll('button')];
                if (!focusables.length) return;
                
                const currentIndex = focusables.indexOf(this.root.activeElement);
                let nextIndex;
                
                if (e.shiftKey) {
                    nextIndex = currentIndex <= 0 ? focusables.length - 1 : currentIndex - 1;
                } else {
                    nextIndex = currentIndex === focusables.length - 1 ? 0 : currentIndex + 1;
                }
                
                if (currentIndex === -1 || 
                    (e.shiftKey && currentIndex === 0) || 
                    (!e.shiftKey && currentIndex === focusables.length - 1)) {
                    e.preventDefault();
                    focusables[nextIndex].focus();
                }
            }
        });
        
        window.addEventListener('scroll', () => {
            if (this.isMenuOpen) closeMenu();
        }, { passive: true });
        
        this.attachMenuEventListeners();
    }

    attachMenuEventListeners() {
        // Size controls
        const minusBtn = this.root.querySelector('.size-minus');
        const plusBtn = this.root.querySelector('.size-plus');
        
        minusBtn?.addEventListener('click', () => this.cycleSizeDown());
        plusBtn?.addEventListener('click', () => this.cycleSizeUp());
        
        // Position options
        const positionOptions = this.root.querySelectorAll('.position-option');
        positionOptions.forEach(option => {
            option.addEventListener('click', (e) => {
                e.stopPropagation();
                const anchor = option.dataset.position;
                this.handlePositionSelect(anchor);
            });
        });
    }

    handlePositionSelect(anchor) {
        const newPositioning = { anchor, offsetX: 0, offsetY: 0 };
        this.applyPositioning(newPositioning);
        this.userPreferences.positioning = newPositioning;
        this.saveUserPreferences();
        this.updatePositionGridUI(anchor);
        
        console.log('SafeSignal: Position selected:', anchor);
    }

    updatePositionGridUI(activeAnchor) {
        if (!this.root) return;
        
        const positionOptions = this.root.querySelectorAll('.position-option');
        positionOptions.forEach(option => {
            option.classList.remove('active');
            if (option.dataset.position === activeAnchor) {
                option.classList.add('active');
            }
        });
    }

    // ==================== SIZE MANAGEMENT ====================
    
    setSizeMode(mode) {
        if (!['normal', 'large', 'xl'].includes(mode)) return;
        
        this.sizeMode = mode;
        const config = this.getSizeConfig();
        
        this.host.style.setProperty('--ss-h', `${config.height}px`);
        this.host.style.setProperty('--ss-font', `${config.font}px`);
        this.host.style.setProperty('--ss-button', `${config.button}px`);
        
        const pos = this.positionState || { anchor: 'bottom-right', offsetX: 0, offsetY: 0 };
        this.applyPositioning(pos);
        this.positionSizeControls();
        
        this.userPreferences.sizeMode = mode;
        this.saveUserPreferences();
        this.updateSizeControlsUI();
        
        console.log(`SafeSignal: Size set to ${config.label}`);
    }

    setShape(shape) {
        this.shape = shape;
        const badge = this.root.querySelector('.badge');
        
        this.host.style.setProperty('--ss-radius', '24px');
        this.host.style.setProperty('--ss-pad-x', '14px');
        badge?.classList.remove('compact');
        
        this.userPreferences.shape = shape;
        this.saveUserPreferences();
        
        const pos = this.positionState || { anchor: 'bottom-right', offsetX: 0, offsetY: 0 };
        this.applyPositioning(pos);
    }

    cycleSizeUp() {
        const order = ['normal', 'large', 'xl'];
        const current = order.indexOf(this.sizeMode);
        const next = (current + 1) % order.length;
        this.setSizeMode(order[next]);
    }

    cycleSizeDown() {
        const order = ['normal', 'large', 'xl'];
        const current = order.indexOf(this.sizeMode);
        const prev = current === 0 ? order.length - 1 : current - 1;
        this.setSizeMode(order[prev]);
    }

    updateSizeControlsUI() {
        const minusBtn = this.root.querySelector('.size-minus');
        const plusBtn = this.root.querySelector('.size-plus');
        
        minusBtn.disabled = this.sizeMode === 'normal';
        plusBtn.disabled = this.sizeMode === 'xl';
    }

    // ==================== POSITIONING ====================
    
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
        if (!this.root) return;
        
        const { anchor, offsetX = 0, offsetY = 0 } = positioning;
        const anchorPositions = this.getAnchorPositions();
        const anchorPos = anchorPositions[anchor] || anchorPositions['bottom-right'];
        
        const badge = this.root.querySelector('.badge');
        if (!badge) return;
        
        const badgeRect = badge.getBoundingClientRect();
        const badgeW = badgeRect.width || 56;
        const badgeH = badgeRect.height || 56;
        
        let finalX = anchorPos.x + offsetX;
        let finalY = anchorPos.y + offsetY;
        
        if (anchor.includes('right')) finalX -= badgeW;
        if (anchor.includes('bottom')) finalY -= badgeH;
        if (anchor.includes('mid')) {
            if (anchor.includes('left') || anchor.includes('right')) {
                finalY -= badgeH / 2;
            }
        }
        
        const margin = 16;
        finalX = Math.max(margin, Math.min(finalX, window.innerWidth - badgeW - margin));
        finalY = Math.max(margin, Math.min(finalY, window.innerHeight - badgeH - margin));
        
        badge.style.position = 'fixed';
        badge.style.left = `${finalX}px`;
        badge.style.top = `${finalY}px`;
        badge.style.right = 'auto';
        badge.style.bottom = 'auto';
        
        this.positionState = { anchor, offsetX, offsetY };
        
        // Position size controls
        this.positionSizeControls();
        
        // Position menu button using geometry
        this.positionMenuButton();
        
        // Reposition action chips
        this.repositionActionChips();
        
        // Update position grid UI
        this.updatePositionGridUI(anchor);
        
        console.log('SafeSignal: Positioned at', { anchor, finalX, finalY });
    }

    positionSizeControls() {
        const badge = this.root.querySelector('.badge');
        const controls = this.root.querySelector('.size-controls');
        if (!badge || !controls) return;
        
        const br = badge.getBoundingClientRect();
        const DOCK_W = 48 + 8 + 48; // 2 buttons + gap (104px total)
        const GAP = 12;
        
        let left, top;
        if (this.positionState.anchor.includes('left')) {
            left = br.right + GAP;
        } else {
            left = br.left - DOCK_W - GAP;
        }
        top = br.top + (br.height - 48) / 2;
        
        left = Math.max(16, Math.min(left, window.innerWidth - DOCK_W - 16));
        top = Math.max(16, Math.min(top, window.innerHeight - 48 - 16));
        
        controls.style.left = `${left}px`;
        controls.style.top = `${top}px`;
    }

    positionMenuButton() {
        const btn = this.root.querySelector('.menu-button');
        const badge = this.root.querySelector('.badge');
        if (!btn || !badge) return;
        
        // Position menu button outside the badge, above it
        const br = badge.getBoundingClientRect();
        
        // Center horizontally on badge
        const btnLeft = (br.width / 2) - 14; // 14 = half of button width
        
        btn.style.position = 'absolute';
        btn.style.left = `${btnLeft}px`;
        btn.style.top = '-34px'; // Place above badge
        btn.style.right = 'auto';
        btn.style.bottom = 'auto';
    }

    // ==================== ACTION CHIPS ====================
    
    showActionChips() {
        this.clearActionChips();
        
        // Always show both chips (placeholder mode)
        this.addActionChip('product', 'Product Scan', '#3b82f6');
        this.addActionChip('health', 'Health Scan', '#10B881');
    }

    clearActionChips() {
        this.root.querySelectorAll('.action-chip').forEach(chip => chip.remove());
    }

    addActionChip(type, text, color) {
        const badge = this.root.querySelector('.badge');
        if (!badge) return;
        
        const badgeRect = badge.getBoundingClientRect();
        const chip = document.createElement('button');
        chip.className = `action-chip action-chip-${type}`;
        chip.textContent = text;
        chip.style.background = color;
        chip.dataset.chipType = type;
        
        // Position below badge
        this.root.appendChild(chip);
        this.positionActionChip(chip);
        
        chip.addEventListener('click', () => this.showModal(type));
    }

    positionActionChip(chip) {
        const badge = this.root.querySelector('.badge');
        if (!badge) return;
        
        const badgeRect = badge.getBoundingClientRect();
        const chipRect = chip.getBoundingClientRect();
        
        // Get index for stacking
        const chips = [...this.root.querySelectorAll('.action-chip')];
        const index = chips.indexOf(chip);
        
        let left = badgeRect.left + (badgeRect.width / 2);
        let top = badgeRect.bottom + 8 + (index * 48); // Stack with gap
        
        left -= chipRect.width / 2;
        left = Math.max(16, Math.min(left, window.innerWidth - chipRect.width - 16));
        top = Math.min(top, window.innerHeight - chipRect.height - 16);
        
        chip.style.left = `${left}px`;
        chip.style.top = `${top}px`;
    }

    repositionActionChips() {
        this.root.querySelectorAll('.action-chip').forEach(chip => {
            this.positionActionChip(chip);
        });
    }

    // ==================== MODAL ====================
    
    showModal(type) {
        if (this.activeModal) return;
        
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', 'modal-title');
        
        const content = {
            'health': {
                title: 'Health Scan',
                body: 'This feature will verify health claims and provide trusted medical information. Coming soon!'
            },
            'product': {
                title: 'Product Scan',
                body: 'This feature will compare prices and safety ratings across trusted retailers. Coming soon!'
            }
        };
        
        const modalData = content[type] || content['product'];
        
        overlay.innerHTML = `
            <div class="modal-content">
                <div class="modal-header" id="modal-title">${modalData.title}</div>
                <div class="modal-body">${modalData.body}</div>
                <button class="modal-close">Close</button>
            </div>
        `;
        
        this.root.appendChild(overlay);
        this.activeModal = overlay;
        
        const closeBtn = overlay.querySelector('.modal-close');
        const modalContent = overlay.querySelector('.modal-content');
        
        const closeModal = () => {
            if (this.activeModal) {
                this.activeModal.remove();
                this.activeModal = null;
                document.removeEventListener('keydown', this._modalEscapeHandler);
                this._modalEscapeHandler = null;
            }
        };
        
        // Focus trap
        const focusableElements = modalContent.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        const firstFocusable = focusableElements[0];
        const lastFocusable = focusableElements[focusableElements.length - 1];
        
        this._modalEscapeHandler = (e) => {
            if (e.key === 'Escape') closeModal();
            
            if (e.key === 'Tab') {
                if (e.shiftKey) {
                    if (document.activeElement === firstFocusable) {
                        e.preventDefault();
                        lastFocusable.focus();
                    }
                } else {
                    if (document.activeElement === lastFocusable) {
                        e.preventDefault();
                        firstFocusable.focus();
                    }
                }
            }
        };
        
        document.addEventListener('keydown', this._modalEscapeHandler);
        
        closeBtn.addEventListener('click', closeModal);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeModal();
        });
        
        // Focus first element
        requestAnimationFrame(() => closeBtn.focus());
    }

    // ==================== KEYBOARD SHORTCUTS ====================
    
    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            if (e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                if (e.key === '=' || e.key === '+') {
                    this.cycleSizeUp();
                    e.preventDefault();
                }
                if (e.key === '-' || e.key === '_') {
                    this.cycleSizeDown();
                    e.preventDefault();
                }
            }
        });
    }

    // ==================== RESIZE HANDLER ====================
    
    setupResizeHandler() {
        let resizeTimer;
        const rebalance = () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                const pos = this.positionState || { anchor: 'bottom-right', offsetX: 0, offsetY: 0 };
                this.applyPositioning(pos);
                this.positionSizeControls();
            }, 100);
        };
        
        window.addEventListener('resize', rebalance, { passive: true });
        window.addEventListener('scroll', rebalance, { passive: true });
        
        // Support mobile keyboards/zoom
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', rebalance);
            window.visualViewport.addEventListener('scroll', rebalance);
        }
    }

    // ==================== SPA DETECTION ====================
    
    initSpaDetection() {
        // Guard against double-patching
        if (window._safesignalHistoryPatched) {
            console.log('SafeSignal: History already patched, skipping');
            return;
        }
        
        const fire = (reason) => {
            requestAnimationFrame(() => this.checkIfPageChanged(reason));
        };
        
        const origPush = history.pushState;
        const origReplace = history.replaceState;
        
        history.pushState = function(...args) {
            const result = origPush.apply(history, args);
            fire('pushState');
            return result;
        };
        
        history.replaceState = function(...args) {
            const result = origReplace.apply(history, args);
            fire('replaceState');
            return result;
        };
        
        window._safesignalHistoryPatched = true;
        
        window.addEventListener('popstate', () => fire('popstate'));
        
        const mo = new MutationObserver(() => {
            clearTimeout(this.pageDebounceTimer);
            this.pageDebounceTimer = setTimeout(() => {
                fire('mutation');
            }, 500);
        });
        
        mo.observe(document.body, {
            childList: true,
            subtree: true
        });
        
        this.mutationObserver = mo;
        
        console.log('SafeSignal: SPA detection initialized');
    }

    checkIfPageChanged(trigger) {
        const newUrl = window.location.href;
        
        const now = Date.now();
        const lastCheck = this.lastCheckByUrl.get(newUrl) || 0;
        
        if (now - lastCheck < this.checkCooldown && trigger !== 'initial_load') {
            console.log('SafeSignal: Skipping check (cooldown)');
            return;
        }
        
        console.log(`SafeSignal: Page changed (${trigger})`);
        
        this.currentUrl = newUrl;
        this.lastCheckByUrl.set(newUrl, now);
        
        this.performSafetyCheck(newUrl);
        this.performContextScan();
    }

    async performSafetyCheck(url) {
        this.updateBadgeState('checking');
        
        try {
            const response = await chrome.runtime.sendMessage({
                action: 'check_url',
                url: url
            });
            
            if (response && response.verdict) {
                this.updateBadgeState(response.verdict, response);
            } else {
                this.updateBadgeState('ok');
            }
        } catch (error) {
            console.warn('SafeSignal: Check failed:', error);
            this.updateBadgeState('checking');
        }
    }

    performContextScan() {
        this.contextData = this.contextProbe.quickContextProbe();
        this.showActionChips();
    }

    updateBadgeState(state, data = {}) {
        const badge = this.root?.querySelector('.badge');
        const icon = this.root?.querySelector('.badge-icon');
        const label = this.root?.querySelector('.badge-label');
        
        if (!badge || !icon || !label) return;

        badge.className = badge.className.replace(/state-\w+/g, '');
        badge.classList.add(`state-${state}`);
        
        const stateConfig = {
            'ok': { icon: '✓', text: 'Safe' },
            'warning': { icon: '!', text: 'Caution' },
            'danger': { icon: '✗', text: 'High Risk' },
            'checking': { icon: '⧗', text: 'Checking' }
        };
        
        const config = stateConfig[state] || stateConfig['checking'];
        icon.textContent = config.icon;
        label.textContent = config.text;
        
        badge.setAttribute('aria-label', `SafeSignal: ${config.text}`);
        
        this.currentState = state;
        console.log(`SafeSignal: Badge state updated to ${state}`);
    }

    // ==================== USER PREFERENCES ====================
    
    async loadUserPreferences() {
        try {
            const result = await chrome.storage.sync.get([
                'positioning', 
                'sizeMode',
                'shape'
            ]);
            
            if (result.positioning) {
                this.userPreferences.positioning = result.positioning;
            }
            
            if (result.sizeMode) {
                this.userPreferences.sizeMode = result.sizeMode;
                this.sizeMode = result.sizeMode;
            }
            
            if (result.shape) {
                this.userPreferences.shape = result.shape;
                this.shape = result.shape;
            }
            
            console.log('SafeSignal: Loaded preferences');
        } catch (error) {
            console.warn('SafeSignal: Could not load preferences:', error);
        }
    }

    async saveUserPreferences() {
        try {
            await chrome.storage.sync.set({
                positioning: this.userPreferences.positioning,
                sizeMode: this.userPreferences.sizeMode,
                shape: this.userPreferences.shape
            });
            console.log('SafeSignal: Saved preferences');
        } catch (error) {
            console.warn('SafeSignal: Could not save preferences:', error);
        }
    }

    // ==================== CLEANUP ====================
    
    destroy() {
        if (this._docClickHandler) {
            document.removeEventListener('click', this._docClickHandler, { capture: true });
        }
        
        if (this.longPressTimer) {
            clearTimeout(this.longPressTimer);
        }
        
        if (this.pageDebounceTimer) {
            clearTimeout(this.pageDebounceTimer);
        }
        
        if (this.mutationObserver) {
            this.mutationObserver.disconnect();
        }
        
        if (this.host && this.host.parentNode) {
            this.host.parentNode.removeChild(this.host);
        }
        
        console.log('SafeSignal: Badge destroyed');
    }
}

// ==================== CONTEXT PROBE ====================

class SafeSignalContextProbe {
    constructor() {
        this.productIndicators = {
            shoppingTerms: [
                'add to cart', 'buy now', 'purchase', 'checkout', 'order now',
                'price', 'sale', 'discount', 'shipping', 'delivery',
                'add to bag', 'cart', 'basket', 'subscribe & save'
            ]
        };

        this.healthIndicators = {
            healthTerms: [
                'supplement', 'vitamin', 'health', 'medicine', 'treatment',
                'cure', 'heal', 'therapy', 'clinical', 'medical',
                'dosage', 'side effects', 'contraindications'
            ],
            suspiciousHealth: [
                'miracle cure', 'instant relief', 'guaranteed results',
                'doctors hate this', 'secret remedy', 'breakthrough'
            ]
        };
    }

    quickContextProbe() {
        const pageText = document.body.textContent.toLowerCase();
        
        const productScore = this.calculateProductScore(pageText);
        const isProduct = productScore > 0.6;
        
        const healthScore = this.calculateHealthScore(pageText);
        const isHealth = healthScore > 0.6;
        
        return {
            isProduct,
            productConfidence: productScore,
            isHealth,
            healthConfidence: healthScore
        };
    }

    calculateProductScore(pageText) {
        let score = 0;
        
        const priceRegex = /\$\d+|\$\d+\.\d+|price.*\$|\d+\.\d+.*usd/gi;
        const priceMatches = pageText.match(priceRegex);
        if (priceMatches && priceMatches.length > 0) {
            score += Math.min(priceMatches.length * 0.2, 0.5);
        }
        
        let termMatches = 0;
        this.productIndicators.shoppingTerms.forEach(term => {
            if (pageText.includes(term)) termMatches++;
        });
        score += Math.min(termMatches * 0.1, 0.4);
        
        return Math.min(score, 1.0);
    }

    calculateHealthScore(pageText) {
        let score = 0;
        
        let healthTerms = 0;
        this.healthIndicators.healthTerms.forEach(term => {
            if (pageText.includes(term)) healthTerms++;
        });
        score += Math.min(healthTerms * 0.1, 0.5);
        
        let suspiciousTerms = 0;
        this.healthIndicators.suspiciousHealth.forEach(term => {
            if (pageText.includes(term)) suspiciousTerms++;
        });
        score += Math.min(suspiciousTerms * 0.2, 0.4);
        
        return Math.min(score, 1.0);
    }
}

// ==================== INITIALIZATION ====================

function initializeBadge() {
    if (window.safesignalBadgeInstance) {
        window.safesignalBadgeInstance.destroy();
        window.safesignalBadgeInstance = null;
    }
    
    window.safesignalBadgeInstance = new SafeSignalBadge();
}

if (typeof window !== 'undefined') {
    window.SafeSignalBadge = SafeSignalBadge;
    window.SafeSignalContextProbe = SafeSignalContextProbe;
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeBadge);
} else {
    initializeBadge();
}

console.log('[SafeSignal] Content script loaded');
/******/ })()
;
//# sourceMappingURL=content.js.map