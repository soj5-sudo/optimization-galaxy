"""
A small convolutional network written directly against numpy.

Nothing here depends on a deep-learning framework. Every layer implements the
same two-method contract:

    forward(x)      -> activation, caching whatever the backward pass needs
    backward(dout)  -> gradient with respect to the layer input

Parameter layers additionally expose `params()`, returning a list of
(value, gradient) pairs that the optimiser mutates in place.

Tensor layout follows the usual NCHW convention: (batch, channels, height,
width). Convolutions are computed with im2col so the heavy lifting lands in a
single BLAS matmul rather than a Python loop over pixels.
"""

from __future__ import annotations

import numpy as np


# --------------------------------------------------------------------------
# im2col / col2im
# --------------------------------------------------------------------------

def im2col(x: np.ndarray, k: int, pad: int) -> np.ndarray:
    """Flatten every k x k receptive field into a column.

    Returns an array of shape (N, C*k*k, out_h*out_w). A strided view is built
    first and then reshaped; the reshape forces one contiguous copy, which is
    the price of turning the convolution into a matmul.
    """
    n, c, h, w = x.shape
    xp = np.pad(x, ((0, 0), (0, 0), (pad, pad), (pad, pad)))
    out_h = h + 2 * pad - k + 1
    out_w = w + 2 * pad - k + 1
    sn, sc, sh, sw = xp.strides
    view = np.lib.stride_tricks.as_strided(
        xp,
        shape=(n, c, k, k, out_h, out_w),
        strides=(sn, sc, sh, sw, sh, sw),
        writeable=False,
    )
    return view.reshape(n, c * k * k, out_h * out_w)


def col2im(cols: np.ndarray, x_shape: tuple, k: int, pad: int) -> np.ndarray:
    """Adjoint of im2col: scatter column gradients back onto the image grid."""
    n, c, h, w = x_shape
    out_h = h + 2 * pad - k + 1
    out_w = w + 2 * pad - k + 1
    grid = cols.reshape(n, c, k, k, out_h, out_w)
    xp = np.zeros((n, c, h + 2 * pad, w + 2 * pad), dtype=cols.dtype)
    # Only k*k iterations, so the loop is cheap and avoids np.add.at.
    for i in range(k):
        for j in range(k):
            xp[:, :, i:i + out_h, j:j + out_w] += grid[:, :, i, j]
    if pad == 0:
        return xp
    return xp[:, :, pad:pad + h, pad:pad + w]


# --------------------------------------------------------------------------
# Layers
# --------------------------------------------------------------------------

class Conv2D:
    """Cross-correlation with `filters` kernels of size k x k, stride 1.

    Weights are He-initialised (gain sqrt(2/fan_in)), which is the right choice
    ahead of a ReLU: it keeps the activation variance roughly constant through
    the stack instead of letting it collapse layer by layer.
    """

    def __init__(self, in_ch: int, filters: int, k: int, pad: int, rng: np.random.Generator, name: str):
        self.name = name
        self.in_ch, self.filters, self.k, self.pad = in_ch, filters, k, pad
        fan_in = in_ch * k * k
        self.W = rng.normal(0.0, np.sqrt(2.0 / fan_in), size=(filters, in_ch, k, k)).astype(np.float32)
        self.b = np.zeros(filters, dtype=np.float32)
        self.dW = np.zeros_like(self.W)
        self.db = np.zeros_like(self.b)
        self._cache = None

    def forward(self, x: np.ndarray) -> np.ndarray:
        n, c, h, w = x.shape
        out_h = h + 2 * self.pad - self.k + 1
        out_w = w + 2 * self.pad - self.k + 1
        cols = im2col(x, self.k, self.pad)                     # (N, C*k*k, L)
        wrow = self.W.reshape(self.filters, -1)                # (F, C*k*k)
        out = np.einsum("fj,njl->nfl", wrow, cols, optimize=True)
        out += self.b[None, :, None]
        self._cache = (x.shape, cols)
        return out.reshape(n, self.filters, out_h, out_w)

    def backward(self, dout: np.ndarray) -> np.ndarray:
        x_shape, cols = self._cache
        n = dout.shape[0]
        d = dout.reshape(n, self.filters, -1)                  # (N, F, L)
        self.db[...] = d.sum(axis=(0, 2))
        self.dW[...] = np.einsum("nfl,njl->fj", d, cols, optimize=True).reshape(self.W.shape)
        wrow = self.W.reshape(self.filters, -1)
        dcols = np.einsum("fj,nfl->njl", wrow, d, optimize=True)
        return col2im(dcols, x_shape, self.k, self.pad)

    def params(self):
        return [(self.W, self.dW), (self.b, self.db)]


class ReLU:
    def __init__(self):
        self._mask = None

    def forward(self, x: np.ndarray) -> np.ndarray:
        self._mask = x > 0
        return x * self._mask

    def backward(self, dout: np.ndarray) -> np.ndarray:
        return dout * self._mask

    def params(self):
        return []


class MaxPool2D:
    """Non-overlapping max pool. Only `size` x `size` windows, stride == size."""

    def __init__(self, size: int = 2):
        self.size = size
        self._cache = None

    def forward(self, x: np.ndarray) -> np.ndarray:
        n, c, h, w = x.shape
        s = self.size
        assert h % s == 0 and w % s == 0, "pooling window must tile the map exactly"
        blocks = x.reshape(n, c, h // s, s, w // s, s).transpose(0, 1, 2, 4, 3, 5)
        flat = blocks.reshape(n, c, h // s, w // s, s * s)
        idx = flat.argmax(axis=-1)
        self._cache = (x.shape, idx)
        return flat.max(axis=-1)

    def backward(self, dout: np.ndarray) -> np.ndarray:
        (n, c, h, w), idx = self._cache
        s = self.size
        flat = np.zeros((n, c, h // s, w // s, s * s), dtype=dout.dtype)
        np.put_along_axis(flat, idx[..., None], dout[..., None], axis=-1)
        blocks = flat.reshape(n, c, h // s, w // s, s, s).transpose(0, 1, 2, 4, 3, 5)
        return blocks.reshape(n, c, h, w)

    def params(self):
        return []


class Flatten:
    def __init__(self):
        self._shape = None

    def forward(self, x: np.ndarray) -> np.ndarray:
        self._shape = x.shape
        # Row-major over (C, H, W) so a JS port can use the same index order.
        return x.reshape(x.shape[0], -1)

    def backward(self, dout: np.ndarray) -> np.ndarray:
        return dout.reshape(self._shape)

    def params(self):
        return []


class Dense:
    def __init__(self, in_dim: int, out_dim: int, rng: np.random.Generator, name: str, gain: float = 2.0):
        self.name = name
        self.W = rng.normal(0.0, np.sqrt(gain / in_dim), size=(in_dim, out_dim)).astype(np.float32)
        self.b = np.zeros(out_dim, dtype=np.float32)
        self.dW = np.zeros_like(self.W)
        self.db = np.zeros_like(self.b)
        self._x = None

    def forward(self, x: np.ndarray) -> np.ndarray:
        self._x = x
        return x @ self.W + self.b

    def backward(self, dout: np.ndarray) -> np.ndarray:
        self.dW[...] = self._x.T @ dout
        self.db[...] = dout.sum(axis=0)
        return dout @ self.W.T

    def params(self):
        return [(self.W, self.dW), (self.b, self.db)]


class Dropout:
    """Inverted dropout. Inactive unless `train` is set on the forward call."""

    def __init__(self, p: float):
        self.p = p
        self._mask = None

    def forward(self, x: np.ndarray, train: bool = False) -> np.ndarray:
        if not train or self.p <= 0.0:
            self._mask = None
            return x
        keep = 1.0 - self.p
        self._mask = (np.random.random(x.shape) < keep).astype(x.dtype) / keep
        return x * self._mask

    def backward(self, dout: np.ndarray) -> np.ndarray:
        return dout if self._mask is None else dout * self._mask

    def params(self):
        return []


# --------------------------------------------------------------------------
# Loss
# --------------------------------------------------------------------------

def softmax_cross_entropy(logits: np.ndarray, y: np.ndarray):
    """Return (mean loss, dlogits, probabilities).

    Uses the log-sum-exp shift so large logits cannot overflow.
    """
    z = logits - logits.max(axis=1, keepdims=True)
    exp = np.exp(z)
    probs = exp / exp.sum(axis=1, keepdims=True)
    n = logits.shape[0]
    loss = float(-np.log(np.clip(probs[np.arange(n), y], 1e-12, None)).mean())
    dlogits = probs.copy()
    dlogits[np.arange(n), y] -= 1.0
    dlogits /= n
    return loss, dlogits, probs


# --------------------------------------------------------------------------
# Optimiser
# --------------------------------------------------------------------------

class Adam:
    """Adam with bias correction and optional decoupled weight decay."""

    def __init__(self, params, lr=1e-3, beta1=0.9, beta2=0.999, eps=1e-8, weight_decay=0.0):
        self.params = list(params)
        self.lr, self.b1, self.b2, self.eps = lr, beta1, beta2, eps
        self.wd = weight_decay
        self.m = [np.zeros_like(p) for p, _ in self.params]
        self.v = [np.zeros_like(p) for p, _ in self.params]
        self.t = 0

    def step(self, lr: float | None = None):
        self.t += 1
        lr = self.lr if lr is None else lr
        c1 = 1.0 - self.b1 ** self.t
        c2 = 1.0 - self.b2 ** self.t
        for i, (p, g) in enumerate(self.params):
            if self.wd:
                p -= lr * self.wd * p          # decoupled: not folded into m/v
            self.m[i] = self.b1 * self.m[i] + (1 - self.b1) * g
            self.v[i] = self.b2 * self.v[i] + (1 - self.b2) * (g * g)
            mhat = self.m[i] / c1
            vhat = self.v[i] / c2
            p -= lr * mhat / (np.sqrt(vhat) + self.eps)


# --------------------------------------------------------------------------
# Model
# --------------------------------------------------------------------------

class InclusionCNN:
    """conv8 -> pool -> conv16 -> pool -> dense32 -> dense2.

    Deliberately small: roughly 20k parameters, which is about what a few
    thousand 24x24 patches can support without memorising the training set.
    """

    def __init__(self, patch: int = 24, seed: int = 7, dropout: float = 0.4):
        rng = np.random.default_rng(seed)
        self.patch = patch
        side = patch // 4                      # two 2x2 pools
        self.conv1 = Conv2D(1, 8, 3, 1, rng, "conv1")
        self.relu1 = ReLU()
        self.pool1 = MaxPool2D(2)
        self.conv2 = Conv2D(8, 16, 3, 1, rng, "conv2")
        self.relu2 = ReLU()
        self.pool2 = MaxPool2D(2)
        self.flat = Flatten()
        self.fc1 = Dense(16 * side * side, 32, rng, "fc1")
        self.relu3 = ReLU()
        self.drop = Dropout(dropout)
        self.fc2 = Dense(32, 2, rng, "fc2", gain=1.0)
        self.layers = [self.conv1, self.relu1, self.pool1,
                       self.conv2, self.relu2, self.pool2,
                       self.flat, self.fc1, self.relu3, self.drop, self.fc2]

    def forward(self, x: np.ndarray, train: bool = False) -> np.ndarray:
        for layer in self.layers:
            x = layer.forward(x, train=train) if isinstance(layer, Dropout) else layer.forward(x)
        return x

    def backward(self, dout: np.ndarray) -> None:
        for layer in reversed(self.layers):
            dout = layer.backward(dout)

    def params(self):
        out = []
        for layer in self.layers:
            out.extend(layer.params())
        return out

    def num_params(self) -> int:
        return int(sum(p.size for p, _ in self.params()))

    # -- serialisation -----------------------------------------------------

    def state(self) -> dict:
        """Named tensors, row-major, ready to be written to JSON."""
        return {
            "conv1.W": self.conv1.W, "conv1.b": self.conv1.b,
            "conv2.W": self.conv2.W, "conv2.b": self.conv2.b,
            "fc1.W": self.fc1.W, "fc1.b": self.fc1.b,
            "fc2.W": self.fc2.W, "fc2.b": self.fc2.b,
        }

    def load_state(self, state: dict) -> None:
        self.conv1.W[...] = state["conv1.W"]
        self.conv1.b[...] = state["conv1.b"]
        self.conv2.W[...] = state["conv2.W"]
        self.conv2.b[...] = state["conv2.b"]
        self.fc1.W[...] = state["fc1.W"]
        self.fc1.b[...] = state["fc1.b"]
        self.fc2.W[...] = state["fc2.W"]
        self.fc2.b[...] = state["fc2.b"]
