import { Brand } from './components/Brand';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import {
  Server as ServerIcon, Layers, Terminal, Bot, TrendingUp,
  Plus, Minus, Play, RefreshCw, CheckCircle2, Cpu,
  Globe, GitBranch, Send, Loader2, AlertTriangle,
  FlaskConical, ExternalLink, Activity, Gauge, UserRound,
  LayoutDashboard, Trash2, History, LogOut, Users, HardDrive,
} from 'lucide-react';
import LogViewer from './components/LogViewer';
import DeployBanner from './components/DeployBanner';
import Dashboard, { DeploymentRec } from './Dashboard';
import { useTelemetry, useTraffic } from './lib/telemetry';
import { firstError, parseLogs } from './lib/logs';
import { BACKEND_URL, getAuthToken, tryBackend } from './lib/backend';
import AdminCustomers from './AdminCustomers';
import AdminStorage from './AdminStorage';
import ServerOnboarding from './components/ServerOnboarding';
import ServerCard from './components/ServerCard';
import { ServerRecord } from './lib/servers';
import { Customer } from './lib/auth';
import NewAppWizard, { NewAppPayload } from './NewAppWizard';
import Modal from './components/Modal';
import { FALLBACK_APP_TYPES } from './lib/appTypes';
import { PageHead, Help, StatusLegend, APP_STATUS_LEGEND, SERVER_STATUS_LEGEND } from './components/ui';

const envAi = import.meta.env.VITE_AI_ENGINE_URL;
const envProm = import.meta.env.VITE_PROMETHEUS_URL;
const isRemoteHost = typeof window !== 'undefined' && window.location?.hostname && !['localhost', '127.0.0.1'].includes(window.location.hostname);
const AI_ENGINE_URL: string = isRemoteHost ? `http://${window.location.hostname}:8001` : (envAi || 'http://localhost:8001');
const PROM_URL: string = isRemoteHost ? `http://${window.location.hostname}:9090` : (envProm || 'http://localhost:9090');
const MAX_LOG_ENTRIES = 3000;

// ── Types ────────────────────────────────────────────────────────────────────
interface AppRecord {
  id: string; name: string; repo_url: string; branch: string;
  domain: string; port: number; host_port?: number; replicas: number; status: string;
  current_commit_sha?: string; server_id: string; app_type?: string; owner_id?: string;
  /** http://<server IP>:<port> for apps on a Linux server; empty when it runs on the platform machine. */
  app_url?: string | null;
}
interface ChatMsg { sender: 'user' | 'bot'; text: string; source?: string; }

// ── Demo seed data ───────────────────────────────────────────────────────────
const DEMO_SERVERS: ServerRecord[] = [
  { id: 'demo-srv-1', name: 'home-lab-01', host: '192.168.1.50', port: 22, ssh_user: 'deploy', status: 'verified', docker_version: 'Docker 27.0.3 (simulated)' },
  { id: 'demo-srv-2', name: 'local-dev', host: '127.0.0.1', port: 22, ssh_user: 'deploy', status: 'verified', docker_version: 'Docker 26.1.4 (simulated)' },
];
const DEMO_APPS: AppRecord[] = [
  { id: 'demo-app-1', name: 'my-portfolio', repo_url: 'https://github.com/vercel/next.js', branch: 'main', domain: 'portfolio.local', port: 3000, replicas: 1, status: 'running', current_commit_sha: 'a1b2c3d', server_id: 'demo-srv-1', app_type: 'nextjs' },
  { id: 'demo-app-2', name: 'api-service', repo_url: 'https://github.com/expressjs/express', branch: 'master', domain: 'api.local', port: 4000, replicas: 2, status: 'idle', current_commit_sha: 'e4f5g6h', server_id: 'demo-srv-2', app_type: 'node' },
];

// Where to open a running app: its published host port on the machine serving the dashboard, else its domain.
const appHref = (a: { host_port?: number; domain: string; app_url?: string | null }) =>
  a.app_url ? a.app_url : a.host_port ? `http://${window.location.hostname}:${a.host_port}` : `http://${a.domain}`;

const relTime = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86400)} d ago`;
};

function makeDemoDeployments(): DeploymentRec[] {
  const out: DeploymentRec[] = [];
  const apps = ['my-portfolio', 'api-service'];
  for (let i = 0; i < 14; i++) {
    const start = Date.now() - (i * 0.9 + Math.random() * 0.6) * 86400000;
    const ok = Math.random() > 0.2;
    out.push({
      id: `demo-dep-${i}`, app_name: apps[i % 2], status: ok ? 'success' : 'failed',
      commit_sha: Math.random().toString(16).slice(2, 9), created_at: new Date(start).toISOString(),
      finished_at: new Date(start + (40 + Math.random() * 90) * 1000).toISOString(),
    });
  }
  return out;
}

// ── Simulated deployment log lines ───────────────────────────────────────────
const buildSimLogs = (appName: string, domain: string) => [
  `--- Deployment Pipeline: ${appName} ---`,
  `🔗 Repository: https://github.com/sample/${appName} (branch: main)`,
  `📡 SSH tunnel established to target server home-lab-01 (192.168.1.50)`,
  `📦 Step 1/4: Fetching code...`,
  `  > mkdir -p /apps && git clone -b main https://github.com/sample/${appName} /apps/${appName}`,
  `  Cloning into '/apps/${appName}'... done.`,
  `🔨 Step 2/4: Building Docker image ${appName}:a1b2c3d...`,
  `  Step 1/8 : FROM node:20-alpine`,
  `  Step 2/8 : WORKDIR /app`,
  `  Step 3/8 : COPY package*.json ./`,
  `  Step 4/8 : RUN npm install --production`,
  `  Step 5/8 : COPY . .`,
  `  Step 6/8 : RUN npm run build`,
  `  Step 7/8 : EXPOSE ${3000}`,
  `  Step 8/8 : CMD ["node","dist/main"]`,
  `  Successfully built image ${appName}:a1b2c3d`,
  `🌐 Step 3/4: Attaching Traefik routing labels...`,
  `  --label "traefik.enable=true"`,
  `  --label "traefik.http.routers.${appName}.rule=Host(\`${domain}\`)"`,
  `  --label "traefik.http.routers.${appName}.tls.certresolver=letsencrypt"`,
  `  --label "traefik.http.services.${appName}.loadbalancer.server.port=3000"`,
  `🚢 Step 4/4: Container swap (zero-downtime)...`,
  `  Starting: docker run -d --name ${appName}-new --network paas-net ...`,
  `  Container ${appName}-new is healthy.`,
  `  Stopping old container ${appName}... done.`,
  `  Renamed ${appName}-new → ${appName}`,
  `  Traefik auto-updated routing table. No restart needed.`,
  `✅ Deployment COMPLETE! App '${appName}' is live.`,
  `🌐 App URL:     https://${domain}`,
];

// ── API helpers (try real backend, fallback gracefully) ───────────────────────
const tryAI = async (body: object) => {
  const r = await fetch(`${AI_ENGINE_URL}/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
};

// ── Subcomponents ─────────────────────────────────────────────────────────────
/** A labelled input with an optional example line under it (.field / .lbl / .input / .hint). */
function Field({ label, placeholder, value, onChange, type = 'text', mono = false, hint, min, max }: {
  label: string; placeholder?: string; value: string; onChange: (v: string) => void; type?: string; mono?: boolean;
  /** One line under the box: what to type, with an example. */
  hint?: React.ReactNode; min?: number | string; max?: number | string;
}) {
  return (
    <label className="field">
      <span className="lbl">{label}</span>
      <input className="input" type={type} placeholder={placeholder} value={value} min={min} max={max} onChange={e => onChange(e.target.value)}
        style={mono ? { fontFamily: 'var(--font-mono)' } : undefined} />
      {hint && <div className="hint">{hint}</div>}
    </label>
  );
}

function Badge({ status }: { status: string }) {
  const cls = ['running', 'verified', 'success'].includes(status) ? 'badge-verified'
    : ['building', 'deploying', 'pending'].includes(status) ? 'badge-building'
    : ['failed', 'unreachable'].includes(status) ? 'badge-failed' : 'badge-idle';
  return <span className={`badge ${cls}`}>{status}</span>;
}

/** Page title + one sentence. Kept as a thin wrapper so the tabs read the same as the customer portal. */
function Header({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return <PageHead title={title} text={subtitle} actions={action} />;
}

/** A short warning or error line. `color` is kept for the callers; only "error" changes the look. */
function Callout({ color, children }: { color?: 'warn' | 'error' | string; children: React.ReactNode }) {
  const error = color === 'error';
  return (
    <div className={`note ${error ? 'note-error' : 'note-warn'}`} role={error ? 'alert' : undefined} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
      <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 2 }} />
      <span>{children}</span>
    </div>
  );
}

function Empty({ icon, title, subtitle, action }: { icon: React.ReactNode; title: string; subtitle: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <h3>{title}</h3>
      <p>{subtitle}</p>
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  );
}

/** The spinning "working" icon. */
const Spin = ({ size = 14 }: { size?: number }) => <Loader2 size={size} style={{ animation: 'spin 1s linear infinite' }} />;

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App({ customer, onLogout, startInDemo = false }: {
  customer?: Customer; onLogout?: () => void; startInDemo?: boolean;
} = {}) {
  const [tab, setTab] = useState<'dashboard' | 'apps' | 'servers' | 'customers' | 'storage' | 'terminal' | 'copilot' | 'metrics'>('apps');
  // Customer id -> email, so app cards can show who owns each app.
  const [owners, setOwners] = useState<Record<string, string>>({});
  const [demoMode, setDemoMode] = useState(startInDemo);
  const [backendOk, setBackendOk] = useState(false);
  const [aiOk, setAiOk] = useState(false);

  // Servers
  const [servers, setServers] = useState<ServerRecord[]>([]);
  const [srvModal, setSrvModal] = useState(false);
  const [srvBusy, setSrvBusy] = useState<string | null>(null);

  // Apps
  const [apps, setApps] = useState<AppRecord[]>([]);
  const [appModal, setAppModal] = useState(false);
  const [deployingId, setDeployingId] = useState<string | null>(null);

  // Terminal
  const [logs, setLogs] = useState<string[]>(['[Platform] Dashboard ready. Use Demo Mode or connect to backend.']);
  const [deployStatus, setDeployStatus] = useState('idle');
  const termRef = useRef<HTMLDivElement>(null);

  // Copilot
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([
    { sender: 'bot', text: "Hi, I am your Ops Copilot. Ask me to deploy an app, scale it, or paste an error line from a deploy log and I will explain it.", source: 'system' }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);

  // Traffic (kept for reference)
  const [traffic, setTraffic] = useState({ current: '420', lag1: '390', lag5: '310', lag15: '220' });
  const [prediction, setPrediction] = useState<{ predicted: number; decision: string; replicas: number } | null>(null);
  const [predicting, setPredicting] = useState(false);

  // ── Container Health / Anomaly Monitor ─────────────────────────────────────
  interface ContainerHealth {
    container_name: string;
    cpu_percent: number;
    mem_percent: number;
    restart_count: number;
    net_in_kb: number;
    net_out_kb: number;
    is_anomaly: boolean;
    score: number | null;
    dominant_factor: string | null;
    confidence: string;
    status?: 'HEALTHY' | 'DEGRADING' | 'ANOMALOUS';
    threshold?: number | null;
    detected_by?: string | null;
    message?: string;
    contributing_factors?: string[];
    warming_up?: boolean;
  }
  const [containerHealth, setContainerHealth] = useState<ContainerHealth[]>([]);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState('');
  const [autoScan, setAutoScan] = useState(false);
  const [scanMsg, setScanMsg] = useState('');
  // Fault-injection demo state
  const [injectForm, setInjectForm] = useState({
    container_name: 'demo-container',
    cpu_percent: '18',
    mem_percent: '30',
    restart_count: '0',
    net_in_kb: '150',
    net_out_kb: '80',
  });
  const [injectResult, setInjectResult] = useState<ContainerHealth | null>(null);
  const [injecting, setInjecting] = useState(false);

  // dashboard / deployments / delete
  const [deployments, setDeployments] = useState<(DeploymentRec & { logs?: string[] })[]>([]);
  const [selectedDep, setSelectedDep] = useState<string>('live');
  const [lastDeploy, setLastDeploy] = useState<{ id?: string; appName: string; status: string; url?: string; domainUrl?: string; simulated?: boolean } | null>(null);
  const [windowMs, setWindowMs] = useState(15 * 60e3);
  const [delTarget, setDelTarget] = useState<AppRecord | null>(null);
  const [delBusy, setDelBusy] = useState(false);
  const [logFilterReq, setLogFilterReq] = useState<{ value: 'all' | 'error' | 'warn' | 'step'; nonce: number }>({ value: 'all', nonce: 0 });
  const [delErr, setDelErr] = useState('');
  const telemetry = useTelemetry({ enabled: demoMode || aiOk, demo: demoMode, aiUrl: AI_ENGINE_URL });
  const traffic2 = useTraffic({ enabled: tab === 'dashboard', demo: demoMode, promUrl: PROM_URL, windowMs });
  const loadDeployments = useCallback(() => { tryBackend('/deployments').then(setDeployments).catch(() => {}); }, []);

  const verifyServer = async (srv: ServerRecord) => {
    if (demoMode || !backendOk) { addLog(`[Simulated] Server '${srv.name}' re-verified.`); return; }
    setSrvBusy(srv.id);
    try {
      const r = await tryBackend(`/servers/${srv.id}/verify`, 'POST', {});
      setServers(p => p.map(s => (s.id === srv.id ? r : s)));
      addLog(`Server '${srv.name}' re-verified: ${r.status}${r.last_error ? ` (${r.last_error})` : ''}`);
    } catch (e: any) { addLog(`Verify error: ${e.message}`); } finally { setSrvBusy(null); }
  };

  /** Let customers deploy to this server, or stop them. */
  const shareServer = async (srv: ServerRecord, shared: boolean) => {
    if (demoMode || !backendOk) { setServers(p => p.map(s => (s.id === srv.id ? { ...s, shared } : s))); return; }
    setSrvBusy(srv.id);
    try {
      const r = await tryBackend(`/servers/${srv.id}`, 'PATCH', { shared });
      setServers(p => p.map(s => (s.id === srv.id ? r : s)));
    } catch (e: any) { addLog(`Share error: ${e.message}`); } finally { setSrvBusy(null); }
  };

  const removeServer = async (srv: ServerRecord) => {
    if (!window.confirm(`Remove server '${srv.name}' from the platform? (Nothing on the server itself is deleted.)`)) return;
    if (demoMode || !backendOk) { setServers(p => p.filter(s => s.id !== srv.id)); return; }
    setSrvBusy(srv.id);
    try {
      await tryBackend(`/servers/${srv.id}`, 'DELETE');
      setServers(p => p.filter(s => s.id !== srv.id));
    } catch (e: any) { window.alert(e.message); } finally { setSrvBusy(null); }
  };

  const addLog = (line: string) => setLogs(p => [...p.slice(-(MAX_LOG_ENTRIES - 1)), `[${new Date().toLocaleTimeString()}] ${line}`]);

  useEffect(() => { chatRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMsgs]);

  // ── Health checks ───────────────────────────────────────────────────────────
  useEffect(() => {
    const check = async () => {
      try { const r = await fetch(`${BACKEND_URL}/health`, { signal: AbortSignal.timeout(2000) }); setBackendOk(r.ok); } catch { setBackendOk(false); }
      try {
        const r = await fetch(`${AI_ENGINE_URL}/health`, { signal: AbortSignal.timeout(2000) });
        setAiOk(r.ok);
      } catch { setAiOk(false); }
    };
    check();
    const t = setInterval(check, 8000);
    return () => clearInterval(t);
  }, []);

  // ── Load from backend or demo ───────────────────────────────────────────────
  useEffect(() => {
    if (demoMode) { setServers(DEMO_SERVERS); setApps(DEMO_APPS); setDeployments(makeDemoDeployments()); return; }
    if (backendOk) {
      tryBackend('/servers').then(setServers).catch(() => {});
      tryBackend('/applications').then(setApps).catch(() => {});
      tryBackend('/admin/customers')
        .then((rows: { id: string; email: string }[]) => setOwners(Object.fromEntries(rows.map(r => [r.id, r.email]))))
        .catch(() => {});
      loadDeployments();
    }
  }, [demoMode, backendOk, loadDeployments]);

  // ── Real-time Socket.IO logs & events ─────────────────────────────
  useEffect(() => {
    if (!backendOk || demoMode) return;
    // The admin's login token: the backend only streams logs to signed-in users.
    const socket = io(BACKEND_URL, { auth: { token: getAuthToken() } });
    socket.on('global_deploy_log', (data: { deploymentId: string; log: string }) => {
      // The backend already prefixes its own timestamp, so don't add a second one.
      setLogs(p => [...p.slice(-(MAX_LOG_ENTRIES - 1)), data.log]);
    });
    socket.on('global_status_change', (data: { deploymentId?: string; status?: string }) => {
      if (data?.status) setDeployStatus(data.status);
      tryBackend('/applications').then(setApps).catch(() => {});
      loadDeployments();
      if (data?.status === 'building') setLastDeploy(null);
      if (data?.deploymentId && (data.status === 'success' || data.status === 'failed')) {
        tryBackend(`/deployments/${data.deploymentId}`).then((d: DeploymentRec) => setLastDeploy({
          id: d.id, appName: d.app_name, status: d.status,
          url: d.app_url && !d.app_url.includes('localhost') ? d.app_url : d.host_port ? `http://${window.location.hostname}:${d.host_port}` : d.app_url, domainUrl: d.domain_url,
        })).catch(() => {});
      }
    });
    return () => { socket.disconnect(); };
  }, [backendOk, demoMode, loadDeployments]);

  // ── Toggle demo mode ────────────────────────────────────────────────────────
  const toggleDemo = () => {
    const next = !demoMode;
    setDemoMode(next);
    if (next) {
      setServers(DEMO_SERVERS); setApps(DEMO_APPS);
      setLogs(['[Demo Mode] Loaded sample servers and applications. All actions are simulated locally.']);
    } else {
      setServers([]); setApps([]);
      setLogs(['[Live Mode] Demo data cleared. Connect to backend to manage real servers.']);
    }
  };

  // ── Create Application ───────────────────────────────────────────────────────
  // Called by the New Application wizard. Throws (the wizard shows the message) on failure.
  const createApp = async (form: NewAppPayload, deployNow: boolean) => {
    const cleanName = form.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    let app: AppRecord;
    if (demoMode || !backendOk) {
      await new Promise(r => setTimeout(r, 800));
      app = {
        id: 'app-' + Date.now(), name: cleanName, repo_url: form.repo_url, branch: form.branch,
        domain: form.domain, port: form.port, replicas: 1, status: 'idle',
        server_id: form.server_id, app_type: form.app_type,
      };
      addLog(`[Simulated] Application '${app.name}' (${form.app_type}) created → ${app.domain}`);
    } else {
      app = await tryBackend('/applications', 'POST', { ...form, name: cleanName, build_method: 'dockerfile', env_vars: {} });
      addLog(`Application '${app.name}' created.`);
    }
    setApps(p => [...p, app]);
    setAppModal(false);
    if (deployNow) deployApp(app);
  };

  // ── Deploy ───────────────────────────────────────────────────────────────────
  const deployApp = async (app: AppRecord) => {
    setDeployingId(app.id); setTab('terminal'); setDeployStatus('building');
    setSelectedDep('live'); setLogs([]); setLastDeploy({ appName: app.name, status: 'building' });
    setApps(p => p.map(a => a.id === app.id ? { ...a, status: 'building' } : a));
    const simLogs = buildSimLogs(app.name, app.domain);

    if (demoMode || !backendOk) {
      // Simulate the pipeline step by step
      for (let i = 0; i < simLogs.length; i++) {
        await new Promise(r => setTimeout(r, 120 + Math.random() * 200));
        addLog(simLogs[i]);
      }
      const t0 = Date.now() - 45000;
      setApps(p => p.map(a => a.id === app.id ? { ...a, status: 'running', current_commit_sha: 'a1b2c3d' } : a));
      setDeployStatus('success');
      setDeployments(p => [{
        id: `demo-${Date.now()}`, app_name: app.name, status: 'success', commit_sha: 'a1b2c3d',
        created_at: new Date(t0).toISOString(), finished_at: new Date().toISOString(),
        logs: simLogs.map(l => `[${new Date().toLocaleTimeString()}] ${l}`),
      }, ...p]);
      setLastDeploy({ appName: app.name, status: 'success', url: `https://${app.domain}`, simulated: true });
    } else {
      try {
        addLog(`Triggering deployment for ${app.name}...`);
        const result = await tryBackend(`/applications/${app.id}/deploy`, 'POST', {});
        setApps(p => p.map(a => a.id === app.id ? { ...a, status: 'building' } : a));
        setDeployStatus('building');
      } catch (e: any) {
        addLog(`ERROR: ${e.message}`); setDeployStatus('failed'); setLastDeploy({ appName: app.name, status: 'failed' });
        setApps(p => p.map(a => a.id === app.id ? { ...a, status: 'failed' } : a));
      }
    }
    setDeployingId(null);
  };

  // ── Delete ───────────────────────────────────────────────────────────────────
  const deleteApp = async (force = false) => {
    if (!delTarget) return;
    const app = delTarget;
    setDelBusy(true); setDelErr('');
    try {
      if (demoMode || !backendOk) {
        await new Promise(r => setTimeout(r, 500));
        addLog(`[Simulated] Application '${app.name}' deleted (containers, images and files removed).`);
      } else {
        const res = await tryBackend(`/applications/${app.id}${force ? '?force=true' : ''}`, 'DELETE');
        addLog(`Application '${app.name}' deleted: ${res.removed_containers?.length ?? 0} container(s) and ${res.removed_images ?? 0} image(s) removed${res.removed_files ? ', checkout deleted' : ''}.`);
        (res.warnings || []).forEach((w: string) => addLog(`Warning: ${w}`));
        loadDeployments();
      }
      setApps(p => p.filter(a => a.id !== app.id));
      setLastDeploy(l => (l && l.appName === app.name ? null : l));
      setDelTarget(null);
    } catch (e: any) {
      setDelErr(e.message);
    } finally { setDelBusy(false); }
  };

  // ── Scale ─────────────────────────────────────────────────────────────────────
  const scaleApp = async (app: AppRecord, delta: number) => {
    const next = Math.max(1, Math.min(10, app.replicas + delta));
    if (demoMode || !backendOk) {
      setApps(p => p.map(a => a.id === app.id ? { ...a, replicas: next } : a));
      addLog(`[Simulated] Scaled '${app.name}' → ${next} replica(s). Traefik load-balancing updated.`);
    } else {
      try {
        const res = await tryBackend(`/applications/${app.id}/scale`, 'POST', { replicas: next });
        const target = res.replicas_requested ?? next;
        setApps(p => p.map(a => a.id === app.id ? { ...a, replicas: target } : a));
        addLog(res.status === 'pending_first_deploy'
          ? `'${app.name}' will run ${target} replica(s) after its first deploy`
          : `Scaled '${app.name}' → ${res.replicas_running ?? target} replica(s) running`);
      } catch (e: any) { addLog(`Scale error: ${e.message}`); }
    }
  };

  // ── Chat ─────────────────────────────────────────────────────────────────────
  const sendChat = async (msg?: string, logText?: string) => {
    const message = (msg || chatInput).trim();
    if (!message) return;
    setChatInput(''); setChatBusy(true);
    setChatMsgs(p => [...p, { sender: 'user', text: message }]);

    try {
      if (aiOk) {
        const data = await tryAI({ message, log_text: logText });
        setChatMsgs(p => [...p, { sender: 'bot', text: data.reply, source: data.source }]);
      } else { throw new Error('AI offline'); }
    } catch {
      // Fully local fallback
      const low = `${message} ${logText || ''}`.toLowerCase();
      let reply = '';
      let source = 'local_pattern_engine';

      if (low.includes('eaddrinuse') || low.includes('address already in use')) {
        reply = '🔍 Port Conflict detected (EADDRINUSE)\n\n**Diagnosis:** Another process is already binding to the port your container tried to use.\n\n**Fix:** Run `docker ps` to find stale containers and stop them, or change the port in your app\'s deploy config.';
      } else if (low.includes('502') || low.includes('bad gateway')) {
        reply = '🔍 502 Bad Gateway\n\n**Diagnosis:** Traefik can reach your domain but the container isn\'t responding on its declared port.\n\n**Fix:** Check the container is running (`docker ps`) and is actually listening on the port set in your app config.';
      } else if (low.includes('enotfound') || low.includes('getaddrinfo')) {
        reply = '🔍 DNS Resolution Failed (ENOTFOUND)\n\n**Diagnosis:** Your app is trying to connect to a hostname it can\'t resolve — usually a database or service.\n\n**Fix:** Check env vars for typos in the hostname, and make sure both containers are on the same `paas-net` Docker network.';
      } else if (low.includes('permission denied')) {
        reply = '🔍 Permission Denied\n\n**Diagnosis:** File or socket permission error — commonly `/var/run/docker.sock` access or a mounted volume ownership issue.\n\n**Fix:** Verify the container user has write access to the mounted path.';
      } else if (low.match(/deploy\s+\S+/)) {
        const appName = low.match(/deploy\s+(\S+)/)?.[1] || 'app';
        const target = apps.find(a => a.name.includes(appName) || appName.includes(a.name));
        reply = target
          ? `🚀 Initiating deployment for **${target.name}**...`
          : `🚀 Tool: \`deploy_application\` → app: "${appName}"\n\nNo app named "${appName}" found in your registered apps. Create it first via "New Application".`;
        source = 'llm_tool_call (simulated)';
        if (target) setTimeout(() => deployApp(target), 500);
      } else if (low.match(/scale\s+\S+\s+(?:to\s+)?\d+/)) {
        const m = low.match(/scale\s+(\S+)\s+(?:to\s+)?(\d+)/);
        if (m) {
          reply = `⚖️ Tool: \`scale_application\` → app: "${m[1]}", replicas: ${m[2]}\n\nTraefik will load-balance automatically across all replicas.`;
          source = 'llm_tool_call (simulated)';
          const target = apps.find(a => a.name.includes(m[1]));
          if (target) scaleApp(target, parseInt(m[2]) - target.replicas);
        }
      } else {
        reply = '🤖 Ops Copilot is running locally (AI Engine offline).\n\nYou can ask me to:\n• **Diagnose errors**: paste `EADDRINUSE`, `502 Bad Gateway`, `ENOTFOUND`, `permission denied`\n• **Deploy**: "deploy my-portfolio"\n• **Scale**: "scale api-service to 3 replicas"\n\nFor full LLM responses, start the AI Engine: `cd ai-engine && uvicorn chatbot.main:app --port 8001`';
        source = 'local_fallback';
      }
      setChatMsgs(p => [...p, { sender: 'bot', text: reply, source }]);
    }
    setChatBusy(false);
  };

  // ── Traffic Predictor ─────────────────────────────────────────────────────────
  const runPredict = async () => {
    setPredicting(true);
    const c = parseFloat(traffic.current) || 0;
    const l1 = parseFloat(traffic.lag1) || 0;
    const l5 = parseFloat(traffic.lag5) || 0;
    const l15 = parseFloat(traffic.lag15) || 0;
    const cur = apps[0]?.replicas ?? 1;

    try {
      const res = await fetch(`${AI_ENGINE_URL}/predict-traffic`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_rate: c, lag_1m: l1, lag_5m: l5, lag_15m: l15, current_replicas: cur, capacity_per_replica: 120 }),
      });
      if (res.ok) {
        const data = await res.json();
        setPrediction({ predicted: data.predicted_traffic, decision: data.decision, replicas: data.recommended_replicas });
        setPredicting(false);
        return;
      }
    } catch { /* fallback */ }

    const pred = c * 0.5 + l1 * 0.3 + l5 * 0.15 + l15 * 0.05;
    const rec = Math.max(1, Math.min(10, Math.ceil(pred / 120)));
    const dec = rec > cur ? 'SCALE_UP' : rec < cur ? 'SCALE_DOWN' : 'HOLD';
    setPrediction({ predicted: parseFloat(pred.toFixed(1)), decision: dec, replicas: rec });
    setPredicting(false);
  };

  // ── Container Health Scanner ────────────────────────────────────────────────
  const scanContainerHealth = useCallback(async () => {
    setHealthLoading(true);
    setHealthError('');
    try {
      const res = await fetch(`${AI_ENGINE_URL}/containers/anomaly`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      if (data.error) {
        // No real containers — show empty state with message
        setHealthError(data.error);
        setContainerHealth([]);
      } else {
        setContainerHealth(data.containers || []);
        setScanMsg(`Last scan: ${new Date().toLocaleTimeString()} · ${(data.containers || []).length} container(s) checked`);
      }
    } catch (e: any) {
      setHealthError(`AI Engine unreachable: ${e.message}`);
    } finally {
      setHealthLoading(false);
    }
  }, []);

  // Auto-scan every 10 seconds when enabled
  useEffect(() => {
    if (!autoScan) return;
    scanContainerHealth();
    const t = setInterval(scanContainerHealth, 10000);
    return () => clearInterval(t);
  }, [autoScan, scanContainerHealth]);

  // Fault-injection manual test
  const runFaultInject = async () => {
    setInjecting(true);
    setInjectResult(null);
    try {
      const body = {
        container_name: injectForm.container_name,
        cpu_percent: parseFloat(injectForm.cpu_percent) || 0,
        mem_percent: parseFloat(injectForm.mem_percent) || 0,
        restart_count: parseInt(injectForm.restart_count) || 0,
        net_in_kb: parseFloat(injectForm.net_in_kb) || 0,
        net_out_kb: parseFloat(injectForm.net_out_kb) || 0,
      };
      const res = await fetch(`${AI_ENGINE_URL}/predict-anomaly`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      setInjectResult(await res.json());
    } catch (e: any) {
      setHealthError(`Fault injection failed: ${e.message}`);
    } finally {
      setInjecting(false);
    }
  };


  // Preset fault scenarios (`ok` = the model should call it healthy; shown as a green / red dot)
  const faultPresets = [
    { label: 'Normal', ok: true, values: { cpu_percent: '18', mem_percent: '30', restart_count: '0', net_in_kb: '150', net_out_kb: '80' } },
    { label: 'Memory leak', ok: false, values: { cpu_percent: '22', mem_percent: '92', restart_count: '1', net_in_kb: '160', net_out_kb: '90' } },
    { label: 'CPU spike', ok: false, values: { cpu_percent: '95', mem_percent: '35', restart_count: '0', net_in_kb: '140', net_out_kb: '75' } },
    { label: 'Crash loop', ok: false, values: { cpu_percent: '30', mem_percent: '40', restart_count: '12', net_in_kb: '120', net_out_kb: '60' } },
    { label: 'Net flood', ok: false, values: { cpu_percent: '20', mem_percent: '32', restart_count: '0', net_in_kb: '2400', net_out_kb: '1900' } },
  ];

  const NAV = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, group: 'Workspace' },
    { id: 'apps', label: 'Applications', icon: Layers, group: 'Workspace' },
    { id: 'servers', label: 'Private Servers', icon: ServerIcon, group: 'Workspace' },
    { id: 'customers', label: 'Customers', icon: Users, group: 'People & data' },
    { id: 'storage', label: 'Data & Storage', icon: HardDrive, group: 'People & data' },
    { id: 'terminal', label: 'Deploy Logs', icon: Terminal, group: 'Operations' },
    { id: 'copilot', label: 'Ops Copilot', icon: Bot, badge: 'AI', group: 'Operations' },
    { id: 'metrics', label: 'Health Monitor', icon: Activity, badge: 'ML', group: 'Operations' },
  ];
  const NAV_GROUPS = ['Workspace', 'People & data', 'Operations'];

  const serverName = (id: string) => servers.find(s => s.id === id)?.name || 'not set';
  const typeLabel = (t?: string) => FALLBACK_APP_TYPES.find(x => x.id === t)?.label || t;
  const healthCls = (c: { is_anomaly: boolean; status?: string }) => c.is_anomaly ? 'badge-failed' : c.status === 'DEGRADING' ? 'badge-building' : 'badge-running';
  const healthWord = (c: { is_anomaly: boolean; status?: string }) => c.is_anomaly ? 'anomalous' : c.status === 'DEGRADING' ? 'degrading' : 'healthy';
  const healthPanel = (c: { is_anomaly: boolean; status?: string }) => c.is_anomaly ? 'panel bad' : c.status === 'DEGRADING' ? 'panel' : 'panel ok';
  const nice = (s: string) => s.replace(/_/g, ' ');
  const backendNote = (
    <Callout>
      The backend (port 3000) is not reachable, so nothing real can be loaded. Turn on <strong>Demo mode</strong> in the sidebar to try the page with sample data, or start it on this laptop: <code>cd core-platform/backend &amp;&amp; npm run start:dev</code>
    </Callout>
  );

  return (
    <div className="shell">

      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="brand"><Brand subtitle="Admin site" /></div>

        {/* Demo mode: sample servers and apps, every action simulated in the browser */}
        <button type="button" className="nav-item" onClick={toggleDemo} aria-pressed={demoMode}
          title={demoMode ? 'Turn demo mode off and go back to real data' : 'Load sample data; nothing is sent to a server'}>
          <FlaskConical size={16} />
          <span style={{ flex: 1 }}>Demo mode: {demoMode ? 'on' : 'off'} - simulated data</span>
          {demoMode && <span className="pill">DEMO</span>}
        </button>

        <nav aria-label="Admin pages" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {NAV_GROUPS.map(g => (
            <React.Fragment key={g}>
              <div className="grp">{g}</div>
              {NAV.filter(n => n.group === g).map(({ id, label, icon: Icon, badge }) => (
                <button key={id} type="button" className="nav-item" onClick={() => setTab(id as any)} aria-current={tab === id ? 'page' : undefined}>
                  <Icon size={16} />
                  <span>{label}</span>
                  {badge && <span className="pill">{badge}</span>}
                </button>
              ))}
            </React.Fragment>
          ))}
        </nav>

        <div className="foot">
          {customer && (
            <div className="who"><b>{customer.name}</b><span>{customer.email}</span></div>
          )}
          {onLogout && (
            <button type="button" className="btn ghost sm" onClick={onLogout} title="Sign out"><LogOut size={13} /> Sign out</button>
          )}
          <div className="svc" title={backendOk ? 'The backend answers' : 'The backend does not answer on port 3000'}>
            <span className={`status-dot ${backendOk ? 'on' : 'off'}`} /> Backend :3000 - {backendOk ? 'connected' : 'offline'}
          </div>
          <div className="svc" title={aiOk ? 'The AI engine answers' : 'The AI engine does not answer on port 8001'}>
            <span className={`status-dot ${aiOk ? 'on' : 'off'}`} /> AI engine :8001 - {aiOk ? 'connected' : 'offline'}
          </div>
        </div>
      </aside>

      {/* ── Main Content ── */}
      <main className="main">

        {/* ══ DASHBOARD ══ */}
        {tab === 'dashboard' && (
          <Dashboard apps={apps} deployments={deployments} history={telemetry.history}
            telemetryError={telemetry.error} telemetryLoading={telemetry.loading}
            paused={telemetry.paused} onPause={telemetry.setPaused} onClearHistory={telemetry.clear}
            traffic={traffic2.series} trafficError={traffic2.error} windowMs={windowMs} onWindow={setWindowMs}
            demo={demoMode} aiOk={aiOk} promUrl={PROM_URL} />
        )}

        {/* ══ APPLICATIONS ══ */}
        {tab === 'apps' && (
          <div className="animate-slide-up">
            <Header
              title="Applications"
              subtitle="Every app on the platform, from every customer. Deploy, open, scale or remove them from here."
              action={<button type="button" className="btn blue" onClick={() => setAppModal(true)}><Plus size={14} /> New application</button>}
            />

            <Help id="admin-apps" title="What is an application?"
              need={[
                <>A GitHub repository with the code (public, or private with a token).</>,
                <>A private server that is <span className="badge badge-verified">verified</span> (see Private Servers).</>,
              ]}
              steps={[
                <><b>Deploy now</b>: OmniDeploy clones the repository, builds a container image, starts it and checks that it answers.</>,
                <>When the health check passes, the new version replaces the old one. The old version is kept, so you can roll back.</>,
                <><b>Scale</b> runs N copies of the app behind the router; visitors are shared between the copies.</>,
                <>If a step fails, the card turns <span className="badge badge-failed">failed</span> and the log shows the reason.</>,
              ]}
              next="As the owner you see every customer's apps; each card names who owns it.">
              An application is a GitHub repository that OmniDeploy builds into a container and runs on one of the private servers.
              Click <b>New application</b> to add one; the wizard asks for the repository, the server and the port.
            </Help>

            {!backendOk && !demoMode && backendNote}

            {apps.length === 0 ? (
              <Empty icon={<Layers size={36} />} title="No applications yet"
                subtitle={demoMode ? 'Click "New application" to create the first one. In demo mode the deploy is simulated.' : 'Turn on Demo mode in the sidebar to load sample apps, or click "New application".'}
                action={<button type="button" className="btn blue" onClick={() => setAppModal(true)}><Plus size={14} /> New application</button>} />
            ) : (
              <div className="grid">
                {apps.map(app => (
                  <div key={app.id} className={`panel${app.status === 'running' ? ' ok' : app.status === 'failed' ? ' bad' : ''}`}>
                    <div className="panel-head">
                      <div style={{ minWidth: 0 }}>
                        <h3 style={{ wordBreak: 'break-all' }}>{app.name}</h3>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                          {app.app_type && app.app_type !== 'auto' && <span className="chip">{typeLabel(app.app_type)}</span>}
                          <span className="chip">{app.replicas} {app.replicas === 1 ? 'copy' : 'copies'}</span>
                        </div>
                      </div>
                      <Badge status={app.status} />
                    </div>

                    {/* Where the app answers - shown when it is running */}
                    {app.status === 'running' && (
                      <a href={appHref(app)} target="_blank" rel="noreferrer" className="url-box">
                        <Globe size={14} /> {appHref(app)} <ExternalLink size={13} style={{ marginLeft: 'auto' }} />
                      </a>
                    )}

                    <div className="kv">
                      <div><Globe size={13} /> Address: <b>{app.domain}</b></div>
                      <div><GitBranch size={13} /> Code: <b>{app.repo_url.replace('https://github.com/', '')}</b> (branch {app.branch})</div>
                      {app.current_commit_sha && <div><History size={13} /> Running version: <b>{app.current_commit_sha.slice(0, 7)}</b></div>}
                      <div><ServerIcon size={13} /> Server: <b>{serverName(app.server_id)}</b></div>
                      <div><UserRound size={13} /> Owner: <b>{app.owner_id ? owners[app.owner_id] || 'customer' : 'you (admin)'}</b></div>
                    </div>

                    <div className="panel-foot">
                      <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Scale</span>
                      <button type="button" className="btn ghost sm icon" onClick={() => scaleApp(app, -1)} disabled={app.replicas <= 1} aria-label="Run one copy fewer" title="Run one copy fewer"><Minus size={13} /></button>
                      <b style={{ minWidth: 18, textAlign: 'center' }}>{app.replicas}</b>
                      <button type="button" className="btn ghost sm icon" onClick={() => scaleApp(app, 1)} disabled={app.replicas >= 10} aria-label="Run one copy more" title="Run one copy more"><Plus size={13} /></button>
                      <span style={{ flex: 1 }} />
                      {app.status === 'running' && (
                        <a href={appHref(app)} target="_blank" rel="noreferrer" className="btn ok sm"><ExternalLink size={13} /> Open the app</a>
                      )}
                      <button type="button" className="btn blue sm" onClick={() => deployApp(app)} disabled={deployingId === app.id}>
                        {deployingId === app.id ? <><Spin size={13} /> Deploying...</> : <><Play size={13} /> Deploy now</>}
                      </button>
                      <button type="button" className="btn danger sm icon" onClick={() => { setDelErr(''); setDelTarget(app); }} disabled={app.status === 'building'}
                        aria-label={`Remove ${app.name}`} title={app.status === 'building' ? 'Wait for the deployment to finish' : 'Remove this application'}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="hint" style={{ marginTop: 8 }}>Scale = how many copies run at the same time (1 to 10). More copies help when the app is busy. "Show the log" is under Deploy Logs.</div>
                  </div>
                ))}
              </div>
            )}
            <StatusLegend items={APP_STATUS_LEGEND} />
          </div>
        )}

        {/* ══ SERVERS ══ */}
        {tab === 'servers' && (
          <div className="animate-slide-up">
            <Header
              title="Private Servers"
              subtitle="The Linux machines where the apps run. OmniDeploy logs in over SSH with its own key and runs git and Docker there."
              action={<button type="button" className="btn blue" onClick={() => setSrvModal(true)}><Plus size={14} /> Add a server</button>}
            />

            <Help id="admin-servers" title="What is a private server?"
              need={[
                <>A Linux machine (a home PC, a lab box, a VPS) that this laptop can reach over the network.</>,
                <>SSH (secure remote login) turned on, with <b>Docker</b> and <b>git</b> installed. The wizard tells you which command installs what is missing.</>,
                <>The platform's own SSH key added to that machine. OmniDeploy never stores a password.</>,
              ]}
              steps={[
                <><b>Add a server</b>: type its address and user name; the wizard shows the key to copy onto the machine.</>,
                <>OmniDeploy logs in and runs a checklist (login, Docker, git, free disk). A server that passes is <span className="badge badge-verified">verified</span>.</>,
                <><b>Share</b> a server to offer it to customers; their apps can then run on it. Un-share to hide it again.</>,
                <><b>Check the server again</b> re-runs the checklist, for example after you installed Docker.</>,
              ]}
              next="Customers can also register their own servers; those cards show the customer's email and cannot be shared with others.">
              A private server is any Linux machine OmniDeploy can reach over SSH. Apps are built and started on it inside Docker containers.
            </Help>

            {!backendOk && !demoMode && backendNote}

            {servers.length === 0 ? (
              <Empty icon={<ServerIcon size={36} />} title="No servers yet"
                subtitle='Click "Add a server" to connect a Linux machine, or turn on Demo mode to load sample servers.'
                action={<button type="button" className="btn blue" onClick={() => setSrvModal(true)}><Plus size={14} /> Add a server</button>} />
            ) : (
              <div className="grid">
                {servers.map(srv => (
                  <ServerCard key={srv.id} server={srv} busy={srvBusy === srv.id}
                    note={srv.owner_id ? `Customer's own server: ${owners[srv.owner_id] || 'customer'}` : srv.is_local ? 'Runs apps on this admin laptop' : undefined}
                    canManage canShare={!srv.owner_id}
                    onVerify={() => verifyServer(srv)} onShare={v => shareServer(srv, v)} onDelete={() => removeServer(srv)} />
                ))}
              </div>
            )}
            <StatusLegend items={SERVER_STATUS_LEGEND} />
          </div>
        )}

        {/* ══ CUSTOMERS / STORAGE (admin only) ══ */}
        {tab === 'customers' && <AdminCustomers demo={demoMode} />}
        {tab === 'storage' && <AdminStorage demo={demoMode} />}

        {/* ══ TERMINAL ══ */}
        {tab === 'terminal' && (() => {
          const live = selectedDep === 'live';
          const sel = deployments.find(d => d.id === selectedDep);
          const viewLogs = live ? logs : (sel?.logs || []);
          const viewStatus = live ? deployStatus : (sel?.status || 'idle');
          const banner = live ? lastDeploy : sel ? {
            appName: sel.app_name, status: sel.status, simulated: sel.id.startsWith('demo'),
            url: sel.host_port ? `http://${window.location.hostname}:${sel.host_port}` : sel.app_url, domainUrl: sel.domain_url,
          } : null;
          const parsed = parseLogs(viewLogs);
          const err = firstError(parsed);
          const errorTexts = parsed.filter(l => l.level === 'error' && !l.divider).slice(0, 20).map(l => l.text).join('\n');
          const dur = (d: DeploymentRec) => d.finished_at ? `${Math.max(1, Math.round((new Date(d.finished_at).getTime() - new Date(d.created_at).getTime()) / 1000))}s` : '';
          return (
            <div className="animate-slide-up">
              <Header title="Deploy Logs" subtitle="What happened, line by line, while an app was being deployed. The live stream shows the deployment running right now." action={<Badge status={viewStatus} />} />

              <Help id="admin-logs" title="How to read a deploy log"
                steps={[
                  <><b>Step 1/4 Fetch</b>: the code is cloned from GitHub onto the server.</>,
                  <><b>Step 2/4 Build</b>: a container image is built from it (this is where most errors happen - missing files, a failing <code>npm run build</code>).</>,
                  <><b>Step 3/4 Route</b>: the router learns the app's address.</>,
                  <><b>Step 4/4 Swap</b>: the new container is started, health-checked and replaces the old one.</>,
                ]}
                next="Every past deployment keeps its log: pick one from the list on the left. Live stream = the deployment running right now.">
              The log is the pipeline's own output. If a deployment fails, the <b>first red line</b> is almost always the cause; the "Show the first error" button jumps to it and "Ask the copilot" explains it in plain words.
              </Help>

              <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div style={{ width: 250, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div className="grp" style={{ paddingLeft: 0 }}>Deployments</div>
                  <button type="button" className="nav-item" onClick={() => setSelectedDep('live')} aria-current={live ? 'page' : undefined}>
                    <span className={`status-dot ${deployStatus === 'building' ? 'on' : ''}`} />
                    <span>Live stream</span>
                  </button>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 'calc(100vh - 330px)', overflowY: 'auto' }}>
                    {deployments.length === 0 && <div className="hint" style={{ padding: '6px 10px' }}>No deployments yet. Click "Deploy now" on an application.</div>}
                    {deployments.slice(0, 60).map(d => (
                      <button key={d.id} type="button" className="nav-item" onClick={() => setSelectedDep(d.id)} aria-current={selectedDep === d.id ? 'page' : undefined} style={{ display: 'block' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                          <strong style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.app_name}</strong>
                          <Badge status={d.status} />
                        </div>
                        <div className="hint" style={{ fontWeight: 400 }}>{relTime(d.created_at)}{dur(d) && ` · ${dur(d)}`}{d.commit_sha && ` · ${d.commit_sha.slice(0, 7)}`}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ flex: 1, minWidth: 360, display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {banner && ['building', 'deploying', 'success', 'failed'].includes(banner.status) && (
                    <DeployBanner status={banner.status} appName={banner.appName} url={banner.url} domainUrl={banner.domainUrl} simulated={banner.simulated}
                      errorText={err?.text}
                      onJumpToError={() => setLogFilterReq(r => ({ value: 'error', nonce: r.nonce + 1 }))}
                      onDiagnose={() => { setTab('copilot'); sendChat(`Why did the deployment of ${banner.appName} fail?`, errorTexts); }} />
                  )}
                  <LogViewer lines={viewLogs} status={viewStatus} title={live ? 'live' : sel?.app_name} filterRequest={logFilterReq}
                    onClear={live ? () => { setLogs([]); setDeployStatus('idle'); setLastDeploy(null); } : undefined} />
                </div>
              </div>
            </div>
          );
        })()}

        {/* ══ COPILOT ══ */}
        {tab === 'copilot' && (
          <div className="animate-slide-up" style={{ maxWidth: 820 }}>
            <Header title="Ops Copilot" subtitle="Paste an error or ask a question in plain words. The copilot explains what went wrong and can run commands for you." />

            <Help id="admin-copilot" title="What can the copilot do?"
              need={[
                <>Nothing for the instant answers: common errors (port in use, 502, DNS, permission denied) are recognised locally at no cost.</>,
                <>For everything else, the AI engine on port 8001 (<code>cd ai-engine &amp;&amp; uvicorn chatbot.main:app --port 8001</code>). It runs a Claude agent that can read your apps and act on them.</>,
              ]}
              steps={[
                <>Type a question or paste the red lines from a deploy log, then press Enter or <b>Send</b>.</>,
                <>Layer 1 answers instantly if it recognises a known error pattern.</>,
                <>Otherwise layer 2 (the Claude agent) answers, and can run commands such as <code>scale my-app to 2 replicas</code> or <code>deploy my-portfolio</code>.</>,
              ]}
              next="Try one of the example questions below.">
              Two layers: instant pattern answers for common errors, and a Claude agent for questions and commands.
            </Help>

            {!aiOk && (
              <Callout>
                The AI engine is offline, so only the instant pattern answers work. Start it with <code>cd ai-engine &amp;&amp; uvicorn chatbot.main:app --port 8001</code> for full answers.
              </Callout>
            )}

            {/* Example questions */}
            <div className="hint" style={{ marginBottom: 6 }}>Examples - click one to send it:</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
              {[
                { label: 'Port already in use (EADDRINUSE)', msg: 'Error: listen EADDRINUSE: address already in use :::3000' },
                { label: '502 Bad Gateway', msg: '502 Bad Gateway — Traefik upstream timeout' },
                { label: 'DNS lookup failed (ENOTFOUND)', msg: 'Error: getaddrinfo ENOTFOUND postgres-db' },
                { label: apps[0] ? `Deploy ${apps[0].name}` : 'Deploy my-portfolio', msg: apps[0] ? `deploy ${apps[0].name}` : 'deploy my-portfolio' },
                { label: apps[0] ? `Scale ${apps[0].name} to 2 replicas` : 'Scale api-service to 2 replicas', msg: apps[0] ? `scale ${apps[0].name} to 2 replicas` : 'scale api-service to 2 replicas' },
              ].map(b => (
                <button key={b.label} type="button" className="btn ghost sm" onClick={() => sendChat(b.msg)}>{b.label}</button>
              ))}
            </div>

            <div className="panel" style={{ display: 'flex', flexDirection: 'column', height: 480 }}>
              <div className="chat" style={{ flex: 1, overflowY: 'auto' }} aria-live="polite">
                {chatMsgs.map((m, i) => (
                  <div key={i} className={`msg ${m.sender === 'user' ? 'me' : 'bot'}`}>
                    <div className="from">{m.sender === 'user' ? 'You' : `Copilot${m.source ? ` · ${nice(m.source)}` : ''}`}</div>
                    {m.text}
                  </div>
                ))}
                {chatBusy && (
                  <div className="msg bot" style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)' }}><Spin size={13} /> Thinking...</div>
                )}
                <div ref={chatRef} />
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <input className="input" aria-label="Message for the copilot" placeholder="Ask a question or paste an error line..." value={chatInput}
                  onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendChat()} style={{ flex: 1 }} />
                <button type="button" className="btn blue" onClick={() => sendChat()} disabled={chatBusy}><Send size={14} /> Send</button>
              </div>
              <div className="hint">Example: "Why did the deployment of my-portfolio fail?" or paste a line like <code>Error: listen EADDRINUSE</code>. Press Enter to send.</div>
            </div>
          </div>
        )}

        {/* ══ CONTAINER HEALTH & ANOMALY MONITOR ══ */}
        {tab === 'metrics' && (
          <div className="animate-slide-up" style={{ maxWidth: 1000 }}>
            <Header
              title="Health Monitor"
              subtitle="A small machine-learning model watches CPU, memory, restarts and network traffic of every running container and flags the ones that look unusual."
              action={
                <>
                  <button type="button" className={`btn ghost sm${autoScan ? '' : ''}`} onClick={() => setAutoScan(p => !p)} aria-pressed={autoScan}
                    title="Scan again every 10 seconds">
                    <RefreshCw size={13} style={{ animation: autoScan ? 'spin 3s linear infinite' : 'none' }} />
                    {autoScan ? 'Auto-scan: on (every 10 s)' : 'Auto-scan: off'}
                  </button>
                  <button type="button" className="btn blue sm" onClick={scanContainerHealth} disabled={healthLoading}>
                    {healthLoading ? <Spin size={14} /> : <Activity size={14} />} Scan live containers
                  </button>
                </>
              }
            />

            <Help id="admin-health" title="What does this page show?"
              need={[<>The AI engine on port 8001; it reads the Docker numbers and runs the model (an Isolation Forest).</>]}
              steps={[
                <><b>Scan live containers</b> reads CPU, memory, restarts and network in/out of every running container and sends them to the model.</>,
                <>The model gives each container an <b>anomaly score</b> between -1 and 0. Lower = more unusual. Below the threshold it is flagged.</>,
                <>Each container gets one of three statuses: <span className="badge badge-running">healthy</span> normal numbers, <span className="badge badge-building">degrading</span> one number is drifting high, <span className="badge badge-failed">anomalous</span> flagged by the model or over a hard limit.</>,
                <>The <b>test bench</b> below lets you send made-up numbers to see how the model reacts, without touching a real container.</>,
              ]}>
              The anomaly score is the model's opinion of how unusual a container's numbers are compared with normal behaviour. It is not a pass/fail test; read it together with the "main factor" line.
            </Help>

            {/* Key numbers */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
              <div className="stat"><div className="v" style={{ fontSize: 18 }}>Isolation Forest</div><div className="l">The model - 5 numbers per container</div></div>
              <div className="stat"><div className="v">{containerHealth.filter(c => c.status === 'HEALTHY').length}</div><div className="l">Healthy containers</div></div>
              <div className="stat"><div className="v" style={{ color: containerHealth.some(c => c.is_anomaly) ? 'var(--danger)' : undefined }}>{containerHealth.filter(c => c.is_anomaly).length}</div><div className="l">Flagged as anomalous</div></div>
              <div className="stat"><div className="v" style={{ fontSize: 18 }}><span className={`status-dot ${aiOk ? 'on' : 'off'}`} />{aiOk ? 'AI engine online' : 'AI engine offline'}</div><div className="l">Port 8001</div></div>
            </div>

            {scanMsg && (
              <div className="hint" style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                <CheckCircle2 size={13} style={{ color: 'var(--ok)' }} /> {scanMsg}
              </div>
            )}

            {/* Live Containers List */}
            <div style={{ marginBottom: 28 }}>
              <h3 style={{ fontSize: 17, fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <ServerIcon size={16} /> Running containers
              </h3>

              {containerHealth.length === 0 ? (
                <Empty icon={<Activity size={32} />} title={healthError ? 'Nothing to show' : 'No running containers found'}
                  subtitle={healthError
                    ? <>{healthError}. Is the AI engine running on port 8001?</>
                    : <>Click <b>Scan live containers</b> after deploying an app, or use the test bench below to try the model with made-up numbers.</>} />
              ) : (
                <div className="grid">
                  {containerHealth.map((c, idx) => (
                    <div key={idx} className={healthPanel(c)}>
                      <div className="panel-head">
                        <h3 style={{ wordBreak: 'break-all' }}>{c.container_name}</h3>
                        <span className={`badge ${healthCls(c)}`}>{healthWord(c)}</span>
                      </div>

                      {/* The four numbers the model looks at */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 12 }}>
                        <div className="stat" style={{ padding: '10px 12px' }}><div className="v" style={{ fontSize: 18, color: c.cpu_percent > 80 ? 'var(--danger)' : undefined }}>{c.cpu_percent}%</div><div className="l">CPU</div></div>
                        <div className="stat" style={{ padding: '10px 12px' }}><div className="v" style={{ fontSize: 18, color: c.mem_percent > 80 ? 'var(--danger)' : undefined }}>{c.mem_percent}%</div><div className="l">Memory</div></div>
                        <div className="stat" style={{ padding: '10px 12px' }}><div className="v" style={{ fontSize: 18, color: c.restart_count > 3 ? 'var(--danger)' : undefined }}>{c.restart_count}</div><div className="l" title="Restarts in the last 10 minutes">Restarts (10 min)</div></div>
                        <div className="stat" style={{ padding: '10px 12px' }}><div className="v" style={{ fontSize: 14 }}>{c.warming_up ? '…' : `${c.net_in_kb}/${c.net_out_kb}`}</div><div className="l">Net in/out KB/s</div></div>
                      </div>

                      {/* What the model said */}
                      <div className="kv" style={{ marginBottom: 0 }}>
                        <div><Gauge size={13} /> Anomaly score: <b>{c.score ?? 'n/a'}</b>{c.threshold != null && <span>(flagged below {c.threshold})</span>}</div>
                        {c.is_anomaly && c.detected_by && <div><AlertTriangle size={13} /> Detected by: <b>{nice(c.detected_by)}</b></div>}
                        {c.dominant_factor && <div><Activity size={13} /> Main factor: <b>{nice(c.dominant_factor)}</b></div>}
                        {c.message && <div style={{ display: 'block' }}>{c.message}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <StatusLegend items={[
                { cls: 'badge-running', label: 'healthy', meaning: 'normal numbers' },
                { cls: 'badge-building', label: 'degrading', meaning: 'one number is drifting high; keep an eye on it' },
                { cls: 'badge-failed', label: 'anomalous', meaning: 'flagged by the model or over a hard limit' },
              ]} />
            </div>

            {/* ══ FAULT INJECTION TEST BENCH ══ */}
            <div className="panel" style={{ marginBottom: 20 }}>
              <div className="panel-head">
                <div>
                  <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><FlaskConical size={17} /> Fault-injection test bench</h3>
                  <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>Send made-up numbers to the model and see what it says. Nothing is changed on any real container.</p>
                </div>
              </div>

              <Help id="admin-health-bench" title="How to use the test bench"
                steps={[
                  <>Pick a preset (green dot = should come back healthy, red dot = should be flagged), or type your own numbers.</>,
                  <>Click <b>Run the check</b>. The numbers are sent to the AI engine exactly as a real scan would send them.</>,
                  <>Read the verdict: the status, the score and the main factor the model blamed.</>,
                ]}>
                Useful for a demo: a memory leak looks like memory at 90%+, a crash loop like many restarts in 10 minutes, a network flood like thousands of KB/s.
              </Help>

              <div className="hint" style={{ marginBottom: 6 }}>Presets:</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                {faultPresets.map(preset => (
                  <button key={preset.label} type="button" className="btn ghost sm" onClick={() => setInjectForm(p => ({ ...p, ...preset.values }))}>
                    <span className={`status-dot ${preset.ok ? 'on' : 'off'}`} />{preset.label}
                  </button>
                ))}
              </div>

              <div className="form-grid">
                <Field label="Container name" value={injectForm.container_name} onChange={v => setInjectForm(p => ({ ...p, container_name: v }))} mono
                  hint="Any name; it is only echoed back. Example: demo-container" />
                <label className="field">
                  <span className="lbl"><span>CPU usage</span><span>{injectForm.cpu_percent}%</span></span>
                  <input type="range" min="0" max="100" step="1" value={injectForm.cpu_percent} onChange={e => setInjectForm(p => ({ ...p, cpu_percent: e.target.value }))} style={{ width: '100%' }} />
                  <div className="hint">0 to 100%. Normal is under 50%; 95% looks like a CPU spike.</div>
                </label>
                <label className="field">
                  <span className="lbl"><span>Memory usage</span><span>{injectForm.mem_percent}%</span></span>
                  <input type="range" min="0" max="100" step="1" value={injectForm.mem_percent} onChange={e => setInjectForm(p => ({ ...p, mem_percent: e.target.value }))} style={{ width: '100%' }} />
                  <div className="hint">0 to 100%. Over 85% looks like a memory leak.</div>
                </label>
                <Field label="Restarts in the last 10 minutes" type="number" min={0} max={100} value={injectForm.restart_count} onChange={v => setInjectForm(p => ({ ...p, restart_count: v }))}
                  hint="0 is normal. 12 looks like a crash loop." />
                <Field label="Network in (KB/s)" type="number" min={0} value={injectForm.net_in_kb} onChange={v => setInjectForm(p => ({ ...p, net_in_kb: v }))}
                  hint="Data coming in. Example: 150. Thousands look like a flood." />
                <Field label="Network out (KB/s)" type="number" min={0} value={injectForm.net_out_kb} onChange={v => setInjectForm(p => ({ ...p, net_out_kb: v }))}
                  hint="Data going out. Example: 80." />
              </div>

              <div className="form-actions">
                <button type="button" className="btn blue" onClick={runFaultInject} disabled={injecting}>
                  {injecting ? <Spin size={15} /> : <Cpu size={15} />} Run the check
                </button>
              </div>

              {/* Verdict */}
              {injectResult && (
                <div className={`${healthPanel(injectResult)}`} style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }} role="status">
                  <div>
                    <div className="hint">Verdict for <b>{injectResult.container_name}</b></div>
                    <div style={{ fontSize: 22, fontWeight: 600, marginTop: 4, display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span className={`badge ${healthCls(injectResult)}`}>{healthWord(injectResult)}</span>
                      {injectResult.is_anomaly ? 'The model flagged this container' : injectResult.status === 'DEGRADING' ? 'Drifting, not flagged yet' : 'Looks normal'}
                    </div>
                    {injectResult.message && <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4, maxWidth: 520 }}>{injectResult.message}</div>}
                    {injectResult.dominant_factor && (
                      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>Main factor: <b style={{ color: 'var(--text-primary)' }}>{nice(injectResult.dominant_factor)}</b></div>
                    )}
                  </div>
                  <div className="stat" style={{ textAlign: 'right' }}>
                    <div className="v">{injectResult.score ?? 'n/a'}</div>
                    <div className="l">
                      Anomaly score (-1 to 0, lower = more unusual)
                      {injectResult.threshold != null && <><br />Flagged below {injectResult.threshold}</>}
                      {injectResult.detected_by ? <><br />Detected by: {nice(injectResult.detected_by)}</> : null}
                      <br />Mode: {injectResult.confidence}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* ══ TRAFFIC FORECASTER (optional) ══ */}
            <details className="panel">
              <summary style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <TrendingUp size={15} /> Optional: traffic forecast (predicts how many copies an app will need)
              </summary>
              <div style={{ marginTop: 18 }}>
                <p className="hint" style={{ marginBottom: 12 }}>Type the requests per minute now and 1, 5 and 15 minutes ago. The model predicts the next value and says whether to add or remove copies. Each copy is assumed to handle 120 requests per minute.</p>
                <div className="form-grid">
                  {[['current', 'Requests per minute now', 'Example: 420'], ['lag1', '1 minute ago', 'Example: 390'], ['lag5', '5 minutes ago', 'Example: 310'], ['lag15', '15 minutes ago', 'Example: 220']].map(([k, label, hint]) => (
                    <Field key={k} label={label} type="number" min={0} value={(traffic as any)[k]} onChange={v => setTraffic(p => ({ ...p, [k]: v }))} hint={hint} />
                  ))}
                </div>
                <div className="form-actions">
                  <button type="button" className="btn ghost" onClick={runPredict} disabled={predicting}>
                    {predicting ? <><Spin size={14} /> Forecasting...</> : <><TrendingUp size={14} /> Run the forecast</>}
                  </button>
                </div>
                {prediction && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginTop: 14 }} role="status">
                    <div className="stat"><div className="v">{prediction.predicted}</div><div className="l">Predicted requests per minute</div></div>
                    <div className="stat"><div className="v" style={{ fontSize: 18 }}>{prediction.decision === 'SCALE_UP' ? 'Add copies' : prediction.decision === 'SCALE_DOWN' ? 'Remove copies' : 'Keep as is'}</div><div className="l">Decision ({prediction.decision})</div></div>
                    <div className="stat"><div className="v">{prediction.replicas}</div><div className="l">Copies recommended</div></div>
                  </div>
                )}
              </div>
            </details>
          </div>
        )}
      </main>

      {/* ══ SERVER MODAL ══ */}
      {srvModal && (
        <Modal title="Add a server" width={720} onClose={() => setSrvModal(false)}>
          <ServerOnboarding asAdmin demo={demoMode || !backendOk} onCancel={() => setSrvModal(false)}
            onDone={srv => { setServers(p => [...p.filter(s => s.id !== srv.id), srv]); addLog(`Server '${srv.name}' added: ${srv.status}`); setSrvModal(false); }} />
        </Modal>
      )}

      {/* ══ APP MODAL ══ */}
      {appModal && (
        <Modal title="New Application" width={760} onClose={() => setAppModal(false)}>
          <NewAppWizard servers={servers} useBackend={backendOk && !demoMode}
            onCreate={createApp} onCancel={() => setAppModal(false)} />
        </Modal>
      )}

      {delTarget && (
        <Modal title={`Remove “${delTarget.name}”?`} onClose={() => !delBusy && setDelTarget(null)}>
          <Help id="admin-delete" title="What happens when you remove an application"
            steps={[
              <>All its containers are stopped and deleted (every copy).</>,
              <>Its built images and the cloned source code are deleted from the server.</>,
              <>Its port (<code>{delTarget.host_port ?? '–'}</code>) is freed and the card disappears from the list.</>,
            ]}
            next="Past deployment logs are kept. The GitHub repository is not touched. This cannot be undone.">
            This removes the application from the platform and from the server it runs on.
          </Help>
          {delErr && (
            <div className="note note-error" role="alert">
              {delErr}
              {/force=true/.test(delErr) && (
                <div style={{ marginTop: 8 }}>
                  <button type="button" className="btn danger sm" onClick={() => deleteApp(true)} disabled={delBusy}>Force remove (delete the record only)</button>
                  <div className="hint">Use this when the server is gone and the containers cannot be reached any more.</div>
                </div>
              )}
            </div>
          )}
          <div className="form-actions">
            <button type="button" className="btn ghost" onClick={() => setDelTarget(null)} disabled={delBusy}>Cancel</button>
            <button type="button" className="btn danger solid" onClick={() => deleteApp(false)} disabled={delBusy}>
              {delBusy ? <><Spin size={14} /> Removing…</> : <><Trash2 size={14} /> Remove application</>}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
