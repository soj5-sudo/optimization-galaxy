// Proves the browser scores a patch exactly as the trainer does.
//
// The model is trained in Python and run in JavaScript. Two implementations of
// the same arithmetic is a standing invitation for them to drift, and a drift
// would mean the numbers a customer sees were produced by something other than
// the thing that was measured. So this compares both on real patches and fails
// on any difference beyond floating point noise.
//
// Run:  node test/parity.js

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const REF = path.join(require('os').tmpdir(), 'og_parity.json');

const py = path.join(ROOT, '.venv', 'bin', 'python');
if (!fs.existsSync(py)) {
  console.error('No virtual environment. Create it with: python3 -m venv .venv && .venv/bin/pip install numpy pillow');
  process.exit(1);
}

console.log('scoring patches in python');
execFileSync(py, ['-c', `
import json, numpy as np
np.seterr(all='ignore')
import sys; sys.path.insert(0, ${JSON.stringify(path.join(ROOT, 'ml'))})
from dataset import build
from cnn import InclusionCNN
d = build(holdout='scan-04.png')
w = json.load(open(${JSON.stringify(path.join(ROOT, 'ml', 'artifacts', 'weights.json'))}))
m = InclusionCNN(patch=24, seed=7)
conv1 = np.transpose(np.array(w['layers'][0]['kernel'], dtype=np.float32), (0,3,1,2))
conv2 = np.transpose(np.array(w['layers'][3]['kernel'], dtype=np.float32), (0,3,1,2))
m.load_state({
 'conv1.W': conv1, 'conv1.b': np.array(w['layers'][0]['bias'], dtype=np.float32),
 'conv2.W': conv2, 'conv2.b': np.array(w['layers'][3]['bias'], dtype=np.float32),
 'fc1.W': np.array(w['layers'][7]['weights'], dtype=np.float32), 'fc1.b': np.array(w['layers'][7]['bias'], dtype=np.float32),
 'fc2.W': np.array(w['layers'][9]['weights'], dtype=np.float32), 'fc2.b': np.array(w['layers'][9]['bias'], dtype=np.float32)})
x = d.x_test[:12]
logits = m.forward(x, train=False)
e = np.exp(logits - logits.max(axis=1, keepdims=True)); probs = e/e.sum(axis=1, keepdims=True)
json.dump({'patches': x[:,0].tolist(), 'probs': probs.tolist()}, open(${JSON.stringify(REF)}, 'w'))
`], { cwd: path.join(ROOT, 'ml'), stdio: ['ignore', 'inherit', 'inherit'] });

const ref = JSON.parse(fs.readFileSync(REF, 'utf8'));
const weights = JSON.parse(fs.readFileSync(path.join(ROOT, 'ml', 'artifacts', 'weights.json'), 'utf8'));

const src = fs.readFileSync(path.join(ROOT, 'js', 'cnn.js'), 'utf8');
const mod = { exports: {} };
new Function('module', 'exports', src.replace('const CNN =', 'module.exports ='))(mod, mod.exports);
const CNN = mod.exports;

global.fetch = async () => ({ ok: true, json: async () => weights });

(async () => {
  await CNN.load('weights');
  let worst = 0;
  ref.patches.forEach((p, i) => {
    const out = CNN.forward(Float32Array.from(p.flat()), 24);
    const diff = Math.abs(out[1] - ref.probs[i][1]);
    if (diff > worst) worst = diff;
  });
  console.log(`compared ${ref.patches.length} patches`);
  console.log(`largest difference ${worst.toExponential(2)}`);
  if (worst > 1e-5) {
    console.error('MISMATCH. The browser is not computing what was trained.');
    process.exit(1);
  }
  console.log('parity confirmed');
})();
