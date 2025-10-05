// SafeSignal Content Script - Fixed Visibility Edition + Scanner Wiring
// Version: 4.1-visibility-fix + scanners

const SAFESIGNAL_BUILD = 'content-2025-10-03-v4.1-scanner-wired';
const API_BASE_URL = 'http://localhost:8000';

console.info('[SafeSignal] Build:', SAFESIGNAL_BUILD);
import chipManager from './services/chipManager.js';

// ← ADDED: Import scanner modules
import { PageScanner, ScannerUI, APIClient } from './scanners.js';

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
        
        // ← ADDED: Scanner services (initialized after Shadow DOM creation)
        this.apiClient = null;
        this.scanner = null;
        this.scannerUI = null;
        
        // Context detection
        this.contextProbe = new SafeSignalContextProbe();
        
        // User preferences
        this.userPreferences = {
            position: 'bottom-right',
            sizeMode: 'large',
            miniChipsEnabled: true
        };
        this.chipManager = chipManager;
        
        this.init();
    }
    
    async init() {
        if (this.shouldSkipInjection()) return;
        
        await this.loadUserPreferences();
        this.createBadge();
        window.chipManager = chipManager;
        chipManager.chipElements = {
            product: () => this.root.querySelector('.chip-product'),
            health: () => this.root.querySelector('.chip-health'),
            wrapper: () => this.chipsWrapper
        };
        // ← ADDED: Initialize scanners after badge creation (needs this.root)
        this.initScanners();
        
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
    
    // ← ADDED: Scanner initialization
    initScanners() {
        try {
            this.apiClient = new APIClient(API_BASE_URL);
            this.scanner = new PageScanner(this.apiClient);
            this.scannerUI = new ScannerUI(this.scanner, this.root);
            console.log('[SafeSignal] ✅ Scanners initialized');
            this.chipManager.chipElements = {
                product: this.root.querySelector('.chip-product'),
                health: this.root.querySelector('.chip-health'),
                wrapper: this.chipsWrapper
            };
        } catch (error) {
            console.error('[SafeSignal] Scanner initialization failed:', error);
        }
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
        
        // Create Shadow DOM structure with all your original CSS
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
                
                /* Mini chips wrapper */
                .chips-wrapper {
                    display: none;
                    flex-direction: column;
                    gap: 6px;
                    max-width: 280px;
                }
                
                .chips-wrapper.visible {
                    display: flex;
                }
                
                .mini-chip {
                    height: ${config.chip}px;
                    padding: 0 16px;
                    border-radius: ${config.chip / 2}px;
                    font-size: ${config.chipFont}px;
                    font-weight: 600;
                    color: white;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    white-space: nowrap;
                    transition: all 0.2s ease;
                    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
                }
                
                .mini-chip:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                }
                
                .chip-product {
                    background: linear-gradient(135deg, #2196f3 0%, #1976d2 100%);
                }
                
                .chip-health {
                    background: linear-gradient(135deg, #9c27b0 0%, #7b1fa2 100%);
                }
                
                /* Badge wrapper */
                .badge-wrapper {
                    position: relative;
                }
                
                /* Main badge */
                .badge {
                    height: ${config.badge}px;
                    min-width: ${config.badge}px;
                    padding: 0 20px;
                    padding-right: 48px;
                    border-radius: ${config.badge / 2}px;
                    font-size: ${config.font}px;
                    font-weight: 700;
                    color: white;
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    white-space: nowrap;
                    transition: all 0.2s ease;
                    position: relative;
                }
                
                .badge:hover {
                    transform: scale(1.02);
                    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
                }
                
                /* State colors */
                .state-checking .badge {
                    background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
                    animation: pulse 2s infinite;
                }
                
                .state-ok .badge {
                    background: linear-gradient(135deg, #10b981 0%, #059669 100%);
                }
                
                .state-warning .badge {
                    background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
                }
                
                .state-danger .badge {
                    background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
                }
                
                @keyframes pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.8; }
                }
                
                .badge-icon {
                    font-size: ${config.font + 2}px;
                    line-height: 1;
                }
                
                .badge-label {
                    font-size: ${config.font}px;
                    line-height: 1;
                }
                
                /* Menu toggle button */
                .menu-btn {
                    position: absolute;
                    right: 8px;
                    top: 50%;
                    transform: translateY(-50%);
                    width: 32px;
                    height: 32px;
                    background: rgba(255, 255, 255, 0.2);
                    border: none;
                    border-radius: 50%;
                    color: white;
                    font-size: 20px;
                    line-height: 1;
                    cursor: pointer;
                    transition: all 0.2s ease;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                
                .menu-btn:hover {
                    background: rgba(255, 255, 255, 0.3);
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
                    content: '✓';
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    color: white;
                    font-size: 14px;
                    font-weight: 700;
                }
                
                /* Size controls */
                .size-controls {
                    display: flex;
                    gap: 4px;
                }
                
                .size-btn {
                    flex: 1;
                    padding: 6px 12px;
                    border: 1px solid #d1d5db;
                    border-radius: 6px;
                    background: white;
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
                
                /* Modal overlay */
                .modal-overlay {
                    display: none;
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: rgba(0, 0, 0, 0.5);
                    z-index: 2147483646;
                    align-items: center;
                    justify-content: center;
                }
                
                .modal-overlay.visible {
                    display: flex;
                }
                
                .modal {
                    background: white;
                    border-radius: 16px;
                    padding: 24px;
                    max-width: 400px;
                    width: 90%;
                    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
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
    
    // ==================== MODAL MANAGEMENT ====================
    
    showModal(title, body) {
        this.root.getElementById('modal-title').textContent = title;
        this.root.getElementById('modal-body').textContent = body;
        this.modalOverlay.classList.add('visible');
        this.activeModal = this.modalOverlay;
    }
    
    closeModal() {
        this.modalOverlay.classList.remove('visible');
        this.activeModal = null;
    }
    
    // ==================== MINI CHIPS MANAGEMENT ====================
    
    updateMiniChips() {
        // Let the chip manager handle all gate logic
        this.chipManager.evaluateChips();
    }
    
        // ← ADDED: Scanner handlers
    async handleProductScan() {
        if (!this.scannerUI) {
            console.error('[SafeSignal] Scanner UI not initialized');
            return;
        }
        
        // Get the extracted subject from chip manager
        const extraction = await chipManager.subjectExtractor.extractSubject('product');
        if (!extraction.subject) {
            console.log('[SafeSignal] No product subject extracted');
            return;
        }
        
        console.log('[SafeSignal] 🛒 Starting product scan for:', extraction.subject);
        try {
            await this.scannerUI.handleProductScan(extraction.subject);
        } catch (error) {
            console.error('[SafeSignal] Product scan error:', error);
        }
    }

    // Similarly for handleHealthScan():
    async handleHealthScan() {
        if (!this.scannerUI) {
            console.error('[SafeSignal] Scanner UI not initialized');
            return;
        }
        
        // Get the extracted subject from chip manager
        const extraction = await chipManager.subjectExtractor.extractSubject('health');
        if (!extraction.subject) {
            console.log('[SafeSignal] No health subject extracted');
            return;
        }
        
        console.log('[SafeSignal] 🏥 Starting health scan for:', extraction.subject);
        try {
            await this.scannerUI.handleHealthScan(extraction.subject);
        } catch (error) {
            console.error('[SafeSignal] Health scan error:', error);
        }
    }
    
    // ==================== STATE MANAGEMENT ====================
    
    getStateIcon() {
        const icons = {
            checking: '⧗',
            ok: '✅',
            warning: '⚠️',
            danger: '❌'
        };
        return icons[this.currentState] || '❓';
    }
    
    getStateText() {
        const texts = {
            checking: 'Checking',
            ok: 'Looks Good',
            warning: 'Be Careful',
            danger: 'High Risk'
        };
        return texts[this.currentState] || 'Unknown';
    }
    
    updateBadgeState(state) {
        this.currentState = state;
        
        // Update badge state classes
        this.container.classList.remove('state-checking', 'state-ok', 'state-warning', 'state-danger');
        this.container.classList.add(`state-${state}`);
        
        // Update icon and text
        const icon = this.root.querySelector('.badge-icon');
        const label = this.root.querySelector('.badge-label');
        
        if (icon) icon.textContent = this.getStateIcon();
        if (label) label.textContent = this.getStateText();
        
        // Update ARIA label
        this.badge.setAttribute('aria-label', `SafeSignal: ${this.getStateText()}`);
        
        // Update mini chips based on new state
        this.updateMiniChips();
        
        console.log(`[SafeSignal] State updated to: ${state}`);
    }
    
    // ==================== PAGE CHANGE DETECTION ====================
    
    async checkIfPageChanged(trigger = 'unknown') {
        const url = window.location.href;
        
        // Skip if URL hasn't changed and not initial load
        if (this.currentUrl === url && trigger !== 'initial_load') {
            return;
        }
        
        // Check cooldown
        const lastCheck = this.lastCheckByUrl.get(url);
        if (lastCheck && (Date.now() - lastCheck) < this.checkCooldown) {
            console.log('[SafeSignal] Skipping check (cooldown)');
            return;
        }
        
        this.currentUrl = url;
        console.log(`[SafeSignal] Checking page (${trigger}): ${url}`);
        
        // Set checking state
        this.updateBadgeState('checking');
        
        try {
            // Simple heuristic analysis (your original logic)
            const pageText = document.body.innerText.toLowerCase();
            let state = 'ok';
            
            // Check for suspicious patterns
            const suspiciousTerms = [
                'urgent', 'act now', 'limited time', 'congratulations', 'claim your', 'verify account',
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
    
    // ==================== SPA DETECTION ====================
    
    initSpaDetection() {
        // Patch history API
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
        
        // Listen to popstate
        window.addEventListener('popstate', () => {
            this.checkIfPageChanged('popstate');
        });
        
        // Mutation observer for content changes
        this.mutationObserver = new MutationObserver(() => {
            this.debouncedPageCheck();
        });
        
        this.mutationObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
        
        console.log('[SafeSignal] SPA detection enabled');
    }
    
    debouncedPageCheck() {
        clearTimeout(this.pageDebounceTimer);
        this.pageDebounceTimer = setTimeout(() => {
            this.checkIfPageChanged('mutation');
        }, 800);
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
        if (this.mutationObserver) {
            this.mutationObserver.disconnect();
        }
        
        // Remove DOM elements
        if (this.host && this.host.parentNode) {
            this.host.parentNode.removeChild(this.host);
        }
        
        // Clear maps
        this.lastCheckByUrl.clear();
        
        console.log('[SafeSignal] Badge destroyed');
    }
}

// ==================== CONTEXT PROBE (YOUR ORIGINAL) ====================

class SafeSignalContextProbe {
    constructor() {
        this.indicators = {
            product: {
                terms: ['price', 'buy now', 'add to cart', 'shop', 'deal', 'sale', 'discount'],
                selectors: [
                    '[itemtype*="Product"]',
                    '[data-price]',
                    'button[name="add-to-cart"]',
                    '.product-price',
                    '.price'
                ],
                patterns: [/\$\d+/, /€\d+/, /£\d+/]
            },
            health: {
                terms: ['symptom', 'treatment', 'cure', 'diagnosis', 'medical', 'health', 'doctor'],
                suspiciousTerms: ['miracle cure', 'guaranteed', 'breakthrough', 'secret'],
                selectors: [
                    'article[about*="health"]',
                    '.medical-content',
                    '[data-medical-info]'
                ]
            }
        };
    }
    
    detectContext() {
        const results = {
            product: { confidence: 0, signals: [] },
            health: { confidence: 0, signals: [] }
        };
        
        const pageText = this.getPageText();
        const pageTitle = document.title.toLowerCase();
        const pageUrl = window.location.href.toLowerCase();
        
        results.product = this.analyzeProductSignals(pageText, pageTitle, pageUrl);
        results.health = this.analyzeHealthSignals(pageText, pageTitle, pageUrl);
        
        return results;
    }
    
    getPageText() {
        const contentSelectors = ['main', 'article', '[role="main"]', '#content', '.content'];
        let text = '';
        
        for (const selector of contentSelectors) {
            const element = document.querySelector(selector);
            if (element) {
                text += (element.innerText || element.textContent || '') + ' ';
            }
        }
        
        if (!text.trim()) {
            const bodyText = document.body.innerText || document.body.textContent || '';
            text = bodyText;
        }
        
        return text.toLowerCase().slice(0, 5000);
    }
    
    analyzeProductSignals(pageText, pageTitle, pageUrl) {
        let confidence = 0;
        const signals = [];
        
        const termMatches = this.indicators.product.terms.filter(term => 
            pageText.includes(term) || pageTitle.includes(term)
        );
        
        if (termMatches.length > 0) {
            confidence += Math.min(termMatches.length * 0.1, 0.4);
            signals.push(`Found ${termMatches.length} shopping terms`);
        }
        
        const selectorMatches = this.indicators.product.selectors.filter(selector => {
            try {
                return document.querySelector(selector) !== null;
            } catch (e) {
                return false;
            }
        });
        
        if (selectorMatches.length > 0) {
            confidence += Math.min(selectorMatches.length * 0.2, 0.4);
            signals.push(`Found ${selectorMatches.length} product elements`);
        }
        
        const priceMatches = this.indicators.product.patterns.filter(pattern =>
            pattern.test(pageText)
        );
        
        if (priceMatches.length > 0) {
            confidence += 0.2;
            signals.push('Found price indicators');
        }
        
        if (/shop|store|product|cart|checkout|buy/.test(pageUrl)) {
            confidence += 0.2;
            signals.push('Shopping URL pattern');
        }
        
        return { confidence: Math.min(confidence, 1), signals };
    }
    
    analyzeHealthSignals(pageText, pageTitle, pageUrl) {
        let confidence = 0;
        const signals = [];
        
        const termMatches = this.indicators.health.terms.filter(term =>
            pageText.includes(term) || pageTitle.includes(term)
        );
        
        if (termMatches.length > 0) {
            confidence += Math.min(termMatches.length * 0.1, 0.4);
            signals.push(`Found ${termMatches.length} health terms`);
        }
        
        const suspiciousMatches = this.indicators.health.suspiciousTerms.filter(term =>
            pageText.includes(term)
        );
        
        if (suspiciousMatches.length > 0) {
            confidence += Math.min(suspiciousMatches.length * 0.15, 0.3);
            signals.push('Detected suspicious health claims');
        }
        
        const selectorMatches = this.indicators.health.selectors.filter(selector => {
            try {
                return document.querySelector(selector) !== null;
            } catch (e) {
                return false;
            }
        });
        
        if (selectorMatches.length > 0) {
            confidence += 0.2;
            signals.push('Found health-related markup');
        }
        
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
    console.log('[SafeSignal] Extension initialized with scanners');
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
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SafeSignalBadge, SafeSignalContextProbe };
}