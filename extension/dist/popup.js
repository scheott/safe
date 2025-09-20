/******/ (() => { // webpackBootstrap
/*!****************************!*\
  !*** ./src/popup/popup.js ***!
  \****************************/
// SafeSignal Popup Script - Phase 1.1 Basic Version
console.log('SafeSignal: Popup loaded');

// Test message to background script
chrome.runtime.sendMessage(
    { action: 'popup_opened', timestamp: Date.now() },
    (response) => {
        console.log('SafeSignal: Background response:', response);
    }
);

console.log('SafeSignal: Popup script complete');
/******/ })()
;