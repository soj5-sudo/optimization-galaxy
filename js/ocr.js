// ocr.js
// Reads a document image into text.
//
// Two routes, same result shape. When the local server is there it uses the
// tesseract binary on the machine, which is faster and needs no download. When
// it is not, which is the case on a static host, it loads the WebAssembly build
// in the browser and does the work here instead.
//
// The route taken is reported alongside the text, because a reader should know
// which engine produced the words it is parsing.

const OCR = (() => {

  const WASM_ENGINE = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
  let serverAvailable = null;      // null until probed
  let wasmWorker = null;
  let wasmLoading = null;

  // The bundled documents never change, so they are read once when the site is
  // built and the words shipped alongside them. A visitor should not spend ten
  // seconds per page having their laptop recognise the same fixed specimen that
  // every other visitor has already recognised. Anything uploaded has no entry
  // here and is read live, which is the case that actually needs the engine.
  let cache = null;
  let cacheLoading = null;

  function loadCache() {
    if (cache) return Promise.resolve(cache);
    if (cacheLoading) return cacheLoading;
    cacheLoading = fetch('assets/docs/ocr-cache.json', { cache: 'force-cache' })
      .then(r => (r.ok ? r.json() : {}))
      .catch(() => ({}))
      .then(c => { cache = c; return c; });
    return cacheLoading;
  }

  // Start fetching the cache and, where it will be needed, the engine, without
  // blocking anything. By the time a document is opened both are usually there.
  function warm() {
    loadCache();
    probeServer().then(hasServer => {
      if (!hasServer) getWorker().catch(() => {});
    });
  }

  async function probeServer() {
    if (serverAvailable !== null) return serverAvailable;
    try {
      const r = await fetch('/api/hostinfo', { cache: 'no-store' });
      if (!r.ok) { serverAvailable = false; return false; }
      const info = await r.json();
      serverAvailable = typeof info.ocr === 'string' && info.ocr !== 'unavailable';
    } catch (e) {
      serverAvailable = false;
    }
    return serverAvailable;
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (window.Tesseract) return resolve();
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('could not load the reader'));
      document.head.appendChild(s);
    });
  }

  async function getWorker(onProgress) {
    if (wasmWorker) return wasmWorker;
    if (wasmLoading) return wasmLoading;
    wasmLoading = (async () => {
      await loadScript(WASM_ENGINE);
      const worker = await window.Tesseract.createWorker('eng', 1, {
        logger: m => {
          if (onProgress && m.status === 'recognizing text') onProgress(m.progress);
        },
      });
      wasmWorker = worker;
      return worker;
    })();
    return wasmLoading;
  }

  // Upscale and flatten to grey before reading. Certificate scans are small and
  // the engine does markedly better on a larger, contrastier image.
  function prepare(img, scale = 2.4) {
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const px = ctx.getImageData(0, 0, c.width, c.height);
    const d = px.data;
    for (let i = 0; i < d.length; i += 4) {
      const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      d[i] = d[i + 1] = d[i + 2] = g;
    }
    ctx.putImageData(px, 0, 0);
    return c;
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('could not open ' + src));
      img.src = src;
    });
  }

  // Reads one document. Returns { text, words, ms, engine } either way.
  async function read(src, onProgress) {
    const t0 = performance.now();

    // a document we have already read
    const key = String(src).replace(/^.*?(assets\/docs\/)/, '$1');
    const hit = (await loadCache())[key];
    if (hit && hit.text) {
      return { text: hit.text, words: hit.words, ms: Math.round(performance.now() - t0), engine: hit.engine, cached: true };
    }

    if (await probeServer()) {
      try {
        const img = await loadImage(src);
        const canvas = prepare(img, 1);
        const dataUrl = canvas.toDataURL('image/png');
        const res = await fetch('/api/ocr', {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: dataUrl,
        });
        const out = await res.json();
        if (out && out.text) {
          return { text: out.text, words: out.words, ms: out.ms, engine: out.engine || 'tesseract, local' };
        }
      } catch (e) {
        serverAvailable = false;      // fall through to the browser engine
      }
    }

    const img = await loadImage(src);
    const canvas = prepare(img, 2.4);
    const worker = await getWorker(onProgress);
    const { data } = await worker.recognize(canvas);
    const text = (data && data.text) || '';
    return {
      text,
      words: text.split(/\s+/).filter(Boolean).length,
      ms: Math.round(performance.now() - t0),
      engine: 'tesseract WebAssembly, in this browser',
    };
  }

  return { read, probeServer, warm };
})();
