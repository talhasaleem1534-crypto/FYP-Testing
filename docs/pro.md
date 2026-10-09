# Project Overview (`pro.md`)

## 1. Project Title
**Private-Server Deployment Platform ("Coolify, Scoped Down, Plus AI")**
*Internal Project Codename: `private-paas` / `DeployStack AI`*

---

## 2. Primary Objective
Build a lightweight, self-hosted Platform-as-a-Service (PaaS) tailored exclusively for **private servers** (bare metal, home labs, on-prem VMs) using SSH orchestration and Docker. The platform automates the developer workflow from Git push to live container deployment with automatic reverse-proxy routing and SSL, augmented by two purpose-built AI subsystems:
1. **Predictive Traffic Autoscaling:** Machine learning model predicting traffic spikes and proactively scaling container replicas.
2. **Ops Copilot Chatbot:** A natural-language operations assistant featuring a zero-cost deterministic log-diagnosis engine paired with an LLM function-calling router for infrastructure operations.

---

## 3. Technology Stack

### Core Platform (Backend & Orchestration)
- **Framework:** NestJS (Node.js / TypeScript)
- **Database & ORM:** PostgreSQL + TypeORM / Prisma
- **Orchestration:** `node-ssh` (SSH client executing remote Docker CLI commands)
- **Realtime Logs:** WebSockets (Socket.io / NestJS WebSockets Gateway)
- **Authentication:** GitHub OAuth & JWT session management

### Core Platform (Frontend Dashboard)
- **Framework:** React.js / Vite + TypeScript
- **Styling:** Vanilla Modern CSS / Glassmorphism Design System
- **Realtime Client:** WebSocket client for live deployment streaming
- **Pages:** Servers, Applications, Live Deploy Terminal, Ops Copilot Chat

### AI Engine Subsystem
- **Runtime & API:** Python 3.10+, FastAPI, Uvicorn, HTTPX
- **Deterministic Pattern Layer:** Python Regex Engine (`log_pattern_engine.py`)
- **LLM Layer:** Anthropic Claude Messages API (Tool Use / Function Calling)
- **Predictive Model:** Scikit-Learn `RandomForestRegressor` with time-lag features
- **Validation:** Pydantic models & structured JSON schemas

### DevOps, Proxy & Infrastructure
- **Reverse Proxy:** Traefik v2/v3 (Docker Provider with container dynamic labels)
- **Containerization:** Docker Engine, Docker Compose
- **Monitoring & Metrics:** Prometheus scraping Node Exporter / cAdvisor
- **Load Testing & Demo:** Locust (`locustfile.py`)

---

## 4. Division of Labor & Team Responsibilities

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           PROJECT DIVISION                              │
├────────────────────────────────────┬────────────────────────────────────┤
│   Salman (DevOps & Core Platform)  │         Talha (AI & ML Lead)       │
├────────────────────────────────────┼────────────────────────────────────┤
│ • Phase 1: Core Backend & SSH      │ • Phase 3: Traffic Prediction Model│
│ • Server Registration & paas-net   │ • Lag Feature Engineering & RF     │
│ • Docker Build & Run with Traefik  │ • Phase 4: Ops Copilot Chatbot     │
│ • Webhook Ingestion (GitHub)       │ • Deterministic Log Pattern Engine │
│ • Phase 2: React Dashboard UI      │ • Anthropic Claude Tool Calling    │
│ • Live Deploy Log WebSocket Stream │ • FastAPI Service Endpoints        │
├────────────────────────────────────┴────────────────────────────────────┤
│                      Joint Collaboration Phases                         │
│ • Phase 5: End-to-End System Integration & Docker Compose Assembly      │
│ • Phase 6: Load Testing, Demo Runbook & FYP Viva Defense Execution      │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 5. High-Level System Architecture Summary
- **No Cloud Vendor Lock-in:** Targets private host machines over SSH.
- **Zero-Touch Routing:** Traefik dynamically discovers running containers via labels; no manual Nginx configurations.
- **Cost-Optimized AI:** 80% of common DevOps errors are caught instantly for free via the deterministic pattern engine; LLM is only called for novel issues or intent-based tool execution.
- **Safe Agentic Boundary:** The LLM cannot execute raw terminal commands; it only emits structured tool calls that target vetted internal API endpoints.
