import json
import logging
import math
import os
from typing import Any, Dict, Literal, Optional

import joblib
import pandas as pd

logger = logging.getLogger("ai-engine.predictor")

ScaleDecision = Literal["SCALE_UP", "SCALE_DOWN", "HOLD"]

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_MODEL_PATH = os.path.join(HERE, "artifacts", "scaler_model.pkl")
FEATURES = ["traffic", "lag_1m", "lag_5m", "lag_15m"]
MIN_REPLICAS, MAX_REPLICAS = 1, 10


class TrafficPredictor:
    def __init__(self, model_path: Optional[str] = None):
        self.model_path = model_path or os.environ.get("TRAFFIC_MODEL_PATH") or DEFAULT_MODEL_PATH
        self.model = None
        self.load_error: Optional[str] = None
        self.metrics: Optional[Dict[str, Any]] = None
        self._load_model()

    def _load_model(self) -> None:
        if not os.path.exists(self.model_path):
            self.load_error = f"model file not found: {self.model_path}"
            logger.warning("%s - using heuristic fallback", self.load_error)
            return
        try:
            self.model = joblib.load(self.model_path)
        except Exception as e:  # e.g. pickle made with a different scikit-learn version
            self.model = None
            self.load_error = f"{type(e).__name__}: {e}"
            logger.error("Could not load %s (%s) - using heuristic fallback. "
                         "Retrain with `python -m traffic.models.train_scaler_model`.",
                         self.model_path, self.load_error)
            return

        metrics_path = os.path.splitext(self.model_path)[0] + ".metrics.json"
        if os.path.exists(metrics_path):
            try:
                with open(metrics_path, encoding="utf-8") as f:
                    self.metrics = json.load(f)
            except (OSError, ValueError):
                self.metrics = None

    def predict_next_minute(self, current_rate: float, lag_1m: float, lag_5m: float, lag_15m: float) -> float:
        if self.model is None:
            # Weighted moving-average fallback when the model artifact isn't usable.
            return (current_rate * 0.5) + (lag_1m * 0.3) + (lag_5m * 0.2)

        row = pd.DataFrame([[current_rate, lag_1m, lag_5m, lag_15m]], columns=FEATURES)
        return max(0.0, float(self.model.predict(row)[0]))

    def evaluate_scaling(
        self,
        predicted_traffic: float,
        current_replicas: int = 1,
        capacity_per_replica: float = 120.0,
    ) -> Dict[str, Any]:
        capacity = capacity_per_replica if capacity_per_replica and capacity_per_replica > 0 else 120.0
        required = max(MIN_REPLICAS, min(MAX_REPLICAS, math.ceil(predicted_traffic / capacity)))

        decision: ScaleDecision
        if required > current_replicas:
            decision = "SCALE_UP"
        elif required < current_replicas:
            decision = "SCALE_DOWN"
        else:
            decision = "HOLD"

        return {
            "predicted_traffic": round(predicted_traffic, 2),
            "current_replicas": current_replicas,
            "recommended_replicas": required,
            "decision": decision,
        }
