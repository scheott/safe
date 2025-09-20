/******/ (() => { // webpackBootstrap
// SafeSignal Content Script - Phase 1.1 Basic Version
console.log('SafeSignal: Content script loaded on', window.location.hostname);

// Very basic test - just inject a simple element to prove it works
function createTestBadge() {
    // Don't inject on chrome:// pages or extension pages
    if (window.location.protocol === 'chrome:' || 
        window.location.protocol === 'chrome-extension:' ||
        window.location.protocol === 'moz-extension:') {
        return;
    }

    // Create a simple test badge
    const testBadge = document.createElement('div');
    testBadge.id = 'safesignal-test-badge';
    testBadge.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 48px;
        height: 48px;
        background: #3b82f6;
        color: white;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: system-ui;
        font-size: 20px;
        z-index: 2147483647;
        cursor: pointer;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    `;
    testBadge.textContent = 'S';
    testBadge.title = 'SafeSignal Test Badge';

    // Add click handler
    testBadge.addEventListener('click', () => {
        alert('SafeSignal extension is working!\n\nThis is a test badge for Phase 1.1');
    });

    // Inject into page
    document.body.appendChild(testBadge);
    
    console.log('SafeSignal: Test badge injected');
}

// Wait for DOM to be ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createTestBadge);
} else {
    createTestBadge();
}
/******/ })()
;
//# sourceMappingURL=content.js.map