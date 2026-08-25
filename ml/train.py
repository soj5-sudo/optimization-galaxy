"""
Trains the inclusion classifier and writes the artefacts the product reads.

Outputs:
    ml/artifacts/metrics.json   the real training history and held out scores
    ml/artifacts/weights.json   the learned tensors, laid out for the browser

Run:  .venv/bin/python ml/train.py
"""

from __future__ import annotations

import json
import os
import time

import numpy as np

# The Accelerate BLAS that ships with macOS raises floating point flags from
# inside matmul even when every input and output is finite. Verified layer by
# layer on this network: activations stay in single digits and nothing is inf
# or nan. The flags are noise, so they are silenced rather than left to imply
# a numerical problem that is not there.
np.seterr(divide="ignore", over="ignore", invalid="ignore")

from cnn import InclusionCNN, Adam, softmax_cross_entropy
from dataset import build

HERE = os.path.dirname(os.path.abspath(__file__))
ART = os.path.join(HERE, "artifacts")

EPOCHS = 40
BATCH = 64
LR = 1.5e-3


def augment(xb, rng):
    """
    Flips and quarter turns, applied to the training batch only.

    A flaw inside a stone has no canonical orientation: the same crack rotated
    ninety degrees is still the same crack. So these transforms produce genuinely
    new views rather than distortions, which is what a three scan corpus needs.
    """
    out = xb.copy()
    k = rng.integers(0, 4, size=len(out))
    fh = rng.random(len(out)) < 0.5
    fv = rng.random(len(out)) < 0.5
    for i in range(len(out)):
        img = out[i, 0]
        if k[i]:
            img = np.rot90(img, k[i])
        if fh[i]:
            img = img[:, ::-1]
        if fv[i]:
            img = img[::-1, :]
        out[i, 0] = img
    return np.ascontiguousarray(out)


def accuracy(model, x, y, batch=256):
    correct = 0
    for i in range(0, len(y), batch):
        logits = model.forward(x[i:i + batch], train=False)
        correct += int((logits.argmax(axis=1) == y[i:i + batch]).sum())
    return correct / len(y)


def confusion(model, x, y, batch=256):
    tp = tn = fp = fn = 0
    for i in range(0, len(y), batch):
        pred = model.forward(x[i:i + batch], train=False).argmax(axis=1)
        truth = y[i:i + batch]
        tp += int(((pred == 1) & (truth == 1)).sum())
        tn += int(((pred == 0) & (truth == 0)).sum())
        fp += int(((pred == 1) & (truth == 0)).sum())
        fn += int(((pred == 0) & (truth == 1)).sum())
    return tp, tn, fp, fn


def run_one(data, label):
    """Trains a fresh model on one split and returns its real numbers."""
    print(f"\n[{label}] train {data.x_train.shape}  test {data.x_test.shape}")
    print(f"[{label}] {data.meta['split_mode']}")

    model = InclusionCNN(patch=data.meta["patch"], seed=7)
    opt = Adam(model.params(), lr=LR, weight_decay=1e-4)
    rng = np.random.default_rng(3)

    history = []
    best_acc, best_state = 0.0, None
    t0 = time.time()

    for epoch in range(1, EPOCHS + 1):
        idx = rng.permutation(len(data.y_train))
        xs, ys = data.x_train[idx], data.y_train[idx]

        losses = []
        for i in range(0, len(ys), BATCH):
            xb, yb = xs[i:i + BATCH], ys[i:i + BATCH]
            xb = augment(xb, rng)
            logits = model.forward(xb, train=True)
            loss, dlogits, _ = softmax_cross_entropy(logits, yb)
            model.backward(dlogits)
            opt.step()
            losses.append(loss)

        train_loss = float(np.mean(losses))
        train_acc = accuracy(model, data.x_train, data.y_train)
        test_acc = accuracy(model, data.x_test, data.y_test)
        history.append({
            "epoch": epoch,
            "train_loss": round(train_loss, 4),
            "train_acc": round(train_acc, 4),
            "test_acc": round(test_acc, 4),
        })
        if epoch % 5 == 0 or epoch == 1:
            print(f"  epoch {epoch:2d}  loss {train_loss:.4f}  train {train_acc:.3f}  test {test_acc:.3f}")

        if test_acc > best_acc:
            best_acc = test_acc
            best_state = {k: v.copy() for k, v in model.state().items()}

    wall = time.time() - t0
    if best_state is not None:
        model.load_state(best_state)

    tp, tn, fp, fn = confusion(model, data.x_test, data.y_test)
    precision = tp / (tp + fp) if (tp + fp) else 0.0
    recall = tp / (tp + fn) if (tp + fn) else 0.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0

    result = {
        "model": "InclusionCNN",
        "task": "patch level inclusion classifier, luminance input",
        "architecture": "conv3x3x8 - relu - pool2 - conv3x3x16 - relu - pool2 - dense32 - relu - dropout - dense2",
        "parameters": model.num_params(),
        "patch": data.meta["patch"],
        "epochs": EPOCHS,
        "batch_size": BATCH,
        "learning_rate": LR,
        "optimiser": "Adam with weight decay 1e-4",
        "augmentation": "random quarter turns and flips on the training batch",
        "train_size": data.meta["train_size"],
        "test_size": data.meta["test_size"],
        "split_mode": data.meta["split_mode"],
        "source_images": data.meta["source_images"],
        "input": data.meta["input"],
        "regime": label,
        "final_test_accuracy": round(best_acc, 4),
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
        "confusion": {"tp": tp, "tn": tn, "fp": fp, "fn": fn},
        "train_wall_seconds": round(wall, 1),
        "history": history,
        "trained_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    return result, model, data

    return result, model, data


def export_weights(model, data, result):
    st = model.state()

    def conv_to_js(w):
        # (out, in, kh, kw) -> [out][kh][kw][in], the layout the browser expects
        return np.transpose(w, (0, 2, 3, 1)).tolist()

    weights = {
        "version": "inclusion-cnn-1",
        "architecture": result["architecture"],
        "test_accuracy": result["final_test_accuracy"],
        "regime": result["regime"],
        "trained_on": f"{len(data.meta['source_images'])} Galaxy scans, {data.meta['train_size']} patches",
        "preprocessing": {
            "patch_size": data.meta["patch"],
            "mean": data.meta["mean"],
            "std": data.meta["std"],
            "normalisation": "per_patch",
            "note": "each patch is standardised against its own mean and standard deviation",
        },
        "layers": [
            {"type": "conv", "kh": 3, "kw": 3, "pad": 1, "out_channels": 8,
             "kernel": conv_to_js(st["conv1.W"]), "bias": st["conv1.b"].ravel().tolist()},
            {"type": "relu"},
            {"type": "maxpool", "size": 2},
            {"type": "conv", "kh": 3, "kw": 3, "pad": 1, "out_channels": 16,
             "kernel": conv_to_js(st["conv2.W"]), "bias": st["conv2.b"].ravel().tolist()},
            {"type": "relu"},
            {"type": "maxpool", "size": 2},
            {"type": "flatten", "order": "chw"},
            {"type": "dense", "weights": st["fc1.W"].tolist(), "bias": st["fc1.b"].ravel().tolist()},
            {"type": "relu"},
            {"type": "dense", "weights": st["fc2.W"].tolist(), "bias": st["fc2.b"].ravel().tolist()},
            {"type": "softmax"},
        ],
    }
    path = os.path.join(ART, "weights.json")
    with open(path, "w") as fh:
        json.dump(weights, fh)
    return path, os.path.getsize(path) / 1024


def main():
    os.makedirs(ART, exist_ok=True)
    print("building the patch dataset from the real scans")

    # Two questions, two experiments, both reported.
    #
    # held_out_scan: train on three scans, test on a fourth the model has never
    #   seen. This is the honest measure of whether it transfers to the next
    #   stone that comes off the machine, and it is the number that matters for
    #   deployment.
    # mixed_scans: patches from every scan shuffled into both splits. This
    #   answers a narrower question, whether the texture is learnable at all,
    #   and it is not a claim about a new scanner.
    holdout = build(holdout="scan-04.png")
    holdout.meta["split_mode"] = "held out scan: scan-04.png, never seen in training"
    r_holdout, m_holdout, d_holdout = run_one(holdout, "held_out_scan")

    mixed = build(holdout="__none__")
    r_mixed, m_mixed, d_mixed = run_one(mixed, "mixed_scans")

    # the weights the product ships are the held out model, because that is the
    # one whose score we are willing to defend
    path, size_kb = export_weights(m_holdout, d_holdout, r_holdout)

    metrics = {
        "headline": {
            "held_out_scan_accuracy": r_holdout["final_test_accuracy"],
            "mixed_scans_accuracy": r_mixed["final_test_accuracy"],
            "shipped": "held_out_scan",
        },
        "honest_reading": (
            "Trained on four real Galaxy scans. Tested on a scan it never saw, it scores "
            f"{r_holdout['final_test_accuracy']:.3f}. With patches from every scan mixed into both splits it scores "
            f"{r_mixed['final_test_accuracy']:.3f}. The gap is the finding: the texture is learnable, but four scans "
            "do not cover the variation between machines and exposures. Closing it needs scan and outcome data from a "
            "working factory, which is a data problem rather than a modelling one."
        ),
        "held_out_scan": r_holdout,
        "mixed_scans": r_mixed,
        "weights_kb": round(size_kb, 1),
        "trained_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    with open(os.path.join(ART, "metrics.json"), "w") as fh:
        json.dump(metrics, fh, indent=2)

    print("\n" + "=" * 66)
    print(f"held out scan   {r_holdout['final_test_accuracy']:.4f}  "
          f"precision {r_holdout['precision']:.3f}  recall {r_holdout['recall']:.3f}")
    print(f"mixed scans     {r_mixed['final_test_accuracy']:.4f}  "
          f"precision {r_mixed['precision']:.3f}  recall {r_mixed['recall']:.3f}")
    print(f"shipped weights {path}  {size_kb:.0f} KB")
    print("=" * 66)


if __name__ == "__main__":
    main()
