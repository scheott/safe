// tests/setup.js
// Jest test environment setup
import { jest } from '@jest/globals';

// Mock Chrome API
global.chrome = {
  storage: {
    local: {
      get: jest.fn().mockResolvedValue({}),
      set: jest.fn().mockResolvedValue({}),
      remove: jest.fn().mockResolvedValue({})
    },
    sync: {
      get: jest.fn().mockResolvedValue({}),
      set: jest.fn().mockResolvedValue({}),
      remove: jest.fn().mockResolvedValue({})
    }
  },
  runtime: {
    sendMessage: jest.fn(),
    onMessage: {
      addListener: jest.fn()
    },
    getURL: jest.fn((path) => `chrome-extension://mock-id/${path}`)
  }
};

// Mock browser globals
global.browser = global.chrome;

// Make jest available globally for tests
global.jest = jest;

// Polyfill document.elementsFromPoint for jsdom
if (!document.elementsFromPoint) {
  document.elementsFromPoint = function(x, y) {
    const element = document.elementFromPoint(x, y);
    return element ? [element] : [];
  };
}

// Keep console.warn and console.error for tests to spy on them
// Don't mock them globally - let individual tests spy as needed
const originalConsole = global.console;
global.console = {
  ...originalConsole,
  // Keep log for debugging
  log: originalConsole.log
};