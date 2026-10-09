# Engineering Guidelines & Rules (`rules.md`)

## 1. Scope & System Boundaries

### Rule 1.1: Private Servers Only (Strict SSH Boundary)
- **Constraint:** The system orchestrates deployments exclusively onto **private/self-hosted Linux servers** (bare metal, home labs, local VMs, VPS instances) via standard SSH (port 22).
- **Prohibited:** Do NOT introduce cloud-provider SDKs (e.g., AWS SDK, GCP SDK, Azure SDK, DigitalOcean API). Orchestration is performed purely by executing Docker CLI commands over SSH (`node-ssh`).

### Rule 1.2: Zero-Touch Reverse Proxy via Traefik Labels
- **Constraint:** Traefik must discover applications dynamically using Docker container labels.
- **Prohibited:** Never generate, template, or manipulate static Nginx configuration files per application. Traefik listens on `/var/run/docker.sock` and routes based on `traefik.http.routers.<app-name>.rule=Host(\`<domain>\`)`.

### Rule 1.3: Non-Destructive Deployment Guarantee
- **Constraint:** If a build, container run, or health check fails during deployment, the system must **preserve the currently running container** and flag the deployment as `failed`.
- **Prohibited:** Never terminate a working container before verifying that the replacement container has been successfully created and started.

---

## 2. AI Subsystem & Cost-Optimization Rules

### Rule 2.1: Layer-1 Deterministic Pattern First
- **Constraint:** For log analysis and troubleshooting requests, the system **must** execute `log_pattern_engine.py` first.
- **Rationale:** 80% of routine deployment errors (e.g., `EADDRINUSE`, `502 Bad Gateway`, missing `Dockerfile`, `ENOTFOUND`, `permission denied`) are diagnosed deterministically in < 1ms at $0 API cost.
- **Prohibited:** Never bypass Layer 1 to directly invoke an LLM for recognized error signatures.

### Rule 2.2: Sandboxed LLM Tool Calling (No Raw Terminal Access)
- **Constraint:** The LLM Ops Copilot is restricted to the fixed function schemas defined in `tool_schemas.py` (`deploy_application`, `scale_application`, `get_deployment_status`).
- **Prohibited:** Never provide the LLM with direct SSH access, bash execution capabilities, or destructive shell tools (`rm`, `kill`, `docker system prune`). All actions must pass through authenticated HTTP endpoints in the Core Platform Backend.

### Rule 2.3: Predictive Autoscaler Isolation
- **Constraint:** The Traffic Predictor consumes Prometheus metrics, computes feature lags (1m, 5m, 15m), and sends scaling recommendations via `POST /applications/:id/scale`.
- **Prohibited:** The ML script must not independently launch or kill Docker containers on private servers without going through the Core Platform API.

---

## 3. Coding & Framework Standards

### 3.1 NestJS Backend Guidelines
- Use modular architecture (`AuthModule`, `ServerModule`, `ApplicationModule`, `DeploymentModule`, `WebhookModule`).
- Enforce strict TypeScript typing and DTO validation using `class-validator` and `class-transformer`.
- All remote SSH executions must capture `stdout` and `stderr` and emit events to the WebSocket gateway for live streaming.
- Server operations (e.g., `docker network create paas-net`) must be idempotent.

### 3.2 Python AI Engine Guidelines
- Enforce Python 3.10+ with type hints and Pydantic schemas for all request/response bodies.
- Use `httpx.AsyncClient` for asynchronous HTTP communication with the NestJS backend.
- Keep ML models cleanly serialized in `ai-engine/traffic/artifacts/` (`scaler_model.pkl`).

### 3.3 Frontend Dashboard Guidelines
- Enforce clean, modern, responsive aesthetics (Inter/Outfit typography, glassmorphism, structured status badges).
- Provide real-time feedback for all asynchronous operations (deploy logs streaming via WebSockets, server health indicators).
- Embed the Ops Copilot chat interface cleanly within the central navigation layout.
