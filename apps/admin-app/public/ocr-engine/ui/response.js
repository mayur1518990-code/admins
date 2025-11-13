/* global service */
'use strict';

{
  const em = document.createElement('ocr-result');
  em.dataset.page = (window.ocrHomepageUrl || 'https://webextension.org/listing/ocr.html') + '#faq8';
  em.controllers = new Set();
  document.body.append(em);
  try {
    em.scrollIntoViewIfNeeded();
  }
  catch (e) {}

  const command = em.command = (name, ...args) => em[name](...args);

  const ocr = (lang, src) => {
    // if accuracy changed, kill old engines
    if (em.controllers.accuracy) {
      if (em.controllers.accuracy !== em.dataset.accuracy) {
        for (const controller of em.controllers) {
          controller.abort();
        }
        em.controllers.clear();
        command('progress', 0);
        command('clear');
      }
    }
    em.controllers.accuracy = em.dataset.accuracy;

    const report = report => {
      command('message', report.status);

      if (report.status === 'recognizing text') {
        command('progress', report.progress);
      }
      else if (report.status.startsWith('Streaming')) {
        command('progress', report.progress);
      }
      else if (
        report.status.startsWith('Loading') ||
        report.status.startsWith('loading') ||
        report.status.startsWith('loaded')
      ) {
        command('progress', report.progress, 'lang');
      }
    };
    const controller = new AbortController();
    em.controllers.add(controller);
    em.addEventListener('closed', () => controller.abort());
    return self.execute({
      lang,
      src,
      accuracy: em.dataset.accuracy,
      signal: controller.signal
    }, report);
  };

  // if there is oResult object, run in inverted colors
  const run = em.run = async (oResult, mode = 'normal') => {
    const src = await self.crop(em.href, em.box, mode);

    command('progress', 0);
    command('clear');

    const lang = oResult?.lang || em.dataset.language || 'eng';

    let o;
    try {
      if (lang !== 'detect') {
        o = await ocr(lang, src);
      }
      else {
        // Auto-detect: Try multiple languages and pick the best confidence
        // Note: For better language detection, consider using a library like 'franc'
        await Promise.all([
          ocr('eng', src).then(o => ({ lang: 'eng', o, confidence: o.confidence })),
          ocr('ara', src).then(o => ({ lang: 'ara', o, confidence: o.confidence })),
          ocr('jpn', src).then(o => ({ lang: 'jpn', o, confidence: o.confidence }))
        ]).then(async a => {
          const r = a.sort((a, b) => b.confidence - a.confidence)[0];
          o = r.o;
          o.lang = r.lang;
          command('rename', `Auto Detect (${r.lang})`);
          command('message', `Detected language is "${r.lang}". Please wait...`);
        });
      }
      command('progress', 1);

      // in case "confidence" is not acceptable, rerun with inverted colors
      if (o.confidence < 50 && !oResult) {
        command('message', `Low confidence (${o.confidence}%). Trying with inverted colors. Please wait...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        run(o, 'invert');
        return;
      }
      if (mode === 'invert' && o.confidence < 20 && oResult.confidence < 20) {
        command('message', `Low confidence (${o.confidence}%) again! Trying with inverted colors. Please wait...`);

        run(o, 'gray');
        return;
      }
      if (oResult) {
        if (oResult.confidence > o.confidence) {
          o = oResult;
        }
      }

      if (o.text.trim() === '') {
        command('build', {
          hocr: '<span style="color: red">No text was detected! Edit the image and drop it here to retry!</span>'
        });
      }
      else {
        command('build', o);
        command('enable');
      }
    }
    catch (e) {
      console.warn(e);
      command('message', e.message || e);
    }
    service.next();
  };

  // events
  em.addEventListener('open-link', e => {
    window.open(e.detail, '_blank');
  });
  em.addEventListener('fetch-resource', async e => {
    const {href, options} = e.detail;
    const t = (msg, timeout = 3000) => command('toast', 'post', {
      new: msg,
      old: 'Post Result'
    }, timeout);

    try {
      const r = await fetch(href, options);
      if (r.ok || r.status === 0) {
        t('Done');
      }
      else {
        throw Error('Error ' + r.status);
      }
    }
    catch (e) {
      console.warn(e);
      t(e.message);
    }
  });
  em.addEventListener('language-changed', () => run());
  em.addEventListener('accuracy-changed', () => {
    // Clear caches and IndexedDB
    caches.delete('traineddata').then(() => {
      if (indexedDB && indexedDB.databases) {
        indexedDB.databases().then(dbs => {
          dbs.forEach(db => indexedDB.deleteDatabase(db.name));
        }).then(() => run()).catch(() => run());
      } else {
        run();
      }
    }).catch(() => run());
  });
  em.addEventListener('save-preference', async e => {
    const prefs = e.detail;
    // Clipboard API works directly in modern browsers, no special permission needed
    if ('auto-clipboard' in prefs && prefs['auto-clipboard']) {
      // Modern browsers handle clipboard automatically
    }

    // Use LocalStorageAdapter if available, otherwise use localStorage directly
    if (typeof LocalStorageAdapter !== 'undefined') {
      const storage = new LocalStorageAdapter();
      await storage.set(prefs);
    } else {
      // Fallback to direct localStorage
      for (const [key, value] of Object.entries(prefs)) {
        try {
          localStorage.setItem('ocr_' + key, JSON.stringify(value));
        } catch (err) {
          console.warn('Failed to save preference:', key);
        }
      }
    }
  });
  em.addEventListener('closed', e => {
    if (e.metaKey || e.ctrlKey) {
      // Clear caches and IndexedDB
      caches.delete('traineddata').catch(() => {});
      if (indexedDB && indexedDB.databases) {
        indexedDB.databases().then(dbs => {
          dbs.forEach(db => indexedDB.deleteDatabase(db.name));
        }).catch(() => {});
      }
    }
  });

  // Drag and drop support
  em.addEventListener('dragover', e => {
    const types = [...e.dataTransfer.items].map(e => e.type);
    if (types.some(s => s.startsWith('image/'))) {
      e.preventDefault();
    }
  });
  em.addEventListener('drop', async e => {
    e.preventDefault();
    for (const entry of [...e.dataTransfer.files].filter(e => e.type && e.type.startsWith('image/'))) {
      await new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = () => {
          service.add({
            method: 'add-job',
            href: reader.result,
            request: {
              left: 0,
              top: 0,
              width: 0,
              height: 0
            }
          });
          resolve();
        };
        reader.readAsDataURL(entry);
      });
    }
  });
}

