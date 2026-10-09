"""Live container telemetry from the Docker CLI, converted to the units the model was trained on.

`docker stats` and `docker inspect` report LIFETIME counters:
  * NetIO is the total bytes received/sent since the container started
  * RestartCount is the total number of restarts since the container was created
A healthy container that has been up for a day therefore looks like a "network flood" and a
"crash loop" if those numbers are fed to the model directly. The tracker below turns them into
KB/s and restarts-in-the-last-N-minutes by comparing consecutive scans.
"""
import re
import subprocess
import threading
import time
from collections import deque
from datetime import datetime, timezone
from typing import Any, Callable, Deque, Dict, List, Optional, Tuple

RESTART_WINDOW_S = 600  # a restart counts toward "crash loop" for 10 minutes

# `docker stats` prints decimal units for NetIO (kB, MB, GB) and binary for memory (MiB); accept both.
_UNITS_KB = {
    "b": 1 / 1000, "kb": 1.0, "mb": 1000.0, "gb": 1e6, "tb": 1e9,
    "kib": 1.024, "mib": 1048.576, "gib": 1073741.824, "tib": 1.099511627776e9,
}


class DockerError(Exception):
    pass


class DockerUnavailable(DockerError):
    pass


def parse_percent(s: str) -> Optional[float]:
    """'12.34%' -> 12.34 ; '--' / '' -> None (docker prints '--' while a container starts or stops)."""
    try:
        return float((s or "").replace("%", "").strip())
    except ValueError:
        return None


def parse_size_kb(s: str) -> Optional[float]:
    m = re.fullmatch(r"\s*([\d.]+)\s*([A-Za-z]*)\s*", s or "")
    if not m:
        return None
    unit = (m.group(2) or "b").lower()
    if unit not in _UNITS_KB:
        return None
    try:
        return float(m.group(1)) * _UNITS_KB[unit]
    except ValueError:
        return None


def parse_netio(s: str) -> Optional[Tuple[float, float]]:
    """'1.2kB / 3.4MB' -> (rx_total_kb, tx_total_kb)."""
    parts = [p.strip() for p in (s or "").split("/")]
    if len(parts) != 2:
        return None
    rx, tx = parse_size_kb(parts[0]), parse_size_kb(parts[1])
    return (rx, tx) if rx is not None and tx is not None else None


def parse_started_at(s: str) -> Optional[datetime]:
    """Docker prints RFC3339 with nanoseconds ('2026-10-03T06:13:03.123456789Z'); Python wants <= 6 digits."""
    if not s or s.startswith("0001-01-01"):
        return None
    s = re.sub(r"(\.\d{6})\d+", r"\1", s.strip()).replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


class TelemetryTracker:
    """Per-container history: last network counters and recent RestartCount values."""

    def __init__(self, window_s: int = RESTART_WINDOW_S):
        self.window_s = window_s
        self._lock = threading.Lock()
        self._net: Dict[str, Tuple[float, float, float]] = {}            # name -> (ts, rx_kb, tx_kb)
        self._restarts: Dict[str, Deque[Tuple[float, int]]] = {}         # name -> [(ts, RestartCount)]

    def has_net(self, name: str) -> bool:
        with self._lock:
            return name in self._net

    def observe_net(self, name: str, ts: float, rx_kb: float, tx_kb: float) -> Optional[Tuple[float, float]]:
        """Store the sample; return (rx_kb_per_s, tx_kb_per_s) vs the previous one, or None on first sight."""
        with self._lock:
            prev = self._net.get(name)
            self._net[name] = (ts, rx_kb, tx_kb)
        if prev is None:
            return None
        dt = max(ts - prev[0], 0.5)
        # A counter that went DOWN means the container was recreated: its new total is all new traffic.
        rx = (rx_kb - prev[1]) / dt if rx_kb >= prev[1] else rx_kb / dt
        tx = (tx_kb - prev[2]) / dt if tx_kb >= prev[2] else tx_kb / dt
        return max(rx, 0.0), max(tx, 0.0)

    def restarts_in_window(self, name: str, ts: float, count: int, started_at: Optional[datetime], now: datetime) -> int:
        with self._lock:
            hist = self._restarts.setdefault(name, deque())
            if hist and count < hist[-1][1]:   # container recreated -> counter restarted from 0
                hist.clear()
            first_sighting = not hist
            hist.append((ts, count))
            while len(hist) > 1 and hist[1][0] <= ts - self.window_s:
                hist.popleft()                  # keep one baseline sample at/before the window start
            baseline = hist[0][1]
        if not first_sighting:
            return max(count - baseline, 0)
        # First time we see this container: no history, so use its uptime. A container that has been
        # up longer than the window has not (recently) crash-looped, whatever its lifetime counter says.
        if started_at is not None:
            uptime = (now - started_at).total_seconds()
            if 0 <= uptime < self.window_s:      # negative uptime = clock skew: treat as unknown
                return count
        return 0

    def forget_missing(self, present: List[str]) -> None:
        keep = set(present)
        with self._lock:
            for d in (self._net, self._restarts):
                for name in [n for n in d if n not in keep]:
                    del d[name]


Runner = Callable[[List[str], float], str]


def default_runner(args: List[str], timeout: float) -> str:
    try:
        proc = subprocess.run(["docker", *args], capture_output=True, text=True, timeout=timeout)
    except FileNotFoundError:
        raise DockerUnavailable("Docker CLI not found. Is Docker installed and on the PATH of the AI engine?")
    except subprocess.TimeoutExpired:
        raise DockerError("Docker command timed out")
    if proc.returncode != 0:
        msg = (proc.stderr or proc.stdout or "").strip()
        if "Cannot connect to the Docker daemon" in msg or "error during connect" in msg or "permission denied" in msg.lower():
            raise DockerUnavailable(msg.splitlines()[0] if msg else "Docker daemon not reachable")
        raise DockerError(msg or f"docker {args[0]} failed")
    return proc.stdout


class DockerCollector:
    def __init__(
        self,
        runner: Runner = default_runner,
        tracker: Optional[TelemetryTracker] = None,
        first_sample_delay: float = 2.0,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.time,
    ):
        self.runner = runner
        self.tracker = tracker or TelemetryTracker()
        self.first_sample_delay = first_sample_delay
        self.sleep = sleep
        self.clock = clock
        self._scan_lock = threading.Lock()

    def _stats(self) -> Tuple[float, List[Dict[str, Any]], List[str]]:
        out = self.runner(["stats", "--no-stream", "--format", "{{.Name}}|{{.CPUPerc}}|{{.MemPerc}}|{{.NetIO}}"], 30)
        ts = self.clock()
        rows: List[Dict[str, Any]] = []
        skipped: List[str] = []
        for line in out.splitlines():
            parts = line.strip().split("|")
            if len(parts) != 4:
                continue
            name = parts[0]
            cpu, mem, net = parse_percent(parts[1]), parse_percent(parts[2]), parse_netio(parts[3])
            if cpu is None or mem is None or net is None:
                skipped.append(name)  # '--' while the container is starting/stopping
                continue
            rows.append({"name": name, "cpu": cpu, "mem": mem, "rx": net[0], "tx": net[1]})
        return ts, rows, skipped

    def _inspect(self, names: List[str]) -> Dict[str, Dict[str, Any]]:
        if not names:
            return {}
        fmt = '{{.Name}}|{{.RestartCount}}|{{.State.StartedAt}}|{{index .Config.Labels "paas.app"}}'
        out = self.runner(["inspect", "--format", fmt, *names], 30)
        info: Dict[str, Dict[str, Any]] = {}
        for line in out.splitlines():
            parts = line.strip().split("|")
            if len(parts) < 4:
                continue
            try:
                count = int(parts[1])
            except ValueError:
                count = 0
            info[parts[0].lstrip("/")] = {"restarts": count, "started_at": parse_started_at(parts[2]), "paas_app": parts[3] or None}
        return info

    def scan(self, predict: Callable[..., Dict[str, Any]], scope: str = "all") -> Dict[str, Any]:
        """Collect one telemetry snapshot per running container and score it with `predict`."""
        with self._scan_lock:
            ts, rows, skipped = self._stats()
            # Rates need two samples. For containers we haven't seen before, take the second one now.
            first_seen = [r["name"] for r in rows if not self.tracker.has_net(r["name"])]
            for r in rows:
                self.tracker.observe_net(r["name"], ts, r["rx"], r["tx"])
            rates: Dict[str, Optional[Tuple[float, float]]] = {}
            if first_seen:
                self.sleep(self.first_sample_delay)
                ts, rows, more_skipped = self._stats()
                skipped = sorted(set(skipped) | set(more_skipped))
            for r in rows:
                rates[r["name"]] = self.tracker.observe_net(r["name"], ts, r["rx"], r["tx"])

            info = self._inspect([r["name"] for r in rows])
            self.tracker.forget_missing([r["name"] for r in rows])
            now_dt = datetime.fromtimestamp(ts, tz=timezone.utc)

            containers = []
            for r in rows:
                name = r["name"]
                meta = info.get(name, {"restarts": 0, "started_at": None, "paas_app": None})
                if scope == "apps" and not meta["paas_app"]:
                    continue
                rate = rates.get(name)
                restarts = self.tracker.restarts_in_window(name, ts, meta["restarts"], meta["started_at"], now_dt)
                rx_kbps, tx_kbps = rate if rate else (0.0, 0.0)
                verdict = predict(r["cpu"], r["mem"], restarts, rx_kbps, tx_kbps)
                containers.append({
                    "container_name": name,
                    "paas_app": meta["paas_app"],
                    "cpu_percent": round(r["cpu"], 2),
                    "mem_percent": round(r["mem"], 2),
                    "restart_count": restarts,
                    "restart_count_lifetime": meta["restarts"],
                    "net_in_kb": round(rx_kbps, 1),
                    "net_out_kb": round(tx_kbps, 1),
                    "warming_up": rate is None,
                    **verdict,
                })
            return {
                "containers": containers,
                "skipped": skipped,
                "scanned_at": datetime.now(timezone.utc).isoformat(),
                "units": {"net": "KB/s", "restart_count": f"restarts in last {self.tracker.window_s // 60} min"},
            }
