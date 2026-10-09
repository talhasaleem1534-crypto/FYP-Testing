import os
import sys

import numpy as np
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.pop("ANTHROPIC_API_KEY", None)

from anomaly import telemetry as T  # noqa: E402
from anomaly.detector import AnomalyDetector  # noqa: E402
from anomaly.evaluate import evaluate  # noqa: E402
from anomaly.synthetic import make_normal  # noqa: E402
from chatbot import main as app_main  # noqa: E402

det = AnomalyDetector()
client = TestClient(app_main.app)


def test_model_artifacts_load():
    assert det.model is not None, det.load_error
    assert det.metrics is not None


# ── The five presets shown in the dashboard's fault-injection bench ───────────
PRESETS = {
    "normal":      ((18, 30, 0, 150, 80),   "HEALTHY",   None),
    "memory leak": ((22, 92, 1, 160, 90),   "ANOMALOUS", "memory_leak"),
    "cpu spike":   ((95, 35, 0, 140, 75),   "ANOMALOUS", "cpu_spike"),       # the shipped model missed this one
    "crash loop":  ((30, 40, 12, 120, 60),  "ANOMALOUS", "crash_loop"),
    "net flood":   ((20, 32, 0, 2400, 1900), "ANOMALOUS", "network_flood"),  # used to be labelled memory_leak
}


@pytest.mark.parametrize("name", PRESETS)
def test_dashboard_presets(name):
    values, status, factor = PRESETS[name]
    r = det.predict(*values)
    assert r["status"] == status, r
    assert r["is_anomaly"] == (status == "ANOMALOUS")
    assert r["dominant_factor"] == factor, r


@pytest.mark.parametrize("values", [(0.1, 3.5, 0, 0, 0), (0.8, 9, 0, 2, 1), (0.3, 18, 0, 1, 1), (0.2, 2.4, 0, 3, 2)])
def test_idle_healthy_containers_are_not_flagged(values):
    # The shipped model flagged 3 of these 4 as "memory_leak" because it never saw an idle container.
    assert det.predict(*values)["status"] == "HEALTHY"


def test_compound_degradation_is_caught_by_the_model_not_the_limits():
    r = det.predict(55, 62, 2, 550, 300)   # every metric under its hard limit
    assert r["status"] == "ANOMALOUS" and r["detected_by"] == "model"
    assert len(r["contributing_factors"]) >= 2


def test_result_contract():
    r = det.predict(18, 30, 0, 150, 80)
    assert -1.0 < r["score"] < 0.0 and r["threshold"] < 0.0
    assert set(r) >= {"status", "is_anomaly", "score", "threshold", "detected_by", "dominant_factor",
                      "contributing_factors", "message", "confidence"}


def test_false_positive_rate_on_fresh_healthy_data():
    df = make_normal(3000, np.random.default_rng(999))
    flagged = sum(det.predict(*row)["is_anomaly"] for row in df.itertuples(index=False))
    assert flagged / len(df) < 0.03          # the shipped model flagged ~8.3%


def test_hybrid_beats_each_part_alone():
    m = evaluate(det, seed=7, n_each=300, n_normal=1500)
    p = m["pooled"]
    assert p["hybrid"]["recall"] > p["model_only"]["recall"]
    assert p["hybrid"]["recall"] > p["hard_limits_only"]["recall"]
    assert m["false_positive_rate"]["idle_only"]["hybrid"] < 0.02
    assert m["recall_by_fault"]["compound_degradation"]["hard_limits_only"] == 0.0
    assert m["recall_by_fault"]["compound_degradation"]["model_only"] > 0.9


def test_without_a_model_it_falls_back_to_hard_limits(tmp_path):
    d = AnomalyDetector(str(tmp_path / "missing.pkl"))
    assert d.model is None and d.load_error
    ok = d.predict(18, 30, 0, 150, 80)
    assert ok["status"] == "HEALTHY" and ok["score"] is None and ok["confidence"] == "hard_limits_only"
    assert d.predict(95, 30, 0, 100, 50)["status"] == "ANOMALOUS"


def test_corrupt_model_is_reported_not_swallowed(tmp_path):
    bad = tmp_path / "anomaly_model.pkl"
    bad.write_bytes(b"not a pickle")
    d = AnomalyDetector(str(bad))
    assert d.model is None and "Error" in d.load_error or "error" in d.load_error.lower()


# ── Parsing docker output ────────────────────────────────────────────────────
def test_parsers():
    assert T.parse_percent("12.34%") == 12.34
    assert T.parse_percent("--") is None and T.parse_percent("") is None     # used to crash the whole scan
    assert T.parse_netio("1.2kB / 3.4MB") == (1.2, 3400.0)
    assert T.parse_size_kb("2GiB") == pytest.approx(2 * 1073741.824)
    assert T.parse_netio("--") is None and T.parse_netio("1.2kB") is None
    assert T.parse_started_at("2026-10-03T06:13:03.123456789Z").year == 2026
    assert T.parse_started_at("0001-01-01T00:00:00Z") is None


# ── Live collector with a fake docker ────────────────────────────────────────
class FakeDocker:
    """Scripted `docker stats` / `docker inspect` output; counters advance by `step` per stats call."""

    def __init__(self, containers):
        self.c = containers          # name -> dict(cpu, mem, rx_kb, tx_kb, step_rx, step_tx, restarts, started, label)
        self.calls = []

    def __call__(self, args, timeout):
        self.calls.append(args[0])
        if args[0] == "stats":
            lines = []
            for n, c in self.c.items():
                if c.get("dash"):
                    lines.append(f"{n}|--|--|0B / 0B")
                    continue
                c["rx_kb"] += c["step_rx"]; c["tx_kb"] += c["step_tx"]
                lines.append(f"{n}|{c['cpu']}%|{c['mem']}%|{c['rx_kb']:.1f}kB / {c['tx_kb']:.1f}kB")
            return "\n".join(lines)
        if args[0] == "inspect":
            names = args[3:]
            return "\n".join(f"/{n}|{self.c[n]['restarts']}|{self.c[n]['started']}|{self.c[n].get('label', '')}" for n in names if n in self.c)
        raise AssertionError(args)


def _collector(fake, clock_values):
    it = iter(clock_values)
    return T.DockerCollector(runner=fake, first_sample_delay=0, sleep=lambda s: None, clock=lambda: next(it))


def test_long_running_healthy_container_is_not_flagged():
    """350 MB / 120 MB lifetime traffic and 7 lifetime restarts used to read as flood + crash loop."""
    fake = FakeDocker({"web": dict(cpu=12, mem=30, rx_kb=350_000, tx_kb=120_000, step_rx=200, step_tx=100,
                                   restarts=7, started="2026-09-01T00:00:00Z")})
    col = _collector(fake, [1_791_007_000.0, 1_791_007_002.0, 1_791_007_012.0])
    r1 = col.scan(det.predict)["containers"][0]
    assert r1["status"] == "HEALTHY"
    assert r1["net_in_kb"] == pytest.approx(100.0)       # 200 KB over 2 s -> 100 KB/s
    assert r1["restart_count"] == 0 and r1["restart_count_lifetime"] == 7
    r2 = col.scan(det.predict)["containers"][0]          # container now known: no second sample needed
    assert r2["status"] == "HEALTHY" and r2["warming_up"] is False
    assert fake.calls.count("stats") == 3


def test_real_flood_and_crash_loop_are_still_caught():
    fake = FakeDocker({
        "flooded": dict(cpu=20, mem=30, rx_kb=0, tx_kb=0, step_rx=5000, step_tx=4000, restarts=0, started="2026-09-01T00:00:00Z"),
        "looping": dict(cpu=30, mem=40, rx_kb=0, tx_kb=0, step_rx=10, step_tx=5, restarts=9, started="2026-10-03T06:12:40Z"),
    })
    col = _collector(fake, [1_791_007_980.0, 1_791_007_982.0])   # 06:13:00Z, 20 s after "looping" started
    out = {c["container_name"]: c for c in col.scan(det.predict)["containers"]}
    assert out["flooded"]["status"] == "ANOMALOUS" and out["flooded"]["dominant_factor"] == "network_flood"
    assert out["looping"]["status"] == "ANOMALOUS" and out["looping"]["dominant_factor"] == "crash_loop"


def test_restart_window_uses_deltas_between_scans():
    tr = T.TelemetryTracker(window_s=600)
    from datetime import datetime, timezone
    now = datetime(2026, 10, 3, tzinfo=timezone.utc)
    old = datetime(2026, 9, 1, tzinfo=timezone.utc)
    assert tr.restarts_in_window("a", 0, 7, old, now) == 0          # first sighting, long-lived -> 0
    assert tr.restarts_in_window("a", 60, 7, old, now) == 0         # no new restarts
    assert tr.restarts_in_window("a", 120, 10, old, now) == 3       # 3 restarts since the baseline
    assert tr.restarts_in_window("a", 1000, 10, old, now) == 0      # they have aged out of the 10 min window
    assert tr.restarts_in_window("a", 1100, 2, old, now) == 0       # container recreated (counter reset)


def test_network_counter_reset_is_not_negative():
    tr = T.TelemetryTracker()
    tr.observe_net("a", 0, 1000, 1000)
    rx, tx = tr.observe_net("a", 2, 10, 10)    # counters went down -> container recreated
    assert rx == pytest.approx(5.0) and tx == pytest.approx(5.0)


def test_starting_container_with_dashes_does_not_break_the_scan():
    fake = FakeDocker({"ok": dict(cpu=10, mem=20, rx_kb=0, tx_kb=0, step_rx=10, step_tx=10, restarts=0, started="2026-09-01T00:00:00Z"),
                       "booting": dict(dash=True, restarts=0, started="2026-10-03T00:00:00Z")})
    res = _collector(fake, [1.0, 3.0]).scan(det.predict)
    assert [c["container_name"] for c in res["containers"]] == ["ok"] and res["skipped"] == ["booting"]


def test_scope_apps_only_returns_platform_containers():
    fake = FakeDocker({
        "paas-blog": dict(cpu=5, mem=10, rx_kb=0, tx_kb=0, step_rx=1, step_tx=1, restarts=0, started="2026-09-01T00:00:00Z", label="blog"),
        "traefik": dict(cpu=1, mem=3, rx_kb=0, tx_kb=0, step_rx=1, step_tx=1, restarts=0, started="2026-09-01T00:00:00Z"),
    })
    res = _collector(fake, [1.0, 3.0]).scan(det.predict, scope="apps")
    assert [c["container_name"] for c in res["containers"]] == ["paas-blog"]


# ── HTTP layer ───────────────────────────────────────────────────────────────
def test_predict_anomaly_endpoint():
    r = client.post("/predict-anomaly", json={"container_name": "x", "cpu_percent": 95, "mem_percent": 35,
                                              "restart_count": 0, "net_in_kb": 140, "net_out_kb": 75})
    assert r.status_code == 200 and r.json()["status"] == "ANOMALOUS" and r.json()["dominant_factor"] == "cpu_spike"


@pytest.mark.parametrize("raw", ['{"cpu_percent": -5, "mem_percent": 1}', '{"cpu_percent": Infinity, "mem_percent": 1}',
                                 '{"cpu_percent": NaN, "mem_percent": 1}', '{"cpu_percent": "abc", "mem_percent": 1}',
                                 '{"mem_percent": 1}'])
def test_predict_anomaly_rejects_garbage(raw):
    r = client.post("/predict-anomaly", content=raw, headers={"Content-Type": "application/json"})
    assert r.status_code == 422


def test_containers_endpoint_reports_docker_problems_in_body(monkeypatch):
    def boom(args, timeout):
        raise T.DockerUnavailable("Docker CLI not found.")
    monkeypatch.setattr(app_main, "collector", T.DockerCollector(runner=boom))
    j = client.get("/containers/anomaly").json()
    assert j["containers"] == [] and "not found" in j["error"] and j["error_code"] == "docker_unavailable"
    assert client.get("/containers/anomaly?scope=bogus").status_code == 422


def test_health_exposes_anomaly_model_state():
    h = client.get("/health").json()
    assert h["anomaly_model_loaded"] is True and h["anomaly_metrics"]["pooled"]["hybrid"]["recall"] > 0.9
