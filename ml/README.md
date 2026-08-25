# Models

Two learned components, both trained by the scripts in this directory. Run them
with the project virtual environment: `../.venv/bin/python <script>`.

## 1. Inclusion classifier, `cnn.py` + `train.py`

A small convolutional network written directly against numpy. No framework.
Conv, ReLU, max pool, dense, softmax, cross entropy, Adam, all with their own
forward and backward passes.

**What it does.** Slides over a rough scan and marks where the flaws are.

**How it is labelled.** The scanner paints marked flaws in green and red. That
colour is the ground truth, so no human annotation is needed. Critically, the
network is fed **luminance only**: the colour that carries the label never
reaches the input, so it cannot learn "green means flaw" and has to learn the
texture instead.

**How it is measured.** Two regimes, both in `artifacts/metrics.json`:
- held out scan, trained on three scans and tested on a fourth it has never seen
- mixed scans, patches from every scan shuffled into both splits

The gap between them is the finding. The texture is learnable; the corpus is too
small to cover the variation between machines and exposures. Closing it is a
data problem, not a modelling one.

**Parity.** The browser runs the same forward pass. `node test/parity.js` scores
real patches in both Python and JavaScript and fails on any difference beyond
floating point noise.

## 2. Cut or hold policy, `rl.py`

Reinforcement learning, REINFORCE with a moving baseline.

- **state**: flaw coverage inside the outline, how close the nearest flaw is to
  the rim, how decisive the model was, clarity against the buyer's floor, size
- **action**: cut, or hold
- **reward**: money. A stone that passes earns its value less wheel time. A
  stone that comes back costs the rough, the wheel time and the return handling.
  Holding a stone that would have passed costs the margin not made.

The policy is a logistic over a linear state, so every weight is readable. The
learned weights say: cut by default, hold when the stone is flawed, chipped at
the rim, under grade, or too small. Nobody wrote those rules down.

`artifacts/policy.json` records the comparison against the hand set threshold
table it replaces, and against cutting everything.

**Where outcomes come from.** Until a factory returns real cut results, the
reward is produced by a simulator built from the same evidence the gate sees.
`sample_outcome` is the only place the environment is defined; point it at real
outcomes and nothing else changes.
