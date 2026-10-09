import os
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ.pop("ANTHROPIC_API_KEY", None)  # force the offline/heuristic path

from chatbot import llm_router  # noqa: E402
from chatbot.log_pattern_engine import explain_log  # noqa: E402
from chatbot.main import app  # noqa: E402
from traffic.predictor import TrafficPredictor  # noqa: E402

client = TestClient(app)


# ── Layer 1 ──────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("log", [
    "Error: listen EADDRINUSE: address already in use :::3000",
    "nginx: 502 Bad Gateway while connecting to upstream",
    "Error: getaddrinfo ENOTFOUND postgres-db",
    "EACCES: permission denied, open '/var/run/docker.sock'",
    "Cannot connect to the Docker daemon at unix:///var/run/docker.sock",
])
def test_pattern_engine_hits(log):
    assert explain_log(log)["handled_locally"] is True


def test_pattern_engine_miss():
    assert explain_log("TypeError: Cannot read properties of undefined")["handled_locally"] is False
    assert explain_log("")["handled_locally"] is False


# ── Heuristic router ─────────────────────────────────────────────────────────
@pytest.mark.parametrize("msg,app_name", [
    ("deploy my-blog to production", "my-blog"),
    ("Deploy my-store", "my-store"),          # used to be mangled to "my-sre"
    ("deploy photo-app", "photo-app"),        # used to be mangled to "pho-app"
    ("deploy my blog", "blog"),
    ("please deploy the app api-service now", "api-service"),
])
def test_deploy_parsing(msg, app_name):
    r = llm_router._heuristic_tool_fallback(msg)
    assert r["tool"] == "deploy_application" and r["input"]["app_name"] == app_name


def test_scale_parsing_and_clamping():
    r = llm_router._heuristic_tool_fallback("Scale portfolio-app to 2 replicas")
    assert r["tool"] == "scale_application" and r["input"] == {"app_name": "portfolio-app", "replicas": 2}
    assert llm_router._heuristic_tool_fallback("scale x 99")["input"]["replicas"] == 10
    assert llm_router._heuristic_tool_fallback("scale x 0")["input"]["replicas"] == 1


def test_status_parsing_and_no_false_positive():
    assert llm_router._heuristic_tool_fallback("status of my-blog")["input"]["app_name"] == "my-blog"
    assert llm_router._heuristic_tool_fallback("check my-blog status")["input"]["app_name"] == "my-blog"
    assert llm_router._heuristic_tool_fallback("check why my app is slow") is None


def test_sanitize_rejects_bad_tool_input():
    assert llm_router._sanitize_tool_call("rm_rf", {"app_name": "x"}) is None
    assert llm_router._sanitize_tool_call("deploy_application", {"app_name": "x; rm -rf /"}) is None
    ok = llm_router._sanitize_tool_call("scale_application", {"app_name": "Blog", "replicas": "50"})
    assert ok["input"] == {"app_name": "blog", "replicas": 10}


# ── Predictor ────────────────────────────────────────────────────────────────
def test_model_loads_and_predicts():
    p = TrafficPredictor()
    assert p.model is not None, p.load_error
    assert p.predict_next_minute(300, 290, 280, 250) > 0


def test_scaling_uses_ceil():
    p = TrafficPredictor()
    assert p.evaluate_scaling(120, 1, 120)["recommended_replicas"] == 1   # exactly one replica's capacity
    assert p.evaluate_scaling(121, 1, 120)["recommended_replicas"] == 2
    assert p.evaluate_scaling(5000, 1, 120)["recommended_replicas"] == 10  # capped
    assert p.evaluate_scaling(10, 3, 120)["decision"] == "SCALE_DOWN"
    assert p.evaluate_scaling(10, 1, 0)["recommended_replicas"] == 1       # no ZeroDivisionError


# ── HTTP API ─────────────────────────────────────────────────────────────────
def test_health_and_metrics():
    h = client.get("/health").json()
    assert h["status"] == "ok" and h["model_loaded"] is True
    assert b"ai_engine_requests_total" in client.get("/metrics").content


def test_predict_endpoint_validation():
    ok = client.post("/predict-traffic", json={"current_rate": 450, "lag_1m": 410, "lag_5m": 320, "lag_15m": 200})
    assert ok.status_code == 200 and ok.json()["decision"] in {"SCALE_UP", "SCALE_DOWN", "HOLD"}
    bad = client.post("/predict-traffic", json={"current_rate": 1, "lag_1m": 1, "lag_5m": 1, "lag_15m": 1,
                                                "capacity_per_replica": 0})
    assert bad.status_code == 422


def test_chat_layer1_and_help():
    r = client.post("/chat", json={"message": "listen EADDRINUSE: address already in use :::3000"}).json()
    assert r["source"] == "pattern_engine"
    r = client.post("/chat", json={"message": "hello there"}).json()
    assert r["source"] == "local_response"


# ── Claude path (mocked) ─────────────────────────────────────────────────────
class _Block:
    def __init__(self, **kw):
        self.__dict__.update(kw)


class _FakeClient:
    def __init__(self, content):
        self.messages = self
        self._content = content

    def create(self, **kwargs):
        return _Block(content=self._content)


def test_tool_call_after_leading_text_is_not_dropped(monkeypatch):
    """Claude usually says something *before* the tool call; that used to swallow the call."""
    content = [
        _Block(type="text", text="Sure, deploying that now."),
        _Block(type="tool_use", name="deploy_application", input={"app_name": "my-blog"}),
    ]
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    monkeypatch.setattr(llm_router, "_get_client", lambda key: _FakeClient(content))
    r = llm_router.handle_chat_message("please ship my-blog")
    assert r["source"] == "llm_tool_call" and r["input"] == {"app_name": "my-blog"}


def test_text_only_reply(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    monkeypatch.setattr(llm_router, "_get_client", lambda key: _FakeClient([_Block(type="text", text="Hello!")]))
    assert llm_router.handle_chat_message("what is traefik?")["message"] == "Hello!"
