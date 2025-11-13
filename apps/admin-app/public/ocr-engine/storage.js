// storage.js - LocalStorage adapter (replaces chrome.storage)
'use strict';

class LocalStorageAdapter {
  async get(keys) {
    const defaults = typeof keys === 'object' ? keys : {};
    const result = {};
    const keysToGet = typeof keys === 'object' ? Object.keys(keys) : [keys];
    
    for (const key of keysToGet) {
      try {
        const value = localStorage.getItem('ocr_' + key);
        result[key] = value !== null ? JSON.parse(value) : (defaults[key] !== undefined ? defaults[key] : null);
      } catch (e) {
        result[key] = defaults[key] !== undefined ? defaults[key] : null;
      }
    }
    return result;
  }

  async set(items) {
    for (const [key, value] of Object.entries(items)) {
      try {
        localStorage.setItem('ocr_' + key, JSON.stringify(value));
      } catch (e) {
        console.warn('Failed to save preference:', key);
      }
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LocalStorageAdapter;
} else {
  window.LocalStorageAdapter = LocalStorageAdapter;
}

