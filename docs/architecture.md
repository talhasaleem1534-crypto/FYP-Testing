# System Architecture (`architecture.md`)

## 1. Master Repository Directory Structure

```
private-paas/
├── docs/
│   ├── pro.md                        # Project Overview & Tech Stack
│   ├── architecture.md               # System Architecture & Blueprint
│   ├── rules.md                      # Engineering Guidelines & Constraints
│   ├── task.md                       # Implementation Checklist & Phase Tracking
│   ├── memory.md                     # Long-Term Decisions & ADR Log
│   ├── COOLIFY_STYLE_BLUEPRINT.md    # Source Reference Blueprint
│   └── log_pattern_engine.py         # Tested Pattern Engine Source
├── core-platform/                    # (Salman)
│   ├── backend/
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   │   ├── auth/             # GitHub OAuth, JWT Strategy & Guards
│   │   │   │   ├── servers/          # SSH connection management & host registration
│   │   │   │   ├── applications/     # App CRUD, Git clone/pull, environment config
│   │   │   │   ├── deployments/      # Docker build & run orchestration, live logs
│   │   │   │   ├── proxy/            # Traefik configuration & label generation
│   │   │   │   └── webhooks/         # GitHub push webhook handler
│   │   │   ├── main.ts
│   │   │   └── app.module.ts
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── frontend/
│       ├── src/
│       │   ├── pages/                # Servers, Applications, Deployments, Logs, Chat
│       │   ├── components/           # UI Components (Terminal, ServerCard, ChatWidget)
│       │   ├── services/             # API & WebSocket clients
│       │   └── App.tsx
│       ├── package.json
│       └── vite.config.ts
├── ai-engine/                        # (Talha)
│   ├── traffic/                      # Autoscaling Predictive Engine
│   │   ├── data/
│   │   │   └── generate_traffic_data.py # Lag-feature dataset generator (8,635 rows)
│   │   ├── models/
│   │   │   └── train_scaler_model.py    # RandomForestRegressor training (MAE: 45.0, R²: 0.63)
│   │   ├── artifacts/
│   │   │   └── scaler_model.pkl         # Serialized ML model
│   │   └── predictor.py                 # Evaluates Prometheus metrics -> SCALE_UP/DOWN/HOLD
│   ├── chatbot/                      # Ops Copilot Subsystem
│   │   ├── log_pattern_engine.py     # Deterministic regex diagnostics (Free Layer 1)
│   │   ├── tool_schemas.py           # Anthropic tool schemas for deploy, scale, status
│   │   ├── llm_router.py             # Claude Sonnet tool-calling & reasoning engine
│   │   └── main.py                   # FastAPI application hosting /chat & /explain-log
│   ├── Dockerfile
│   └── requirements.txt
├── devops/
│   ├── docker-compose.yml            # Orchestration: backend, ai-engine, Traefik, Prometheus
│   ├── traefik/
│   │   └── traefik.yml               # Static Traefik config enabling Docker provider
│   └── prometheus/
│       └── prometheus.yml            # Prometheus scrape targets
├── demo/
│   ├── locustfile.py                 # Traffic simulation load test
│   └── demo_script.md                # Viva demonstration script & presentation walk-through
└── README.md
```

---

## 2. High-Level Component Topology

```
                  ┌────────────────────────────────────────────────────────┐
                  │                 Developer / End User                   │
                  └──────────────┬─────────────────────────┬───────────────┘
                                 │ HTTP / WebSockets       │ HTTP / Webhooks
                                 ▼                         ▼
                  ┌────────────────────────┐    ┌──────────────────────────┐
                  │ Core Platform Frontend │    │ GitHub / Git Repository  │
                  │   (React Dashboard)    │    └────────────┬─────────────┘
                  └──────────────┬─────────┘                 │
                                 │ HTTP / WS                 │
                                 ▼                           ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ Core Platform Backend (NestJS @ Port 3000)                               │
│  ├─ AuthModule (GitHub OAuth / JWT)                                      │
│  ├─ ServerModule (SSH Orchestrator via node-ssh)                         │
│  ├─ ApplicationModule & DeploymentModule (Build/Run/Scale)               │
│  └─ WebhookModule (Git Push triggers)                                    │
└───────────┬───────────────────────────────▲──────────────────────────────┘
            │                               │ HTTP Tool Execution
            │ SSH (Remote Docker Commands)  │
            ▼                               │
┌────────────────────────┐     ┌────────────┴──────────────────────────────┐
│ Target Private Server  │     │ AI Engine Service (FastAPI @ Port 8001)   │
│  ├─ Docker Engine      │     │  ├─ Layer 1: Regex Log Pattern Engine     │
│  ├─ Traefik Proxy      │     │  ├─ Layer 2: Claude Tool Router (LLM)     │
│  ├─ paas-net Network   │     │  └─ Traffic Predictor (RandomForest)      │
│  ├─ App Containers     │     └────────────▲──────────────────────────────┘
│  └─ cAdvisor / Metrics │                  │ Scrapes metrics
└───────────┬────────────┘                  │
            │                               │
            └──────────────► Prometheus ────┘
```

---

## 3. Step-by-Step System Data Flows

### 3.1 Private Server Registration Flow
1. **User Request:** Admin inputs server IP/Host, SSH port, user (`deploy`), and SSH private key via the Frontend UI.
2. **Connectivity & Docker Probe:** Backend opens an SSH tunnel (`node-ssh`) and runs `docker --version`.
3. **PaaS Network Provisioning:** Backend runs `docker network create paas-net` (handles "already exists" idempotently) and installs/verifies metrics collectors (cAdvisor / Node Exporter).
4. **State Persistence:** Server record saved in PostgreSQL with status `verified` (or `unreachable`).

### 3.2 Application Deployment Flow (Git Push / Manual Trigger)
1. **Trigger:** `POST /applications/:id/deploy` called manually or triggered via GitHub webhook `POST /webhooks/github`.
2. **Repository Sync:** Backend executes remote SSH command: `git clone <repo_url> /apps/<app-name>` or `git pull` if repo exists.
3. **Image Build:** Backend executes: `docker build -t <app-name>:<commit-sha> /apps/<app-name>`.
4. **Log Streaming:** Remote stdout/stderr streams back to NestJS and is broadcasted via WebSockets to the React frontend deploy terminal.
5. **Zero-Downtime Container Swap:**
   - Run new container:
     ```bash
     docker run -d --name <app-name>-<new-sha> --network paas-net \
       --label "traefik.enable=true" \
       --label "traefik.http.routers.<app-name>.rule=Host(\`<domain>\`)" \
       --label "traefik.http.routers.<app-name>.tls.certresolver=letsencrypt" \
       <app-name>:<commit-sha>
     ```
   - Stop and remove older container instance once healthy.
   - On build/run failure: Keep the old container alive; mark deployment as `failed`.

### 3.3 Traefik Dynamic Auto-Discovery Flow
1. Traefik listens on the host Docker socket (`/var/run/docker.sock`).
2. Traefik Docker Provider reads container labels dynamically upon container launch.
3. Automatically routes external traffic matching `Host(<domain>)` to the container port over `paas-net`.

### 3.4 Predictive Autoscaling Flow
1. **Metric Gathering:** Prometheus scrapes request rate and container metrics from private servers.
2. **Prediction Cycle:** `traffic_watcher` queries Prometheus and runs feature lags through `scaler_model.pkl`.
3. **Decision Rule:**
   - Predicted traffic > High Threshold $\rightarrow$ Output `SCALE_UP`
   - Predicted traffic < Low Threshold $\rightarrow$ Output `SCALE_DOWN`
   - Otherwise $\rightarrow$ Output `HOLD`
4. **Scale Execution:** Calls `POST /applications/:id/scale { "replicas": N }`. Backend launches additional labeled containers (`<app-name>-replica-X`), and Traefik automatically load-balances across all matching containers.

### 3.5 Ops Copilot Hybrid 2-Layer Chat Flow
1. **User Prompt Ingestion:** User sends a query or error log to `/chat`.
2. **Layer 1 (Deterministic Pattern Engine):**
   - Checks message and `log_text` against regex table (`EADDRINUSE`, `no such file or directory Dockerfile`, `502 bad gateway`, `ENOTFOUND`, `permission denied`).
   - If match found: Returns structured diagnosis and fix **instantly with 0 latency and $0 LLM cost**.
3. **Layer 2 (LLM Router):**
   - If novel error or conversational action: Invokes Claude Sonnet with strict `TOOLS` schemas (`deploy_application`, `scale_application`, `get_deployment_status`).
   - When tool call returned: FastAPI executes the corresponding authenticated HTTP request against Core Platform Backend and returns the formatted response.

---

## 4. API Contracts

### 4.1 Core Platform Backend (`http://core-platform-backend:3000`)

#### Server Registration: `POST /servers`
- **Request Body:**
  ```json
  {
    "name": "home-lab-01",
    "host": "192.168.1.50",
    "port": 22,
    "ssh_user": "deploy",
    "ssh_private_key": "-----BEGIN OPENSSH PRIVATE KEY-----\n...",
    "docker_installed": true
  }
  ```
- **Response (`201 Created`):**
  ```json
  {
    "id": 1,
    "name": "home-lab-01",
    "host": "192.168.1.50",
    "status": "verified",
    "created_at": "2026-10-02T12:00:00Z"
  }
  ```

#### Application Creation: `POST /applications`
- **Request Body:**
  ```json
  {
    "name": "my-blog",
    "repo_url": "https://github.com/user/my-blog",
    "branch": "main",
    "server_id": 1,
    "build_method": "dockerfile",
    "domain": "blog.example.com",
    "env_vars": {
      "NODE_ENV": "production",
      "PORT": "3000"
    }
  }
  ```
- **Response (`201 Created`):**
  ```json
  {
    "id": 10,
    "name": "my-blog",
    "status": "idle",
    "domain": "blog.example.com"
  }
  ```

#### Deploy Application: `POST /applications/:id/deploy` or `POST /applications/by-name/:name/deploy`
- **Response (`202 Accepted`):**
  ```json
  {
    "deployment_id": 101,
    "app_name": "my-blog",
    "status": "building",
    "stream_url": "/deployments/101/logs/ws"
  }
  ```

#### Scale Application: `POST /applications/:id/scale` or `POST /applications/by-name/:name/scale`
- **Request Body:**
  ```json
  {
    "replicas": 3
  }
  ```
- **Response (`200 OK`):**
  ```json
  {
    "app_name": "my-blog",
    "replicas_running": 3,
    "status": "scaled"
  }
  ```

#### Application Status: `GET /applications/by-name/:name/status`
- **Response (`200 OK`):**
  ```json
  {
    "app_name": "my-blog",
    "status": "running",
    "replicas": 2,
    "latest_deployment": {
      "id": 101,
      "commit_sha": "a1b2c3d",
      "status": "success",
      "deployed_at": "2026-10-02T12:05:00Z"
    }
  }
  ```

#### GitHub Webhook Receiver: `POST /webhooks/github`
- **Headers:** `X-GitHub-Event: push`
- **Request Body:** GitHub push webhook payload containing `ref`, `repository.clone_url`, and `head_commit`.

---

### 4.2 AI Engine Service (`http://ai-engine:8001`)

#### Ops Copilot Chat: `POST /chat`
- **Request Body:**
  ```json
  {
    "message": "deploy my-blog to production",
    "log_text": null
  }
  ```
- **Response (Tool-Calling Path):**
  ```json
  {
    "reply": "Done - deploy_application executed.",
    "api_response": {
      "deployment_id": 101,
      "status": "building"
    }
  }
  ```
- **Response (Deterministic Log Diagnosis Path):**
  ```json
  {
    "reply": "Port conflict: another process is already using the port this container tried to bind to.",
    "source": "pattern_engine"
  }
  ```

#### Predictive Traffic Evaluation: `POST /predict-traffic`
- **Request Body:**
  ```json
  {
    "app_id": 10,
    "current_rate": 450.0,
    "lag_1m": 420.0,
    "lag_5m": 310.0,
    "lag_15m": 200.0
  }
  ```
- **Response (`200 OK`):**
  ```json
  {
    "predicted_traffic": 560.5,
    "decision": "SCALE_UP",
    "recommended_replicas": 3
  }
  ```
