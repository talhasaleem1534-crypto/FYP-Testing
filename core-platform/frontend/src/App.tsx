import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import {
  Server as ServerIcon, Layers, Terminal, Bot, TrendingUp,
  Plus, Play, RefreshCw, CheckCircle2, Cpu, ShieldCheck,
  Globe, GitBranch, Send, Zap, X, Loader2, AlertTriangle,
  FlaskConical, Wifi, WifiOff, ExternalLink, Activity, ShieldAlert,
  BarChart3, AlertCircle, LayoutDashboard, Trash2, History, LogOut, Users, HardDrive,
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
function Field({ label, placeholder, value, onChange, type = 'text', mono = false }: {
  label: string; placeholder?: string; value: string; onChange: (v: string) => void; type?: string; mono?: boolean;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</label>
      <input type={type} placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)}
        style={{ width: '100%', padding: '10px 14px', background: 'rgba(0,0,0,0.4)', border: '1px solid var(--glass-border)', borderRadius: 8, color: '#fff', fontSize: 13, fontFamily: mono ? 'var(--font-mono)' : 'inherit' }} />
    </div>
  );
}

function Badge({ status }: { status: string }) {
  const cls = ['running', 'verified', 'success'].includes(status) ? 'badge-verified'
    : ['building', 'deploying', 'pending'].includes(status) ? 'badge-building'
    : ['failed', 'unreachable'].includes(status) ? 'badge-failed' : 'badge-idle';
  return <span className={`badge ${cls}`}><span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} />{status}</span>;
}

function Header({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
      <div>
        <h2 style={{ fontSize: 24, fontWeight: 700 }}>{title}</h2>
        {subtitle && <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginTop: 5 }}>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

function Callout({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '11px 14px', background: `${color}18`, border: `1px solid ${color}44`, borderRadius: 10, color, fontSize: 13, marginBottom: 20, lineHeight: 1.6 }}>
      <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 2 }} />
      <span>{children}</span>
    </div>
  );
}

function Empty({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 260, gap: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
      <div style={{ opacity: 0.25 }}>{icon}</div>
      <div style={{ fontWeight: 600, fontSize: 17, color: 'var(--text-secondary)' }}>{title}</div>
      <div style={{ fontSize: 13, maxWidth: 340 }}>{subtitle}</div>
    </div>
  );
}

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
    { sender: 'bot', text: "👋 I'm your Ops Copilot. Ask me to deploy apps, scale replicas, or paste an error log for instant AI diagnosis.", source: 'system' }
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
        (res.warnings || []).forEach((w: string) => addLog(`⚠️ ${w}`));
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

  // Preset fault scenarios
  const faultPresets = [
    { label: '🟢 Normal', values: { cpu_percent: '18', mem_percent: '30', restart_count: '0', net_in_kb: '150', net_out_kb: '80' } },
    { label: '🔴 Memory Leak', values: { cpu_percent: '22', mem_percent: '92', restart_count: '1', net_in_kb: '160', net_out_kb: '90' } },
    { label: '🔴 CPU Spike', values: { cpu_percent: '95', mem_percent: '35', restart_count: '0', net_in_kb: '140', net_out_kb: '75' } },
    { label: '🔴 Crash Loop', values: { cpu_percent: '30', mem_percent: '40', restart_count: '12', net_in_kb: '120', net_out_kb: '60' } },
    { label: '🔴 Net Flood', values: { cpu_percent: '20', mem_percent: '32', restart_count: '0', net_in_kb: '2400', net_out_kb: '1900' } },
  ];

  const NAV = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'apps', label: 'Applications', icon: Layers },
    { id: 'servers', label: 'Private Servers', icon: ServerIcon },
    { id: 'customers', label: 'Customers', icon: Users },
    { id: 'storage', label: 'Data & Storage', icon: HardDrive },
    { id: 'terminal', label: 'Deploy Logs', icon: Terminal },
    { id: 'copilot', label: 'Ops Copilot AI', icon: Bot, badge: 'AI' },
    { id: 'metrics', label: 'Health Monitor', icon: Activity, badge: 'ML' },
  ];

  // ── FORM PREFILL with sample data ─────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>

      {/* ── Sidebar ── */}
      <aside style={{ width: 256, flexShrink: 0, borderRight: '1px solid var(--glass-border)', background: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column', padding: '22px 14px', gap: 5 }}>

        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '0 10px 20px', borderBottom: '1px solid var(--glass-border)' }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: 'linear-gradient(135deg, var(--accent-cyan), var(--accent-purple))', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'var(--shadow-glow)' }}>
            <Zap size={20} color="#fff" />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>DeployStack</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Admin site · Coolify + AI Ops</div>
          </div>
        </div>

        {/* Demo Mode Toggle */}
        <div style={{ margin: '12px 0', padding: '10px 12px', background: demoMode ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.04)', border: `1px solid ${demoMode ? 'rgba(245,158,11,0.4)' : 'var(--glass-border)'}`, borderRadius: 10, cursor: 'pointer' }} onClick={toggleDemo}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FlaskConical size={15} color={demoMode ? '#fbbf24' : 'var(--text-muted)'} />
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: demoMode ? '#fbbf24' : 'var(--text-secondary)' }}>{demoMode ? 'Demo Mode ON' : 'Demo Mode OFF'}</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{demoMode ? 'Using simulated data' : 'Click to load sample data'}</div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
          {NAV.map(({ id, label, icon: Icon, badge }) => {
            const active = tab === id;
            return (
              <button key={id} onClick={() => setTab(id as any)} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                borderRadius: 10, textAlign: 'left', fontSize: 13,
                background: active ? 'rgba(79,172,254,0.15)' : 'transparent',
                color: active ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                border: active ? '1px solid rgba(0,242,254,0.2)' : '1px solid transparent',
                fontWeight: active ? 600 : 400,
              }}>
                <Icon size={16} />
                <span style={{ flex: 1 }}>{label}</span>
                {badge && <span style={{ fontSize: 9, fontWeight: 700, background: 'var(--accent-purple)', color: '#fff', padding: '2px 5px', borderRadius: 5 }}>{badge}</span>}
              </button>
            );
          })}
        </nav>

        {/* Signed-in customer */}
        {customer && (
          <div style={{ padding: '10px 10px 12px', borderTop: '1px solid var(--glass-border)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{customer.name}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{customer.email}</div>
            </div>
            {onLogout && (
              <button onClick={onLogout} title="Sign out"
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 9px', background: 'rgba(255,255,255,0.06)', border: '1px solid var(--glass-border)', borderRadius: 8, color: 'var(--text-secondary)', fontSize: 11 }}>
                <LogOut size={13} /> Sign out
              </button>
            )}
          </div>
        )}

        {/* Status pills */}
        <div style={{ paddingTop: 12, borderTop: '1px solid var(--glass-border)', display: 'flex', flexDirection: 'column', gap: 5 }}>
          {[
            { label: 'Backend :3000', ok: backendOk },
            { label: 'AI Engine :8001', ok: aiOk },
          ].map(s => (
            <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, color: 'var(--text-muted)', padding: '4px 10px' }}>
              {s.ok ? <Wifi size={12} color="#34d399" /> : <WifiOff size={12} color="#64748b" />}
              <span style={{ color: s.ok ? '#34d399' : 'var(--text-muted)' }}>{s.label}</span>
            </div>
          ))}
        </div>
      </aside>

      {/* ── Main Content ── */}
      <main style={{ flex: 1, padding: '36px 44px', overflowY: 'auto' }}>

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
              subtitle="Connect a Git repository and deploy containers to your private server with Traefik auto-routing."
              action={
                <button onClick={() => setAppModal(true)}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 18px', background: 'linear-gradient(135deg, var(--accent-blue), var(--accent-purple))', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 600, fontSize: 14, boxShadow: '0 4px 14px rgba(79,172,254,0.25)', cursor: 'pointer' }}>
                  <Plus size={16} /> New Application
                </button>
              }
            />

            {!backendOk && !demoMode && (
              <Callout color="#f59e0b">
                Backend offline. <strong>Enable Demo Mode</strong> (sidebar) to test with sample data, or start backend: <code style={{ fontSize: 11 }}>cd core-platform/backend && npm run start:dev</code>
              </Callout>
            )}

            {apps.length === 0 ? (
              <Empty icon={<Layers size={42} />} title="No applications yet"
                subtitle={demoMode ? 'Click "New Application" to create your first app.' : 'Enable Demo Mode in the sidebar to load sample apps instantly.'} />
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px,1fr))', gap: 20 }}>
                {apps.map(app => (
                  <div key={app.id} className="glass-panel" style={{ padding: 24, borderColor: app.status === 'running' ? 'rgba(52,211,153,0.35)' : undefined }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 18 }}>{app.name}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--accent-cyan)', fontSize: 12, marginTop: 3 }}>
                          <Globe size={12} />{app.domain}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                          👤 {app.owner_id ? owners[app.owner_id] || 'customer' : 'admin'}
                        </div>
                        {app.app_type && app.app_type !== 'auto' && (
                          <span style={{ display: 'inline-block', marginTop: 6, fontSize: 11, padding: '2px 8px', borderRadius: 6, background: 'rgba(167,139,250,0.15)', color: '#c4b5fd', border: '1px solid rgba(167,139,250,0.3)' }}>
                            {FALLBACK_APP_TYPES.find(t => t.id === app.app_type)?.label || app.app_type}
                          </span>
                        )}
                      </div>
                      <Badge status={app.status} />
                    </div>

                    {/* Live URL Banner — shows when running */}
                    {app.status === 'running' && (
                      <a href={appHref(app)} target="_blank" rel="noreferrer"
                        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.35)', borderRadius: 10, marginBottom: 12, textDecoration: 'none', color: '#34d399', fontWeight: 600, fontSize: 13 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#34d399', display: 'inline-block', boxShadow: '0 0 6px #34d399', animation: 'pulse 2s infinite' }} />
                        {appHref(app)}
                        <ExternalLink size={13} style={{ marginLeft: 'auto', opacity: 0.7 }} />
                      </a>
                    )}

                    <div style={{ background: 'rgba(0,0,0,0.25)', borderRadius: 8, padding: '9px 12px', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 14 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}><GitBranch size={11} />{app.repo_url.replace('https://github.com/', '')} ({app.branch})</div>
                      {app.current_commit_sha && <div style={{ color: 'var(--text-muted)' }}>Commit: {app.current_commit_sha}</div>}
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--glass-border)', paddingTop: 14 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Replicas</span>
                        <button onClick={() => scaleApp(app, -1)} style={{ padding: '2px 9px', background: 'rgba(255,255,255,0.08)', color: '#fff', borderRadius: 5, cursor: 'pointer' }}>-</button>
                        <span style={{ fontWeight: 700, minWidth: 18, textAlign: 'center' }}>{app.replicas}</span>
                        <button onClick={() => scaleApp(app, 1)} style={{ padding: '2px 9px', background: 'rgba(255,255,255,0.08)', color: '#fff', borderRadius: 5, cursor: 'pointer' }}>+</button>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {app.status === 'running' && (
                          <a href={appHref(app)} target="_blank" rel="noreferrer"
                            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '8px 12px', background: 'rgba(52,211,153,0.15)', color: '#34d399', border: '1px solid rgba(52,211,153,0.35)', borderRadius: 8, fontWeight: 600, fontSize: 12, textDecoration: 'none' }}>
                            <ExternalLink size={12} /> Open
                          </a>
                        )}
                        <button onClick={() => { setDelErr(''); setDelTarget(app); }} disabled={app.status === 'building'}
                          title={app.status === 'building' ? 'Wait for the deployment to finish' : 'Delete application'}
                          style={{ display: 'flex', alignItems: 'center', padding: '8px 10px', background: 'rgba(244,63,94,0.12)', color: '#fb7185', border: '1px solid rgba(244,63,94,0.35)', borderRadius: 8, cursor: app.status === 'building' ? 'not-allowed' : 'pointer', opacity: app.status === 'building' ? 0.4 : 1 }}>
                          <Trash2 size={14} />
                        </button>
                        <button onClick={() => deployApp(app)} disabled={deployingId === app.id}
                          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'rgba(16,185,129,0.2)', color: '#34d399', border: '1px solid rgba(16,185,129,0.4)', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer', opacity: deployingId === app.id ? 0.6 : 1 }}>
                          {deployingId === app.id ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Deploying...</> : <><Play size={13} /> Deploy</>}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ══ SERVERS ══ */}
        {tab === 'servers' && (
          <div className="animate-slide-up">
            <Header
              title="Private Servers"
              subtitle="Linux machines where apps run. DeployStack logs in over SSH with its own key and runs git and Docker there."
              action={
                <button onClick={() => setSrvModal(true)}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 18px', background: 'linear-gradient(135deg, var(--accent-blue), var(--accent-purple))', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                  <Plus size={16} /> Add a server
                </button>
              }
            />

            {!backendOk && !demoMode && (
              <Callout color="#f59e0b">
                Backend offline. Enable <strong>Demo Mode</strong> in the sidebar to test with sample servers.
              </Callout>
            )}

            {servers.length === 0 ? (
              <Empty icon={<ServerIcon size={42} />} title="No servers registered"
                subtitle="Enable Demo Mode to load sample servers, or click Add a server to connect a Linux machine." />
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px,1fr))', gap: 20 }}>
                {servers.map(srv => (
                  <ServerCard key={srv.id} server={srv} busy={srvBusy === srv.id}
                    note={srv.owner_id ? `👤 customer's own server: ${owners[srv.owner_id] || 'customer'}` : srv.is_local ? 'Runs apps on this admin laptop' : undefined}
                    canManage canShare={!srv.owner_id}
                    onVerify={() => verifyServer(srv)} onShare={v => shareServer(srv, v)} onDelete={() => removeServer(srv)} />
                ))}
              </div>
            )}
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
              <Header title="Deployment Logs" subtitle="Live pipeline output with progress, folding, search and one-click app links." action={<Badge status={viewStatus} />} />
              <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div style={{ width: 250, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: 6 }}><History size={12} /> Deployments</div>
                  <button onClick={() => setSelectedDep('live')} style={{ textAlign: 'left', padding: '9px 12px', borderRadius: 9, cursor: 'pointer', fontSize: 13, fontWeight: 600,
                    background: live ? 'rgba(0,242,254,0.12)' : 'rgba(255,255,255,0.03)', color: live ? '#00f2fe' : 'var(--text-secondary)', border: `1px solid ${live ? 'rgba(0,242,254,0.4)' : 'var(--glass-border)'}` }}>
                    <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: '#34d399', marginRight: 8, animation: 'pulse 2s infinite' }} />Live stream
                  </button>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 'calc(100vh - 330px)', overflowY: 'auto' }}>
                    {deployments.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 4px' }}>No deployments yet.</div>}
                    {deployments.slice(0, 60).map(d => (
                      <button key={d.id} onClick={() => setSelectedDep(d.id)} style={{ textAlign: 'left', padding: '9px 12px', borderRadius: 9, cursor: 'pointer', fontSize: 12,
                        background: selectedDep === d.id ? 'rgba(0,242,254,0.10)' : 'rgba(255,255,255,0.03)', color: 'var(--text-secondary)',
                        border: `1px solid ${selectedDep === d.id ? 'rgba(0,242,254,0.4)' : 'var(--glass-border)'}` }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                          <strong style={{ color: '#f8fafc', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.app_name}</strong>
                          <Badge status={d.status} />
                        </div>
                        <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>{relTime(d.created_at)}{dur(d) && ` · ${dur(d)}`}{d.commit_sha && ` · ${d.commit_sha.slice(0, 7)}`}</div>
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
          <div className="animate-slide-up" style={{ maxWidth: 780 }}>
            <Header title="Ops Copilot AI" subtitle="Layer 1: instant deterministic log diagnostics. Layer 2: Claude LLM tool execution." />

            {!aiOk && (
              <Callout color="#f59e0b">
                AI Engine offline — running in <strong>local fallback mode</strong>. Common errors are still diagnosed instantly. Start AI Engine: <code style={{ fontSize: 11 }}>cd ai-engine && uvicorn chatbot.main:app --port 8001</code>
              </Callout>
            )}

            {/* Quick test buttons */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
              {[
                { label: '⚡ EADDRINUSE Error', msg: 'Error: listen EADDRINUSE: address already in use :::3000', c: 'rgba(244,63,94,0.15)', t: '#fb7185', b: 'rgba(244,63,94,0.3)' },
                { label: '🌐 502 Bad Gateway', msg: '502 Bad Gateway — Traefik upstream timeout', c: 'rgba(245,158,11,0.15)', t: '#fbbf24', b: 'rgba(245,158,11,0.3)' },
                { label: '🔗 DNS Failed', msg: 'Error: getaddrinfo ENOTFOUND postgres-db', c: 'rgba(127,0,255,0.15)', t: '#c084fc', b: 'rgba(127,0,255,0.3)' },
                { label: '🚀 Deploy App', msg: apps[0] ? `deploy ${apps[0].name}` : 'deploy my-portfolio', c: 'rgba(0,242,254,0.12)', t: 'var(--accent-cyan)', b: 'rgba(0,242,254,0.3)' },
              ].map(b => (
                <button key={b.label} onClick={() => sendChat(b.msg)}
                  style={{ padding: '6px 12px', background: b.c, color: b.t, border: `1px solid ${b.b}`, borderRadius: 8, fontSize: 12, cursor: 'pointer' }}>
                  {b.label}
                </button>
              ))}
            </div>

            <div className="glass-panel" style={{ height: 440, display: 'flex', flexDirection: 'column', padding: 18 }}>
              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {chatMsgs.map((m, i) => (
                  <div key={i} style={{
                    alignSelf: m.sender === 'user' ? 'flex-end' : 'flex-start',
                    maxWidth: '88%', padding: '11px 15px', borderRadius: 12,
                    background: m.sender === 'user' ? 'linear-gradient(135deg, var(--accent-blue), var(--accent-purple))' : 'rgba(255,255,255,0.06)',
                    fontSize: 13, lineHeight: 1.6,
                  }}>
                    {m.source && <div style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--accent-cyan)', marginBottom: 4, letterSpacing: '0.5px' }}>▸ {m.source}</div>}
                    <div style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>
                  </div>
                ))}
                {chatBusy && (
                  <div style={{ alignSelf: 'flex-start', padding: '10px 14px', background: 'rgba(255,255,255,0.05)', borderRadius: 12, fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 7 }}>
                    <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Thinking...
                  </div>
                )}
                <div ref={chatRef} />
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <input placeholder="Ask Copilot or paste an error log..." value={chatInput}
                  onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendChat()}
                  style={{ flex: 1, padding: '10px 14px', background: 'rgba(0,0,0,0.4)', border: '1px solid var(--glass-border)', borderRadius: 8, color: '#fff', fontSize: 13 }} />
                <button onClick={() => sendChat()} disabled={chatBusy}
                  style={{ padding: '0 18px', background: 'var(--accent-cyan)', color: '#000', fontWeight: 700, borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                  <Send size={16} />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ══ CONTAINER HEALTH & ANOMALY MONITOR ══ */}
        {tab === 'metrics' && (
          <div className="animate-slide-up" style={{ maxWidth: 960 }}>
            <Header
              title="Container Health & Anomaly Detector"
              subtitle="Unsupervised Isolation Forest ML model analyzing Docker CPU, Memory, Restart, and Network I/O metrics in real time."
              action={
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button
                    onClick={() => setAutoScan(p => !p)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
                      background: autoScan ? 'rgba(52,211,153,0.2)' : 'rgba(255,255,255,0.06)',
                      border: `1px solid ${autoScan ? 'rgba(52,211,153,0.4)' : 'var(--glass-border)'}`,
                      borderRadius: 8, color: autoScan ? '#34d399' : 'var(--text-secondary)',
                      fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    }}>
                    <RefreshCw size={13} style={{ animation: autoScan ? 'spin 3s linear infinite' : 'none' }} />
                    {autoScan ? 'Auto-Scan ON (10s)' : 'Auto-Scan OFF'}
                  </button>
                  <button
                    onClick={scanContainerHealth}
                    disabled={healthLoading}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 7, padding: '8px 16px',
                      background: 'linear-gradient(135deg, var(--accent-cyan), var(--accent-blue))',
                      color: '#000', fontWeight: 700, borderRadius: 8, fontSize: 13, cursor: 'pointer',
                    }}>
                    {healthLoading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Activity size={14} />}
                    Scan Live Containers
                  </button>
                </div>
              }
            />

            {/* Model & System Status Pills */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
              <div className="glass-panel" style={{ padding: '14px 18px', borderLeft: '3px solid var(--accent-cyan)' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>ML Architecture</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginTop: 4 }}>Isolation Forest</div>
                <div style={{ fontSize: 11, color: 'var(--accent-cyan)', marginTop: 2 }}>5 Telemetry Dimensions</div>
              </div>

              <div className="glass-panel" style={{ padding: '14px 18px', borderLeft: '3px solid #34d399' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Healthy Containers</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#34d399', marginTop: 4 }}>
                  {containerHealth.filter(c => c.status === 'HEALTHY').length}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Not flagged by model or limits</div>
              </div>

              <div className="glass-panel" style={{ padding: '14px 18px', borderLeft: '3px solid #fb7185' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Anomalies Flagged</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#fb7185', marginTop: 4 }}>
                  {containerHealth.filter(c => c.is_anomaly).length}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Immediate attention needed</div>
              </div>

              <div className="glass-panel" style={{ padding: '14px 18px', borderLeft: '3px solid var(--accent-purple)' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>AI Engine</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: aiOk ? '#34d399' : '#fb7185', marginTop: 4 }}>
                  {aiOk ? 'Active (Port 8001)' : 'Offline'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>FastAPI + Scikit-Learn</div>
              </div>
            </div>

            {scanMsg && (
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                <CheckCircle2 size={13} color="#34d399" />
                {scanMsg}
              </div>
            )}

            {/* Live Containers List */}
            <div style={{ marginBottom: 28 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <ServerIcon size={16} color="var(--accent-cyan)" />
                Live Running Container Telemetry
              </h3>

              {containerHealth.length === 0 ? (
                <div className="glass-panel" style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
                  <Activity size={32} style={{ opacity: 0.3, margin: '0 auto 10px' }} />
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)' }}>
                    {healthError || 'No running Docker containers detected on host'}
                  </div>
                  <div style={{ fontSize: 12, marginTop: 4, maxWidth: 500, margin: '6px auto 0' }}>
                    Deploy an app from the Applications tab or use the <strong>Fault Injection Simulator</strong> below to test the Isolation Forest anomaly detector.
                  </div>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: 16 }}>
                  {containerHealth.map((c, idx) => (
                    <div key={idx} className="glass-panel" style={{
                      padding: 20,
                      borderColor: c.is_anomaly ? 'rgba(244,63,94,0.45)' : c.status === 'DEGRADING' ? 'rgba(251,191,36,0.45)' : 'rgba(52,211,153,0.35)',
                      background: c.is_anomaly ? 'rgba(244,63,94,0.05)' : undefined,
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                        <div style={{ fontWeight: 700, fontSize: 15, color: '#fff' }}>{c.container_name}</div>
                        <span style={{
                          fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 999,
                          background: c.is_anomaly ? 'rgba(244,63,94,0.2)' : c.status === 'DEGRADING' ? 'rgba(251,191,36,0.2)' : 'rgba(52,211,153,0.2)',
                          color: c.is_anomaly ? '#fb7185' : c.status === 'DEGRADING' ? '#fbbf24' : '#34d399',
                          border: `1px solid ${c.is_anomaly ? '#fb7185' : c.status === 'DEGRADING' ? '#fbbf24' : '#34d399'}`,
                        }}>
                          {c.is_anomaly ? '⚠️ ANOMALY DETECTED' : c.status === 'DEGRADING' ? '⚠ DEGRADING' : '✓ HEALTHY'}
                        </span>
                      </div>

                      {/* Metrics 4-grid */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 14 }}>
                        <div style={{ background: 'rgba(0,0,0,0.3)', padding: '8px 10px', borderRadius: 8, textAlign: 'center' }}>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>CPU</div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: c.cpu_percent > 80 ? '#fb7185' : 'var(--accent-cyan)' }}>{c.cpu_percent}%</div>
                        </div>
                        <div style={{ background: 'rgba(0,0,0,0.3)', padding: '8px 10px', borderRadius: 8, textAlign: 'center' }}>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Memory</div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: c.mem_percent > 80 ? '#fb7185' : 'var(--accent-cyan)' }}>{c.mem_percent}%</div>
                        </div>
                        <div style={{ background: 'rgba(0,0,0,0.3)', padding: '8px 10px', borderRadius: 8, textAlign: 'center' }}>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)' }} title="Restarts in the last 10 minutes">Restarts (10m)</div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: c.restart_count > 3 ? '#fb7185' : '#fff' }}>{c.restart_count}</div>
                        </div>
                        <div style={{ background: 'rgba(0,0,0,0.3)', padding: '8px 10px', borderRadius: 8, textAlign: 'center' }}>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Net In/Out</div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: '#fff' }}>{c.warming_up ? '…' : `${c.net_in_kb}/${c.net_out_kb} KB/s`}</div>
                        </div>
                      </div>

                      {/* Anomaly diagnosis details */}
                      <div style={{ background: 'rgba(0,0,0,0.4)', borderRadius: 8, padding: '10px 12px', fontSize: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span style={{ color: 'var(--text-muted)' }}>Isolation Forest Score:</span>
                          <span style={{ fontWeight: 700, color: c.is_anomaly ? '#fb7185' : c.status === 'DEGRADING' ? '#fbbf24' : '#34d399' }}>
                            {c.score ?? 'n/a'}{c.threshold != null && <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}> (flagged below {c.threshold})</span>}
                          </span>
                        </div>
                        {c.is_anomaly && c.detected_by && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                            <span style={{ color: 'var(--text-muted)' }}>Detected by:</span>
                            <span style={{ fontWeight: 600 }}>{c.detected_by.replace(/_/g, ' ')}</span>
                          </div>
                        )}
                        {c.dominant_factor && (
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: 'var(--text-muted)' }}>Dominant Fault Factor:</span>
                            <span style={{ fontWeight: 700, color: '#fbbf24', textTransform: 'uppercase' }}>{c.dominant_factor.replace(/_/g, ' ')}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ══ VIVA DEMO / FAULT INJECTION SIMULATOR ══ */}
            <div className="glass-panel" style={{ padding: 26, border: '1px solid rgba(0,242,254,0.25)', marginBottom: 28 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div>
                  <h3 style={{ fontSize: 17, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <FlaskConical size={18} color="var(--accent-cyan)" />
                    Interactive Fault Injection Test Bench (Viva Demo)
                  </h3>
                  <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                    Test how the Isolation Forest model classifies custom container telemetry & detects faults like Memory Leaks, CPU Spikes, Crash Loops, and Net Floods.
                  </p>
                </div>
              </div>

              {/* Preset Scenario Buttons */}
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8, letterSpacing: 0.5 }}>Quick Fault Presets:</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {faultPresets.map(preset => (
                    <button
                      key={preset.label}
                      onClick={() => setInjectForm(p => ({ ...p, ...preset.values }))}
                      style={{
                        padding: '6px 14px',
                        background: 'rgba(255,255,255,0.06)',
                        border: '1px solid var(--glass-border)',
                        borderRadius: 8,
                        color: '#fff',
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}>
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Sliders / Inputs */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14, marginBottom: 20 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 5 }}>Container Name</label>
                  <input
                    value={injectForm.container_name}
                    onChange={e => setInjectForm(p => ({ ...p, container_name: e.target.value }))}
                    style={{ width: '100%', padding: '8px 12px', background: 'rgba(0,0,0,0.4)', border: '1px solid var(--glass-border)', borderRadius: 8, color: '#fff', fontSize: 13 }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 5 }}>CPU Usage: <strong style={{ color: 'var(--accent-cyan)' }}>{injectForm.cpu_percent}%</strong></label>
                  <input
                    type="range" min="0" max="100" step="1"
                    value={injectForm.cpu_percent}
                    onChange={e => setInjectForm(p => ({ ...p, cpu_percent: e.target.value }))}
                    style={{ width: '100%' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 5 }}>Memory Usage: <strong style={{ color: 'var(--accent-cyan)' }}>{injectForm.mem_percent}%</strong></label>
                  <input
                    type="range" min="0" max="100" step="1"
                    value={injectForm.mem_percent}
                    onChange={e => setInjectForm(p => ({ ...p, mem_percent: e.target.value }))}
                    style={{ width: '100%' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 5 }}>Restarts (last 10 min)</label>
                  <input
                    type="number" min="0" max="100"
                    value={injectForm.restart_count}
                    onChange={e => setInjectForm(p => ({ ...p, restart_count: e.target.value }))}
                    style={{ width: '100%', padding: '8px 12px', background: 'rgba(0,0,0,0.4)', border: '1px solid var(--glass-border)', borderRadius: 8, color: '#fff', fontSize: 13 }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 5 }}>Net In (KB/s)</label>
                  <input
                    type="number" min="0"
                    value={injectForm.net_in_kb}
                    onChange={e => setInjectForm(p => ({ ...p, net_in_kb: e.target.value }))}
                    style={{ width: '100%', padding: '8px 12px', background: 'rgba(0,0,0,0.4)', border: '1px solid var(--glass-border)', borderRadius: 8, color: '#fff', fontSize: 13 }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 5 }}>Net Out (KB/s)</label>
                  <input
                    type="number" min="0"
                    value={injectForm.net_out_kb}
                    onChange={e => setInjectForm(p => ({ ...p, net_out_kb: e.target.value }))}
                    style={{ width: '100%', padding: '8px 12px', background: 'rgba(0,0,0,0.4)', border: '1px solid var(--glass-border)', borderRadius: 8, color: '#fff', fontSize: 13 }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
                <button
                  onClick={runFaultInject}
                  disabled={injecting}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '10px 24px',
                    background: 'linear-gradient(135deg, var(--accent-cyan), var(--accent-blue))',
                    color: '#000', fontWeight: 700, borderRadius: 10, cursor: 'pointer',
                  }}>
                  {injecting ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Cpu size={16} />}
                  Run Anomaly Inference
                </button>
              </div>

              {/* Inference Result Card */}
              {injectResult && (
                <div style={{
                  padding: 20,
                  borderRadius: 12,
                  background: injectResult.is_anomaly ? 'rgba(244,63,94,0.12)' : 'rgba(52,211,153,0.12)',
                  border: `1px solid ${injectResult.is_anomaly ? 'rgba(244,63,94,0.4)' : 'rgba(52,211,153,0.4)'}`,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 16,
                }}>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>
                      Inference Verdict · Container: <strong>{injectResult.container_name}</strong>
                    </div>
                    <div style={{
                      fontSize: 26, fontWeight: 800, marginTop: 4,
                      color: injectResult.is_anomaly ? '#fb7185' : '#34d399',
                    }}>
                      {injectResult.is_anomaly ? '🚨 ANOMALY DETECTED' : injectResult.status === 'DEGRADING' ? '⚠️ DEGRADING' : '✅ HEALTHY CONTAINER'}
                    </div>
                    {injectResult.message && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4, maxWidth: 520 }}>{injectResult.message}</div>}
                    {injectResult.dominant_factor && (
                      <div style={{ fontSize: 13, color: '#fbbf24', marginTop: 4 }}>
                        Primary Diagnostic Cause: <strong>{injectResult.dominant_factor.replace(/_/g, ' ').toUpperCase()}</strong>
                      </div>
                    )}
                  </div>

                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Isolation Forest Anomaly Score</div>
                    <div style={{ fontSize: 24, fontWeight: 800, color: '#fff', marginTop: 2 }}>{injectResult.score ?? 'n/a'}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                      {injectResult.threshold != null && <>Flagged below <strong>{injectResult.threshold}</strong> · </>}
                      {injectResult.detected_by ? <>Detected by: <strong>{injectResult.detected_by.replace('_', ' ')}</strong> · </> : null}
                      Mode: <strong>{injectResult.confidence}</strong>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* ══ TRAFFIC FORECASTER (LEGACY TAB ACCORDION) ══ */}
            <details className="glass-panel" style={{ padding: '16px 20px', cursor: 'pointer' }}>
              <summary style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <TrendingUp size={15} color="var(--accent-purple)" />
                Optional: Traffic Load Forecaster (Time-Series Random Forest)
              </summary>
              <div style={{ marginTop: 18 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 16 }}>
                  {[['current', 'Current Rate (t)'], ['lag1', 'Lag 1m (t-1)'], ['lag5', 'Lag 5m (t-5)'], ['lag15', 'Lag 15m (t-15)']].map(([k, label]) => (
                    <div key={k} style={{ background: 'rgba(0,0,0,0.3)', padding: '10px 14px', borderRadius: 8 }}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
                      <input
                        type="number"
                        value={(traffic as any)[k]}
                        onChange={e => setTraffic(p => ({ ...p, [k]: e.target.value }))}
                        style={{ width: '100%', background: 'transparent', border: 'none', color: 'var(--accent-cyan)', fontSize: 20, fontWeight: 700 }}
                      />
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>req/min</div>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
                  <button onClick={runPredict} disabled={predicting}
                    style={{ padding: '8px 18px', background: 'rgba(255,255,255,0.08)', color: '#fff', border: '1px solid var(--glass-border)', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                    {predicting ? 'Forecasting...' : 'Run Traffic Forecast'}
                  </button>
                </div>
                {prediction && (
                  <div style={{ padding: 14, background: 'rgba(0,242,254,0.06)', borderRadius: 8, border: '1px solid rgba(0,242,254,0.2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Predicted Traffic: </span>
                      <strong style={{ color: 'var(--accent-cyan)' }}>{prediction.predicted} req/min</strong>
                    </div>
                    <div>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Decision: </span>
                      <strong style={{ color: prediction.decision === 'SCALE_UP' ? '#34d399' : '#fb7185' }}>{prediction.decision}</strong>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 10 }}>Target Replicas: <strong>{prediction.replicas}</strong></span>
                    </div>
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
        <Modal title={`Delete “${delTarget.name}”?`} onClose={() => !delBusy && setDelTarget(null)}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: 14 }}>
            This permanently removes the application:
            <ul style={{ margin: '8px 0 0 18px' }}>
              <li>stops and deletes all its containers (including replicas)</li>
              <li>deletes its built Docker images and the cloned source code</li>
              <li>frees its port <code>{delTarget.host_port ?? '–'}</code> and removes it from the dashboard</li>
            </ul>
            <div style={{ marginTop: 8 }}>Past deployment logs are kept. This cannot be undone.</div>
          </div>
          {delErr && (
            <div style={{ color: '#fb7185', fontSize: 12, marginBottom: 12, lineHeight: 1.6 }}>⚠️ {delErr}
              {/force=true/.test(delErr) && (
                <div style={{ marginTop: 8 }}>
                  <button onClick={() => deleteApp(true)} disabled={delBusy} style={{ padding: '6px 12px', background: 'rgba(244,63,94,0.2)', border: '1px solid rgba(244,63,94,0.5)', borderRadius: 8, color: '#fb7185', fontSize: 12, cursor: 'pointer' }}>
                    Force delete (remove the record only)
                  </button>
                </div>
              )}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button onClick={() => setDelTarget(null)} disabled={delBusy} style={{ padding: '9px 16px', background: 'rgba(255,255,255,0.06)', border: '1px solid var(--glass-border)', borderRadius: 8, color: 'var(--text-secondary)', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
            <button onClick={() => deleteApp(false)} disabled={delBusy}
              style={{ padding: '9px 20px', background: '#e11d48', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7, opacity: delBusy ? 0.7 : 1 }}>
              {delBusy ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Deleting…</> : <><Trash2 size={14} /> Delete application</>}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
