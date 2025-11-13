# OCR Engine - Standalone Web Library

This is a standalone OCR (Optical Character Recognition) library converted from a Chrome extension. It works directly in web browsers without requiring any extension installation.

## Quick Start

### 1. Copy Files

Copy the entire `ocr-engine` folder to your project's public directory (e.g., `public/ocr-engine` or `static/ocr-engine`).

### 2. Copy Engine Assets

You need to copy these folders from the original extension:
- `data/engine/tesseract/` → `ocr-engine/engine/tesseract/`
- `data/engine/transformers/` → `ocr-engine/engine/transformers/`
- `data/engine/katex/` → `ocr-engine/engine/katex/`

### 3. Basic Usage

```html
<!DOCTYPE html>
<html>
<head>
  <title>OCR Example</title>
</head>
<body>
  <input type="file" id="imageInput" accept="image/*">
  <div id="result"></div>

  <script src="/ocr-engine/storage.js"></script>
  <script src="/ocr-engine/ocr.js"></script>
  <script>
    const ocr = new OCRLibrary({
      enginePath: '/ocr-engine/engine',
      defaultLang: 'eng'
    });

    document.getElementById('imageInput').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const result = await ocr.recognize(event.target.result, {
            lang: 'eng',
            accuracy: '4.0.0',
            onProgress: (report) => {
              console.log(report.status, report.progress);
            }
          });
          document.getElementById('result').innerHTML = result.hocr || result.text;
        } catch (error) {
          console.error('OCR Error:', error);
        }
      };
      reader.readAsDataURL(file);
    });
  </script>
</body>
</html>
```

## API Reference

### OCRLibrary

#### Constructor

```javascript
const ocr = new OCRLibrary(options);
```

**Options:**
- `enginePath` (string, default: `/ocr-engine/engine`) - Path to the OCR engine folder
- `defaultLang` (string, default: `'eng'`) - Default language code
- `defaultAccuracy` (string, default: `'4.0.0'`) - Default accuracy mode

#### Methods

##### `recognize(imageSource, options)`

Recognizes text from an image.

**Parameters:**
- `imageSource` (string|File|Blob) - Image as data URL, File object, or Blob
- `options` (object):
  - `lang` (string) - Language code (e.g., 'eng', 'fra', 'jpn')
  - `accuracy` (string) - Accuracy mode ('3.02', '4.0.0', '4.0.0_best', etc.)
  - `region` (object) - Crop region: `{left, top, width, height}`
  - `mode` (string) - Color mode: 'normal', 'invert', 'gray'
  - `onProgress` (function) - Progress callback: `(report) => {}`

**Returns:** Promise resolving to:
```javascript
{
  text: string,      // Plain text
  hocr: string,      // HTML with formatting
  html: string,      // Alternative HTML
  confidence: number // Confidence score
}
```

**Example:**
```javascript
const result = await ocr.recognize('data:image/png;base64,...', {
  lang: 'eng',
  accuracy: '4.0.0',
  onProgress: (report) => {
    console.log(`${report.status}: ${Math.round(report.progress * 100)}%`);
  }
});
console.log(result.text);
```

## Supported Languages

The library supports 100+ languages including:
- English (eng)
- French (fra)
- German (deu)
- Spanish (spa)
- Chinese Simplified (chi_sim)
- Chinese Traditional (chi_tra)
- Japanese (jpn)
- Arabic (ara)
- Russian (rus)
- And many more...

See `ui/elements.js` for the complete list.

## Server Configuration

### WASM Files

Make sure your server serves `.wasm` files with the correct MIME type:

**Express.js:**
```javascript
app.use('/ocr-engine', express.static('ocr-engine', {
  setHeaders: (res, path) => {
    if (path.endsWith('.wasm')) {
      res.setHeader('Content-Type', 'application/wasm');
    }
  }
}));
```

**Apache (.htaccess):**
```apache
<IfModule mod_mime.c>
  AddType application/wasm .wasm
</IfModule>
```

**Nginx:**
```nginx
location /ocr-engine {
  add_header Content-Type application/wasm;
}
```

## Language Data

Language training data is automatically downloaded from `tessdata.projectnaptha.com` on first use. It's cached in the browser's Cache API, so subsequent uses are faster.

## Notes

- The library requires internet connection for the first download of each language
- Language files are cached automatically
- All processing happens in the browser (no server required)
- Works in all modern browsers (Chrome, Firefox, Safari, Edge)

## License

This code is converted from the "OCR - Image Reader" Chrome extension.

