# Fixes applied (review + repair pass)

Verified in a sandbox with: 52 Python tests, `tsc` + full frontend build from a clean `npm ci`, NestJS build, and an
end-to-end run of the backend against fake `git`/`docker` programs. **Not** verified here (no real Docker, SSH, or
Anthropic key): real container builds, the live Health Monitor against your Docker, Traefik routing, the Claude path.

## Anomaly detector (new plan)
| Problem found in the supplied version | Fix |
|---|---|
| "CPU Spike" preset (95 %) was **not** flagged; "Net Flood" was labelled `memory_leak` | Hybrid detector (Isolation Forest + hard limits); factor attribution normalised per metric |
| Healthy **idle** containers were flagged as `memory_leak` (model never saw an idle container) | Training data now includes idle profiles |
| Live scan fed Docker's **lifetime** NetIO / RestartCount to a model trained on rates, so any long-running container looked like a flood / crash loop | `anomaly/telemetry.py` converts to KB/s and restarts-in-last-10-min |
| `contamination=0.08` => ~8 % false alarms on healthy data; "hold-out" set contained the training data | Clean train/validation/test split, threshold calibrated on validation (1 % FPR) |
| Docs promised score -1..1 and `HEALTHY/DEGRADING/ANOMALOUS`; code returned a bool | Returns `status`, raw score (-1..0), threshold, `detected_by`, factors, message |
| `docker stats` printing `--` crashed the whole scan; `docker` missing in the AI-engine image; no `/metrics` | Safe parsing, docker CLI + socket in compose, Prometheus counters |
| FastAPI 500 on `NaN`/`Infinity` input (error body not JSON-encodable) | Custom 422 handler |

Measured on fresh synthetic faults (`python -m anomaly.evaluate`): hybrid recall ~96 %, precision ~99 %, false alarms
< 1 %. Forest alone: 58 % recall (misses most single-metric faults) but 100 % on combined degradation where fixed
limits get 0 %. Data is synthetic: results describe these scenarios, not your workloads.

## AI engine
- `llm_router`: removed `.replace("to","")` that corrupted app names (`my-store` -> `my-sre`); regex char-class bug;
  tool call after a leading text block was dropped; retired model id -> `claude-sonnet-5-5` (override with `ANTHROPIC_MODEL`);
  tool arguments validated and replicas clamped 1-10.
- Blocking Anthropic call moved off the event loop; CORS allow-list; request validation; scaling uses `ceil`.
- Pickled models were tied to one scikit-learn version and failed silently; now retrained at image build, load errors
  reported in `/health`. `requirements.txt` pinned versions that cannot install on Python 3.14; now ranges.
- Time-ordered train/test split for the (now legacy) traffic model; scripts run from any directory.

## Backend
- **Command injection**: every `exec` string with user input replaced by argument-array `spawn` (no shell); repo URL,
  branch, env names and domain validated (`--upload-pack=...` style options rejected).
- Windows-only shell syntax (`2>nul`, `set`) removed; Docker daemon check instead of CLI check.
- Zero-downtime-ish deploy: previous container parked, health-checked swap, **automatic rollback**; failed deploy no
  longer marks a still-running app `failed`; concurrent deploys rejected; real replica scaling (Traefik load-balances).
- Server API no longer returns SSH private keys; remote servers are really SSH-verified; deploying to a remote server
  now fails loudly instead of silently deploying locally.
- Webhooks: HMAC signature check (`GITHUB_WEBHOOK_SECRET`), exact repo+branch match (was substring match).
- Loopback bind by default, CORS allow-list for REST and Socket.IO, `/health`, graceful shutdown, `.env.example`.

## Frontend
- Missing `vite-env.d.ts` made `npm run build` fail on TypeScript 5.9; API/AI URLs configurable (`VITE_*`);
  status badge now follows the real deployment status; "Re-verify" button works; `scale 3` chat regex typo;
  readable API error messages; Health Monitor shows status/threshold/KB/s.

## DevOps
- **Traefik v3.1 cannot talk to Docker Engine 29+** (your notes say 29.8.1) -> `traefik:v3.6`.
- Prometheus job pointed at Traefik's dashboard port as "cadvisor"; replaced with real targets.
- Ports bound to 127.0.0.1, docker.sock + apps volume for the backend, persistent ACME storage, obsolete `version:` removed.
- `docker network create paas-net` is required once (documented in README).

## Second round: dashboard, logs, delete, persistence
- **Dashboard tab** (`Dashboard.tsx`, `components/Charts.tsx`): dependency-free SVG charts. Container charts poll the AI engine
  every 5 s (history kept in the browser); request rate comes from Traefik metrics in Prometheus (needs the compose stack,
  explains itself when unreachable); deployment charts come from `/deployments`.
- **Logs** (`components/LogViewer.tsx`, `lib/logs.ts`): parsed levels, step folding, filters, search, follow/jump-to-latest,
  copy/download, URLs linkified, deployment history sidebar. The backend now returns `app_url`/`domain_url`/`host_port` on success.
- **App URL**: `DeployBanner` (big Open App button + copy) and a highlighted APP URL row inside the log; links use the browser's
  hostname, so they also work when the dashboard is opened from another machine.
- **Delete**: `DELETE /applications/:id` (`?force=true` if Docker is down). Stops/removes all containers incl. replicas and the
  parked rollback copy, removes images and the checkout (path-checked), frees the port; refused while a deploy runs.
- **Persistence**: JSON files, atomic writes, mode 600, restored on start (interrupted deploys are marked failed).
- Fixed along the way: the dashboard showed the app as `failed` after a failed build although the old version kept running, and
  the app record was updated *after* the "finished" event (UI could read stale status).
- Tests added: 17 frontend tests (parser on real pipeline output, rendering), 28 real-browser checks (run once, not shipped),
  backend delete/persistence scenarios (`backend/test-e2e`).

## Not changed on purpose
- `traffic/` + `/predict-traffic` + Locust file kept (legacy, no longer in the dashboard's main tab) - delete if unwanted.
- Remote (SSH) deployment is still not implemented; it now says so.
- `PROGRESS_HANDOVER.md` / `MASTER_PROJECT_LOG.md` untouched. Removed duplicate `docs/log_pattern_engine.py`.
- Reinstall dependencies on your machine (`npm install`): the zipped `node_modules` came from Windows.
