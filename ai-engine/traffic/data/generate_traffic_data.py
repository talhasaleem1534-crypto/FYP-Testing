import os

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUTPUT = os.path.join(HERE, "traffic_data.csv")


def generate_traffic_dataset(num_points: int = 8635, output_path: str = DEFAULT_OUTPUT) -> pd.DataFrame:
    """
    Generate synthetic web-traffic time-series data (one row per minute) with a daily
    cycle, noise and random bursts, plus lagged features (1m, 5m, 15m).
    """
    np.random.seed(42)
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)

    t = np.arange(num_points)
    daily_cycle = 200 + 150 * np.sin(2 * np.pi * t / (24 * 60))
    noise = np.random.normal(0, 20, num_points)

    spikes = np.zeros(num_points)
    spike_indices = np.random.choice(num_points, size=int(num_points * 0.03), replace=False)
    spikes[spike_indices] = np.random.uniform(100, 400, size=len(spike_indices))

    raw_traffic = np.maximum(10, daily_cycle + noise + spikes)

    df = pd.DataFrame({"traffic": raw_traffic})
    df["lag_1m"] = df["traffic"].shift(1)
    df["lag_5m"] = df["traffic"].shift(5)
    df["lag_15m"] = df["traffic"].shift(15)

    # Target: traffic one minute ahead
    df["target_traffic"] = df["traffic"].shift(-1)

    df = df.dropna()
    df.to_csv(output_path, index=False)
    print(f"Generated dataset with {len(df)} rows at {output_path}")
    return df


if __name__ == "__main__":
    generate_traffic_dataset()
