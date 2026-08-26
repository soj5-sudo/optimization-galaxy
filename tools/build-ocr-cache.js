// Reads every bundled document once, at build time, and writes the text next to
// them. The hosted site then has the words immediately instead of spending ten
// seconds per page recognising the same fixed specimen in every visitor's
// browser. Anything a user uploads is still read live, because there is no
// cache entry for a file nobody has seen before.
//
// Run:  node tools/build-ocr-cache.js     (needs the tesseract binary)

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const DOCS = path.join(ROOT, 'assets', 'docs');
const OUT = path.join(DOCS, 'ocr-cache.json');

function which(bin) {
  for (const dir of ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']) {
    const p = path.join(dir, bin);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const tesseract = which('tesseract');
const ffmpeg = which('ffmpeg');
if (!tesseract) {
  console.error('tesseract not found. brew install tesseract');
  process.exit(1);
}

const cache = {};
for (const file of fs.readdirSync(DOCS).filter(f => /\.(png|jpe?g)$/i.test(f))) {
  const src = path.join(DOCS, file);
  const tmp = path.join(os.tmpdir(), 'ocr_' + file);
  let input = src;
  if (ffmpeg) {
    // the same upscale and flatten the browser does, so the text matches
    try {
      execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', src,
        '-vf', 'scale=iw*2.4:ih*2.4:flags=lanczos,format=gray', tmp]);
      input = tmp;
    } catch (e) { /* read the original instead */ }
  }
  const base = path.join(os.tmpdir(), 'ocrout_' + file.replace(/\W/g, ''));
  const t0 = Date.now();
  execFileSync(tesseract, [input, base, '--psm', '6'], { stdio: 'ignore' });
  const text = fs.readFileSync(base + '.txt', 'utf8');
  const words = text.split(/\s+/).filter(Boolean).length;
  cache['assets/docs/' + file] = {
    text,
    words,
    ms: Date.now() - t0,
    engine: 'tesseract, read once when the site was built',
  };
  console.log(`  ${file.padEnd(30)} ${String(words).padStart(4)} words`);
  for (const f of [tmp, base + '.txt']) { try { fs.unlinkSync(f); } catch (e) {} }
}

fs.writeFileSync(OUT, JSON.stringify(cache, null, 1));
console.log(`\nwrote ${path.relative(ROOT, OUT)}, ${Object.keys(cache).length} documents, ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);
