"""
Learns the cut or hold policy by reinforcement, instead of hand setting it.

The gate that runs before the saw used to be a table of thresholds a person
chose. This replaces that table with a policy learned from outcomes.

Setup, in the usual terms:

    state   what the scan and the plan say about one stone: how much of the
            outline is flawed, how close the nearest flaw is to the rim, how
            decisive the model was, the clarity, the size
    action  cut it, or hold it
    reward  cut a stone that passes and you earn its value
            cut a stone that comes back and you lose the rough and the wheel time
            hold a stone that would have passed and you lose the margin you did
            not make, which is a real cost and is charged here
            hold a stone that would have come back and you save the loss

    algorithm  REINFORCE with a learned baseline, which is policy gradient in
               its plainest form. The policy is a small linear model over the
               state, so every weight can be read and argued with.

Where the outcomes come from matters, so it is stated plainly. Until a factory
returns real cut results, the reward is produced by a simulator built from the
same evidence the gate sees. That is enough to learn the shape of a sensible
policy and to prove the loop runs end to end. The moment real outcomes exist
they replace the simulator, and nothing else in this file changes: that is why
`sample_outcome` is the only place the environment is defined.
"""

from __future__ import annotations

import json
import os
import time

import numpy as np

np.seterr(divide="ignore", over="ignore", invalid="ignore")

ART = os.path.join(os.path.dirname(os.path.abspath(__file__)), "artifacts")

FEATURES = [
    "flaw_coverage",     # fraction of the planned outline the model calls flawed
    "rim_proximity",     # 1 when a flaw sits on the rim, 0 when the rim is clear
    "uncertainty",       # 1 minus how decisive the model was
    "clarity_penalty",   # grades below the buyer's floor, scaled
    "size_shortfall",    # how far under the minimum economic size
    "bias",
]

CLARITY_ORDER = ["FL", "IF", "VVS1", "VVS2", "VS1", "VS2", "SI1", "SI2", "I1", "I2", "I3"]
CLARITY_FLOOR = "SI2"
MIN_CARAT = 0.30
RIM_CLEARANCE_MM = 0.35


def featurise(stone: dict) -> np.ndarray:
    cov = float(stone.get("flaw_coverage", 0.0))
    nearest = stone.get("nearest_flaw_mm")
    rim = 0.0 if nearest is None else max(0.0, (RIM_CLEARANCE_MM - float(nearest)) / RIM_CLEARANCE_MM)
    conf = float(stone.get("model_confidence", 0.5))
    ci = CLARITY_ORDER.index(stone.get("clarity", "SI2")) if stone.get("clarity") in CLARITY_ORDER else 7
    floor = CLARITY_ORDER.index(CLARITY_FLOOR)
    clarity_pen = max(0, ci - floor) / 3.0
    carat = float(stone.get("carat", 1.0))
    size_short = max(0.0, (MIN_CARAT - carat) / MIN_CARAT)
    return np.array([
        min(cov / 0.06, 2.0),
        rim,
        (1.0 - conf) * 2.0,
        clarity_pen,
        size_short,
        1.0,
    ], dtype=np.float64)


def sample_outcome(stone: dict, rng: np.random.Generator) -> bool:
    """
    Would this stone pass if it were cut.

    The only place the environment lives. Replace the body with a lookup into
    real cut results and the learner is training on the factory instead of on a
    simulation, with no other change.
    """
    cov = float(stone.get("flaw_coverage", 0.0))
    nearest = stone.get("nearest_flaw_mm")
    rim = 0.0 if nearest is None else max(0.0, (RIM_CLEARANCE_MM - float(nearest)) / RIM_CLEARANCE_MM)
    ci = CLARITY_ORDER.index(stone.get("clarity", "SI2")) if stone.get("clarity") in CLARITY_ORDER else 7
    floor = CLARITY_ORDER.index(CLARITY_FLOOR)

    risk = 0.0
    risk += min(1.0, cov / 0.05) * 0.60          # flaws inside the outline
    risk += rim * 0.55                            # chipping while bruting
    risk += max(0, ci - floor) * 0.22             # buyer rejects the grade
    risk += 0.55 if float(stone.get("carat", 1.0)) < MIN_CARAT else 0.0
    risk += (1.0 - float(stone.get("model_confidence", 0.5))) * 0.30
    return rng.random() > min(0.97, risk)


def reward(action: int, passed: bool, value: float, rough_cost: float, wheel_cost: float) -> float:
    """
    Money, in the units the factory actually feels.

    A stone that comes back does not just lose the rough and the wheel time. It
    is freighted twice, it is re-graded, and it is argued about, so the return
    is charged at more than the sum of its parts. That asymmetry is the whole
    reason a gate exists: cutting is cheap to do and expensive to get wrong.
    """
    if action == 1:                                   # cut
        if passed:
            return value - wheel_cost
        return -(rough_cost + wheel_cost + 0.30 * value)   # return handling
    # hold: nothing lost, but the margin not made is real
    return -0.18 * value if passed else 0.0


def make_stone(rng: np.random.Generator) -> dict:
    clarity = CLARITY_ORDER[int(rng.integers(1, len(CLARITY_ORDER)))]
    carat = float(np.round(rng.uniform(0.12, 4.0), 2))
    has_rim_flaw = rng.random() < 0.45
    return {
        "flaw_coverage": float(abs(rng.normal(0.02, 0.03))),
        "nearest_flaw_mm": float(abs(rng.normal(0.30, 0.35))) if has_rim_flaw else None,
        "model_confidence": float(np.clip(rng.normal(0.82, 0.12), 0.4, 0.99)),
        "clarity": clarity,
        "carat": carat,
        "value": float(max(200.0, carat * rng.uniform(1200, 9000))),
    }


def policy_prob(w: np.ndarray, x: np.ndarray) -> float:
    """Probability of cutting, from a logistic over the state."""
    z = float(np.dot(w, x))
    z = max(-30.0, min(30.0, z))
    return 1.0 / (1.0 + np.exp(-z))


def train(episodes: int = 60000, lr: float = 0.06, seed: int = 5):
    rng = np.random.default_rng(seed)
    w = np.zeros(len(FEATURES))
    w[-1] = 0.5                      # start near indifferent, then learn where to hold
    baseline = 0.0
    history = []
    window = []

    for ep in range(1, episodes + 1):
        stone = make_stone(rng)
        x = featurise(stone)
        p_cut = policy_prob(w, x)
        action = 1 if rng.random() < p_cut else 0

        passed = sample_outcome(stone, rng)
        value = stone["value"]
        r = reward(action, passed, value, rough_cost=0.55 * value, wheel_cost=0.08 * value)
        r_scaled = r / max(value, 1.0)            # keep the gradient scale sane

        # REINFORCE with a moving baseline
        baseline = 0.99 * baseline + 0.01 * r_scaled
        advantage = r_scaled - baseline
        grad_log = (action - p_cut) * x
        w += lr * advantage * grad_log

        window.append(r_scaled)
        if ep % 500 == 0:
            history.append({
                "episode": ep,
                "mean_reward": round(float(np.mean(window)), 4),
                "cut_rate": round(float(np.mean([1 if policy_prob(w, featurise(make_stone(rng))) > 0.5 else 0
                                                 for _ in range(200)])), 3),
            })
            window = []

    return w, history


def evaluate(w: np.ndarray, trials: int = 6000, seed: int = 99):
    """Compare the learned policy against the hand set thresholds it replaces."""
    rng = np.random.default_rng(seed)
    learned = 0.0
    threshold = 0.0
    always_cut = 0.0

    for _ in range(trials):
        stone = make_stone(rng)
        x = featurise(stone)
        value = stone["value"]
        rough_cost, wheel_cost = 0.55 * value, 0.08 * value
        passed = sample_outcome(stone, rng)

        a_learned = 1 if policy_prob(w, x) > 0.5 else 0
        learned += reward(a_learned, passed, value, rough_cost, wheel_cost)

        # the old table: cut unless any single threshold is tripped
        cov = stone["flaw_coverage"]
        nearest = stone["nearest_flaw_mm"]
        ci = CLARITY_ORDER.index(stone["clarity"])
        trip = (cov > 0.055
                or (nearest is not None and nearest < RIM_CLEARANCE_MM)
                or ci > CLARITY_ORDER.index(CLARITY_FLOOR)
                or stone["carat"] < MIN_CARAT)
        threshold += reward(0 if trip else 1, passed, value, rough_cost, wheel_cost)

        always_cut += reward(1, passed, value, rough_cost, wheel_cost)

    return {
        "learned_policy": round(learned / trials, 2),
        "threshold_table": round(threshold / trials, 2),
        "cut_everything": round(always_cut / trials, 2),
        "trials": trials,
        "units": "average money per stone, in the same units as stone value",
    }


def main():
    os.makedirs(ART, exist_ok=True)
    t0 = time.time()
    print("learning the cut or hold policy by reinforcement")
    w, history = train()
    scores = evaluate(w)

    print("\n  learned policy   ", scores["learned_policy"])
    print("  threshold table  ", scores["threshold_table"])
    print("  cut everything   ", scores["cut_everything"])

    out = {
        "method": "REINFORCE policy gradient with a moving baseline",
        "policy": "logistic over a linear state, so every weight is readable",
        "features": FEATURES,
        "weights": [round(float(v), 5) for v in w],
        "episodes": 60000,
        "environment": "simulator built from the same evidence the gate sees, replaced by real cut outcomes when a factory supplies them",
        "comparison": scores,
        "history": history,
        "trained_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "wall_seconds": round(time.time() - t0, 1),
    }
    with open(os.path.join(ART, "policy.json"), "w") as fh:
        json.dump(out, fh, indent=2)
    print(f"\n  weights {[round(float(v), 3) for v in w]}")
    print(f"  written to {os.path.join(ART, 'policy.json')}")


if __name__ == "__main__":
    main()
