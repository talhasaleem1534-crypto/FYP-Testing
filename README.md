# OmniDeploy - Private-Server Deployment Platform ("Coolify + AI Ops")

> Formerly "OmniDeploy". Older session logs still use that name.

A self-hosted PaaS platform exclusively designed for **private servers** (bare-metal hosts, home labs, on-prem VMs, and local Docker daemons) using SSH orchestration and Docker. It automates Git-to-deploy pipelines with dynamic Traefik reverse-proxy discovery, an AI Ops Copilot, and an unsupervised **Container Health Anomaly Detection model (Isolation Forest)**.

---

## 💡 Project Origin & Motivation

As computer science students, we wanted an easy way to deploy our web applications without having to pay monthly bills for cloud services like AWS, Vercel, or Heroku. 

While looking for self-hosted solutions, **Salman** discovered an open-source tool called **Coolify** ([coolify.io](https://coolify.io)). Coolify is popular because it lets developers connect to their own private server (or laptop) using SSH and automatically deploy projects using Docker containers. 

However, while testing and using Coolify, we noticed two common problems that students and beginners always struggle with:
1. **Confusing Build Errors:** When a deployment fails (like a port conflict `EADDRINUSE` or `502 Bad Gateway`), Coolify only shows hundreds of lines of raw terminal logs. For a beginner or student developer, it is very hard to figure out what actually broke without searching Google for hours. There was no AI assistant or chatbot to explain the error in plain English.
2. **Containers Crash Without Warning:** Tools like Coolify only alert you after a container has already crashed. They don't give you an early warning if a container is slowly running out of memory (memory leak) or restarting repeatedly.

At the same time, **Talha** was looking for a practical Machine Learning project for our FYP. Instead of doing a typical toy project (like predicting house prices or movie reviews), Talha wanted to solve a real system problem. While watching YouTube engineering channels like **StatQuest with Josh Starmer** and **TechWorld with Nana**, and consulting AI tools for practical ideas, Talha learned about **unsupervised Anomaly Detection using Isolation Forest**. 

We realized we could combine our two ideas into one solid project:
- **Salman's Part (DevOps):** Built a self-hosted platform inspired by Coolify that uses SSH, Docker, and Traefik to automatically deploy apps from GitHub.
- **Talha's Part (AI & ML):** Added a **2-layer AI Copilot** that instantly explains deployment errors in simple words, plus an **Isolation Forest Anomaly Detector** that watches live Docker stats (CPU %, memory %, restart count, network I/O) to warn us if a container starts behaving abnormally *before* it crashes.

The result is **OmniDeploy**: a beginner-friendly, self-hosted deployment platform that makes hosting apps easy and uses AI to help you catch errors and fix container problems.

---

## 🤖 Core AI Features

### 1. Container Health Anomaly Detection (Isolation Forest)
- **Unsupervised Learning:** Trained on normal multi-dimensional container telemetry (CPU %, memory %, restart counts, and network I/O) collected via Docker stats.
- **Catches Compound Failures:** Uncovers subtle degradation patterns (e.g. memory climbing + restart count increasing together) that simple fixed thresholds (`CPU > 80%`) completely miss.
- **Controlled Fault Injection Validation:** Ground-truth "unhealthy" states are generated via controlled fault injection scripts (simulated memory leaks, CPU thrashing, crash loops) so the model's precision and recall can be validated against known-bad states.
- **Dashboard tab:** live charts for HTTP requests/s (Traefik via Prometheus), network, CPU, memory and the anomaly score per container, plus deployment analytics (per day, success rate, durations). Works in Demo Mode with simulated data.
- **Readable deployment logs:** pipeline progress, folded steps, error/warning filters, search, line wrapping, copy/download, and a big **Open App** button plus a highlighted APP URL row when a deploy succeeds. Every past deployment's log can be reopened.
- **Delete applications** from the Applications tab (removes containers, replicas, images and source, frees the port; confirmation required).
- **State survives restarts:** apps, servers and deployment history are saved to `~/.paas-data` (`PAAS_DATA_DIR`, `PAAS_PERSISTENCE=off` to disable).
- **Actionable Health Scoring:** Returns the raw Isolation Forest score (always between -1 and 0; lower = more unusual) together with a status (`HEALTHY`, `DEGRADING`, `ANOMALOUS`), the primary contributing metric and a plain-English message.
- **Hybrid by design:** the forest is combined with hard safety limits (e.g. CPU > 85 %). Measured on injected faults, the forest alone catches combined degradation that fixed limits cannot (100 % vs 0 %) but is weak on single-metric faults (e.g. CPU spike), which the limits catch; together they reach ~96 % recall at < 1 % false alarms. Re-run with `python -m anomaly.evaluate` (results are stored in `ai-engine/anomaly/artifacts/anomaly_metrics.json`).
- **Live metrics are converted to the units the model was trained on:** network I/O becomes KB/s and restarts become *restarts in the last 10 minutes* (Docker only reports lifetime counters).

### 2. Dual-Layer AI Ops Copilot
- **Layer 1 (Zero-Cost Deterministic Engine):** Instant regex pattern catalog for 80% of routine DevOps container errors (`EADDRINUSE`, `502 Bad Gateway`, `ENOTFOUND`, missing `Dockerfile`) with 0ms latency and $0 API cost.
- **Layer 2 (LLM Tool Calling Agent):** Anthropic Claude Messages API function-calling router for natural-language commands (e.g. *"Scale portfolio-app to 2 replicas"* or *"Deploy my-portfolio"*).

---

## 🐧 Apps Run on Your Linux Server over SSH (Session 23, version 7)

Three devices: **platform laptop** (OmniDeploy + admin), **Linux laptop** (the server), **customer device** (browser).
**Add a server** shows the commands to prepare the Linux machine and one command that trusts the platform's own SSH key;
**Connect & check** verifies SSH, Docker, git, the apps folder and the Docker network. Deployments then clone, build and run
**on the Linux server over SSH**, and "Open App" links to `http://<server-IP>:<port>`. The admin can share servers with
customers, and customers can add their own. Step-by-step: [docs/MULTI_DEVICE_SETUP.md](docs/MULTI_DEVICE_SETUP.md).

## 🖥️ Two Sites, Separate Devices (Session 22, version 6)

- **Customer portal** `http://<admin-laptop-IP>:5173/` - customers sign up on their own device, pick the app type, paste a GitHub link and deploy. They only ever see their own apps and logs.
- **Admin site** `http://localhost:5173/admin` - the platform owner sees every customer, every app (with its owner), servers, and **Data & Storage**: the exact files on the admin laptop that hold accounts (password hashes, never passwords), sessions, apps and the customers' cloned code.
- Every backend route needs a login; the backend prints the customer link at start-up. Setup steps, Windows firewall and storage table: [docs/MULTI_DEVICE_SETUP.md](docs/MULTI_DEVICE_SETUP.md).

## 👤 Customer Flow (Session 21)

1. **Login page** - customers create an account or sign in (passwords hashed with scrypt). "Try the demo" needs no account.
2. **Private Servers** - the customer registers their own server.
3. **New Application → "What type of app is this?"** - Flask, FastAPI, Django, Node.js/Express, Next.js, React/Vue/Vite, Static HTML, Go, own Dockerfile, or auto-detect. Each type knows its required files, port, start command and Dockerfile recipe (`core-platform/backend/src/modules/app-types/app-types.ts`).
4. **Create & deploy** - the deploy log explains what was checked and generated.

How this maps to Coolify, and what is still missing: [docs/COOLIFY_HOW_IT_WORKS.md](docs/COOLIFY_HOW_IT_WORKS.md).

---

## 🏗️ Architecture & Modules

- **`core-platform/backend/`**: NestJS application orchestrating private servers via SSH (`node-ssh`), handling Docker container builds, Traefik dynamic labels, WebSockets live streaming, and GitHub push webhooks.
- **`core-platform/frontend/`**: Modern React dashboard (Vite + TypeScript) with live deployment logs, server management, Traefik domain overview, embedded Ops Copilot chat, and the Container Health Anomaly Monitor.
- **`ai-engine/`**: FastAPI service hosting the **Ops Copilot** and the **Container Anomaly Detector** (`IsolationForest`).
- **`devops/`**: Docker Compose configuration running the backend, AI engine, Traefik dynamic proxy, and Prometheus metrics scraper.
- **`docs/`**: Master project chronicle, progress handovers, flowcharts, and viva defense runbooks.

---

## 📚 Student & Project References

1. **PaaS Architecture:** Inspired by open-source **Coolify** ([github.com/coolify-io/coolify](https://github.com/coolify-io/coolify)) for agentless SSH orchestration and Traefik container auto-discovery.
2. **Machine Learning Concept:** Learned Isolation Forest from **StatQuest with Josh Starmer** (*"Isolation Forest, Clearly Explained!"*) and the official **Scikit-Learn documentation** (`sklearn.ensemble.IsolationForest`).
3. **Container Telemetry:** Docker metrics collection methodology guided by **TechWorld with Nana** (*"Docker Container Monitoring & Metrics Explained"*).
4. **AI Pair Programming:** Consulted AI tools (ChatGPT / Claude) for brainstorming the fault-injection validation scripts.

---

## 🚀 Quickstart Guide

### Option A - everything in Docker
```bash
docker network create paas-net        # once (skip if it already exists)
cd devops
cp .env.example .env                  # optional: add ANTHROPIC_API_KEY / GITHUB_WEBHOOK_SECRET
docker compose up -d --build
```
Traefik must be v3.6.1 or newer on Docker Engine 29+ (older Traefik cannot talk to the new Docker API); the compose file already pins `traefik:v3.6`.

### Option B - run the pieces by hand

### 1. Run the Core Platform Backend
```bash
cd core-platform/backend
cp .env.example .env     # optional
npm install
npm run start:dev
```

### 2. Run the Core Platform Frontend (Dashboard)
```bash
cd core-platform/frontend
npm install
npm run dev
```

### 3. Run the AI Engine Standalone
```bash
cd ai-engine
pip install -r requirements.txt
python -m uvicorn chatbot.main:app --host 127.0.0.1 --port 8001
```
If `/health` reports `anomaly_model_error` (e.g. after upgrading scikit-learn), retrain: `python -m anomaly.train_model`.
Tests: `pip install -r requirements-dev.txt && python -m pytest tests`

Frontend tests: `cd core-platform/frontend && npm test`. Backend scenarios with a fake Docker: `cd core-platform/backend && npm run build && npm run test:e2e` (see `test-e2e/README.md`).

---

## 📊 FYP Demonstration Runbook

- **Deterministic Log Diagnosis:** Test Layer 1 pattern engine by asking Copilot: `"Why is my app crashing with 502 Bad Gateway?"` or `"listen EADDRINUSE: address already in use :::3000"` (instant, $0 API cost).
- **Ops Tool Execution:** Ask Copilot `"Scale portfolio-app to 2 replicas"` and watch the backend dynamically execute the scale action.
- **Live Anomaly Detection Demo:** In the dashboard under **Container Health & Anomaly Detector**, pick a fault preset in the **Fault Injection Test Bench** (e.g. 🔴 Memory Leak or 🔴 CPU Spike) and click **Run Anomaly Inference**, or press **Scan Live Containers** to score the containers actually running on your Docker host.
