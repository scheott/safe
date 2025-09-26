class SafeSignalBadgePositioning {
    constructor(shadowRoot) {
        this.shadowRoot = shadowRoot;
        this.SAFE_MARGIN = 16;
        this.GAP = 8; // Gap between badge and menu
        this.topLayerContainer = null;
        this.activeMenuEl = null; // Track which menu is currently active
    }

    // Create top-layer container for menu to escape clipping
    createTopLayerContainer() {
        if (this.topLayerContainer) return this.topLayerContainer;
        
        this.topLayerContainer = document.createElement('div');
        this.topLayerContainer.id = 'safesignal-menu-portal';
        this.topLayerContainer.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            z-index: 2147483647;
            pointer-events: none;
            width: 100vw;
            height: 100vh;
        `;
        
        // Append to documentElement to escape any body transforms
        document.documentElement.appendChild(this.topLayerContainer);
        return this.topLayerContainer;
    }

    // Move menu to top layer when opening (don't clone, move the actual element)
    moveMenuToTopLayer(menu) {
        const container = this.createTopLayerContainer();
        
        // Store original parent for restoration
        menu._originalParent = menu.parentNode;
        menu._originalNextSibling = menu.nextSibling;
        
        // Move to top layer
        container.appendChild(menu);
        
        // Inject CSS into the portal container to maintain styles (guard against duplicates)
        if (!this._portalStyleInjected) {
            const style = document.createElement('style');
            style.textContent = `
                .badge-menu {
                    position: fixed;
                    pointer-events: none;
                    background: white;
                    border-radius: 12px;
                    box-shadow: 0 8px 32px rgba(0,0,0,.15), 0 4px 16px rgba(0,0,0,.1);
                    border: 1px solid rgba(0,0,0,.08);
                    padding: 12px;
                    min-width: 220px;
                    max-height: calc(100vh - 32px);
                    overflow-y: auto;
                    box-sizing: border-box;
                    /* CLOSED baseline */
                    opacity: 0;
                    transform: translateY(-10px) scale(0.95);
                    z-index: auto;
                }
                
                .badge-menu.open {
                    /* OPEN state */
                    opacity: 1;
                    transform: none;
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
                    font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
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
                
                .menu--above { 
                    transform-origin: bottom center; 
                }
                
                .menu--left { 
                    transform-origin: top right; 
                }
            `;
            container.appendChild(style);
            this._portalStyleInjected = true;
        }
        
        this.activeMenuEl = menu;
        return menu;
    }

    // Restore menu to original position
    restoreMenuToShadow(menu) {
        if (menu._originalParent) {
            if (menu._originalNextSibling) {
                menu._originalParent.insertBefore(menu, menu._originalNextSibling);
            } else {
                menu._originalParent.appendChild(menu);
            }
            delete menu._originalParent;
            delete menu._originalNextSibling;
        }
        this.activeMenuEl = null;
    }

    // Calculate smart menu placement with gap
    calculateMenuPlacement(badgeRect, menuRect) {
        const vw = window.visualViewport?.width || window.innerWidth;
        const vh = window.visualViewport?.height || window.innerHeight;
        const margin = this.SAFE_MARGIN;
        const gap = this.GAP;
        
        let placement = {
            x: badgeRect.right + gap,
            y: badgeRect.bottom + gap,
            anchorX: 'right',
            anchorY: 'below',
            classes: []
        };
        
        // Vertical placement - flip if would overflow bottom
        if (badgeRect.bottom + gap + menuRect.height > vh - margin) {
            placement.y = badgeRect.top - gap - menuRect.height;
            placement.anchorY = 'above';
            placement.classes.push('menu--above');
        }
        
        // Horizontal placement - flip if would overflow right
        if (badgeRect.right + gap + menuRect.width > vw - margin) {
            placement.x = badgeRect.left - gap - menuRect.width;
            placement.anchorX = 'left';
            placement.classes.push('menu--left');
        }
        
        // Clamp to safe bounds
        placement.x = Math.max(margin, Math.min(placement.x, vw - menuRect.width - margin));
        placement.y = Math.max(margin, Math.min(placement.y, vh - menuRect.height - margin));
        
        // Fallback: center on screen if still doesn't fit
        if (menuRect.width > vw - margin * 2 || menuRect.height > vh - margin * 2) {
            placement.x = (vw - menuRect.width) / 2;
            placement.y = (vh - menuRect.height) / 2;
            placement.classes.push('menu--centered');
        }
        
        return placement;
    }

    // Check if we need to portal (body has transforms or overflow issues)
    shouldPortal() {
        const bodyStyle = getComputedStyle(document.body);
        return bodyStyle.transform !== 'none' || 
               bodyStyle.overflow !== 'visible' ||
               bodyStyle.position === 'fixed';
    }

    // Apply menu positioning
    applyMenuPosition(menu, badgeRect) {
        // First, move to top layer (force for now while debugging)
        let targetMenu = this.moveMenuToTopLayer(menu);
        
        // Always position against the viewport, even when not portaled
        targetMenu.style.position = 'fixed';
        targetMenu.style.right = 'auto';
        targetMenu.style.bottom = 'auto';
        
        // Make visible but transparent for measurement
        targetMenu.style.opacity = '0';
        targetMenu.style.pointerEvents = 'none';
        targetMenu.classList.add('measuring');
        targetMenu.classList.add('open'); // Add open class for proper size
        
        // Measure after it's in the right container
        const menuRect = targetMenu.getBoundingClientRect();
        const placement = this.calculateMenuPlacement(badgeRect, menuRect);
        
        // Apply positioning
        targetMenu.style.left = `${placement.x}px`;
        targetMenu.style.top = `${placement.y}px`;
        targetMenu.style.maxHeight = `calc(100vh - ${this.SAFE_MARGIN * 2}px)`;
        targetMenu.style.overflowY = 'auto';
        
        // Apply placement classes
        targetMenu.classList.remove('measuring');
        placement.classes.forEach(cls => targetMenu.classList.add(cls));
        
        // Force visibility explicitly
        targetMenu.style.opacity = '1';
        targetMenu.style.pointerEvents = 'auto';
        
        // Store reference to active menu
        this.activeMenuEl = targetMenu;
        
        // Re-attach event handlers since this was moved to portal
        this.reattachMenuEventHandlers(targetMenu);
        
        return targetMenu;
    }

    // Re-attach event handlers to portaled menu
    reattachMenuEventHandlers(portaledMenu) {
        // Prevent clicks from closing menu
        portaledMenu.addEventListener('click', (e) => {
            e.stopPropagation();
        });
        
        // Re-attach position option handlers
        const positionOptions = portaledMenu.querySelectorAll('.position-option');
        positionOptions.forEach(option => {
            option.addEventListener('click', (e) => {
                e.stopPropagation();
                const anchor = option.dataset.position;
                // Trigger custom event that badge can listen for
                document.dispatchEvent(new CustomEvent('safesignal-position-select', {
                    detail: { anchor }
                }));
            });
        });
        
        // Re-attach hide site handler
        const hideSiteButton = portaledMenu.querySelector('[data-action="hide-site"]');
        if (hideSiteButton) {
            hideSiteButton.addEventListener('click', (e) => {
                e.stopPropagation();
                document.dispatchEvent(new CustomEvent('safesignal-hide-site'));
            });
        }
    }

    // Close and clean up menu
    closeMenu() {
        if (this.activeMenuEl) {
            console.log('[SafeSignal] Closing menu:', this.activeMenuEl);
            
            // Remove all menu state classes and hide
            this.activeMenuEl.classList.remove('open', 'menu--above', 'menu--left', 'menu--centered');
            this.activeMenuEl.style.opacity = '0';
            this.activeMenuEl.style.pointerEvents = 'none';
            
            // If it was portaled, restore it to shadow DOM
            if (this.activeMenuEl.parentNode === this.topLayerContainer) {
                this.restoreMenuToShadow(this.activeMenuEl);
            }
            
            this.activeMenuEl = null;
        }
    }

    // Cleanup portaled elements
    cleanup() {
        if (this.activeMenuEl && this.activeMenuEl.parentNode === this.topLayerContainer) {
            this.restoreMenuToShadow(this.activeMenuEl);
        }
        
        if (this.topLayerContainer && this.topLayerContainer.parentNode) {
            this.topLayerContainer.parentNode.removeChild(this.topLayerContainer);
        }
        this.topLayerContainer = null;
        this.activeMenuEl = null;
    }
}

class SafeSignalContextProbe {
    constructor() {
        this.productIndicators = {
            priceRegex: /\$\d+(?:\.\d{2})?|\d+\.\d{2}\s*(?:USD|dollars?)|starting\s+at|sale\s+price|was\s+\$|now\s+\$/i,
            shoppingTerms: ['add to cart', 'buy now', 'checkout', 'add to bag', 'purchase', 'order now', 'shop now'],
            productCategories: ['supplement', 'vitamin', 'electronics', 'gadget', 'device', 'product', 'item'],
            productSelectors: [
                '[data-testid*="price"]', '[class*="price"]', '[id*="price"]',
                '[data-testid*="cart"]', '[class*="cart"]', '[id*="cart"]',
                'button[data-testid*="add"]', 'button[class*="add-to"]'
            ]
        };
        
        this.healthIndicators = {
            medicalClaims: ['cures', 'prevents', 'treats', 'heals', 'miracle', 'breakthrough'],
            healthTerms: ['supplement', 'natural remedy', 'clinical study', 'proven', 'FDA approved', 'doctor'],
            suspiciousHealth: ['doctors hate this', 'miracle cure', 'secret remedy', 'big pharma'],
            healthSelectors: [
                '[class*="health"]', '[class*="medical"]', '[class*="supplement"]',
                '[id*="health"]', '[id*="medical"]', '[id*="nutrition"]'
            ]
        };
    }
    
    quickContextProbe() {
        const pageText = this.getPageText();
        const pageTitle = document.title || '';
        
        const productScore = this.calculateProductScore(pageText, pageTitle);
        const healthScore = this.calculateHealthScore(pageText, pageTitle);
        
        return {
            isProduct: productScore > 0.6,
            isHealth: healthScore > 0.6,
            productConfidence: productScore,
            healthConfidence: healthScore,
            hints: {
                title: pageTitle.slice(0, 200),
                priceText: this.extractPriceText(pageText),
                productName: this.extractProductName(pageTitle, pageText),
                claimsText: this.extractHealthClaims(pageText),
                medicalTerms: this.extractMedicalTerms(pageText)
            }
        };
    }
    
    getPageText() {
        const mainSelectors = ['main', '[role="main"]', 'article', '.content', '#content'];
        const mainContent = mainSelectors
            .map(sel => document.querySelector(sel)?.textContent || '')
            .find(text => text.length > 100) || document.body?.textContent || '';
            
        return mainContent.slice(0, 2000);
    }
    
    calculateProductScore(text, title) {
        let score = 0;
        const fullText = (title + ' ' + text).toLowerCase();
        
        if (this.productIndicators.priceRegex.test(fullText)) {
            score += 0.4;
        }
        
        const shoppingMatches = this.productIndicators.shoppingTerms
            .filter(term => fullText.includes(term)).length;
        score += Math.min(shoppingMatches * 0.2, 0.4);
        
        const categoryMatches = this.productIndicators.productCategories
            .filter(cat => fullText.includes(cat)).length;
        score += Math.min(categoryMatches * 0.1, 0.3);
        
        const hasProductElements = this.productIndicators.productSelectors
            .some(sel => document.querySelector(sel));
        if (hasProductElements) score += 0.3;
        
        return Math.min(score, 1.0);
    }
    
    calculateHealthScore(text, title) {
        let score = 0;
        const fullText = (title + ' ' + text).toLowerCase();
        
        const claimMatches = this.healthIndicators.medicalClaims
            .filter(claim => fullText.includes(claim)).length;
        score += Math.min(claimMatches * 0.3, 0.6);
        
        const healthMatches = this.healthIndicators.healthTerms
            .filter(term => fullText.includes(term)).length;
        score += Math.min(healthMatches * 0.2, 0.4);
        
        const suspiciousMatches = this.healthIndicators.suspiciousHealth
            .filter(phrase => fullText.includes(phrase)).length;
        const suspiciousWeight = suspiciousMatches > 0 ? 0.4 : 0;
        score += suspiciousWeight;
        
        const hasHealthElements = this.healthIndicators.healthSelectors
            .some(sel => document.querySelector(sel));
        if (hasHealthElements) score += 0.2;
        
        return Math.min(score, 1.0);
    }
    
    extractPriceText(text) {
        const priceMatch = text.match(this.productIndicators.priceRegex);
        return priceMatch ? priceMatch[0] : null;
    }
    
    extractProductName(title, text) {
        const titleWords = title.split(' ').slice(0, 4).join(' ');
        return titleWords.length > 5 ? titleWords : null;
    }
    
    extractHealthClaims(text) {
        const sentences = text.split(/[.!?]/).slice(0, 10);
        const claimSentences = sentences.filter(sentence => {
            const lower = sentence.toLowerCase();
            return this.healthIndicators.medicalClaims.some(claim => lower.includes(claim));
        });
        return claimSentences.slice(0, 3).join('. ');
    }
    
    extractMedicalTerms(text) {
        const found = this.healthIndicators.healthTerms
            .filter(term => text.toLowerCase().includes(term));
        return found.slice(0, 5).join(', ');
    }
}

class SafeSignalBadge {
    constructor() {
        this.shadowRoot = null;
        this.badgeContainer = null;
        this.currentState = 'checking';
        this.isVisible = true;
        
        // Separate positioning state from positioning helper
        this.positionState = {
            anchor: 'bottom-right',
            offsetX: 0,
            offsetY: 0
        };
        
        // Positioning helper (will be initialized after shadow root)
        this.positioning = null;
        
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
        this.proximityCheckInterval = null;
        this.userPreferences = {
            positioning: { anchor: 'mid-right', offsetX: 0, offsetY: 0 },
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
            const result = await chrome.storage.sync.get(['positioning']);
            if (result.positioning) {
                this.userPreferences.positioning = result.positioning;
            }
            // Remove all hide-related logic
        } catch (error) {
            console.error('SafeSignal: Error loading preferences:', error);
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

    // === BADGE CREATION ===

    createShadowDOMBadge() {
        // Mount to documentElement to avoid body transform issues
        this.badgeContainer = document.createElement('div');
        this.badgeContainer.id = 'safesignal-badge-container';
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
                    background: white;
                    border: 1px solid #e1e5e9;
                    border-radius: 8px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                    padding: 12px;
                    min-width: 140px;
                    z-index: 1000001;
                    opacity: 0;
                    visibility: hidden;
                    transform: scale(0.9);
                    transition: all 0.15s ease;
                }
                
                .badge-menu.open {
                    opacity: 1;
                    visibility: visible;
                    transform: scale(1);
                }
                
                .menu-label {
                    font-size: 12px;
                    font-weight: 600;
                    color: #374151;
                    margin-bottom: 8px;
                    text-align: center;
                }
                
                /* Position grid remains the same */
                .position-grid {
                    display: grid;
                    grid-template-columns: 1fr 1fr 1fr;
                    gap: 6px;
                    margin-bottom: 8px;
                }
                
                .position-option {
                    width: 20px;
                    height: 20px;
                    border: 2px solid #d1d5db;
                    border-radius: 4px;
                    background: #f9fafb;
                    cursor: pointer;
                    transition: all 0.15s ease;
                }
                
                .position-option:hover {
                    border-color: #3b82f6;
                    background: #eff6ff;
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
                            <button class="position-option active" 
                                    data-position="mid-right" 
                                    type="button"
                                    title="Middle Right (Current)"
                                    aria-label="Middle right side"></button>
                            <button class="position-option" 
                                    data-position="bottom-left" 
                                    type="button"
                                    title="Bottom Left"
                                    aria-label="Bottom left corner"></button>
                            <div></div>
                            <button class="position-option" 
                                    data-position="bottom-right" 
                                    type="button"
                                    title="Bottom Right"
                                    aria-label="Bottom right corner"></button>
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
        
        // Listen for custom events from portaled menu
        document.addEventListener('safesignal-position-select', (e) => {
            this.handlePositionSelect(e.detail.anchor);
        });
        
        document.addEventListener('safesignal-hide-site', () => {
            this.toggleSiteVisibility();
        });
        
        // Window resize handler with throttling
        let resizeRaf = null;
        const onResize = () => {
            if (resizeRaf) return;
            resizeRaf = requestAnimationFrame(() => {
                resizeRaf = null;
                this.applyPositioning(this.positionState);
                this.updateStatusBubblePosition();
                
                // Reposition menu if open
                if (this.isMenuOpen && this.positioning.activeMenuEl) {
                    const badgeRect = this.getBadgeRect();
                    this.positioning.applyMenuPosition(this.positioning.activeMenuEl, badgeRect);
                }
            });
        };
        window.addEventListener('resize', onResize);
        this.cleanupHandlers.push(() => window.removeEventListener('resize', onResize));
        
        // Listen to visual viewport changes (mobile keyboard)
        if (window.visualViewport) {
            const onViewportChange = () => {
                if (this.isMenuOpen && this.positioning.activeMenuEl) {
                    const badgeRect = this.getBadgeRect();
                    this.positioning.applyMenuPosition(this.positioning.activeMenuEl, badgeRect);
                }
            };
            window.visualViewport.addEventListener('resize', onViewportChange);
            this.cleanupHandlers.push(() => 
                window.visualViewport?.removeEventListener('resize', onViewportChange)
            );
        }
        
        // Input proximity detection with proper cleanup tracking
        this.proximityCheckInterval = setInterval(() => {
            this.checkInputProximity();
        }, 2000);
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
        const badge = this.shadowRoot.querySelector('.badge');
        const menuButton = this.shadowRoot.querySelector('.menu-button');
        const menu = this.shadowRoot.querySelector('.badge-menu');
        
        if (this.isMenuOpen) {
            badge.classList.add('menu-open');
            menuButton.setAttribute('aria-expanded', 'true');
            menu.classList.add('open');
            
            // Auto-close after 5 seconds for simplicity
            setTimeout(() => {
                if (this.isMenuOpen) {
                    this.closeMenu();
                }
            }, 5000);
        } else {
            this.closeMenu();
        }
    }

    closeMenu() {
        if (this.isMenuOpen) {
            this.isMenuOpen = false;
            const badge = this.shadowRoot.querySelector('.badge');
            const menuButton = this.shadowRoot.querySelector('.menu-button');
            
            this.positioning.closeMenu();
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
            'mid-right': 'Middle Right',
            'mid-left': 'Middle Left',
            'top-right': 'Top Right',
            'top-left': 'Top Left',
            'bottom-right': 'Bottom Right',
            'bottom-left': 'Bottom Left'
        };
        
        statusEl.textContent = `Moved to ${friendlyNames[anchor]}`;
        
        badge.classList.add('show-status');
        
        setTimeout(() => {
            badge.classList.remove('show-status');
            // Return to current safety status
            this.updateBadgeState(this.currentState);
        }, 2000);
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
        
        // Clean up positioning helper
        if (this.positioning) {
            this.positioning.cleanup();
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

class SafeSignalBadgeEnhanced extends SafeSignalBadge {
    constructor() {
        super();
        this.contextProbe = new SafeSignalContextProbe();
        this.contextData = null;
        this.showingContextButtons = false;
    }
    
    async checkIfPageChanged(trigger) {
        console.log('SafeSignal: Enhanced page check...', trigger);
        
        if (!this.contextProbe) {
            this.contextProbe = new SafeSignalContextProbe();
        }
        
        const newUrl = window.location.href;
        if (newUrl !== this.currentUrl) {
            this.currentUrl = newUrl;
            console.log('SafeSignal: URL changed to:', newUrl);
        }

        if (trigger === 'initial_load' || trigger === 'url_change' || trigger === 'content_mutation') {
            this.contextData = this.contextProbe.quickContextProbe();
            console.log('SafeSignal: Context detected:', this.contextData);
            this.updateContextButtons();
        }

        return super.checkIfPageChanged?.(trigger);
    }

    updateContextButtons() {
        if (!this.contextData) return;
        
        const badge = this.shadowRoot?.querySelector('.badge');
        if (!badge) {
            requestAnimationFrame(() => this.updateContextButtons());
            return;
        }
        
        const { isProduct, isHealth, productConfidence, healthConfidence } = this.contextData;
        
        if (isProduct && productConfidence > 0.7) {
            this.addContextButton('product', 'Find Safer Deals', '🛍️');
        } else {
            this.removeContextButton('product');
        }
        
        if (isHealth && healthConfidence > 0.7) {
            this.addContextButton('health', 'Health Fact Check', '⚕️');
        } else {
            this.removeContextButton('health');
        }
    }

    addContextButton(type, label, icon) {
        this.removeContextButton(type);
        
        const badge = this.shadowRoot.querySelector('.badge');
        if (!badge) return;
        
        const button = document.createElement('button');
        button.className = `context-button context-${type}`;
        button.type = 'button';
        button.setAttribute('data-context-type', type);
        button.setAttribute('title', label);
        button.setAttribute('aria-label', label);
        button.setAttribute('tabindex', '0');
        
        button.innerHTML = `
            <span class="context-icon">${icon}</span>
            <span class="context-label">${label}</span>
        `;
        
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            this.handleContextButtonClick(type);
        });
        
        button.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.handleContextButtonClick(type);
            }
        });
        
        button.addEventListener('mouseenter', () => {
            this.adjustButtonPlacement(button, type === 'product' ? 80 : 40);
        });
        
        badge.appendChild(button);
        this.showingContextButtons = true;
        this.addContextButtonStyles();
    }
    
    adjustButtonPlacement(button, offsetDefault) {
        const hostRect = this.shadowRoot.host?.getBoundingClientRect?.() ?? { top: 200 };
        const placeAbove = hostRect.top > 120;
        
        if (placeAbove) {
            button.style.top = `${-offsetDefault}px`;
        } else {
            button.style.top = `calc(100% + ${offsetDefault - 40}px)`;
        }
    }

    removeContextButton(type) {
        const existing = this.shadowRoot?.querySelector(`[data-context-type="${type}"]`);
        if (existing) {
            existing.remove();
        }
    }

    addContextButtonStyles() {
        const style = this.shadowRoot?.querySelector('style');
        if (style && !style.textContent.includes('.context-button')) {
            style.textContent += `
                .context-button {
                    position: absolute;
                    top: -40px;
                    left: 50%;
                    transform: translateX(-50%);
                    background: #3b82f6;
                    color: white;
                    border: none;
                    border-radius: 20px;
                    padding: 6px 12px;
                    font-size: 11px;
                    font-weight: 500;
                    cursor: pointer;
                    transition: all 0.2s ease;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.15);
                    white-space: nowrap;
                    opacity: 0;
                    animation: slideInContext 0.3s ease forwards;
                }
                
                .context-button:hover {
                    background: #2563eb;
                    transform: translateX(-50%) translateY(-2px);
                    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
                }
                
                .context-button:focus {
                    outline: 2px solid #60a5fa;
                    outline-offset: 2px;
                }
                
                .context-button.context-health {
                    background: #059669;
                    top: -40px;
                }
                
                .context-button.context-health:hover {
                    background: #047857;
                }
                
                .context-button.context-product {
                    background: #dc2626;
                    top: -80px;
                }
                
                .context-button.context-product:hover {
                    background: #b91c1c;
                }
                
                .context-icon {
                    margin-right: 4px;
                    font-size: 12px;
                }
                
                .context-label {
                    font-size: 11px;
                    font-weight: 500;
                }
                
                @keyframes slideInContext {
                    from {
                        opacity: 0;
                        transform: translateX(-50%) translateY(10px);
                    }
                    to {
                        opacity: 1;
                        transform: translateX(-50%) translateY(0);
                    }
                }
                
                .badge.menu-open .context-button {
                    opacity: 0;
                    pointer-events: none;
                }
            `;
        }
    }

    handleContextButtonClick(type) {
        console.log(`SafeSignal: Context button clicked: ${type}`);
        
        if (type === 'product') {
            this.handleProductScan();
        } else if (type === 'health') {
            this.handleHealthScan();
        }
    }

    async handleProductScan() {
        console.log('SafeSignal: Starting product scan...', this.contextData.hints);
        
        const button = this.shadowRoot.querySelector('[data-context-type="product"]');
        if (button) {
            button.innerHTML = '<span class="context-icon">⏳</span><span class="context-label">Scanning...</span>';
        }
        
        try {
            const response = await chrome.runtime.sendMessage({
                type: 'apiFetch',
                path: '/api/scan/product',
                body: {
                    url: window.location.href,
                    hints: this.contextData.hints
                }
            });
            
            if (response?.ok) {
                this.showProductResults(response.data);
            } else {
                throw new Error(`API error: ${response?.status || 'unknown'}`);
            }
            
        } catch (error) {
            console.error('SafeSignal: Product scan failed:', error);
            this.showProductFallback();
        }
        
        if (button) {
            button.innerHTML = '<span class="context-icon">🛍️</span><span class="context-label">Find Safer Deals</span>';
        }
    }

    async handleHealthScan() {
        console.log('SafeSignal: Starting health scan...', this.contextData.hints);
        
        const button = this.shadowRoot.querySelector('[data-context-type="health"]');
        if (button) {
            button.innerHTML = '<span class="context-icon">⏳</span><span class="context-label">Checking...</span>';
        }
        
        try {
            const response = await chrome.runtime.sendMessage({
                type: 'apiFetch',
                path: '/api/scan/health',
                body: {
                    url: window.location.href,
                    hints: this.contextData.hints
                }
            });
            
            if (response?.ok) {
                this.showHealthResults(response.data);
            } else {
                throw new Error(`API error: ${response?.status || 'unknown'}`);
            }
            
        } catch (error) {
            console.error('SafeSignal: Health scan failed:', error);
            this.showHealthFallback();
        }
        
        if (button) {
            button.innerHTML = '<span class="context-icon">⚕️</span><span class="context-label">Health Fact Check</span>';
        }
    }
    
    showProductResults(result) {
        console.log('SafeSignal: Product results:', result);
        const message = `Product Analysis Complete!\n\n` +
            `Detected: ${this.contextData?.hints?.productName || 'Product'}\n` +
            `Price: ${this.contextData?.hints?.priceText || 'Not found'}\n` +
            `Confidence: ${(this.contextData?.productConfidence * 100).toFixed(0)}%`;
        alert(message);
    }
    
    showHealthResults(result) {
        console.log('SafeSignal: Health results:', result);
        const message = `Health Fact-Check Complete!\n\n` +
            `Claims: ${this.contextData?.hints?.claimsText || 'None detected'}\n` +
            `Medical terms: ${this.contextData?.hints?.medicalTerms || 'None'}\n` +
            `Confidence: ${(this.contextData?.healthConfidence * 100).toFixed(0)}%`;
        alert(message);
    }
    
    showProductFallback() {
        alert('Product scan temporarily unavailable. Please try again later.');
    }
    
    showHealthFallback() {
        alert('Health fact-check temporarily unavailable. Please try again later.');
    }
    
    destroy() {
        try {
            this.removeContextButton('product');
            this.removeContextButton('health');
        } catch(e) {
            console.warn('SafeSignal: Error during context cleanup:', e);
        }
        super.destroy?.();
    }
}

// Initialize badge when DOM is ready
let safesignalBadge = null;

async function initializeBadge() {
    if (safesignalBadge) {
        safesignalBadge.destroy();
    }
    
    safesignalBadge = new SafeSignalBadgeEnhanced();
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
    window.SafeSignalBadge = SafeSignalBadgeEnhanced;
}