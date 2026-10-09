"""Fault-injection validation of the anomaly detector.

Fresh synthetic data (a different seed from training) is generated for each fault type
and the detector's verdicts are compared against the known ground truth, for three methods:

  model_only        Isolation Forest below the calibrated threshold
  hard_limits_only  fixed per-metric thresholds (the "simple alerting" baseline)
  hybrid            what the platform actually uses (model OR hard limit)

Run:  cd ai-engine && python -m anomaly.evaluate
"""
import json
import os
import sys
from typing import Any, Dict

import numpy as np
import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from anomaly.detector import HARD_LIMITS, AnomalyDetector  # noqa: E402
from anomaly.synthetic import FAULT_KINDS, FEATURES, make_faults, make_normal  # noqa: E402

METHODS = ["model_only", "hard_limits_only", "hybrid"]


def _limit_flags(df: pd.DataFrame) -> np.ndarray:
    flags = np.zeros(len(df), dtype=bool)
    for feat, (op, limit) in HARD_LIMITS.items():
        col = df[feat].to_numpy()
        flags |= (col > limit) if op == ">" else (col >= limit)
    return flags


def flag_all(det: AnomalyDetector, df: pd.DataFrame) -> Dict[str, np.ndarray]:
    """Vectorised version of AnomalyDetector.predict() used for evaluation."""
    clipped = df.copy()
    clipped["cpu_percent"] = clipped["cpu_percent"].clip(0, 100)
    clipped["mem_percent"] = clipped["mem_percent"].clip(0, 100)
    limits = np.asarray(_limit_flags(clipped), dtype=bool)
    model = np.asarray(det.model.score_samples(clipped[FEATURES]) < det.meta["threshold"], dtype=bool)
    return {"model_only": model, "hard_limits_only": limits, "hybrid": model | limits}


def evaluate(det: AnomalyDetector, seed: int = 2024, n_each: int = 500, n_normal: int = 2500) -> Dict[str, Any]:
    if det.model is None:
        raise RuntimeError(f"model not loaded: {det.load_error}")
    rng = np.random.default_rng(seed)
    normal = make_normal(n_normal, rng)
    idle = make_normal(1000, rng, idle_fraction=1.0)
    busy = make_normal(1000, rng, idle_fraction=0.0)
    faults = make_faults(n_each, rng)

    fpr = {}
    for label, df in (("all_healthy", normal), ("idle_only", idle), ("busy_only", busy)):
        flags = flag_all(det, df)
        fpr[label] = {m: round(float(flags[m].mean()), 4) for m in METHODS}

    recall: Dict[str, Dict[str, float]] = {}
    for kind in FAULT_KINDS:
        flags = flag_all(det, faults[kind])
        recall[kind] = {m: round(float(flags[m].mean()), 4) for m in METHODS}

    # Pooled precision/recall on a 1:1 mix of healthy and faulty samples.
    n_fault_total = n_each * len(FAULT_KINDS)
    nf = flag_all(det, normal.sample(n=n_fault_total, replace=True, random_state=seed))
    pooled = {}
    fault_flags = {m: np.concatenate([flag_all(det, faults[k])[m] for k in FAULT_KINDS]) for m in METHODS}
    for m in METHODS:
        tp = int(fault_flags[m].sum())
        fn = n_fault_total - tp
        fp = int(nf[m].sum())
        precision = tp / (tp + fp) if tp + fp else 0.0
        rec = tp / (tp + fn)
        f1 = 2 * precision * rec / (precision + rec) if precision + rec else 0.0
        pooled[m] = {"precision": round(precision, 4), "recall": round(rec, 4), "f1": round(f1, 4)}

    return {
        "seed": seed,
        "n_healthy_test": n_normal,
        "n_per_fault": n_each,
        "note": "Synthetic data. Precision assumes a 1:1 mix of healthy and faulty samples.",
        "false_positive_rate": fpr,
        "recall_by_fault": recall,
        "pooled": pooled,
    }


def format_report(m: Dict[str, Any]) -> str:
    lines = ["", f"Fault-injection validation (synthetic, seed={m['seed']}, {m['n_healthy_test']} healthy / {m['n_per_fault']} per fault)", ""]
    lines.append(f"{'False-positive rate':<26}{'model_only':>12}{'hard_limits':>13}{'hybrid':>10}")
    for k, v in m["false_positive_rate"].items():
        lines.append(f"  {k:<24}{v['model_only']:>12.1%}{v['hard_limits_only']:>13.1%}{v['hybrid']:>10.1%}")
    lines.append("")
    lines.append(f"{'Recall by injected fault':<26}{'model_only':>12}{'hard_limits':>13}{'hybrid':>10}")
    for k, v in m["recall_by_fault"].items():
        lines.append(f"  {k:<24}{v['model_only']:>12.1%}{v['hard_limits_only']:>13.1%}{v['hybrid']:>10.1%}")
    lines.append("")
    lines.append(f"{'Pooled (1:1 healthy:faulty)':<26}{'precision':>12}{'recall':>13}{'F1':>10}")
    for k, v in m["pooled"].items():
        lines.append(f"  {k:<24}{v['precision']:>12.1%}{v['recall']:>13.1%}{v['f1']:>10.1%}")
    return "\n".join(lines)


if __name__ == "__main__":
    detector = AnomalyDetector()
    result = evaluate(detector)
    print(format_report(result))
