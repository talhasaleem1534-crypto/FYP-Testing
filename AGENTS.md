# MANDATORY SYSTEM INSTRUCTIONS FOR ALL AI AGENTS

> 🚨 **CRITICAL INSTRUCTION FOR ALL AI AGENTS & CODING ASSISTANTS:**
> **Whenever you are loaded, prompted, or asked to do any task on this project, you MUST abide by this rule:**
> **BEFORE FINISHING YOUR TURN OR GIVING YOUR FINAL RESPONSE TO THE USER, YOU MUST AUTOMATICALLY UPDATE BOTH OF THE FOLLOWING TWO PROGRESS FILES:**
> 1. `PROGRESS_HANDOVER.md` (and sync to `docs/PROGRESS_HANDOVER.md`)
> 2. `MASTER_PROJECT_LOG.md` (and sync to `docs/MASTER_PROJECT_LOG.md`)

---

## 📌 Why This Rule Exists (Do Not Skip)
The student/developer is tracking the entire project lifecycle to compile:
1. Final university thesis documentation.
2. Step-by-step viva defense flowcharts (system architecture, sequence diagrams, ML decision flow).
3. Faculty presentation materials and grading proof.

If you fail to update these two files, critical debugging history and defense points are lost.

---

## 📋 What Every AI Agent Must Record In Both Files:

For EVERY session or prompt where you write code, debug an issue, run commands, or answer questions:

1. **Session Entry:** Increment session number, record timestamp, and list goals.
2. **Changes Made:** Specific files created or modified with Markdown links (e.g. `[filename](file:///path/to/file)`).
3. **Every Hurdle & Error Encountered:**
   - Any compile failure (`tsc`, `nest build`, `vite build`, `python`).
   - Any runtime error (`EADDRINUSE`, `502 Bad Gateway`, `Connection refused`, `AttributeError`, `FileNotFoundError`).
   - Any port binding or Docker conflict.
4. **Technical Root Cause & Fix:**
   - Why did the issue happen? (Explain the underlying system mechanism).
   - How was it fixed? (Exact code change or shell command).
5. **Verification & Proof:**
   - Commands executed (`curl`, `Invoke-RestMethod`, test suites).
   - Response payloads or exit codes proving it works.
6. **Active Ports & Service Health Table:**
   - Core Backend (`3000`)
   - Frontend Dashboard (`5173`)
   - AI Engine (`8001`)

---

## 🚀 Standard Verification Commands
When verifying services or updating the log, test:
- Backend: `http://localhost:3000/servers`
- AI Health: `http://localhost:8001/health`
- AI Traffic ML: `POST http://localhost:8001/predict-traffic`
- AI Ops Copilot: `POST http://localhost:8001/chat`
- Frontend: `http://localhost:5173`
