"""Train the traffic forecaster.

Run from the ai-engine directory:  python -m traffic.models.train_scaler_model
"""
import json
import os
import sys

import joblib
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, r2_score

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # .../ai-engine
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from traffic.data.generate_traffic_data import generate_traffic_dataset  # noqa: E402

DATA_PATH = os.path.join(ROOT, "traffic", "data", "traffic_data.csv")
MODEL_PATH = os.path.join(ROOT, "traffic", "artifacts", "scaler_model.pkl")
FEATURES = ["traffic", "lag_1m", "lag_5m", "lag_15m"]


def train_and_export_model(data_path: str = DATA_PATH, model_output_path: str = MODEL_PATH):
    if os.path.exists(data_path):
        df = pd.read_csv(data_path)
    else:
        df = generate_traffic_dataset(output_path=data_path)

    X, y = df[FEATURES], df["target_traffic"]

    # Time-ordered split. A random shuffle would let the model train on minutes
    # that sit right next to the test minutes (lag features overlap) and inflate R2.
    split = int(len(df) * 0.8)
    X_train, X_test = X.iloc[:split], X.iloc[split:]
    y_train, y_test = y.iloc[:split], y.iloc[split:]

    model = RandomForestRegressor(n_estimators=100, max_depth=10, random_state=42, n_jobs=-1)
    model.fit(X_train, y_train)

    preds = model.predict(X_test)
    naive = X_test["traffic"]  # baseline: "next minute = this minute"
    metrics = {
        "split": "chronological 80/20",
        "train_rows": int(len(X_train)),
        "test_rows": int(len(X_test)),
        "mae": round(float(mean_absolute_error(y_test, preds)), 3),
        "r2": round(float(r2_score(y_test, preds)), 4),
        "baseline_persistence_mae": round(float(mean_absolute_error(y_test, naive)), 3),
        "baseline_persistence_r2": round(float(r2_score(y_test, naive)), 4),
    }

    print("Model performance (held-out, chronological):")
    print(f"  RandomForest  MAE: {metrics['mae']:.2f} req/min   R2: {metrics['r2']:.4f}")
    print(f"  Persistence   MAE: {metrics['baseline_persistence_mae']:.2f} req/min   R2: {metrics['baseline_persistence_r2']:.4f}")

    os.makedirs(os.path.dirname(model_output_path), exist_ok=True)
    joblib.dump(model, model_output_path)
    metrics_path = os.path.splitext(model_output_path)[0] + ".metrics.json"
    with open(metrics_path, "w", encoding="utf-8") as f:
        json.dump(metrics, f, indent=2)
    print(f"Model saved to {model_output_path}")
    return model, metrics


if __name__ == "__main__":
    train_and_export_model()
