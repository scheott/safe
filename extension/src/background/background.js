console.log('SafeSignal: Background started');

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Message:', message);
    sendResponse({ status: 'ok' });
});

chrome.runtime.onInstalled.addListener((details) => {
    console.log('Installed:', details.reason);
});
