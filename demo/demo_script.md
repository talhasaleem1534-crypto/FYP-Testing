# Demo Day & FYP Viva Presentation Script (`demo_script.md`)

## 1. Introduction & Problem Statement (2 Minutes)
- **Problem:** Cloud provider lock-in (AWS/GCP/Azure) is expensive and complex for private infrastructure, while raw server administration requires tedious manual reverse proxy configuration and shell scripting.
- **Solution:** A self-hosted Private-Server PaaS with zero-touch Traefik routing, an Isolation Forest container-health anomaly detector, and an Ops Copilot Chatbot.

---

## 2. Live Demo Part 1: Register Server & Deploy App (3 Minutes)
1. **Server Registration:**
   - Register a private host target over SSH.
   - Show automatic verification and creation of `paas-net`.
2. **App Creation & Git Deploy:**
   - Connect a Git repository (`https://github.com/user/my-blog`).
   - Trigger deployment: show live terminal streaming stdout/stderr over WebSockets.
   - Show container running with dynamic Traefik labels routing `Host("blog.example.com")`.

---

## 3. Live Demo Part 2: Ops Copilot Chatbot (3 Minutes)
1. **Instant Layer-1 Log Diagnosis (Zero Latency & $0 Cost):**
   - Query: `"Why did my deploy fail? Log: listen EADDRINUSE: address already in use :::3000"`
   - Output: Instant regex diagnosis identifying port collision and actionable fix.
2. **Layer-2 Natural Language Action Execution:**
   - Query: `"Deploy my-blog"` or `"Scale my-blog to 3 replicas"`
   - Output: Claude tool call triggers backend API endpoint and returns live deployment/scaling status.

---

## 4. Live Demo Part 3: Container Health & Anomaly Detection (3 Minutes)
1. Open **Health Monitor** and press **Scan Live Containers** (or enable Auto-Scan). Healthy containers show `HEALTHY`; network is in KB/s and restarts are counted over the last 10 minutes.
2. In the **Fault Injection Test Bench** run the presets: Normal -> `HEALTHY`; Memory Leak, CPU Spike, Crash Loop, Net Flood -> `ANOMALOUS` with the right primary factor.
3. Show the case a fixed threshold cannot express: set CPU 55, Memory 62, Restarts 2, Net In 550, Net Out 300. No single metric is alarming, but the Isolation Forest flags the combination (`Detected by: model`).
4. Optional load: `locust -f demo/locustfile.py --host=http://localhost --users 300 --spawn-rate 50` against a deployed app and watch its CPU and network rise in the scan.
5. Quote the validation: `python -m anomaly.evaluate` (synthetic fault injection on fresh data, never seen in training).

---

## 5. Defense Q&A Cheatsheet
- **Why SSH instead of Docker Remote API over TCP?** Exposing Docker TCP ports publicly is a major security risk. SSH is encrypted, standard, and audited.
- **Why Traefik labels over Nginx config generation?** Traefik dynamically reloads routing tables directly from the Docker socket without error-prone template generation or restarting proxy processes.
- **Why Isolation Forest *and* hard limits?** Measured on injected faults the forest alone misses most single-metric faults (it only learns what healthy looks like), while fixed limits cannot see combined degradation at all. The hybrid keeps both strengths. Be ready to say the validation data is synthetic.
- **Why does the collector turn Docker counters into rates?** `docker stats` network totals and `RestartCount` are lifetime counters; feeding them straight to the model would flag every long-running container.
- **Why a two-layer chatbot?** Pure LLM calls on every message are slow and costly. 80% of common errors are deterministic; reserving the LLM for novel queries and tool calling is the right architectural choice.
