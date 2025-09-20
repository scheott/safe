/******/ (() => { // webpackBootstrap
/*!**************************************!*\
  !*** ./src/background/background.js ***!
  \**************************************/
// SafeSignal Background Service Worker - Phase 1.1 Basic Version
console.log('SafeSignal: Background service worker started');

// Basic message handler setup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('SafeSignal: Received message in background:', message);
    
    // For now, just echo back that we received it
    sendResponse({ status: 'received', echo: message });
});

// Installation handler
chrome.runtime.onInstalled.addListener((details) => {
    console.log('SafeSignal: Extension installed/updated', details.reason);
    
    if (details.reason === 'install') {
        console.log('SafeSignal: First time installation');
    }
});

console.log('SafeSignal: Background script setup complete');
/******/ })()
;