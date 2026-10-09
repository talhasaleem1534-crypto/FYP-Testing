import json
import logging
import os
import re
from pathlib import Path
from typing import Any, Dict, Optional

from dotenv import load_dotenv
import httpx

load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=True)

from .log_pattern_engine import explain_log
from .tool_schemas import TOOLS

try:
    import anthropic

    HAS_ANTHROPIC = True
except ImportError:
    HAS_ANTHROPIC = False

logger = logging.getLogger("ai-engine.router")

DEFAULT_MODEL = "claude-sonnet-5-5"
MIN_REPLICAS, MAX_REPLICAS = 1, 10
KNOWN_TOOLS = {t["name"] for t in TOOLS}

_APP = r"([a-z0-9][a-z0-9_-]*)"
_FILLER = r"(?:(?:the|my)\s+)?(?:(?:application|app)\s+)?"

_DEPLOY_RE = re.compile(rf"\bdeploy\s+{_FILLER}{_APP}")
_SCALE_RE = re.compile(rf"\bscale\s+{_FILLER}{_APP}\s+(?:up\s+|down\s+)?(?:to\s+)?(\d+)")
_STATUS_RE_1 = re.compile(rf"\bstatus\s+(?:of\s+|for\s+)?{_FILLER}{_APP}")
_STATUS_RE_2 = re.compile(rf"\b(?:check|show|get)\s+{_FILLER}{_APP}\s+status\b")

_NOT_AN_APP = {"my", "the", "app", "application", "to", "it", "this", "that", "now", "please"}

_client = None


def _get_client(api_key: str):
    global _client
    if _client is None:
        _client = anthropic.Anthropic(api_key=api_key, timeout=30.0, max_retries=1)
    return _client


def _clamp_replicas(value: Any) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError):
        n = MIN_REPLICAS
    return max(MIN_REPLICAS, min(MAX_REPLICAS, n))


def _heuristic_tool_fallback(user_message: str) -> Optional[Dict[str, Any]]:
    """Intent matcher for deployment operations."""
    msg = user_message.lower().strip()

    m = _SCALE_RE.search(msg)
    if m and m.group(1) not in _NOT_AN_APP:
        return {
            "source": "llm_tool_call",
            "tool": "scale_application",
            "input": {"app_name": m.group(1), "replicas": _clamp_replicas(m.group(2))},
        }

    m = _DEPLOY_RE.search(msg)
    if m and m.group(1) not in _NOT_AN_APP:
        return {
            "source": "llm_tool_call",
            "tool": "deploy_application",
            "input": {"app_name": m.group(1)},
        }

    m = _STATUS_RE_1.search(msg) or _STATUS_RE_2.search(msg)
    if m and m.group(1) not in _NOT_AN_APP:
        return {
            "source": "llm_tool_call",
            "tool": "get_deployment_status",
            "input": {"app_name": m.group(1)},
        }

    return None


def _call_gemini(user_message: str, system_prompt: Optional[str] = None) -> Optional[str]:
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return None

    configured_model = os.environ.get("GEMINI_MODEL", "gemini-flash-latest")
    candidate_models = [configured_model]
    for m in ("gemini-flash-latest", "gemini-3.8-flash"):
        if m not in candidate_models:
            candidate_models.append(m)

    contents = []
    if system_prompt:
        contents.append({"role": "user", "parts": [{"text": f"SYSTEM INSTRUCTIONS:\n{system_prompt}\n\nPlease acknowledge."}]})
        contents.append({"role": "model", "parts": [{"text": "Understood. I will strictly follow all instructions."}]})
    contents.append({"role": "user", "parts": [{"text": user_message}]})

    headers = {
        "x-goog-api-key": api_key,
        "Content-Type": "application/json",
    }

    for model in candidate_models:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        try:
            with httpx.Client(timeout=30.0) as client:
                resp = client.post(url, headers=headers, json={"contents": contents})
                if resp.status_code == 200:
                    data = resp.json()
                    candidates = data.get("candidates", [])
                    if candidates:
                        parts = candidates[0].get("content", {}).get("parts", [])
                        if parts:
                            return parts[0].get("text", "").strip()
                elif resp.status_code in (503, 429, 404):
                    logger.warning("Gemini model %s returned status %d, trying fallback candidate...", model, resp.status_code)
                    continue
                else:
                    logger.error("Gemini API error %d for model %s: %s", resp.status_code, model, resp.text)
        except Exception as e:
            logger.exception("Gemini call for model %s failed: %s", model, e)
    return None


def auto_repair_dockerfile(dockerfile: str, error_log: str, repo_files: Optional[list] = None) -> Dict[str, Any]:
    """Automated AI remediation of failed Dockerfile builds."""
    prompt = f"""You are an automated DevOps healing agent for DeployStack AI (Private-PaaS).
A Docker container build has failed. Analyze the error log and current Dockerfile, and provide the corrected Dockerfile.

CURRENT DOCKERFILE:
```dockerfile
{dockerfile}
```

BUILD FAILURE ERROR LOG:
```text
{error_log[-2000:]}
```

REPOSITORY FILES:
{repo_files or []}

Respond STRICTLY in valid JSON with these 3 keys (no markdown code blocks around the JSON):
{{
  "diagnosis": "A concise 1-2 sentence explanation of what broke",
  "patch_description": "Exact fix applied to the Dockerfile",
  "fixed_dockerfile": "The complete, ready-to-run corrected Dockerfile content"
}}
"""
    res = _call_gemini(prompt)
    if res:
        try:
            clean = re.sub(r"^```json\s*", "", res.strip(), flags=re.MULTILINE)
            clean = re.sub(r"^```\s*$", "", clean.strip(), flags=re.MULTILINE)
            parsed = json.loads(clean)
            if "fixed_dockerfile" in parsed:
                return {
                    "success": True,
                    "source": "gemini_auto_repair",
                    "diagnosis": parsed.get("diagnosis", "AI auto-repair patch applied"),
                    "patch_description": parsed.get("patch_description", "Updated Dockerfile"),
                    "fixed_dockerfile": parsed["fixed_dockerfile"],
                }
        except Exception as e:
            logger.warning("Failed to parse Gemini repair response: %s", e)

    # Heuristic rule fallback
    fixed = dockerfile
    diag = "Heuristic auto-repair"
    patch = "Adjusted configuration"

    if "ERR_OSSL_EVP_UNSUPPORTED" in error_log or "digital envelope routines" in error_log:
        diag = "OpenSSL 3.0 incompatibility with legacy Webpack/crypto hashing"
        patch = "Injected ENV NODE_OPTIONS='--openssl-legacy-provider'"
        if "NODE_OPTIONS" not in fixed:
            fixed = fixed.replace("WORKDIR /app\n", "WORKDIR /app\nENV NODE_OPTIONS=\"--openssl-legacy-provider\"\n")

    return {
        "success": fixed != dockerfile,
        "source": "heuristic_auto_repair",
        "diagnosis": diag,
        "patch_description": patch,
        "fixed_dockerfile": fixed,
    }


def _sanitize_tool_call(name: str, tool_input: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if name not in KNOWN_TOOLS or not isinstance(tool_input, dict):
        return None
    app_name = str(tool_input.get("app_name", "")).strip().lower()
    if not re.fullmatch(_APP, app_name):
        return None
    clean: Dict[str, Any] = {"app_name": app_name}
    if name == "scale_application":
        clean["replicas"] = _clamp_replicas(tool_input.get("replicas"))
    return {"source": "llm_tool_call", "tool": name, "input": clean}


def handle_chat_message(user_message: str, context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    context = context or {}
    log_text = context.get("log_text") or user_message

    # LAYER 1: deterministic pattern engine (free, instant)
    local_result = explain_log(log_text)
    if local_result["handled_locally"]:
        return local_result

    # Check for direct tool intents (deploy, scale, status)
    tool_call = _heuristic_tool_fallback(user_message)
    if tool_call:
        return tool_call

    # LAYER 2: Google Gemini (if configured)
    gemini_key = os.environ.get("GEMINI_API_KEY")
    if gemini_key:
        sys_prompt = (
            "You are an Ops Copilot for DeployStack AI, a self-hosted private-server PaaS modeled after Coolify. "
            "Help the developer diagnose Docker issues, reverse proxy routing (Traefik), container logs, and cloud architecture. "
            "Keep answers concise, direct, technical, and actionable."
        )
        gemini_text = _call_gemini(user_message, system_prompt=sys_prompt)
        if gemini_text:
            return {"source": "gemini_llm", "message": gemini_text}

    # Anthropic fallback (if configured)
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if api_key and HAS_ANTHROPIC:
        try:
            response = _get_client(api_key).messages.create(
                model=os.environ.get("ANTHROPIC_MODEL", DEFAULT_MODEL),
                max_tokens=1024,
                tools=TOOLS,
                system=(
                    "You are an Ops Copilot for a private-server deployment platform. "
                    "Only call a tool if the user's request clearly maps to one of the defined tools. "
                    "If it is a general question or log diagnosis, respond in clear helpful text."
                ),
                messages=[{"role": "user", "content": user_message}],
            )
            for block in response.content:
                if block.type == "tool_use":
                    call = _sanitize_tool_call(block.name, block.input)
                    if call:
                        return call
            text = "\n".join(b.text for b in response.content if b.type == "text").strip()
            if text:
                return {"source": "llm_text", "message": text}
        except Exception as e:
            logger.exception("Anthropic LLM request failed: %s", e)

    return {
        "source": "local_response",
        "message": (
            "Ops Copilot: I can deploy apps ('deploy my-blog'), scale replicas "
            "('scale my-blog to 3 replicas'), report status ('status of my-blog') "
            "or diagnose log errors. Provide GEMINI_API_KEY or ANTHROPIC_API_KEY for free-form questions."
        ),
    }
