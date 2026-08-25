"""
Builds a labelled patch dataset out of the Galaxy scan images.

The label comes from the operator software itself. When a scanner marks an
internal feature it paints it in saturated green or red over an otherwise grey
stone, so those pixels are a free ground truth: we do not need a human to
annotate anything.

The important detail is what the network is allowed to see. If the colour
channels went in, the task would collapse to "is this pixel green", the model
would score close to perfect, and it would be worthless on an unmarked scan.
So the label is derived from colour and the input is luminance only. The model
has to learn what a flaw looks like in the texture of the stone.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SAMPLES = os.path.join(ROOT, "assets", "samples")

PATCH = 24
CENTRE = 8          # size of the centre window that decides the label
MIN_STONE_FRAC = 0.85   # a patch must be almost entirely inside the stone


@dataclass
class Split:
    x_train: np.ndarray
    y_train: np.ndarray
    x_test: np.ndarray
    y_test: np.ndarray
    meta: dict


def _load_rgb(path: str) -> np.ndarray:
    img = Image.open(path).convert("RGB")
    return np.asarray(img).astype(np.float32)


def _luminance(rgb: np.ndarray) -> np.ndarray:
    return 0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]


def _marked_mask(rgb: np.ndarray) -> np.ndarray:
    """Pixels the scanner painted as a flaw: strong green or strong red."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    green = (g > 64) & (g > 1.22 * r) & (g > 1.12 * b)
    red = (r > 76) & (r > 1.35 * g) & (r > 1.25 * b)
    return green | red


def _stone_mask(rgb: np.ndarray, lum: np.ndarray) -> np.ndarray:
    """
    Rough body versus background. The scans are a bright stone on a darker
    field, sometimes with a light margin from the operator screenshot, so the
    stone is taken as the pixels that are neither near-black nor near-white,
    plus anything the scanner marked.
    """
    not_dark = lum > 40
    not_paper = ~((rgb[..., 0] > 232) & (rgb[..., 1] > 232) & (rgb[..., 2] > 232))
    return (not_dark & not_paper) | _marked_mask(rgb)


def _patches_from_image(path: str, rng: np.random.Generator, per_class: int):
    rgb = _load_rgb(path)
    lum = _luminance(rgb)
    marked = _marked_mask(rgb)
    stone = _stone_mask(rgb, lum)

    h, w = lum.shape
    half = PATCH // 2
    c0 = (PATCH - CENTRE) // 2
    c1 = c0 + CENTRE

    pos, neg = [], []
    # stride the image rather than sampling randomly, so coverage is even
    step = max(2, PATCH // 12)
    coords = [(y, x)
              for y in range(half, h - half - 1, step)
              for x in range(half, w - half - 1, step)]
    rng.shuffle(coords)

    for (y, x) in coords:
        if len(pos) >= per_class and len(neg) >= per_class:
            break
        y0, x0 = y - half, x - half
        stone_win = stone[y0:y0 + PATCH, x0:x0 + PATCH]
        if stone_win.mean() < MIN_STONE_FRAC:
            continue                              # mostly background, skip
        mark_win = marked[y0:y0 + PATCH, x0:x0 + PATCH]
        centre = mark_win[c0:c1, c0:c1]

        patch = lum[y0:y0 + PATCH, x0:x0 + PATCH]

        if centre.mean() > 0.25 and len(pos) < per_class:
            pos.append(patch)
        elif mark_win.sum() == 0 and len(neg) < per_class:
            neg.append(patch)

    return pos, neg


def build(per_class_per_image: int = 2400, seed: int = 11, holdout: str = "scan-04.png") -> Split:
    """
    Held out by image where possible: the model is tested on a scan it never
    saw during training, which is the only split that says anything honest
    about whether it generalises to the next stone.
    """
    rng = np.random.default_rng(seed)
    files = sorted(f for f in os.listdir(SAMPLES) if f.lower().endswith(".png"))
    if not files:
        raise SystemExit(f"No scans found in {SAMPLES}")

    train_pos, train_neg, test_pos, test_neg = [], [], [], []
    per_image = {}

    for name in files:
        pos, neg = _patches_from_image(os.path.join(SAMPLES, name), rng, per_class_per_image)
        per_image[name] = {"positive": len(pos), "negative": len(neg)}
        if name == holdout:
            test_pos += pos
            test_neg += neg
        else:
            train_pos += pos
            train_neg += neg

    # If the held out scan could not supply both classes, fall back to a
    # stratified random split and say so in the metadata.
    split_mode = f"held out image: {holdout}"
    if holdout == "__none__" or len(test_pos) < 40 or len(test_neg) < 40:
        split_mode = ("patches from every scan mixed into both splits"
                      if holdout == "__none__" else
                      "stratified random split, the held out image lacked both classes")
        all_pos = train_pos + test_pos
        all_neg = train_neg + test_neg
        rng.shuffle(all_pos)
        rng.shuffle(all_neg)
        cut_p, cut_n = int(len(all_pos) * 0.75), int(len(all_neg) * 0.75)
        train_pos, test_pos = all_pos[:cut_p], all_pos[cut_p:]
        train_neg, test_neg = all_neg[:cut_n], all_neg[cut_n:]

    # balance the classes so accuracy means something
    def balance(a, b):
        n = min(len(a), len(b))
        return a[:n], b[:n]

    train_pos, train_neg = balance(train_pos, train_neg)
    test_pos, test_neg = balance(test_pos, test_neg)

    def stack(pos, neg):
        x = np.array(pos + neg, dtype=np.float32)
        y = np.array([1] * len(pos) + [0] * len(neg), dtype=np.int64)
        idx = rng.permutation(len(y))
        return x[idx], y[idx]

    x_train, y_train = stack(train_pos, train_neg)
    x_test, y_test = stack(test_pos, test_neg)

    # Normalise each patch against itself rather than against a global mean.
    #
    # This matters more than it looks. Every scan comes off the machine with
    # its own exposure and contrast, so a global constant fitted on three
    # scans encodes those three lighting conditions and the model then fails
    # on the fourth. Standardising per patch removes the illumination of the
    # scan it came from and leaves the texture, which is the thing we actually
    # want the network to learn. The constants below are kept only so the
    # browser can reproduce the identical transform.
    def per_patch(a):
        flat = a.reshape(len(a), -1)
        mu = flat.mean(axis=1, keepdims=True)
        sd = np.maximum(flat.std(axis=1, keepdims=True), 1e-3)
        return ((flat - mu) / sd).reshape(a.shape).astype(np.float32)

    mean = float(x_train.mean() / 255.0)
    std = float(max(x_train.std() / 255.0, 1e-6))
    x_train = per_patch(x_train)
    x_test = per_patch(x_test)

    x_train = x_train[:, None, :, :]
    x_test = x_test[:, None, :, :]

    meta = {
        "patch": PATCH,
        "centre_window": CENTRE,
        "mean": mean,
        "std": std,
        "normalisation": "per patch standardisation, so scan to scan exposure does not leak into the model",
        "split_mode": split_mode,
        "per_image": per_image,
        "train_size": int(len(y_train)),
        "test_size": int(len(y_test)),
        "train_positive": int(y_train.sum()),
        "test_positive": int(y_test.sum()),
        "source_images": files,
        "input": "luminance only, colour is used for the label and never fed to the network",
    }
    return Split(x_train, y_train, x_test, y_test, meta)


if __name__ == "__main__":
    s = build()
    print(json.dumps(s.meta, indent=2))
    print("train", s.x_train.shape, "test", s.x_test.shape)
