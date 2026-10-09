# AI-Integrated Automated Deployment Platform for Private Servers

> **Final Year Project (FYP)**  
> Department of Computer Science  
> **Supervisor:** Mr. Amir Zia  

---

## 💡 Project Origin & Motivation: "Coolify + AI Ops"

As computer science students, we wanted an easy way to deploy our web applications without having to pay monthly bills for cloud services like AWS, Vercel, or Heroku. 

While looking for self-hosted solutions, **Salman** discovered an open-source tool called **Coolify** ([coolify.io](https://coolify.io)). Coolify is popular because it lets developers connect to their own private server (or laptop) using SSH and automatically deploy projects using Docker containers. 

However, while testing and using Coolify, we noticed two common problems that students and beginners always struggle with:
1. **Confusing Build Errors:** When a deployment fails (like a port conflict `EADDRINUSE` or `502 Bad Gateway`), Coolify only shows hundreds of lines of raw terminal logs. For a beginner or student developer, it is very hard to figure out what actually broke without searching Google for hours. There was no AI assistant or chatbot to explain the error in plain English.
2. **Containers Crash Without Warning:** Tools like Coolify only alert you after a container has already crashed. They don't give you an early warning if a container is slowly running out of memory (memory leak) or restarting repeatedly.

At the same time, **Talha** was looking for a practical Machine Learning project for our FYP. Instead of doing a typical toy project (like predicting house prices or movie reviews), Talha wanted to solve a real system problem. While watching YouTube engineering channels like **StatQuest with Josh Starmer** and **TechWorld with Nana**, and consulting AI tools for practical ideas, Talha learned about **unsupervised Anomaly Detection using Isolation Forest**. 

We realized we could combine our two ideas into one solid project:
- **Salman's Part (DevOps):** Built a self-hosted platform inspired by Coolify that uses SSH, Docker, and Traefik to automatically deploy apps from GitHub.
- **Talha's Part (AI & ML):** Added a **2-layer AI Copilot** that instantly explains deployment errors in simple words, plus an **Isolation Forest Anomaly Detector** that watches live Docker stats (CPU %, memory %, restart count, network I/O) to warn us if a container starts behaving abnormally *before* it crashes.

We tested our model by writing simple test scripts to inject fake memory leaks and high CPU usage, and the model successfully detected them.

The result is **DeployStack AI**: a beginner-friendly, self-hosted deployment platform that makes hosting apps easy and uses AI to help you catch errors and fix container problems.

---

## 🤖 Core AI Features

### 1. Container Health Anomaly Detection (Isolation Forest)
- Continuously monitors live per-container resource metrics (CPU %, memory %, restart count, network I/O) collected via Docker stats.
- Uses an unsupervised anomaly detection model (**Isolation Forest**) trained on normal container behavior to flag containers that are degrading or about to fail — catching unusual combinations of metrics (e.g. memory climbing + restarts increasing together) that a simple fixed threshold would miss.
- Ground-truth "unhealthy" states are generated via controlled fault injection (simulated memory leaks, CPU spikes, crash loops) so the model's detections can be validated against known-bad states with concrete precision and recall.
- Flags feed into the platform's alerting dashboard so the DevOps side can act before complete downtime occurs.

### 2. Dual-Layer AI Ops Copilot
- **Layer 1 (Zero-Cost Deterministic Engine):** Instant regex pattern catalog for 80% of routine DevOps container errors (`EADDRINUSE`, `502 Bad Gateway`, `ENOTFOUND`, missing `Dockerfile`) with 0ms latency and $0 API cost.
- **Layer 2 (LLM Tool Calling Agent):** Natural-language assistant for explaining novel errors and executing operational commands (e.g. scaling or checking status).

---

## 👥 Project Team

| Name | Roll Number | Role / Specialization |
| :--- | :--- | :--- |
| **Talha Saleem** *(Team Lead)* | `BSCS51F23S012` | AI/ML Implementation and Intelligent Modeling |
| **Salman Khalid** | `BSCS51F23S045` | Platform Engineering, Deployment & DevOps |

---

## 📚 Student & Project References

1. **PaaS Architecture:** Inspired by open-source **Coolify** ([github.com/coolify-io/coolify](https://github.com/coolify-io/coolify)) for agentless SSH orchestration and Traefik container auto-discovery.
2. **Machine Learning Concept:** Learned Isolation Forest from **StatQuest with Josh Starmer** on YouTube (*"Isolation Forest, Clearly Explained!"*) and the official **Scikit-Learn documentation** (`sklearn.ensemble.IsolationForest`).
3. **Container Telemetry:** Docker metrics collection methodology guided by **TechWorld with Nana** on YouTube (*"Docker Container Monitoring & Metrics Explained"*).
4. **AI Pair Programming:** Consulted AI tools (ChatGPT / Claude) for brainstorming the fault-injection validation scripts.
