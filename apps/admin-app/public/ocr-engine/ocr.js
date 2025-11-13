// ocr.js - Main OCR API for your project
'use strict';

class OCRLibrary {
  constructor(options = {}) {
    const resolvedEnginePath = (() => {
      return undefined;
    })();

    this.options = {
      enginePath: resolvedEnginePath,
      defaultLang: options.defaultLang || 'eng',
      defaultAccuracy: options.defaultAccuracy || '4.0.0',
      ...options
    };
  }

  // Prepare image (crop, invert, etc.)
  async prepareImage(imageSource, region, mode = 'normal') {
    return new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();
      
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        if (region && region.width && region.height) {
          canvas.width = region.width;
          canvas.height = region.height;
          ctx.drawImage(img, region.left, region.top, region.width, region.height, 0, 0, region.width, region.height);
        } else {
          canvas.width = img.width;
          canvas.height = img.height;
          ctx.drawImage(img, 0, 0);
        }

        if (mode === 'invert' || mode === 'gray') {
          ctx.globalCompositeOperation = mode === 'gray' ? 'saturation' : 'difference';
          ctx.fillStyle = '#fff';
          ctx.globalAlpha = 1;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        resolve(canvas.toDataURL());
      };
      
      img.onerror = () => {
        // If it's already a data URL, use it directly
        if (typeof imageSource === 'string' && imageSource.startsWith('data:')) {
          resolve(imageSource);
        } else {
          reject(new Error('Failed to load image'));
        }
      };
      
      img.src = imageSource;
    });
  }

  // Execute OCR using the engine
  async executeOCR({ lang, src, accuracy }, onProgress) {
    return new Promise((resolve, reject) => {
      const frame = document.createElement('iframe');
      const id = 'ocr-' + Math.random().toString(36).substr(2, 9);
      frame.style.display = 'none';
      frame.src = `${this.options.enginePath}/index.html?id=${encodeURIComponent(id)}`;
      
      const messageHandler = (e) => {
        const { command, id: msgId, report, result, message } = e.data || {};
        if (msgId !== id) return;

        if (command === 'report') {
          onProgress?.(report);
        } else if (command === 'result') {
          cleanup();
          resolve(result);
        } else if (command === 'error') {
          cleanup();
          reject(new Error(message || 'OCR failed'));
        }
      };

      const cleanup = () => {
        window.removeEventListener('message', messageHandler);
        if (frame.parentNode) {
          frame.parentNode.removeChild(frame);
        }
      };

      window.addEventListener('message', messageHandler);
      
      frame.onload = () => {
        frame.contentWindow.postMessage({ lang, src, accuracy }, '*');
      };
      
      document.body.appendChild(frame);
    });
  }

  // Main API: Recognize text from image
  async recognize(imageSource, options = {}) {
    const {
      lang = this.options.defaultLang,
      accuracy = this.options.defaultAccuracy,
      region = null,
      mode = 'normal',
      onProgress = null
    } = options;

    const src = await this.prepareImage(imageSource, region, mode);
    return await this.executeOCR({ lang, src, accuracy }, onProgress);
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = OCRLibrary;
} else {
  window.OCRLibrary = OCRLibrary;
}

