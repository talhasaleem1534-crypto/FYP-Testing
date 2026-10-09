import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, Optional

from dotenv import load_dotenv
import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest
from pydantic import BaseModel, Field

# Make `traffic` importable no matter which directory uvicorn is started from.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=True)

from anomaly.detector import AnomalyDetector  # noqa: E402
from anomaly.telemetry import DockerCollector, DockerError, DockerUnavailable  # noqa: E402
from chatbot.llm_router import MAX_REPLICAS, MIN_REPLICAS, auto_repair_dockerfile, handle_chat_message  # noqa: E402
from chatbot.log_pattern_engine import explain_log  # noqa: E402
from traffic.predictor import TrafficPredictor  # noqa: E402

app = FastAPI(
    title="Private PaaS Ops Copilot & AI Engine",
    description="Deterministic Pattern Diagnostics + LLM Tool Calling Router + Traffic Autoscaler",
    version="1.0.0",
)

_origins = os.environ.get("CORS_ORIGINS", "*")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if _origins == "*" else [o.strip() for o in _origins.split(",") if o.strip()],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

CORE_PLATFORM_URL = os.environ.get("CORE_PLATFORM_URL", "http://localhost:3000").rstrip("/")
# The backend requires a login on every route. From the same laptop (loopback) the engine is trusted
# automatically; from another container it proves itself with the shared INTERNAL_API_TOKEN.
_INTERNAL_TOKEN = os.environ.get("INTERNAL_API_TOKEN", "")
BACKEND_HEADERS = {"X-Internal-Token": _INTERNAL_TOKEN} if _INTERNAL_TOKEN else {}
predictor = TrafficPredictor()   # legacy traffic forecaster (no longer used by the dashboard)
detector = AnomalyDetector()
collector = DockerCollector()

REQUESTS = Counter("ai_engine_requests_total", "HTTP requests", ["method", "path", "status"])
LATENCY = Histogram("ai_engine_request_seconds", "HTTP request latency", ["path"])
PREDICTIONS = Counter("ai_engine_predictions_total", "Traffic predictions", ["decision"])
ANOMALY_VERDICTS = Counter("ai_engine_anomaly_verdicts_total", "Container health verdicts", ["status"])


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    # FastAPI's default 422 body echoes the offending input; for NaN/Infinity that is not valid
    # JSON and the encoder raises, turning a clean 422 into a 500. Return only loc/msg/type.
    detail = [{"loc": list(e.get("loc", [])), "msg": e.get("msg"), "type": e.get("type")} for e in exc.errors()]
    return JSONResponse(status_code=422, content={"detail": detail})


@app.middleware("http")
async def metrics_middleware(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    # Use the route template, not the raw URL, to keep label cardinality bounded.
    route = request.scope.get("route")
    path = getattr(route, "path", "unmatched")
    LATENCY.labels(path).observe(time.perf_counter() - start)
    REQUESTS.labels(request.method, path, str(response.status_code)).inc()
    return response


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=8000)
    log_text: Optional[str] = Field(default=None, max_length=50000)


class AnomalyRequest(BaseModel):
    container_name: str = Field(default="manual-input", max_length=200)
    cpu_percent: float = Field(ge=0, le=1000, allow_inf_nan=False)
    mem_percent: float = Field(ge=0, le=1000, allow_inf_nan=False)
    restart_count: float = Field(default=0, ge=0, le=100000, allow_inf_nan=False)
    net_in_kb: float = Field(default=0.0, ge=0, le=1e9, allow_inf_nan=False)    # KB/s
    net_out_kb: float = Field(default=0.0, ge=0, le=1e9, allow_inf_nan=False)   # KB/s


class LogExplainRequest(BaseModel):
    log_text: str = Field(max_length=50000)


class PredictTrafficRequest(BaseModel):
    current_rate: float = Field(ge=0)
    lag_1m: float = Field(ge=0)
    lag_5m: float = Field(ge=0)
    lag_15m: float = Field(ge=0)
    current_replicas: int = Field(default=1, ge=MIN_REPLICAS, le=MAX_REPLICAS)
    capacity_per_replica: float = Field(default=120.0, gt=0)
    app_id: Optional[str] = None
    auto_scale: bool = False


class AutoRepairRequest(BaseModel):
    dockerfile: str
    error_log: str
    repo_files: Optional[list] = []


def _body(response: httpx.Response) -> Any:
    """Return the JSON body, or the raw text/status when the backend didn't send JSON."""
    if response.status_code >= 300:
        return {"error": response.text, "status_code": response.status_code}
    try:
        return response.json()
    except ValueError:
        return {"status_code": response.status_code, "body": response.text}


@app.get("/health")
def health_check() -> Dict[str, Any]:
    return {
        "status": "ok",
        "service": "ai-engine",
        "model_loaded": predictor.model is not None,
        "model_error": predictor.load_error,
        "model_metrics": predictor.metrics,
        "anomaly_model_loaded": detector.model is not None,
        "anomaly_model_error": detector.load_error,
        "anomaly_metrics": detector.metrics,
        "llm_configured": bool(os.environ.get("GEMINI_API_KEY") or os.environ.get("ANTHROPIC_API_KEY")),
        "llm_provider": "gemini" if os.environ.get("GEMINI_API_KEY") else ("anthropic" if os.environ.get("ANTHROPIC_API_KEY") else "local_fallback"),
    }


@app.post("/auto-repair-dockerfile")
async def auto_repair_dockerfile_endpoint(req: AutoRepairRequest):
    result = await run_in_threadpool(
        auto_repair_dockerfile,
        req.dockerfile,
        req.error_log,
        req.repo_files,
    )
    return result


@app.get("/metrics")
def metrics() -> Response:
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.post("/predict-anomaly")
def predict_anomaly(req: AnomalyRequest):
    """Score one telemetry snapshot (net values are KB/s, restarts are 'in the last few minutes')."""
    verdict = detector.predict(req.cpu_percent, req.mem_percent, req.restart_count, req.net_in_kb, req.net_out_kb)
    ANOMALY_VERDICTS.labels(verdict["status"]).inc()
    return {
        "container_name": req.container_name,
        "cpu_percent": req.cpu_percent,
        "mem_percent": req.mem_percent,
        "restart_count": req.restart_count,
        "net_in_kb": req.net_in_kb,
        "net_out_kb": req.net_out_kb,
        **verdict,
    }


@app.get("/containers/anomaly")
def containers_anomaly_scan(scope: str = "all"):
    """
    Poll live Docker stats and score every running container.
    scope=all (default) scans every container; scope=apps only the ones deployed by this platform.
    Docker problems are reported in the body (`error`) with HTTP 200, which is what the dashboard expects.
    """
    if scope not in ("all", "apps"):
        raise HTTPException(status_code=422, detail="scope must be 'all' or 'apps'")
    try:
        result = collector.scan(detector.predict, scope=scope)
    except DockerUnavailable as e:
        return {"error": str(e), "error_code": "docker_unavailable", "containers": []}
    except DockerError as e:
        return {"error": str(e), "error_code": "docker_error", "containers": []}
    for c in result["containers"]:
        ANOMALY_VERDICTS.labels(c["status"]).inc()
    return result


@app.post("/explain-log")
def explain_log_endpoint(req: LogExplainRequest):
    return explain_log(req.log_text)


@app.post("/predict-traffic")
async def predict_traffic_endpoint(req: PredictTrafficRequest):
    pred = predictor.predict_next_minute(req.current_rate, req.lag_1m, req.lag_5m, req.lag_15m)
    result = predictor.evaluate_scaling(pred, req.current_replicas, req.capacity_per_replica)
    result["model_used"] = "random_forest" if predictor.model is not None else "heuristic_fallback"
    PREDICTIONS.labels(result["decision"]).inc()

    if req.auto_scale and req.app_id and result["decision"] != "HOLD":
        try:
            async with httpx.AsyncClient(timeout=10.0, headers=BACKEND_HEADERS) as client:
                r = await client.post(
                    f"{CORE_PLATFORM_URL}/applications/{req.app_id}/scale",
                    json={"replicas": result["recommended_replicas"]},
                )
                result["backend_sync"] = _body(r)
        except Exception as e:
            result["backend_sync_error"] = str(e)

    return result


@app.post("/chat")
async def chat(req: ChatRequest):
    # The router makes blocking network calls (Anthropic SDK), so keep it off the event loop.
    result = await run_in_threadpool(handle_chat_message, req.message, {"log_text": req.log_text})

    if result.get("handled_locally"):
        return {
            "source": "pattern_engine",
            "reply": f"🔍 {result['diagnosis']}\n💡 Suggested Fix: {result['fix']}",
            "diagnosis": result["diagnosis"],
            "fix": result["fix"],
        }

    if result.get("source") == "llm_tool_call":
        tool_name = result["tool"]
        tool_input = result.get("input", {})
        app_name = tool_input.get("app_name")
        base = f"{CORE_PLATFORM_URL}/applications/by-name/{app_name}"

        try:
            async with httpx.AsyncClient(timeout=15.0, headers=BACKEND_HEADERS) as client:
                if tool_name == "deploy_application":
                    r = await client.post(f"{base}/deploy")
                    ok = r.status_code < 300
                    reply = (
                        f"🚀 Deployment initiated for application '{app_name}'."
                        if ok
                        else f"❌ Could not deploy '{app_name}' (HTTP {r.status_code})."
                    )
                elif tool_name == "scale_application":
                    replicas = tool_input.get("replicas", 1)
                    r = await client.post(f"{base}/scale", json={"replicas": replicas})
                    ok = r.status_code < 300
                    reply = (
                        f"⚖️ Application '{app_name}' scaled to {replicas} replicas."
                        if ok
                        else f"❌ Could not scale '{app_name}' (HTTP {r.status_code})."
                    )
                elif tool_name == "get_deployment_status":
                    r = await client.get(f"{base}/status")
                    ok = r.status_code < 300
                    reply = (
                        f"📊 Retrieved status for '{app_name}'."
                        if ok
                        else f"❌ Could not get status for '{app_name}' (HTTP {r.status_code})."
                    )
                else:
                    return {"source": "llm_text", "reply": f"Unknown tool '{tool_name}'."}

            return {
                "source": "llm_tool_call",
                "tool": tool_name,
                "reply": reply,
                "api_response": _body(r),
            }
        except Exception as e:
            return {
                "source": "llm_tool_call_failed",
                "tool": tool_name,
                "reply": f"⚠️ Intended to run {tool_name} for '{app_name}', but the backend call failed: {e}",
            }

    return {
        "source": result.get("source", "llm_text"),
        "reply": result.get("message") or "I could not process your request.",
    }
