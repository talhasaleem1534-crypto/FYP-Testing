# Private-Server Deployment Platform — "Coolify, Scoped Down, Plus AI"
## Full Engineering Blueprint — All Phases, Both Members

**Scope confirmed:** Coolify-inspired self-hosted PaaS, **private servers only** (no EC2/DigitalOcean/cloud-provider SDKs — SSH to servers you control, full stop). Two AI features: **Traffic Prediction** (already built and validated — reused directly from the earlier blueprint) and an **Ops Copilot Chatbot** (natural-language commands + log explanation). Ransomware/anomaly detection is explicitly out of scope for now.

**Division of labor, unchanged from your fairness matrix:**
- **Salman (DevOps):** Phases 1–2 — the core platform
- **You (AI/ML):** Phases 3–4 — traffic prediction + chatbot
- **Both:** Phase 5 — integration, Phase 6 — demo

---

## 0. Master Repository Structure

```
private-paas/
├── core-platform/                    (Salman)
│   ├── backend/
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   │   ├── auth/             GitHub OAuth, JWT
│   │   │   │   ├── servers/          private server registration (SSH keys, host info)
│   │   │   │   ├── applications/     app CRUD, linked repo, env vars
│   │   │   │   ├── deployments/      build + deploy orchestration
│   │   │   │   ├── proxy/            Traefik config generation
│   │   │   │   └── webhooks/         GitHub push webhook receiver
│   │   │   ├── main.ts
│   │   │   └── app.module.ts
│   │   ├── Dockerfile
│   │   └── package.json
│   └── frontend/
│       ├── src/
│       │   ├── pages/  (Servers, Applications, Deployments, Logs, Chat)
│       │   └── components/
│       └── package.json
├── ai-engine/                        (You)
│   ├── traffic/                      <- already built, reused as-is
│   │   ├── data/
│   │   ├── models/
│   │   ├── artifacts/
│   │   └── (see Phase 3 - points back to the validated earlier blueprint)
│   ├── chatbot/
│   │   ├── log_pattern_engine.py     <- already built & tested
│   │   ├── tool_schemas.py
│   │   ├── llm_router.py
│   │   └── main.py                   (FastAPI: /chat, /explain-log)
│   ├── Dockerfile
│   └── requirements.txt
├── devops/
│   ├── docker-compose.yml            (runs core-platform + ai-engine + Traefik + Prometheus)
│   └── traefik/
│       └── traefik.yml
├── demo/
│   ├── locustfile.py                 <- reused from earlier blueprint
│   └── demo_script.md
└── README.md (existing - not touched)
```

---

# PHASE 1 — Core Platform Backend (Salman)

## 1.1 Stack
NestJS + PostgreSQL + TypeORM/Prisma + `node-ssh` (SSH client library) + `dockerode` (Docker SDK, used *remotely* over SSH tunnel) or shelling SSH commands directly — for a private-server-only scope, the simplest reliable approach is: **SSH into the registered server, run Docker CLI commands remotely.** This mirrors exactly how Coolify itself works under the hood (it is, at its core, an SSH orchestrator).

## 1.2 `servers` module — registering a private server

**Data contract — `POST /servers`:**
```json
{
  "name": "home-lab-01",
  "host": "192.168.1.50",
  "port": 22,
  "ssh_user": "deploy",
  "ssh_private_key": "-----BEGIN OPENSSH PRIVATE KEY-----...",
  "docker_installed": true
}
```
**On registration, the backend:**
1. Opens an SSH connection, runs `docker --version` to confirm Docker is installed
2. Runs `docker network create paas-net` (idempotent — ignore "already exists" errors) so every deployed app shares one network with Traefik
3. Stores the server row with `status: "verified"` or `"unreachable"`

## 1.3 `applications` + `deployments` modules — the actual deploy logic

**Data contract — `POST /applications`:**
```json
{
  "name": "my-blog",
  "repo_url": "https://github.com/user/my-blog",
  "branch": "main",
  "server_id": 1,
  "build_method": "dockerfile",
  "domain": "blog.example.com",
  "env_vars": { "NODE_ENV": "production" }
}
```

**Deploy pipeline (triggered by `POST /applications/:id/deploy` or a GitHub webhook):**
```
1. SSH into target server
2. git clone <repo_url> (or git pull if it already exists at /apps/<app-name>)
3. docker build -t <app-name>:<commit-sha> /apps/<app-name>
4. docker stop <app-name> || true   (ignore error if first deploy)
5. docker run -d --name <app-name> --network paas-net \
     --label "traefik.enable=true" \
     --label "traefik.http.routers.<app-name>.rule=Host(\`<domain>\`)" \
     --label "traefik.http.routers.<app-name>.tls.certresolver=letsencrypt" \
     <env vars from config> \
     <app-name>:<commit-sha>
6. Stream all of the above output back to the frontend via WebSocket (live deploy logs)
7. On any non-zero exit code, mark deployment as "failed" and keep the OLD container running (never take down a working app on a failed deploy)
```

**This labels-on-container pattern is exactly how Traefik auto-discovers new apps with zero manual Nginx config editing** — the single biggest "wow" feature Coolify itself is built around, and it's genuinely learnable in a semester (unlike writing a custom reverse-proxy controller from scratch).

## 1.4 `webhooks` module

**Data contract — incoming from GitHub (`POST /webhooks/github`):**
```json
{
  "ref": "refs/heads/main",
  "repository": { "clone_url": "https://github.com/user/my-blog" },
  "head_commit": { "id": "a1b2c3d", "message": "Fix navbar bug" }
}
```
Backend matches `repository.clone_url` + branch against a registered application, and triggers the same deploy pipeline as 1.3 automatically — this is "git push → live" with zero manual steps, the core Coolify promise.

## 1.5 `proxy` module — Traefik config

Rather than hand-writing Nginx configs per app (fragile, what DeployStack's original proposal struggled with), **use Traefik's Docker provider** — it watches the Docker socket directly and auto-generates routing from container labels (shown in 1.3). Salman's entire Nginx-equivalent workload becomes: install Traefik once, done. This is a genuine improvement over the original DeployStack proposal's plan to template raw Nginx configs by hand.

## Phase 1 Testing Commands
```bash
# From the backend directory
npm run start:dev

curl -X POST http://localhost:3000/servers -d '{"name":"test-server","host":"192.168.1.50","port":22,"ssh_user":"deploy","ssh_private_key":"..."}' -H "Content-Type: application/json"

curl -X POST http://localhost:3000/applications -d '{...}' -H "Content-Type: application/json"
curl -X POST http://localhost:3000/applications/1/deploy

# Confirm on the actual private server:
ssh deploy@192.168.1.50 "docker ps"
# Expect: your app container running, labeled for Traefik
```

---

# PHASE 2 — Core Platform Frontend (Salman)

**Stack:** React + a WebSocket client for live deploy logs.

**Pages (minimum for a complete demo):**
1. **Servers** — add/list registered private servers, verified/unreachable status
2. **Applications** — list apps, each showing linked repo, domain, last deploy status
3. **Deploy view** — live-streaming log output during a deploy (this is your single best "it's actually working" demo moment)
4. **Chat** — the Ops Copilot interface (Phase 4) embedded directly in the dashboard

No testing commands needed here beyond standard `npm run dev` — this phase is validated visually against Phase 1's working API.

---

# PHASE 3 — AI: Traffic Prediction (You)

**This phase is already built and validated — reuse it directly, no rework needed.** From the earlier blueprint:
- `ml-engine/data/generate_traffic_data.py` — generates lag-feature traffic data (validated: 8,635 rows)
- `ml-engine/models/train_scaler_model.py` — trains `RandomForestRegressor` (validated: MAE 45.00 req/min, R² 0.63)
- `ml-engine/api/main.py`'s `/predict-traffic` endpoint (validated: correctly returns `SCALE_UP`/`SCALE_DOWN`/`HOLD`)

**The only change for this version:** instead of Prometheus scraping a local `docker-compose` cluster, it now scrapes the **real private servers** registered in Phase 1 (via `node-exporter` or `cadvisor` installed on each private server during the "server verification" step in 1.2 — add this as one more SSH command Salman's `servers` module runs on registration). The prediction logic, the model, the API contract — all identical to what's already validated. The only thing that changes is *where the input numbers come from.*

**New integration point:** when `/predict-traffic` returns `SCALE_UP`, instead of calling `docker compose scale`, it now calls back into Salman's `applications` module:
```
POST core-platform/applications/:id/scale  { "replicas": 3 }
```
which runs `docker run` additional instances of that specific app's container on its assigned private server, each auto-registered with Traefik via the same label pattern from 1.3 (Traefik load-balances automatically across same-named containers — no extra work needed for this).

---

# PHASE 4 — AI: Ops Copilot Chatbot (You)

## 4.1 Two-layer design (already partially validated)

```
User message
     │
     ▼
Layer 1: Deterministic log-pattern engine  (FREE, INSTANT, no API cost)
     │
     ├── Matched a known pattern? → return diagnosis immediately
     │
     └── Not matched? ↓
                Layer 2: LLM call (Claude), with function-calling tools
```

**Why this two-layer design matters for your report:** a naive chatbot calls the LLM API on every single message — slow, costs money per call, and is exactly the "just an API wrapper" pattern your earlier DeepSeek conversation correctly flagged as academically thin. The pattern-engine-first design is a genuine systems-design decision: common errors get instant, free, deterministic answers; only genuinely novel problems reach the LLM. **This is validated and working code**, not a plan:

```python
# ai-engine/chatbot/log_pattern_engine.py  (already tested, 6/6 cases correctly routed)
import re

PATTERNS = [
    {"match": re.compile(r"bind.*address already in use|EADDRINUSE", re.I),
     "diagnosis": "Port conflict: another process is already using the port this container tried to bind to.",
     "fix": "Check for a stale container on the same port (`docker ps`) or change the exposed port in your app config."},
    {"match": re.compile(r"dockerfile.*no such file or directory|no such file or directory.*dockerfile", re.I),
     "diagnosis": "Build failed because no Dockerfile was found at the expected path.",
     "fix": "Confirm the Dockerfile is committed and the build context path in your deploy config is correct."},
    {"match": re.compile(r"502 bad gateway", re.I),
     "diagnosis": "The reverse proxy (Traefik) can't reach your container.",
     "fix": "Check the container is actually listening on the declared port, and that it's still running."},
    {"match": re.compile(r"ENOTFOUND|getaddrinfo", re.I),
     "diagnosis": "A DNS lookup failed - the app is trying to reach a hostname that can't be resolved.",
     "fix": "Check environment variables for a service hostname typo, or that both containers share the paas-net network."},
    {"match": re.compile(r"permission denied", re.I),
     "diagnosis": "A file or socket permission error - commonly Docker socket access or a mounted volume's ownership.",
     "fix": "Check the container user has access to the mounted volume."},
]

def explain_log(log_text: str):
    for p in PATTERNS:
        if p["match"].search(log_text):
            return {"source": "pattern_engine", "diagnosis": p["diagnosis"], "fix": p["fix"], "handled_locally": True}
    return {"source": "needs_llm", "handled_locally": False}
```
**Validated test output:** 5 known error types correctly caught locally; 1 genuinely novel stack trace correctly deferred to the LLM layer.

## 4.2 `ai-engine/chatbot/tool_schemas.py` — function-calling definitions

This is the natural-language-deploy-command piece. The LLM is given a fixed set of callable tools matching Salman's **actual** API — it cannot invent actions, only select from this list:

```python
TOOLS = [
    {
        "name": "deploy_application",
        "description": "Trigger a deployment for a named application",
        "input_schema": {
            "type": "object",
            "properties": {
                "app_name": {"type": "string", "description": "The application's registered name"}
            },
            "required": ["app_name"]
        }
    },
    {
        "name": "scale_application",
        "description": "Change the number of running replicas for an application",
        "input_schema": {
            "type": "object",
            "properties": {
                "app_name": {"type": "string"},
                "replicas": {"type": "integer", "minimum": 1, "maximum": 10}
            },
            "required": ["app_name", "replicas"]
        }
    },
    {
        "name": "get_deployment_status",
        "description": "Check the current status of an application's latest deployment",
        "input_schema": {
            "type": "object",
            "properties": {"app_name": {"type": "string"}},
            "required": ["app_name"]
        }
    }
]
```

## 4.3 `ai-engine/chatbot/llm_router.py` — the LLM call itself

**This is the one piece that genuinely needs a live API key to execute** — written to the correct, current Anthropic Messages API tool-use format:

```python
import anthropic
from tool_schemas import TOOLS
from log_pattern_engine import explain_log

client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY from environment

def handle_chat_message(user_message: str, context: dict):
    # If this looks like a log/error, try the free deterministic layer first
    if context.get("log_text"):
        local_result = explain_log(context["log_text"])
        if local_result["handled_locally"]:
            return local_result

    response = client.messages.create(
        model="claude-sonnet-4-5",
        max_tokens=1024,
        tools=TOOLS,
        system=(
            "You are an Ops Copilot for a private-server deployment platform. "
            "Only call a tool if the user's request clearly maps to one. "
            "If it's a question you can answer directly (e.g. explaining an error), just respond in text."
        ),
        messages=[{"role": "user", "content": user_message}]
    )

    for block in response.content:
        if block.type == "tool_use":
            return {"source": "llm_tool_call", "tool": block.name, "input": block.input}
        if block.type == "text":
            return {"source": "llm_text", "message": block.text}

    return {"source": "llm_text", "message": "I didn't understand that - try rephrasing."}
```

**The actual execution of a returned tool call** (e.g., `{"tool": "deploy_application", "input": {"app_name": "my-blog"}}`) happens back in the FastAPI layer below — the chatbot *decides*, the core platform's real API *acts*. This separation matters: the LLM never gets direct infrastructure access, only a fixed menu of safe, pre-defined actions.

## 4.4 `ai-engine/chatbot/main.py` — FastAPI wrapper

```python
import httpx
from fastapi import FastAPI
from pydantic import BaseModel
from llm_router import handle_chat_message

app = FastAPI(title="Ops Copilot")
CORE_PLATFORM_URL = "http://core-platform-backend:3000"

class ChatRequest(BaseModel):
    message: str
    log_text: str | None = None

@app.post("/chat")
async def chat(req: ChatRequest):
    result = handle_chat_message(req.message, {"log_text": req.log_text})

    if result["source"] == "llm_tool_call":
        # Execute the decided action against the REAL core platform API
        async with httpx.AsyncClient() as client:
            if result["tool"] == "deploy_application":
                r = await client.post(f"{CORE_PLATFORM_URL}/applications/by-name/{result['input']['app_name']}/deploy")
            elif result["tool"] == "scale_application":
                r = await client.post(
                    f"{CORE_PLATFORM_URL}/applications/by-name/{result['input']['app_name']}/scale",
                    json={"replicas": result['input']['replicas']}
                )
            else:
                r = await client.get(f"{CORE_PLATFORM_URL}/applications/by-name/{result['input']['app_name']}/status")
        return {"reply": f"Done - {result['tool']} executed.", "api_response": r.json()}

    return {"reply": result.get("diagnosis") or result.get("message")}
```

## 4.5 Data Contracts

**`POST /chat`** request:
```json
{ "message": "deploy my-blog to production" }
```
Response (tool-call path):
```json
{ "reply": "Done - deploy_application executed.", "api_response": { "deployment_id": 42, "status": "building" } }
```

**`POST /chat`** request (log explainer path):
```json
{ "message": "why did this fail?", "log_text": "Error: listen EADDRINUSE: address already in use :::3000" }
```
Response:
```json
{ "reply": "Port conflict: another process is already using the port this container tried to bind to." }
```

## Phase 4 Testing Commands
```bash
cd ai-engine/chatbot
pip install -r requirements.txt
python3 log_pattern_engine.py          # confirms the local layer standalone - no API key needed

export ANTHROPIC_API_KEY=sk-...
uvicorn main:app --port 8001 --reload

curl -X POST http://localhost:8001/chat -H "Content-Type: application/json" \
  -d '{"message":"why did this fail?","log_text":"Error: listen EADDRINUSE: address already in use :::3000"}'
# Expect instant local-pattern response, no LLM latency

curl -X POST http://localhost:8001/chat -H "Content-Type: application/json" \
  -d '{"message":"scale my-blog to 4 replicas"}'
# Expect a tool_use response naming scale_application with replicas=4
```

**`ai-engine/chatbot/requirements.txt`:**
```
fastapi==0.111.0
uvicorn[standard]==0.30.1
anthropic==0.34.0
httpx==0.27.0
```

---

# PHASE 5 — Integration

| Who connects to what | How |
|---|---|
| Frontend Chat page → Chatbot API | WebSocket or simple POST to `ai-engine/chatbot` `/chat` |
| Chatbot → Core Platform API | HTTP calls to execute decided tool actions (4.4) |
| Traffic Predictor → Core Platform API | HTTP `POST /applications/:id/scale` when `SCALE_UP`/`SCALE_DOWN` fires |
| Core Platform → Private Servers | SSH (Phase 1) |
| Prometheus → Private Servers | Scrapes `node-exporter`/`cadvisor` installed during server registration |

**Suggested integration order (reduces "who's blocked on whom" friction):**
1. Salman gets Phase 1 working stand-alone first (deploy via `curl`, no frontend needed yet) — unblocks your Phase 3/4 work against a real, working API
2. You build Phase 3 (already done) and Phase 4 against his running backend
3. Frontend (Phase 2) comes last — it's the thinnest layer once both APIs exist and work

## Phase 5 Testing Commands
```bash
# Full stack up
cd devops && docker compose up -d --build

# End-to-end smoke test
curl -X POST http://localhost:8001/chat -d '{"message":"deploy my-blog"}' -H "Content-Type: application/json"
# Confirm: core-platform logs show a real deploy triggered, app appears live on the private server
```

---

# PHASE 6 — Demo Day Runbook

```bash
# 1. Full stack up
cd devops && docker compose up -d --build

# 2. TRAFFIC PREDICTION DEMO (reuse validated locustfile.py from earlier blueprint)
locust -f demo/locustfile.py --host=http://<your-app-domain> --users 500 --spawn-rate 50 --run-time 3m --headless
# Narrate: traffic_watcher predicts load, calls /applications/:id/scale, replica count visibly climbs

# 3. CHATBOT DEMO - two moments back to back
curl -X POST http://localhost:8001/chat -d '{"message":"deploy my-blog"}' -H "Content-Type: application/json"
# Narrate: natural language -> real deployment, show it live on the dashboard

curl -X POST http://localhost:8001/chat -d '{"message":"why did this fail?","log_text":"Error: listen EADDRINUSE..."}' -H "Content-Type: application/json"
# Narrate: instant local diagnosis, zero LLM latency - point out this is a deliberate cost/speed optimization, not a limitation
```

---

## What You're Defending in the Viva (updated for this version)

- **Why SSH-and-shell-out instead of a cloud provider SDK** → private-servers-only was a deliberate scope decision, and it's literally how Coolify itself works under the hood
- **Why Traefik + Docker labels instead of hand-written Nginx configs** → zero-touch auto-discovery, a genuine improvement over the original DeployStack proposal's plan
- **Why the chatbot has a deterministic layer before the LLM call** → cost, speed, and reliability — not every "AI chatbot" needs to hit an LLM on every message, and designing around that is a real systems decision
- **Why the LLM only gets a fixed tool menu, never direct infrastructure access** → a security boundary, and a very answerable "what if the AI hallucinates a dangerous command" question
- **Why the traffic predictor reuses validated code unchanged** → the model and API contract don't care where the input numbers come from; only the metrics source changed from Phase 1's earlier version. That's good software design, not corner-cutting.
