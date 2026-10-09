"""Container health anomaly detector: Isolation Forest + hard safety limits.

Why both?  An Isolation Forest trained only on healthy telemetry is good at "this
combination of metrics is unusual", but a fault that is extreme in just ONE metric
(e.g. CPU 95% while everything else is normal) is not guaranteed to score below the
decision threshold. Hard limits catch those cases deterministically; the forest adds
the unusual-combination cases the limits cannot express.

Result `status`:
  HEALTHY    - score is typical of healthy containers
  DEGRADING  - not flagged, but less typical than ~95% of healthy samples (watch it)
  ANOMALOUS  - flagged by the model (score below the calibrated threshold) and/or a hard limit
`score` is scikit-learn's raw Isolation Forest score: always in (-1, 0), more negative = more anomalous.
"""
import json
import logging
import os
from typing import Any, Dict, List, Optional

import joblib
import pandas as pd

from .synthetic import FEATURES

logger = logging.getLogger("ai-engine.anomaly")

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_MODEL_PATH = os.path.join(HERE, "artifacts", "anomaly_model.pkl")

# (feature, comparison, limit)
HARD_LIMITS = {
    "cpu_percent":   (">", 85.0),
    "mem_percent":   (">", 82.0),
    "restart_count": (">=", 5.0),
    "net_in_kb":     (">", 1500.0),
    "net_out_kb":    (">", 1200.0),
}

FACTOR_FOR = {
    "cpu_percent": "cpu_spike",
    "mem_percent": "memory_leak",
    "restart_count": "crash_loop",
    "net_in_kb": "network_flood",
    "net_out_kb": "network_flood",
}
FACTOR_TEXT = {
    "cpu_spike": "CPU usage is far above normal",
    "memory_leak": "memory usage is far above normal (possible memory leak)",
    "crash_loop": "the container keeps restarting (possible crash loop)",
    "network_flood": "network traffic is far above normal",
    "unusual_combination": "no single metric is extreme, but the combination is unusual for a healthy container",
}
# Floors keep the normalised deviation meaningful for metrics that are almost constant when healthy.
SCALE_FLOOR = {"cpu_percent": 5.0, "mem_percent": 5.0, "restart_count": 0.5, "net_in_kb": 50.0, "net_out_kb": 30.0}


def hard_limit_hits(values: Dict[str, float]) -> List[str]:
    hits = []
    for feat, (op, limit) in HARD_LIMITS.items():
        v = values[feat]
        if (op == ">" and v > limit) or (op == ">=" and v >= limit):
            hits.append(feat)
    return hits


class AnomalyDetector:
    def __init__(self, model_path: Optional[str] = None):
        self.model_path = model_path or os.environ.get("ANOMALY_MODEL_PATH") or DEFAULT_MODEL_PATH
        art_dir = os.path.dirname(os.path.abspath(self.model_path))
        self.meta_path = os.path.join(art_dir, "anomaly_meta.json")
        self.metrics_path = os.path.join(art_dir, "anomaly_metrics.json")
        self.model = None
        self.meta: Dict[str, Any] = {}
        self.metrics: Optional[Dict[str, Any]] = None
        self.load_error: Optional[str] = None
        self._load()

    def _load(self) -> None:
        if not os.path.exists(self.model_path):
            self.load_error = f"model file not found: {self.model_path}"
            logger.warning("%s - running on hard limits only", self.load_error)
            return
        try:
            self.model = joblib.load(self.model_path)
            with open(self.meta_path, encoding="utf-8") as f:
                self.meta = json.load(f)
            for key in ("threshold", "degrading_threshold", "center", "scale"):
                if key not in self.meta:
                    raise ValueError(f"metadata is missing '{key}'")
        except Exception as e:  # sklearn version mismatch, corrupt pickle, missing metadata, ...
            self.model = None
            self.meta = {}
            self.load_error = f"{type(e).__name__}: {e}"
            logger.error("Could not load anomaly model (%s) - running on hard limits only. "
                         "Retrain with `python -m anomaly.train_model`.", self.load_error)
            return
        if os.path.exists(self.metrics_path):
            try:
                with open(self.metrics_path, encoding="utf-8") as f:
                    self.metrics = json.load(f)
            except (OSError, ValueError):
                self.metrics = None

    # ── scoring ────────────────────────────────────────────────────────────────
    def score(self, values: Dict[str, float]) -> float:
        row = pd.DataFrame([[values[f] for f in FEATURES]], columns=FEATURES)
        return float(self.model.score_samples(row)[0])

    def _deviations(self, values: Dict[str, float]) -> Dict[str, float]:
        """How many 'healthy standard deviations' above normal each metric is (positive side only)."""
        out = {}
        for f in FEATURES:
            scale = max(float(self.meta["scale"][f]), SCALE_FLOOR[f]) if self.meta else SCALE_FLOOR[f]
            center = float(self.meta["center"][f]) if self.meta else 0.0
            out[f] = max(0.0, (values[f] - center) / scale)
        return out

    def predict(
        self,
        cpu_percent: float,
        mem_percent: float,
        restart_count: float,
        net_in_kb: float,
        net_out_kb: float,
    ) -> Dict[str, Any]:
        values = {
            "cpu_percent": min(max(float(cpu_percent), 0.0), 100.0),
            "mem_percent": min(max(float(mem_percent), 0.0), 100.0),
            "restart_count": max(float(restart_count), 0.0),
            "net_in_kb": max(float(net_in_kb), 0.0),
            "net_out_kb": max(float(net_out_kb), 0.0),
        }
        limit_hits = hard_limit_hits(values)

        score = threshold = None
        model_flag = False
        degrading = False
        if self.model is not None:
            score = self.score(values)
            threshold = float(self.meta["threshold"])
            model_flag = score < threshold
            degrading = (not model_flag) and score < float(self.meta["degrading_threshold"])

        is_anomaly = model_flag or bool(limit_hits)
        if is_anomaly:
            status = "ANOMALOUS"
        elif degrading:
            status = "DEGRADING"
        else:
            status = "HEALTHY"

        if model_flag and limit_hits:
            detected_by = "model+hard_limit"
        elif model_flag:
            detected_by = "model"
        elif limit_hits:
            detected_by = "hard_limit"
        else:
            detected_by = None

        dominant = None
        contributing: List[str] = []
        if status != "HEALTHY":
            dev = self._deviations(values)
            ranked = sorted(dev.items(), key=lambda kv: kv[1], reverse=True)
            for feat, z in ranked:
                factor = FACTOR_FOR[feat]
                if z >= 3.0 and factor not in contributing:
                    contributing.append(factor)
            dominant = contributing[0] if contributing else "unusual_combination"

        if status == "HEALTHY":
            message = "Telemetry is within the normal range for a healthy container."
        elif status == "DEGRADING":
            message = ("Behaviour is less typical than most healthy containers - not an alarm yet, "
                       "but worth watching.")
        else:
            reason = FACTOR_TEXT[dominant]
            extra = f" (also: {', '.join(c.replace('_', ' ') for c in contributing[1:])})" if len(contributing) > 1 else ""
            message = f"Anomaly detected: {reason}{extra}."

        return {
            "status": status,
            "is_anomaly": is_anomaly,
            "score": round(score, 4) if score is not None else None,
            "threshold": round(threshold, 4) if threshold is not None else None,
            "degrading_threshold": round(float(self.meta["degrading_threshold"]), 4) if self.model is not None else None,
            "detected_by": detected_by,
            "dominant_factor": dominant,
            "contributing_factors": contributing,
            "message": message,
            "confidence": "model+hard_limits" if self.model is not None else "hard_limits_only",
        }
