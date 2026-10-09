"""Synthetic container telemetry used to train and validate the anomaly detector.

Feature units (these are what the live collector in telemetry.py produces too):
  cpu_percent    % of ONE core, as reported by `docker stats` (clipped to 0-100)
  mem_percent    % of the container memory limit (or host RAM if no limit)
  restart_count  restarts observed in the last few minutes (NOT the lifetime counter)
  net_in_kb      inbound  network rate in KB/s (NOT the cumulative byte counter)
  net_out_kb     outbound network rate in KB/s

Everything here is synthetic. It is a model of "what a healthy / faulty container
might look like", so results measured on it say how the detector behaves on these
scenarios, not how it will behave on any particular real workload.
"""
from typing import Dict

import numpy as np
import pandas as pd

FEATURES = ["cpu_percent", "mem_percent", "restart_count", "net_in_kb", "net_out_kb"]
FAULT_KINDS = ["memory_leak", "cpu_spike", "crash_loop", "network_flood", "compound_degradation"]


def make_normal(n: int, rng: np.random.Generator, idle_fraction: float = 0.35) -> pd.DataFrame:
    """Healthy containers: a mix of busy ones and idle ones (most real containers are idle most of the time)."""
    n_idle = int(round(n * idle_fraction))
    n_busy = n - n_idle

    busy = pd.DataFrame({
        "cpu_percent":   rng.normal(18, 8, n_busy).clip(0, 60),
        "mem_percent":   rng.normal(30, 10, n_busy).clip(5, 70),
        "restart_count": rng.choice([0, 1], n_busy, p=[0.96, 0.04]),
        "net_in_kb":     rng.exponential(150, n_busy).clip(0, 800),
        "net_out_kb":    rng.exponential(80, n_busy).clip(0, 500),
    })
    idle = pd.DataFrame({
        "cpu_percent":   np.abs(rng.normal(0.8, 1.2, n_idle)).clip(0, 10),
        "mem_percent":   rng.normal(12, 7, n_idle).clip(1, 40),
        "restart_count": rng.choice([0, 1], n_idle, p=[0.99, 0.01]),
        "net_in_kb":     rng.exponential(4, n_idle).clip(0, 60),
        "net_out_kb":    rng.exponential(3, n_idle).clip(0, 40),
    })
    df = pd.concat([busy, idle], ignore_index=True)
    return df.sample(frac=1, random_state=int(rng.integers(0, 2**31 - 1))).reset_index(drop=True)[FEATURES]


def make_fault(kind: str, n: int, rng: np.random.Generator) -> pd.DataFrame:
    if kind == "memory_leak":
        df = pd.DataFrame({
            "cpu_percent":   rng.normal(22, 5, n).clip(0, 60),
            "mem_percent":   rng.normal(87, 6, n).clip(75, 100),
            "restart_count": rng.choice([0, 1], n, p=[0.85, 0.15]),
            "net_in_kb":     rng.exponential(160, n).clip(0, 900),
            "net_out_kb":    rng.exponential(90, n).clip(0, 600),
        })
    elif kind == "cpu_spike":
        df = pd.DataFrame({
            "cpu_percent":   rng.normal(92, 4, n).clip(80, 100),
            "mem_percent":   rng.normal(35, 8, n).clip(5, 70),
            "restart_count": np.zeros(n),
            "net_in_kb":     rng.exponential(140, n).clip(0, 800),
            "net_out_kb":    rng.exponential(75, n).clip(0, 500),
        })
    elif kind == "crash_loop":
        df = pd.DataFrame({
            "cpu_percent":   rng.normal(25, 15, n).clip(0, 80),
            "mem_percent":   rng.normal(40, 20, n).clip(0, 100),
            "restart_count": rng.choice([5, 8, 12, 20], n),
            "net_in_kb":     rng.exponential(120, n).clip(0, 700),
            "net_out_kb":    rng.exponential(60, n).clip(0, 400),
        })
    elif kind == "network_flood":
        df = pd.DataFrame({
            "cpu_percent":   rng.normal(20, 8, n).clip(0, 60),
            "mem_percent":   rng.normal(32, 10, n).clip(5, 70),
            "restart_count": np.zeros(n),
            "net_in_kb":     rng.normal(2200, 300, n).clip(1500, 4000),
            "net_out_kb":    rng.normal(1800, 400, n).clip(1000, 4000),
        })
    elif kind == "compound_degradation":
        # Author-defined scenario: everything is moderately elevated AT THE SAME TIME,
        # but no single metric reaches a hard limit (cpu>85, mem>82, restarts>=5, net>1500/1200).
        df = pd.DataFrame({
            "cpu_percent":   rng.normal(55, 6, n).clip(40, 75),
            "mem_percent":   rng.normal(62, 5, n).clip(50, 75),
            "restart_count": rng.choice([1, 2, 3], n),
            "net_in_kb":     rng.normal(550, 100, n).clip(300, 900),
            "net_out_kb":    rng.normal(300, 60, n).clip(150, 500),
        })
    else:
        raise ValueError(f"unknown fault kind: {kind}")
    return df[FEATURES]


def make_faults(n_each: int, rng: np.random.Generator) -> Dict[str, pd.DataFrame]:
    return {k: make_fault(k, n_each, rng) for k in FAULT_KINDS}
