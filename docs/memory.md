# Architectural Decision Records & Long-Term Memory (`memory.md`)

## 1. Architectural Decision Records (ADRs)

### ADR-001: Direct SSH & Remote Docker CLI Orchestration vs. Cloud SDKs
- **Context:** The platform is targeted at self-hosted, private Linux servers (bare metal, home labs, on-premise VMs).
- **Decision:** Use SSH connections (`node-ssh` in NestJS) to directly execute Docker CLI commands remotely (`docker build`, `docker run`, `docker stop`).
- **Rationale:** 
  1. Adheres to strict scope (no AWS/GCP/Azure/DigitalOcean SDKs).
  2. Exactly mirrors Coolify's underlying architecture (an SSH orchestrator).
  3. Avoids exposing vulnerable Docker TCP daemon sockets directly to the public network.

---

### ADR-002: Traefik Dynamic Docker Provider vs. Nginx Config Templating
- **Context:** Applications need automated reverse proxy routing and SSL certificates upon deployment.
- **Decision:** Deploy Traefik once on the target server/network, connected to `/var/run/docker.sock`, and attach labels directly to application containers.
- **Rationale:**
  1. Zero-touch auto-discovery: Traefik detects new containers and updates routing tables dynamically in memory.
  2. Eliminates fragile file templating, syntax validation bugs, and service reload delays associated with custom Nginx config generators.

---

### ADR-003: Hybrid 2-Layer AI Chatbot (Deterministic Layer 1 + LLM Layer 2)
- **Context:** An AI Ops Copilot needs to diagnose errors and execute ops actions while remaining cost-effective and ultra-fast.
- **Decision:** Implement a deterministic regex pattern engine (`log_pattern_engine.py`) that runs before invoking the LLM.
- **Rationale:**
  1. 80% of routine deployment failures (`EADDRINUSE`, `502 Bad Gateway`, missing `Dockerfile`, `ENOTFOUND`, `permission denied`) are diagnosed with zero latency and zero API cost.
  2. Defends against the critique of being "just an API wrapper"; demonstrates thoughtful systems optimization.

---

### ADR-004: Safe AI Execution Boundary (Tool Schemas vs. Direct Shell Access)
- **Context:** The Ops Copilot must be able to trigger actions (deploy, scale) from natural language instructions.
- **Decision:** The LLM only receives a fixed list of tool schemas (`tool_schemas.py`) and returns structured JSON tool calls. The FastAPI backend executes the corresponding authenticated HTTP calls to the Core Platform.
- **Rationale:**
  1. Prevents hallucinated or destructive shell commands (`rm -rf`, `docker system prune`).
  2. Creates a clean security separation between AI decision-making and infrastructure execution.

---

### ADR-005: Lag-Feature Predictive Traffic Autoscaling
- **Context:** Responsive autoscaling needs to preempt traffic spikes rather than reacting after CPU/Memory hits 100%.
- **Decision:** Use a `RandomForestRegressor` model trained on time-lagged traffic features (1m, 5m, 15m lags) predicting traffic 1 minute into the future.
- **Rationale:** Validated dataset and model (8,635 rows, MAE 45.00 req/min, R² 0.63) provides smooth proactive scaling (`SCALE_UP`, `SCALE_DOWN`, `HOLD`).

---

## 2. Known Pitfalls, Workarounds & Engineering Gotchas

| Pitfall / Issue | Root Cause | Implemented Workaround |
|---|---|---|
| **SSH Host Key Verification** | New private servers reject automated non-interactive SSH connections if host key is unknown. | Configure SSH client with `StrictHostKeyChecking=accept-new` or accept trusted keys during initial server registration. |
| **Duplicate `paas-net` Error** | Running `docker network create paas-net` fails if the network already exists. | Execute idempotently with error suppression or check network existence before creation. |
| **Port Conflicts on Scaling** | Launching multiple replicas on the host network could cause binding conflicts. | Connect all replicas to bridge network `paas-net` and route via Traefik labels without host port mapping (`-p`). |
| **App Outage on Failed Build** | Replacing a running container before a new build succeeds causes downtime. | Always build and test the new container first; only stop the old container after the new container is healthy. If the build fails, preserve the old container. |
| **Traefik Multiple Port Detection** | When an image exposes multiple ports (e.g., 3000 and 9229), Traefik may pick the wrong port. | Explicitly pass `traefik.http.services.<app-name>.loadbalancer.server.port=<port>` in the container labels based on the app's configuration. |
