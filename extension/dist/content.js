/******/ (() => { // webpackBootstrap
/******/ 	var __webpack_modules__ = ({

/***/ 611:
/***/ ((module) => {

// SafeSignal Content Script - Fixed Visibility Edition
// Version: 4.1-visibility-fix

const SAFESIGNAL_BUILD = 'content-2025-09-29-v4.1-fixed';
console.info('[SafeSignal] Build:', SAFESIGNAL_BUILD);

class SafeSignalBadge {
    constructor() {
        // Core elements
        this.host = null;
        this.root = null;
        
        // State management
        this.currentState = 'checking';
        this.contextData = null;
        this.isMenuOpen = false;
        this.activeModal = null;
        
        // Positioning
        this.position = 'bottom-right';
        
        // Size mode (elder-friendly defaults)
        this.sizeMode = 'large';
        
        // SPA detection
        this.currentUrl = null; // Start as null so first check always runs
        this.mutationObserver = null;
        this.pageDebounceTimer = null;
        this.lastCheckByUrl = new Map();
        this.checkCooldown = 30 * 60 * 1000;
        
        // Context detection
        this.contextProbe = new SafeSignalContextProbe();
        
        // User preferences
        this.userPreferences = {
            position: 'bottom-right',
            sizeMode: 'large',
            miniChipsEnabled: true
        };
        
        this.init();
    }
    
    async init() {
        if (this.shouldSkipInjection()) return;
        
        await this.loadUserPreferences();
        this.createBadge();
        this.initSpaDetection();
        this.setupKeyboardShortcuts();
        this.setupResizeHandler();
        
        console.log('[SafeSignal] Badge initialized and visible');
        this.checkIfPageChanged('initial_load');
    }
    
    shouldSkipInjection() {
        if (document.getElementById('safesignal-host')) {
            console.log('[SafeSignal] Badge already exists');
            return true;
        }
        
        const protocol = window.location.protocol;
        if (['chrome:', 'chrome-extension:', 'moz-extension:', 'about:'].includes(protocol)) {
            return true;
        }
        
        if (window.top !== window) {
            console.log('[SafeSignal] Skipping iframe');
            return true;
        }
        
        return false;
    }
    
    // ==================== BADGE CREATION ====================
    
    createBadge() {
        // Create host container
        this.host = document.createElement('div');
        this.host.setAttribute('id', 'safesignal-host');
        this.root = this.host.attachShadow({ mode: 'open' });
        
        // Get size configuration
        const sizes = {
            normal: { badge: 56, font: 18, chip: 32, chipFont: 14 },
            large: { badge: 64, font: 20, chip: 36, chipFont: 15 },
            xl: { badge: 72, font: 22, chip: 40, chipFont: 16 }
        };
        const config = sizes[this.sizeMode] || sizes.large;
        
        // Create Shadow DOM structure with FIXED positioning
        this.root.innerHTML = `
            <style>
                * {
                    margin: 0;
                    padding: 0;
                    box-sizing: border-box;
                }
                
                /* Main container - FIXED positioning */
                .safesignal-container {
                    position: fixed !important;
                    z-index: 2147483647 !important;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif !important;
                    pointer-events: auto !important;
                    display: flex !important;
                    flex-direction: column !important;
                    align-items: center !important;
                    gap: 8px !important;
                }
                
                /* Position classes */
                .pos-top-left { top: 20px !important; left: 20px !important; }
                .pos-top-right { top: 20px !important; right: 20px !important; }
                .pos-bottom-left { bottom: 20px !important; left: 20px !important; }
                .pos-bottom-right { bottom: 20px !important; right: 20px !important; }
                .pos-mid-left { top: 50% !important; left: 20px !important; transform: translateY(-50%) !important; }
                .pos-mid-right { top: 50% !important; right: 20px !important; transform: translateY(-50%) !important; }
                
                /* Mini chips container */
                .chips-wrapper {
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                    align-items: center;
                    order: -1; /* Always above badge */
                }
                
                /* Mini chip */
                .mini-chip {
                    height: ${config.chip}px;
                    padding: 0 14px;
                    border-radius: ${config.chip / 2}px;
                    font-size: ${config.chipFont}px;
                    font-weight: 600;
                    color: white;
                    border: 1px solid rgba(255, 255, 255, 0.3);
                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    white-space: nowrap;
                    transition: all 0.2s ease;
                    opacity: 0;
                    transform: translateY(10px);
                    animation: chipFadeIn 0.3s ease forwards;
                    background: #2563eb; /* Default blue */
                }
                
                @keyframes chipFadeIn {
                    to {
                        opacity: 0.95;
                        transform: translateY(0);
                    }
                }
                
                .mini-chip:hover {
                    opacity: 1;
                    transform: translateY(-2px);
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
                }
                
                .mini-chip.product {
                    background: #7c3aed;
                }
                
                .mini-chip.health {
                    background: #059669;
                }
                
                /* Main badge wrapper */
                .badge-wrapper {
                    position: relative;
                    display: flex;
                    align-items: center;
                }
                
                /* Main badge */
                .badge {
                    height: ${config.badge}px;
                    min-width: ${config.badge}px;
                    padding: 0 20px;
                    padding-right: 48px; /* Space for menu button */
                    border-radius: ${config.badge / 2}px;
                    font-size: ${config.font}px;
                    font-weight: 700;
                    color: white;
                    border: 2px solid rgba(255, 255, 255, 0.3);
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    transition: all 0.2s ease;
                    position: relative;
                    background: #6b7280; /* Default gray */
                }
                
                .badge:hover {
                    transform: scale(1.05);
                    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2);
                }
                
                .badge.state-ok {
                    background: #059669;
                }
                
                .badge.state-warning {
                    background: #d97706;
                }
                
                .badge.state-danger {
                    background: #dc2626;
                }
                
                .badge.state-checking {
                    background: #6b7280;
                }
                
                .badge-icon {
                    font-size: 1.2em;
                    line-height: 1;
                }
                
                .badge-label {
                    font-size: 0.9em;
                    white-space: nowrap;
                }
                
                /* Menu button - inside badge */
                .menu-btn {
                    position: absolute;
                    right: 10px;
                    top: 50%;
                    transform: translateY(-50%);
                    width: 32px;
                    height: 32px;
                    border-radius: 50%;
                    background: rgba(255, 255, 255, 0.2);
                    color: white;
                    border: none;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 20px;
                    font-weight: bold;
                    transition: all 0.2s ease;
                }
                
                .menu-btn:hover {
                    background: rgba(255, 255, 255, 0.3);
                    transform: translateY(-50%) scale(1.1);
                }
                
                /* Menu panel */
                .menu {
                    position: absolute;
                    bottom: calc(100% + 12px);
                    right: 0;
                    background: white;
                    border-radius: 12px;
                    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
                    border: 1px solid #e5e7eb;
                    padding: 16px;
                    min-width: 220px;
                    display: none;
                    z-index: 1000;
                }
                
                .menu.open {
                    display: block;
                }
                
                /* Adjust menu position for top placements */
                .pos-top-left .menu,
                .pos-top-right .menu {
                    bottom: auto;
                    top: calc(100% + 12px);
                }
                
                .menu-section {
                    margin-bottom: 12px;
                }
                
                .menu-section:last-child {
                    margin-bottom: 0;
                }
                
                .menu-label {
                    font-size: 11px;
                    font-weight: 600;
                    color: #6b7280;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                    margin-bottom: 8px;
                }
                
                /* Position grid */
                .position-grid {
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 4px;
                }
                
                .pos-btn {
                    width: 32px;
                    height: 32px;
                    border: 1px solid #d1d5db;
                    border-radius: 6px;
                    background: white;
                    cursor: pointer;
                    transition: all 0.2s ease;
                    position: relative;
                }
                
                .pos-btn:hover {
                    background: #f3f4f6;
                    border-color: #9ca3af;
                }
                
                .pos-btn.active {
                    background: #7c3aed;
                    border-color: #7c3aed;
                }
                
                .pos-btn.active::after {
                    content: '•';
                    position: absolute;
                    inset: 0;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: white;
                    font-size: 18px;
                }
                
                /* Size buttons */
                .size-controls {
                    display: flex;
                    gap: 8px;
                }
                
                .size-btn {
                    flex: 1;
                    padding: 6px 10px;
                    border: 1px solid #d1d5db;
                    border-radius: 6px;
                    background: white;
                    color: #374151;
                    font-size: 13px;
                    font-weight: 500;
                    cursor: pointer;
                    transition: all 0.2s ease;
                }
                
                .size-btn:hover {
                    background: #f3f4f6;
                    border-color: #9ca3af;
                }
                
                .size-btn.active {
                    background: #7c3aed;
                    color: white;
                    border-color: #7c3aed;
                }
                
                /* Modal */
                .modal-overlay {
                    position: fixed;
                    inset: 0;
                    background: rgba(0, 0, 0, 0.5);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 2147483646;
                    display: none;
                }
                
                .modal-overlay.open {
                    display: flex;
                }
                
                .modal {
                    background: white;
                    border-radius: 16px;
                    padding: 24px;
                    max-width: 400px;
                    width: 90%;
                    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.15);
                }
                
                .modal-title {
                    font-size: 20px;
                    font-weight: 700;
                    color: #111827;
                    margin-bottom: 12px;
                }
                
                .modal-body {
                    font-size: 16px;
                    line-height: 1.5;
                    color: #6b7280;
                    margin-bottom: 20px;
                }
                
                .modal-close {
                    width: 100%;
                    padding: 12px;
                    border-radius: 8px;
                    background: #7c3aed;
                    color: white;
                    font-size: 16px;
                    font-weight: 600;
                    border: none;
                    cursor: pointer;
                    transition: all 0.2s ease;
                }
                
                .modal-close:hover {
                    background: #6d28d9;
                }
                
                /* Accessibility */
                @media (prefers-reduced-motion: reduce) {
                    * {
                        transition: none !important;
                        animation: none !important;
                    }
                }
            </style>
            
            <!-- Main container with position class -->
            <div class="safesignal-container pos-bottom-right" id="main-container">
                <!-- Mini chips wrapper (will be populated dynamically) -->
                <div class="chips-wrapper" id="chips-wrapper"></div>
                
                <!-- Badge wrapper -->
                <div class="badge-wrapper">
                    <div class="badge state-checking" 
                         role="button" 
                         tabindex="0" 
                         aria-live="polite" 
                         aria-label="SafeSignal: Checking"
                         id="main-badge">
                        <span class="badge-icon">⧗</span>
                        <span class="badge-label">Checking</span>
                        <button class="menu-btn" 
                                aria-label="SafeSignal Menu"
                                aria-expanded="false"
                                id="menu-btn">
                            ⋯
                        </button>
                    </div>
                    
                    <!-- Menu -->
                    <div class="menu" id="menu" role="dialog">
                        <div class="menu-section">
                            <div class="menu-label">Position</div>
                            <div class="position-grid">
                                <button class="pos-btn" data-pos="top-left" title="Top Left"></button>
                                <button class="pos-btn" data-pos="top-center" title="Top Center" disabled style="opacity: 0.3"></button>
                                <button class="pos-btn" data-pos="top-right" title="Top Right"></button>
                                <button class="pos-btn" data-pos="mid-left" title="Middle Left"></button>
                                <button class="pos-btn" data-pos="mid-center" title="Center" disabled style="opacity: 0.3"></button>
                                <button class="pos-btn" data-pos="mid-right" title="Middle Right"></button>
                                <button class="pos-btn" data-pos="bottom-left" title="Bottom Left"></button>
                                <button class="pos-btn" data-pos="bottom-center" title="Bottom Center" disabled style="opacity: 0.3"></button>
                                <button class="pos-btn active" data-pos="bottom-right" title="Bottom Right"></button>
                            </div>
                        </div>
                        
                        <div class="menu-section">
                            <div class="menu-label">Size</div>
                            <div class="size-controls">
                                <button class="size-btn" data-size="normal">Normal</button>
                                <button class="size-btn active" data-size="large">Large</button>
                                <button class="size-btn" data-size="xl">XL</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- Modal -->
            <div class="modal-overlay" id="modal-overlay">
                <div class="modal" role="dialog" aria-modal="true">
                    <h2 class="modal-title" id="modal-title">Feature Coming Soon</h2>
                    <div class="modal-body" id="modal-body">
                        This feature is being developed and will be available soon.
                    </div>
                    <button class="modal-close" id="modal-close">Got it</button>
                </div>
            </div>
        `;
        
        // Add to page - CRITICAL: append to body
        document.body.appendChild(this.host);
        
        // Get element references
        this.container = this.root.getElementById('main-container');
        this.badge = this.root.getElementById('main-badge');
        this.menuBtn = this.root.getElementById('menu-btn');
        this.menu = this.root.getElementById('menu');
        this.chipsWrapper = this.root.getElementById('chips-wrapper');
        this.modalOverlay = this.root.getElementById('modal-overlay');
        
        // Initialize event listeners
        this.initEventListeners();
        
        // Apply saved position
        this.setPosition(this.userPreferences.position);
        
        // Apply saved size
        this.setSize(this.userPreferences.sizeMode);
        
        console.log('[SafeSignal] Badge created and should be visible');
    }
    
    // ==================== EVENT LISTENERS ====================
    
    initEventListeners() {
        // Badge click
        this.badge.addEventListener('click', (e) => {
            if (e.target === this.menuBtn || this.menuBtn.contains(e.target)) return;
            console.log('[SafeSignal] Badge clicked');
        });
        
        // Menu toggle
        this.menuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleMenu();
        });
        
        // Position buttons
        this.root.querySelectorAll('.pos-btn:not([disabled])').forEach(btn => {
            btn.addEventListener('click', () => {
                const position = btn.dataset.pos;
                this.setPosition(position);
                this.saveUserPreferences();
            });
        });
        
        // Size buttons
        this.root.querySelectorAll('.size-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const size = btn.dataset.size;
                this.setSize(size);
                this.saveUserPreferences();
            });
        });
        
        // Modal close
        this.root.getElementById('modal-close').addEventListener('click', () => {
            this.closeModal();
        });
        
        // Close menu on outside click
        document.addEventListener('click', (e) => {
            if (this.isMenuOpen && !this.host.contains(e.target)) {
                this.closeMenu();
            }
        });
    }
    
    // ==================== POSITION MANAGEMENT ====================
    
    setPosition(position) {
        const validPositions = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'mid-left', 'mid-right'];
        
        if (!validPositions.includes(position)) {
            position = 'bottom-right';
        }
        
        // Remove all position classes
        validPositions.forEach(pos => {
            this.container.classList.remove(`pos-${pos}`);
        });
        
        // Add new position class
        this.container.classList.add(`pos-${position}`);
        
        // Update active button
        this.root.querySelectorAll('.pos-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.pos === position);
        });
        
        this.position = position;
        this.userPreferences.position = position;
        
        console.log(`[SafeSignal] Position set to: ${position}`);
    }
    
    // ==================== SIZE MANAGEMENT ====================
    
    setSize(size) {
        const sizes = {
            normal: { badge: 56, font: 18, chip: 32, chipFont: 14 },
            large: { badge: 64, font: 20, chip: 36, chipFont: 15 },
            xl: { badge: 72, font: 22, chip: 40, chipFont: 16 }
        };
        
        const config = sizes[size] || sizes.large;
        
        // Update badge size
        this.badge.style.height = `${config.badge}px`;
        this.badge.style.minWidth = `${config.badge}px`;
        this.badge.style.borderRadius = `${config.badge / 2}px`;
        this.badge.style.fontSize = `${config.font}px`;
        
        // Update chips size
        this.root.querySelectorAll('.mini-chip').forEach(chip => {
            chip.style.height = `${config.chip}px`;
            chip.style.borderRadius = `${config.chip / 2}px`;
            chip.style.fontSize = `${config.chipFont}px`;
        });
        
        // Update active button
        this.root.querySelectorAll('.size-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.size === size);
        });
        
        this.sizeMode = size;
        this.userPreferences.sizeMode = size;
        
        console.log(`[SafeSignal] Size set to: ${size}`);
    }
    
    // ==================== MENU MANAGEMENT ====================
    
    toggleMenu() {
        if (this.isMenuOpen) {
            this.closeMenu();
        } else {
            this.openMenu();
        }
    }
    
    openMenu() {
        this.menu.classList.add('open');
        this.menuBtn.setAttribute('aria-expanded', 'true');
        this.isMenuOpen = true;
    }
    
    closeMenu() {
        this.menu.classList.remove('open');
        this.menuBtn.setAttribute('aria-expanded', 'false');
        this.isMenuOpen = false;
    }
    
    // ==================== MINI CHIPS ====================
    
    updateMiniChips() {
        // Run context detection
        this.contextData = this.contextProbe.analyze();
        
        // Clear existing chips
        this.chipsWrapper.innerHTML = '';
        
        // Add chips based on confidence scores
        const chips = [];
        
        if (this.contextData.product.confidence > 0.3) {
            chips.push({
                type: 'product',
                label: '🛒 Better Deals',
                icon: '🛒'
            });
        }
        
        if (this.contextData.health.confidence > 0.3) {
            chips.push({
                type: 'health',
                label: '🔬 Verify Info',
                icon: '🔬'
            });
        }
        
        // Create chip elements
        chips.forEach((chip, index) => {
            const chipEl = document.createElement('button');
            chipEl.className = `mini-chip ${chip.type}`;
            chipEl.innerHTML = `${chip.label}`;
            chipEl.setAttribute('aria-label', chip.label);
            chipEl.style.animationDelay = `${index * 0.1}s`;
            
            chipEl.addEventListener('click', () => this.handleChipClick(chip.type));
            
            this.chipsWrapper.appendChild(chipEl);
        });
    }
    
    handleChipClick(type) {
        console.log(`[SafeSignal] Chip clicked: ${type}`);
        this.showModal(type);
    }
    
    // ==================== MODAL ====================
    
    showModal(type) {
        const modalContent = {
            product: {
                title: '🛒 Product Price Scanner',
                body: 'This feature will compare prices across trusted retailers and alert you to better deals. Coming soon!'
            },
            health: {
                title: '🔬 Health Claim Verifier',
                body: 'This feature will fact-check health claims against medical databases. Coming soon!'
            }
        };
        
        const content = modalContent[type] || modalContent.product;
        
        const title = this.root.getElementById('modal-title');
        const body = this.root.getElementById('modal-body');
        
        title.textContent = content.title;
        body.textContent = content.body;
        
        this.modalOverlay.classList.add('open');
        this.activeModal = type;
    }
    
    closeModal() {
        this.modalOverlay.classList.remove('open');
        this.activeModal = null;
    }
    
    // ==================== STATE MANAGEMENT ====================
    
    updateBadgeState(state) {
        const states = {
            'ok': { icon: '✅', label: 'Safe', class: 'state-ok' },
            'warning': { icon: '⚠️', label: 'Caution', class: 'state-warning' },
            'danger': { icon: '❌', label: 'High Risk', class: 'state-danger' },
            'checking': { icon: '⧗', label: 'Checking', class: 'state-checking' }
        };
        
        const config = states[state] || states.checking;
        
        // Update badge classes
        this.badge.className = `badge ${config.class}`;
        
        // Update content
        const icon = this.badge.querySelector('.badge-icon');
        const label = this.badge.querySelector('.badge-label');
        
        icon.textContent = config.icon;
        label.textContent = config.label;
        
        // Update ARIA
        this.badge.setAttribute('aria-label', `SafeSignal: ${config.label}`);
        
        this.currentState = state;
        
        // Update mini chips based on new state
        if (state !== 'checking') {
            this.updateMiniChips();
        }
    }
    
    // ==================== SPA DETECTION ====================
    
    initSpaDetection() {
        // Monitor URL changes
        const originalPushState = history.pushState;
        const originalReplaceState = history.replaceState;
        
        history.pushState = (...args) => {
            originalPushState.apply(history, args);
            this.checkIfPageChanged('pushState');
        };
        
        history.replaceState = (...args) => {
            originalReplaceState.apply(history, args);
            this.checkIfPageChanged('replaceState');
        };
        
        window.addEventListener('popstate', () => {
            this.checkIfPageChanged('popstate');
        });
        
        // Monitor DOM changes
        this.mutationObserver = new MutationObserver(() => {
            this.debouncedPageCheck();
        });
        
        this.mutationObserver.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: false,
            characterData: false
        });
    }
    
    debouncedPageCheck() {
        if (this.pageDebounceTimer) {
            clearTimeout(this.pageDebounceTimer);
        }
        
        this.pageDebounceTimer = setTimeout(() => {
            if (this.currentUrl !== window.location.href) {
                this.checkIfPageChanged('mutation');
            }
        }, 800);
    }
    
    checkIfPageChanged(trigger) {
        const newUrl = window.location.href;
        
        // Skip if same URL (but allow initial load)
        if (newUrl === this.currentUrl && trigger !== 'initial_load') {
            return;
        }
        
        console.log(`[SafeSignal] Page changed (${trigger}): ${newUrl}`);
        
        // Check cooldown (skip for initial load)
        if (trigger !== 'initial_load') {
            const lastCheck = this.lastCheckByUrl.get(newUrl);
            const now = Date.now();
            
            if (lastCheck && (now - lastCheck) < this.checkCooldown) {
                console.log('[SafeSignal] Skipping check - cooldown active');
                return;
            }
        }
        
        // Update current URL
        this.currentUrl = newUrl;
        
        // Update state to checking
        this.updateBadgeState('checking');
        
        // Perform page analysis
        this.analyzePage(newUrl);
    }
    
    async analyzePage(url) {
        try {
            console.log('[SafeSignal] Analyzing page...');
            
            // Quick context analysis for demo
            const context = this.contextProbe.analyze();
            console.log('[SafeSignal] Context analysis:', context);
            
            // Simulate API call (replace with actual API integration)
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            // Demo: Assign states based on simple heuristics
            let state = 'ok'; // Default to safe
            
            // Check for suspicious patterns
            const pageText = document.body.innerText?.toLowerCase() || '';
            const suspiciousTerms = [
                'urgent', 'act now', 'limited time', 'virus detected', 
                'winner', 'congratulations', 'claim your', 'verify account',
                'suspended', 'click here immediately', 'confirm identity'
            ];
            
            const warningTerms = [
                'sale', 'discount', 'offer', 'deal', 'subscribe',
                'download', 'update required', 'install'
            ];
            
            // Count suspicious indicators
            const suspiciousCount = suspiciousTerms.filter(term => pageText.includes(term)).length;
            const warningCount = warningTerms.filter(term => pageText.includes(term)).length;
            
            // Determine state based on indicators
            if (suspiciousCount >= 3) {
                state = 'danger';
            } else if (suspiciousCount >= 1 || warningCount >= 3) {
                state = 'warning';
            } else {
                // Check URL patterns
                const urlLower = url.toLowerCase();
                if (urlLower.includes('phishing') || urlLower.includes('suspicious')) {
                    state = 'danger';
                } else if (urlLower.includes('shop') || urlLower.includes('promo')) {
                    state = 'warning';
                }
            }
            
            console.log(`[SafeSignal] Analysis complete: ${state}`);
            this.updateBadgeState(state);
            this.lastCheckByUrl.set(url, Date.now());
            
        } catch (error) {
            console.error('[SafeSignal] Analysis failed:', error);
            this.updateBadgeState('ok'); // Default to safe on error
        }
    }
    
    // ==================== KEYBOARD SHORTCUTS ====================
    
    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Alt+S to toggle SafeSignal visibility
            if (e.altKey && e.key === 's') {
                e.preventDefault();
                this.toggleVisibility();
            }
            
            // Escape to close menu/modal
            if (e.key === 'Escape') {
                if (this.activeModal) {
                    this.closeModal();
                } else if (this.isMenuOpen) {
                    this.closeMenu();
                }
            }
        });
    }
    
    toggleVisibility() {
        if (this.host.style.display === 'none') {
            this.host.style.display = '';
            console.log('[SafeSignal] Badge shown');
        } else {
            this.host.style.display = 'none';
            console.log('[SafeSignal] Badge hidden');
        }
    }
    
    // ==================== RESIZE HANDLER ====================
    
    setupResizeHandler() {
        let resizeTimer;
        
        window.addEventListener('resize', () => {
            if (resizeTimer) {
                clearTimeout(resizeTimer);
            }
            
            resizeTimer = setTimeout(() => {
                // Ensure badge stays visible after resize
                const rect = this.container.getBoundingClientRect();
                if (rect.right > window.innerWidth || rect.bottom > window.innerHeight) {
                    console.log('[SafeSignal] Adjusting position after resize');
                    this.setPosition(this.position);
                }
            }, 250);
        });
    }
    
    // ==================== USER PREFERENCES ====================
    
    async loadUserPreferences() {
        try {
            const stored = await chrome.storage.sync.get([
                'position',
                'sizeMode',
                'miniChipsEnabled'
            ]);
            
            if (stored.position) {
                this.userPreferences.position = stored.position;
            }
            
            if (stored.sizeMode) {
                this.userPreferences.sizeMode = stored.sizeMode;
                this.sizeMode = stored.sizeMode;
            }
            
            if (stored.miniChipsEnabled !== undefined) {
                this.userPreferences.miniChipsEnabled = stored.miniChipsEnabled;
            }
            
            console.log('[SafeSignal] Preferences loaded:', this.userPreferences);
        } catch (error) {
            console.warn('[SafeSignal] Could not load preferences:', error);
            // Use defaults if storage fails
        }
    }
    
    async saveUserPreferences() {
        try {
            await chrome.storage.sync.set({
                position: this.userPreferences.position,
                sizeMode: this.userPreferences.sizeMode,
                miniChipsEnabled: this.userPreferences.miniChipsEnabled
            });
            
            console.log('[SafeSignal] Preferences saved');
        } catch (error) {
            console.warn('[SafeSignal] Could not save preferences:', error);
        }
    }
    
    // ==================== CLEANUP ====================
    
    destroy() {
        // Remove event listeners
        document.removeEventListener('click', this.documentClickHandler);
        
        // Disconnect observers
        if (this.mutationObserver) {
            this.mutationObserver.disconnect();
        }
        
        // Clear timers
        if (this.pageDebounceTimer) {
            clearTimeout(this.pageDebounceTimer);
        }
        
        // Remove DOM
        if (this.host && this.host.parentNode) {
            this.host.parentNode.removeChild(this.host);
        }
        
        console.log('[SafeSignal] Badge destroyed');
    }
}

// ==================== CONTEXT DETECTION ====================

class SafeSignalContextProbe {
    constructor() {
        this.indicators = {
            product: {
                terms: ['buy', 'price', 'cart', 'checkout', 'shipping', 'product', 'shop', 'store', 'deal', 'discount', 'sale', 'order', 'purchase', 'payment'],
                selectors: ['[itemtype*="schema.org/Product"]', '[data-price]', '.price', '.product', '.add-to-cart', '#buy-button'],
                patterns: [/\$\d+/, /USD \d+/, /€\d+/, /£\d+/]
            },
            health: {
                terms: ['symptom', 'treatment', 'medicine', 'drug', 'cure', 'therapy', 'doctor', 'medical', 'health', 'disease', 'condition', 'diagnosis', 'prescription'],
                selectors: ['[itemtype*="schema.org/MedicalCondition"]', '[itemtype*="schema.org/Drug"]', '.medical', '.health-info'],
                suspiciousTerms: ['miracle', 'breakthrough', 'secret', 'one weird trick', 'doctors hate', 'instant relief', 'guaranteed cure']
            }
        };
    }
    
    analyze() {
        const results = {
            product: { confidence: 0, signals: [] },
            health: { confidence: 0, signals: [] }
        };
        
        // Get page content
        const pageText = this.getPageText();
        const pageTitle = document.title.toLowerCase();
        const pageUrl = window.location.href.toLowerCase();
        
        // Analyze product signals
        results.product = this.analyzeProductSignals(pageText, pageTitle, pageUrl);
        
        // Analyze health signals
        results.health = this.analyzeHealthSignals(pageText, pageTitle, pageUrl);
        
        return results;
    }
    
    getPageText() {
        // Get text from main content areas
        const contentSelectors = ['main', 'article', '[role="main"]', '#content', '.content'];
        let text = '';
        
        for (const selector of contentSelectors) {
            const element = document.querySelector(selector);
            if (element) {
                text += (element.innerText || element.textContent || '') + ' ';
            }
        }
        
        // Fallback to body if no main content found
        if (!text.trim()) {
            const bodyText = document.body.innerText || document.body.textContent || '';
            text = bodyText;
        }
        
        return text.toLowerCase().slice(0, 5000); // Limit to first 5000 chars
    }
    
    analyzeProductSignals(pageText, pageTitle, pageUrl) {
        let confidence = 0;
        const signals = [];
        
        // Check for product terms
        const termMatches = this.indicators.product.terms.filter(term => 
            pageText.includes(term) || pageTitle.includes(term)
        );
        
        if (termMatches.length > 0) {
            confidence += Math.min(termMatches.length * 0.1, 0.4);
            signals.push(`Found ${termMatches.length} shopping terms`);
        }
        
        // Check for product selectors
        const selectorMatches = this.indicators.product.selectors.filter(selector => {
            try {
                return document.querySelector(selector) !== null;
            } catch (e) {
                return false; // Invalid selector
            }
        });
        
        if (selectorMatches.length > 0) {
            confidence += Math.min(selectorMatches.length * 0.2, 0.4);
            signals.push(`Found ${selectorMatches.length} product elements`);
        }
        
        // Check for price patterns
        const priceMatches = this.indicators.product.patterns.filter(pattern =>
            pattern.test(pageText)
        );
        
        if (priceMatches.length > 0) {
            confidence += 0.2;
            signals.push('Found price indicators');
        }
        
        // Check URL patterns
        if (/shop|store|product|cart|checkout|buy/.test(pageUrl)) {
            confidence += 0.2;
            signals.push('Shopping URL pattern');
        }
        
        return { confidence: Math.min(confidence, 1), signals };
    }
    
    analyzeHealthSignals(pageText, pageTitle, pageUrl) {
        let confidence = 0;
        const signals = [];
        
        // Check for health terms
        const termMatches = this.indicators.health.terms.filter(term =>
            pageText.includes(term) || pageTitle.includes(term)
        );
        
        if (termMatches.length > 0) {
            confidence += Math.min(termMatches.length * 0.1, 0.4);
            signals.push(`Found ${termMatches.length} health terms`);
        }
        
        // Check for suspicious health claims
        const suspiciousMatches = this.indicators.health.suspiciousTerms.filter(term =>
            pageText.includes(term)
        );
        
        if (suspiciousMatches.length > 0) {
            confidence += Math.min(suspiciousMatches.length * 0.15, 0.3);
            signals.push('Detected suspicious health claims');
        }
        
        // Check for health selectors
        const selectorMatches = this.indicators.health.selectors.filter(selector => {
            try {
                return document.querySelector(selector) !== null;
            } catch (e) {
                return false; // Invalid selector
            }
        });
        
        if (selectorMatches.length > 0) {
            confidence += 0.2;
            signals.push('Found health-related markup');
        }
        
        // Check URL patterns
        if (/health|medical|medicine|treatment|symptom|drug/.test(pageUrl)) {
            confidence += 0.2;
            signals.push('Health URL pattern');
        }
        
        return { confidence: Math.min(confidence, 1), signals };
    }
}

// ==================== INITIALIZATION ====================

function initializeSafeSignal() {
    // Clean up any existing instance
    if (window.safeSignalInstance) {
        window.safeSignalInstance.destroy();
        window.safeSignalInstance = null;
    }
    
    // Create new instance
    window.safeSignalInstance = new SafeSignalBadge();
    
    console.log('[SafeSignal] Extension initialized');
}

// Wait for DOM to be ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeSafeSignal);
} else {
    // DOM is already loaded, initialize immediately
    initializeSafeSignal();
}

// Handle dynamic iframe injections
if (window.self === window.top) {
    // Only in main window, not iframes
    console.log('[SafeSignal] Content script loaded in main window');
}

// Export for testing
if ( true && module.exports) {
    module.exports = { SafeSignalBadge, SafeSignalContextProbe };
}

/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		__webpack_modules__[moduleId](module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	
/******/ 	// startup
/******/ 	// Load entry module and return exports
/******/ 	// This entry module is referenced by other modules so it can't be inlined
/******/ 	var __webpack_exports__ = __webpack_require__(611);
/******/ 	
/******/ })()
;
//# sourceMappingURL=content.js.map