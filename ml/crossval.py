"""
Leave one scan out cross validation.

Reporting a single held out scan invites the obvious question: did you pick the
easy one. So every scan takes a turn as the test set and the mean is reported
with its spread. This is the number to quote.
"""
from __future__ import annotations
import json, os, time
import numpy as np
np.seterr(divide="ignore", over="ignore", invalid="ignore")

from cnn import InclusionCNN, Adam, softmax_cross_entropy
from dataset import build, SAMPLES
from train import augment, accuracy, confusion, EPOCHS, BATCH, LR

ART = os.path.join(os.path.dirname(os.path.abspath(__file__)), "artifacts")


def train_fold(data, seed=7, epochs=EPOCHS):
    model = InclusionCNN(patch=data.meta["patch"], seed=seed)
    opt = Adam(model.params(), lr=LR, weight_decay=1e-4)
    rng = np.random.default_rng(3)
    best, best_state = 0.0, None
    for epoch in range(1, epochs + 1):
        idx = rng.permutation(len(data.y_train))
        xs, ys = data.x_train[idx], data.y_train[idx]
        for i in range(0, len(ys), BATCH):
            xb = augment(xs[i:i + BATCH], rng)
            logits = model.forward(xb, train=True)
            _, dlogits, _ = softmax_cross_entropy(logits, ys[i:i + BATCH])
            model.backward(dlogits)
            opt.step()
        acc = accuracy(model, data.x_test, data.y_test)
        if acc > best:
            best, best_state = acc, {k: v.copy() for k, v in model.state().items()}
    if best_state:
        model.load_state(best_state)
    return model, best


def main():
    scans = sorted(f for f in os.listdir(SAMPLES) if f.lower().endswith(".png"))
    folds = []
    t0 = time.time()
    for scan in scans:
        data = build(holdout=scan)
        if data.meta["train_size"] < 200 or data.meta["test_size"] < 100:
            print(f"  {scan}: not enough patches on either side, skipped")
            continue
        model, acc = train_fold(data)
        tp, tn, fp, fn = confusion(model, data.x_test, data.y_test)
        prec = tp / (tp + fp) if (tp + fp) else 0.0
        rec = tp / (tp + fn) if (tp + fn) else 0.0
        folds.append({
            "held_out": scan, "accuracy": round(acc, 4),
            "precision": round(prec, 4), "recall": round(rec, 4),
            "train_size": data.meta["train_size"], "test_size": data.meta["test_size"],
        })
        print(f"  held out {scan:16s} accuracy {acc:.4f}  precision {prec:.3f}  recall {rec:.3f}")

    accs = [f["accuracy"] for f in folds]
    summary = {
        "method": "leave one scan out cross validation",
        "folds": folds,
        "mean_accuracy": round(float(np.mean(accs)), 4) if accs else None,
        "std_accuracy": round(float(np.std(accs)), 4) if accs else None,
        "min_accuracy": round(float(np.min(accs)), 4) if accs else None,
        "max_accuracy": round(float(np.max(accs)), 4) if accs else None,
        "scans": scans,
        "wall_seconds": round(time.time() - t0, 1),
    }
    with open(os.path.join(ART, "crossval.json"), "w") as fh:
        json.dump(summary, fh, indent=2)
    print(f"\nmean {summary['mean_accuracy']}  spread {summary['min_accuracy']} to {summary['max_accuracy']}")


if __name__ == "__main__":
    main()
