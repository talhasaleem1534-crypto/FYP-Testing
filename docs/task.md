# Implementation Tasks & Phase Checklist (`task.md`)

## Phase 1: Core Platform Backend (DevOps / Salman)
- [x] **1.1 Project Scaffolding & Setup**
  - [x] Initialize NestJS backend in `core-platform/backend` with TypeScript and ESLint.
  - [x] Configure module routing and data models.
  - [x] Set up Dockerfile and container definition.
- [x] **1.2 Server Management (`servers` module)**
  - [x] Implement `POST /servers` endpoint for registering private host targets (IP, port, user, private key).
  - [x] Implement SSH connection verification using `node-ssh` (`docker --version`).
  - [x] Implement automatic setup of `paas-net` Docker network on target servers.
  - [x] Persist verified / unreachable status.
- [x] **1.3 Application & Deployment Orchestration (`applications` & `deployments`)**
  - [x] Implement `POST /applications` for application metadata, Git repo URL, branch, domain, and env vars.
  - [x] Implement Git clone / pull over SSH to `/apps/<app-name>` on target server.
  - [x] Implement Docker image build (`docker build -t <app-name>:<sha>`).
  - [x] Implement dynamic container execution with Traefik auto-discovery labels and `paas-net` attachment.
  - [x] Implement WebSocket log streamer to pipe build stdout/stderr to frontend in real time.
  - [x] Implement failure-safe rollback (keep previous container alive if new build fails).
- [x] **1.4 GitHub Webhook Receiver (`webhooks` module)**
  - [x] Implement `POST /webhooks/github` matching repo clone URL and branch.
  - [x] Auto-trigger deploy pipeline on push events.
- [x] **1.5 Proxy Integration (`proxy` module)**
  - [x] Configure Traefik dynamic Docker provider on target hosts.
  - [x] Implement application scaling endpoint: `POST /applications/:id/scale` to launch replica containers.

---

## Phase 2: Core Platform Frontend (DevOps / Salman)
- [x] **2.1 Dashboard Foundation**
  - [x] Initialize React + Vite frontend in `core-platform/frontend`.
  - [x] Build global layout with navigation, sidebar, and status alerts.
- [x] **2.2 Core Views**
  - [x] **Servers Page:** Add server modal, display server list with live health status badges.
  - [x] **Applications Page:** List registered apps, repository links, domains, and last deploy status.
  - [x] **Deploy Terminal View:** Real-time log streaming component connected via WebSocket.
  - [x] **Ops Copilot Chat View:** Interactive chat interface communicating with the AI Engine.
  - [x] **Predictive Autoscaling View:** Visual traffic gauge, lag parameter inputs, and proactive decision engine.

---

## Phase 3: AI Traffic Prediction (AI Lead / Talha)
- [x] **3.1 Dataset & Feature Engineering**
  - [x] Create `ai-engine/traffic/data/generate_traffic_data.py` with lag features (1m, 5m, 15m).
  - [x] Validate dataset generation (8,619 rows generated).
- [x] **3.2 Model Training & Serialization**
  - [x] Implement `ai-engine/traffic/models/train_scaler_model.py` using `RandomForestRegressor`.
  - [x] Train and serialize model artifact to `ai-engine/traffic/artifacts/scaler_model.pkl`.
- [x] **3.3 Metrics Ingestion & Autoscaler Integration**
  - [x] Implement `predictor.py` evaluating lag inputs -> `SCALE_UP`, `SCALE_DOWN`, `HOLD`.
  - [x] Connect decision engine to `POST /applications/:id/scale` in Core Platform Backend.

---

## Phase 4: AI Ops Copilot Chatbot (AI Lead / Talha)
- [x] **4.1 Deterministic Pattern Engine (Layer 1)**
  - [x] Implement `ai-engine/chatbot/log_pattern_engine.py` with regex error catalog.
  - [x] Unit test local matching on known errors (5/5 caught locally, novel errors routed to Layer 2).
- [x] **4.2 Tool Schemas & Function Calling (`tool_schemas.py`)**
  - [x] Define Anthropic tool schemas (`deploy_application`, `scale_application`, `get_deployment_status`).
- [x] **4.3 LLM Reasoning Router (`llm_router.py`)**
  - [x] Implement Claude Sonnet tool router with fallback to conversational guidance.
  - [x] Integrate Layer 1 fallback before calling the LLM API.
- [x] **4.4 FastAPI Service (`main.py`)**
  - [x] Expose `POST /chat` with payload validation.
  - [x] Implement asynchronous backend HTTP execution via `httpx` for returned tool calls.
  - [x] Expose standalone `POST /explain-log` endpoint.

---

## Phase 5: System Integration (Joint Team)
- [x] **5.1 Docker Compose Architecture**
  - [x] Create `devops/docker-compose.yml` orchestrating `core-platform-backend`, `ai-engine`, `traefik`, and `prometheus`.
  - [x] Set up `devops/traefik/traefik.yml` and `devops/prometheus/prometheus.yml`.
- [x] **5.2 Cross-Service Connectivity**
  - [x] Verify Frontend $\rightarrow$ AI Engine chat communications.
  - [x] Verify AI Engine $\rightarrow$ Core Backend tool dispatch.
  - [x] Verify Traffic Predictor $\rightarrow$ Core Backend replica scaling.
  - [x] Validate end-to-end Git push to live Traefik route.

---

## Phase 6: Demo Day Runbook & Viva Defense (Joint Team)
- [x] **6.1 Load Simulation & Autoscaling Demo**
  - [x] Configure `demo/locustfile.py` to generate traffic bursts.
- [x] **6.2 Copilot Operations Demo**
  - [x] Demo natural language trigger: `"deploy my-blog"`.
  - [x] Demo instant local log diagnosis: `"why did this fail?"` with port conflict error.
- [x] **6.3 Viva Defense Preparation**
  - [x] Complete presentation script and defense answers in `demo/demo_script.md`.
