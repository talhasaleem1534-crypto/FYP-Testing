import React, { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { ExternalLink, GitBranch, Globe, Layers, Loader2, LogOut, Play, Plus, ScrollText, Server as ServerIcon, Trash2, Zap } from 'lucide-react';
import { BACKEND_URL, getAuthToken, tryBackend } from './lib/backend';
import { Customer } from './lib/auth';
import { FALLBACK_APP_TYPES } from './lib/appTypes';
import { firstError, parseLogs } from './lib/logs';
import NewAppWizard, { NewAppPayload } from './NewAppWizard';
import Modal from './components/Modal';
import LogViewer from './components/LogViewer';
import DeployBanner from './components/DeployBanner';
import ServerOnboarding from './components/ServerOnboarding';
import ServerCard from './components/ServerCard';
import { ServerRecord } from './lib/servers';

interface PortalApp {
  id: string; name: string; repo_url: string; branch: string; domain: string;
  port: number; host_port?: number; status: string; app_type?: string; current_commit_sha?: string;
  server_id: string;
  /** http://<server IP>:<port> when the app runs on a Linux server. */
  app_url?: string | null;
}
/** The deployment whose log is shown. */
interface LogView { id: string; appName: string; status: string; lines: string[]; url?: string }

/** Where to open a running app: its Linux server, or the platform machine that serves this page. */
const appUrl = (a: { app_url?: string | null; host_port?: number }) =>
  a.app_url || (a.host_port ? `http://${window.location.hostname}:${a.host_port}` : undefined);
/** A deployment's link: the server address it reported, unless that is the platform's own "localhost". */
const depUrl = (d: { app_url?: string; host_port?: number }) =>
  d.app_url && !d.app_url.includes('localhost') ? d.app_url : appUrl({ host_port: d.host_port });
/** The backend writes "http://localhost:<port>" in logs; on the customer's device that must be the platform's address. */
const forThisDevice = (line: string) => line.replace(/http:\/\/localhost:(\d+)/g, (_, port) => `http://${window.location.hostname}:${port}`);
const typeLabel = (id?: string) => FALLBACK_APP_TYPES.find(t => t.id === id)?.label || 'Auto-detect';

function StatusBadge({ status }: { status: string }) {
  const cls = ['running', 'success'].includes(status) ? 'badge-verified'
    : ['building', 'deploying'].includes(status) ? 'badge-building'
    : status === 'failed' ? 'badge-failed' : 'badge-idle';
  return <span className={`badge ${cls}`}><span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />{status}</span>;
}

/**
 * What a customer sees on their own device: their apps only, "New application", deploy, live logs.
 * Servers, other customers and platform internals are on the admin site (/admin) only.
 */
export default function CustomerPortal({ customer, onLogout }: { customer: Customer; onLogout: () => void }) {
  const [apps, setApps] = useState<PortalApp[]>([]);
  const [servers, setServers] = useState<ServerRecord[]>([]);
  const [addServer, setAddServer] = useState(false);
  const [srvBusy, setSrvBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [wizard, setWizard] = useState(false);
  const [view, setView] = useState<LogView | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [delTarget, setDelTarget] = useState<PortalApp | null>(null);
  const viewRef = useRef<LogView | null>(null);
  viewRef.current = view;
  const logsRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const [a, s] = await Promise.all([tryBackend('/applications'), tryBackend('/servers')]);
      setApps(a); setServers(s); setError('');
    } catch (e: any) {
      setError(e.message === 'Failed to fetch' ? 'Cannot reach the platform. Check that the admin laptop is on and on the same network.' : e.message);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Live deploy logs. The backend only sends this customer's own deployments.
  useEffect(() => {
    const socket = io(BACKEND_URL, { auth: { token: getAuthToken() } });
    socket.on('global_deploy_log', (d: { deploymentId: string; log: string }) => {
      setView(v => (v && v.id === d.deploymentId ? { ...v, lines: [...v.lines, d.log] } : v));
    });
    socket.on('global_status_change', (d: { deploymentId: string; status: string }) => {
      load();
      const v = viewRef.current;
      if (!v || v.id !== d.deploymentId) return;
      setView({ ...v, status: d.status });
      if (d.status === 'success' || d.status === 'failed') {
        // Fetch the stored log too, in case some live lines were missed.
        tryBackend(`/deployments/${d.deploymentId}`)
          .then(dep => setView(cur => (cur && cur.id === dep.id ? { ...cur, status: dep.status, lines: dep.logs, url: depUrl(dep) } : cur)))
          .catch(() => {});
      }
    });
    return () => { socket.disconnect(); };
  }, [load]);

  const showLogs = (v: LogView) => {
    setView(v);
    setTimeout(() => logsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const deploy = async (app: PortalApp) => {
    setBusyId(app.id); setError('');
    try {
      const r = await tryBackend(`/applications/${app.id}/deploy`, 'POST', {});
      setApps(p => p.map(a => (a.id === app.id ? { ...a, status: 'building' } : a)));
      showLogs({ id: r.deployment_id, appName: app.name, status: 'building', lines: [] });
    } catch (e: any) { setError(e.message); } finally { setBusyId(null); }
  };

  const openLatestLog = async (app: PortalApp) => {
    try {
      const deps = await tryBackend(`/applications/${app.id}/deployments`);
      if (!deps.length) { setError(`'${app.name}' has not been deployed yet. Press Deploy.`); return; }
      const dep = await tryBackend(`/deployments/${deps[0].id}`);
      showLogs({ id: dep.id, appName: app.name, status: dep.status, lines: dep.logs, url: depUrl(dep) });
    } catch (e: any) { setError(e.message); }
  };

  const create = async (form: NewAppPayload, deployNow: boolean) => {
    const name = form.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const app: PortalApp = await tryBackend('/applications', 'POST', { ...form, name, build_method: 'dockerfile', env_vars: {} });
    setApps(p => [...p, app]);
    setWizard(false);
    if (deployNow) deploy(app);
  };

  const remove = async () => {
    if (!delTarget) return;
    setBusyId(delTarget.id);
    try {
      await tryBackend(`/applications/${delTarget.id}`, 'DELETE');
      setApps(p => p.filter(a => a.id !== delTarget.id));
      if (view?.appName === delTarget.name) setView(null);
      setDelTarget(null);
    } catch (e: any) { setError(e.message); setDelTarget(null); } finally { setBusyId(null); }
  };

  const shownLines = view ? view.lines.map(forThisDevice) : [];
  const verifyServer = async (srv: ServerRecord) => {
    setSrvBusy(srv.id);
    try { const r = await tryBackend(`/servers/${srv.id}/verify`, 'POST', {}); setServers(p => p.map(x => (x.id === r.id ? r : x))); }
    catch (e: any) { setError(e.message); } finally { setSrvBusy(null); }
  };
  const removeServer = async (srv: ServerRecord) => {
    if (!window.confirm(`Remove '${srv.name}' from DeployStack? Nothing on the server itself is deleted.`)) return;
    setSrvBusy(srv.id);
    try { await tryBackend(`/servers/${srv.id}`, 'DELETE'); setServers(p => p.filter(x => x.id !== srv.id)); }
    catch (e: any) { setError(e.message); } finally { setSrvBusy(null); }
  };
  const serverName = (id: string) => servers.find(x => x.id === id)?.name;

  const errLine = view ? firstError(parseLogs(shownLines)) : undefined;
  const btn: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 8, fontSize: 13, fontWeight: 600 };

  return (
    <div style={{ minHeight: '100vh' }}>
      {/* Top bar */}
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 24px', borderBottom: '1px solid var(--glass-border)', background: 'var(--bg-secondary)', flexWrap: 'wrap' }}>
        <div style={{ width: 34, height: 34, borderRadius: 9, background: 'linear-gradient(135deg, var(--accent-cyan), var(--accent-purple))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Zap size={18} color="#fff" />
        </div>
        <div style={{ flex: 1, minWidth: 140 }}>
          <div style={{ fontWeight: 700 }}>DeployStack</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Customer portal</div>
        </div>
        <div style={{ textAlign: 'right', minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{customer.name}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{customer.email}</div>
        </div>
        <button onClick={onLogout} style={{ ...btn, background: 'rgba(255,255,255,0.06)', border: '1px solid var(--glass-border)', color: 'var(--text-secondary)', fontWeight: 500 }}>
          <LogOut size={14} /> Sign out
        </button>
      </header>

      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '28px 16px 60px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 22, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700 }}>My applications</h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginTop: 4 }}>Pick your app type, paste your GitHub link, and we build and run it for you.</p>
          </div>
          <button onClick={() => setWizard(true)}
            style={{ ...btn, padding: '10px 18px', fontSize: 14, background: 'linear-gradient(135deg, var(--accent-blue), var(--accent-purple))', color: '#fff' }}>
            <Plus size={16} /> New application
          </button>
        </div>

        {error && <div style={{ color: '#fb7185', fontSize: 13, marginBottom: 16, padding: '10px 14px', background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.3)', borderRadius: 10 }}>⚠️ {error}</div>}

        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)' }}><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Loading your apps…</div>
        ) : apps.length === 0 ? (
          <div className="glass-panel" style={{ padding: 32, textAlign: 'center' }}>
            <Layers size={40} style={{ opacity: 0.3 }} />
            <div style={{ fontWeight: 600, fontSize: 17, marginTop: 10 }}>You have no applications yet</div>
            <ol style={{ color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.9, margin: '12px auto 18px', textAlign: 'left', display: 'inline-block' }}>
              <li>Click <strong>New application</strong></li>
              <li>Choose what type of app it is (Flask, Node.js, static site…)</li>
              <li>Paste your GitHub repository link and press <strong>Create &amp; deploy</strong></li>
            </ol>
            <div><button onClick={() => setWizard(true)} style={{ ...btn, margin: '0 auto', background: 'rgba(79,172,254,0.15)', color: 'var(--accent-cyan)', border: '1px solid rgba(79,172,254,0.35)' }}><Plus size={14} /> New application</button></div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
            {apps.map(app => {
              const url = app.status === 'running' ? appUrl(app) : undefined;
              const busy = busyId === app.id || app.status === 'building';
              return (
                <div key={app.id} className="glass-panel" style={{ padding: 20, borderColor: app.status === 'running' ? 'rgba(52,211,153,0.35)' : undefined }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 17, overflow: 'hidden', textOverflow: 'ellipsis' }}>{app.name}</div>
                      <span style={{ display: 'inline-block', marginTop: 5, fontSize: 11, padding: '2px 8px', borderRadius: 6, background: 'rgba(167,139,250,0.15)', color: '#c4b5fd', border: '1px solid rgba(167,139,250,0.3)' }}>{typeLabel(app.app_type)}</span>
                    </div>
                    <StatusBadge status={app.status} />
                  </div>
                  {url && (
                    <a href={url} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.35)', borderRadius: 10, marginBottom: 10, color: '#34d399', fontWeight: 600, fontSize: 13, textDecoration: 'none' }}>
                      {url}<ExternalLink size={13} style={{ marginLeft: 'auto' }} />
                    </a>
                  )}
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', background: 'rgba(0,0,0,0.25)', borderRadius: 8, padding: '8px 11px', marginBottom: 14, lineHeight: 1.7, wordBreak: 'break-all' }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}><GitBranch size={11} style={{ flexShrink: 0 }} />{app.repo_url.replace('https://github.com/', '')} ({app.branch})</div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Globe size={11} style={{ flexShrink: 0 }} />{app.domain}</div>
                    {serverName(app.server_id) && <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}><ServerIcon size={11} style={{ flexShrink: 0 }} />runs on {serverName(app.server_id)}</div>}
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button onClick={() => deploy(app)} disabled={busy}
                      style={{ ...btn, background: 'rgba(16,185,129,0.18)', color: '#34d399', border: '1px solid rgba(16,185,129,0.4)', opacity: busy ? 0.6 : 1 }}>
                      {busy ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Play size={13} />} {app.status === 'building' ? 'Deploying…' : 'Deploy'}
                    </button>
                    <button onClick={() => openLatestLog(app)} style={{ ...btn, background: 'rgba(255,255,255,0.06)', color: 'var(--text-secondary)', border: '1px solid var(--glass-border)' }}>
                      <ScrollText size={13} /> Logs
                    </button>
                    <button onClick={() => setDelTarget(app)} disabled={busy} title="Delete application" aria-label={`Delete ${app.name}`}
                      style={{ ...btn, marginLeft: 'auto', background: 'rgba(244,63,94,0.12)', color: '#fb7185', border: '1px solid rgba(244,63,94,0.35)', opacity: busy ? 0.4 : 1 }}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Deploy log of the selected deployment */}
        {view && (
          <div ref={logsRef} style={{ marginTop: 28 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700 }}>Deploy log · {view.appName}</h2>
              <button onClick={() => setView(null)} style={{ ...btn, background: 'transparent', color: 'var(--text-muted)', fontWeight: 500 }}>Close</button>
            </div>
            <DeployBanner status={view.status} appName={view.appName} url={view.url} errorText={errLine?.text} />
            <LogViewer lines={shownLines} status={view.status} minHeight={360} />
          </div>
        )}

        {/* Where apps run: servers the platform shares + the customer's own */}
        {!loading && (
          <section style={{ marginTop: 36 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 14, flexWrap: 'wrap' }}>
              <div>
                <h2 style={{ fontSize: 19, fontWeight: 700 }}>Where your apps run</h2>
                <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 4 }}>Servers you can deploy to. Have your own Linux machine? Add it and your apps run there.</p>
              </div>
              <button onClick={() => setAddServer(true)} style={{ ...btn, background: 'rgba(79,172,254,0.15)', color: 'var(--accent-cyan)', border: '1px solid rgba(79,172,254,0.35)' }}>
                <Plus size={14} /> Add my server
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
              {servers.map(srv => {
                const mine = srv.owner_id === customer.id;
                return (
                  <ServerCard key={srv.id} server={srv} busy={srvBusy === srv.id} canManage={mine} canShare={false}
                    note={mine ? 'Your own server' : 'Provided by DeployStack'}
                    onVerify={() => verifyServer(srv)} onDelete={() => removeServer(srv)} />
                );
              })}
            </div>
          </section>
        )}
      </main>

      {addServer && (
        <Modal title="Add my server" width={720} onClose={() => setAddServer(false)}>
          <ServerOnboarding asAdmin={false} demo={false} onCancel={() => setAddServer(false)}
            onDone={srv => { setServers(p => [srv, ...p.filter(x => x.id !== srv.id)]); setAddServer(false); }} />
        </Modal>
      )}

      {wizard && (
        <Modal title="New application" width={760} onClose={() => setWizard(false)}>
          <NewAppWizard servers={servers} useBackend onCreate={create} onCancel={() => setWizard(false)} />
        </Modal>
      )}

      {delTarget && (
        <Modal title={`Delete “${delTarget.name}”?`} onClose={() => busyId !== delTarget.id && setDelTarget(null)}>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 18 }}>
            This stops the app and deletes its container and the copy of your code on the platform. Your GitHub repository is not touched.
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button onClick={() => setDelTarget(null)} style={{ ...btn, background: 'rgba(255,255,255,0.06)', border: '1px solid var(--glass-border)', color: 'var(--text-secondary)' }}>Cancel</button>
            <button onClick={remove} disabled={busyId === delTarget.id} style={{ ...btn, background: '#e11d48', color: '#fff' }}>
              {busyId === delTarget.id ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Trash2 size={13} />} Delete
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
