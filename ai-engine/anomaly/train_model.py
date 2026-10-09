"""Train the container health anomaly detector (Isolation Forest).

Run:  cd ai-engine && python -m anomaly.train_model

The forest is trained ONLY on healthy telemetry (unsupervised). Healthy data is split
three ways so that nothing reported is measured on data the model has seen:

  train       fit the Isolation Forest
  validation  calibrate the decision thresholds (1% / 5% quantiles of healthy scores)
  test        measured by anomaly.evaluate together with freshly injected faults
"""
import json
import os
import sys
import warnings

import joblib
import numpy as np
from sklearn.ensemble import IsolationForest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from anomaly.detector import AnomalyDetector  # noqa: E402
from anomaly.evaluate import evaluate, format_report  # noqa: E402
from anomaly.synthetic import FEATURES, make_normal  # noqa: E402

ARTIFACTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "artifacts")
SEED = 42
TARGET_FPR = 0.01        # flag as ANOMALOUS below the 1st percentile of healthy scores
DEGRADING_FPR = 0.05     # DEGRADING band: below the 5th percentile of healthy scores


def train(artifacts_dir: str = ARTIFACTS_DIR, seed: int = SEED, n_normal: int = 8000):
    warnings.filterwarnings("ignore", category=UserWarning)
    os.makedirs(artifacts_dir, exist_ok=True)
    rng = np.random.default_rng(seed)

    healthy = make_normal(n_normal, rng)
    n_train, n_val = int(n_normal * 0.6), int(n_normal * 0.2)
    train_df = healthy.iloc[:n_train]
    val_df = healthy.iloc[n_train:n_train + n_val]

    model = IsolationForest(n_estimators=200, contamination="auto", random_state=seed, n_jobs=-1)
    model.fit(train_df)

    val_scores = model.score_samples(val_df)
    meta = {
        "threshold": float(np.quantile(val_scores, TARGET_FPR)),
        "degrading_threshold": float(np.quantile(val_scores, DEGRADING_FPR)),
        "target_fpr": TARGET_FPR,
        "degrading_fpr": DEGRADING_FPR,
        "center": {f: float(train_df[f].mean()) for f in FEATURES},
        "scale": {f: float(train_df[f].std()) for f in FEATURES},
        "train_rows": int(len(train_df)),
        "validation_rows": int(len(val_df)),
        "seed": seed,
    }

    joblib.dump(model, os.path.join(artifacts_dir, "anomaly_model.pkl"))
    with open(os.path.join(artifacts_dir, "anomaly_meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)

    detector = AnomalyDetector(os.path.join(artifacts_dir, "anomaly_model.pkl"))
    metrics = evaluate(detector, seed=seed + 1982)  # different seed from training data
    with open(os.path.join(artifacts_dir, "anomaly_metrics.json"), "w", encoding="utf-8") as f:
        json.dump(metrics, f, indent=2)
    return model, meta, metrics


if __name__ == "__main__":
    _, meta, metrics = train()
    print(f"Trained on {meta['train_rows']} healthy samples; thresholds calibrated on {meta['validation_rows']} more.")
    print(f"  ANOMALOUS below score {meta['threshold']:.4f}, DEGRADING below {meta['degrading_threshold']:.4f}")
    print(format_report(metrics))
    print(f"\nArtifacts written to {ARTIFACTS_DIR}")
