import { Brand } from './components/Brand';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { ExternalLink, GitBranch, Globe, Layers, Loader2, LogOut, Play, Plus, ScrollText, Server as ServerIcon, Trash2 } from 'lucide-react';
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
import { APP_STATUS_LEGEND, Help, PageHead, SERVER_STATUS_LEGEND, StatusLegend } from './components/ui';

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
  return <span className={`badge ${cls}`}>{status}</span>;
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
    if (!window.confirm(`Remove '${srv.name}' from OmniDeploy? Nothing on the server itself is deleted.`)) return;
    setSrvBusy(srv.id);
    try { await tryBackend(`/servers/${srv.id}`, 'DELETE'); setServers(p => p.filter(x => x.id !== srv.id)); }
    catch (e: any) { setError(e.message); } finally { setSrvBusy(null); }
  };
  const serverName = (id: string) => servers.find(x => x.id === id)?.name;

  const errLine = view ? firstError(parseLogs(shownLines)) : undefined;

  return (
    <div style={{ minHeight: '100vh' }}>
      {/* Top bar */}
      <header className="topbar">
        <Brand subtitle="Customer portal" size={34} />
        <div className="spacer" />
        <div style={{ textAlign: 'right', minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{customer.name}</div>
          <div className="hint" style={{ marginTop: 0 }}>Signed in as {customer.email}</div>
        </div>
        <button type="button" className="btn ghost sm" onClick={onLogout}><LogOut size={14} /> Sign out</button>
      </header>

      <main className="content">
        <PageHead title="My applications"
          text="Each application is a GitHub repository that OmniDeploy builds and runs on a server for you. Pick the type, paste the link, press deploy."
          actions={<button type="button" className="btn blue" onClick={() => setWizard(true)}><Plus size={16} /> New application</button>} />

        <Help id="customer-apps" title="How does this page work?"
          need={[
            <>A <strong>public GitHub repository</strong> link, e.g. <code>https://github.com/you/your-repo</code>. Git is the tool that stores your code; GitHub hosts it online.</>,
            <>To know <strong>what kind of app</strong> it is (Flask, Node.js, a static HTML site...). If unsure, choose "Not sure - detect it for me".</>,
            <>A <strong>server</strong> to run it on. One is provided by OmniDeploy; you can also add your own Linux machine below.</>,
          ]}
          steps={[
            'We download (clone) your code from GitHub.',
            'We build it into a container: a small box with your code and everything it needs, so it runs the same way everywhere (this is what Docker does).',
            'We start the container on the server and check that it answers.',
            'You get a link to open your app. The whole thing takes one to three minutes.',
          ]}
          next={<>Press <strong>New application</strong> to begin. Each app card shows its status, its link when it is running, a "Deploy now" button and its log.</>}>
          An application here is simply your code on GitHub. OmniDeploy turns it into a running website or API on a private server, without any cloud account.
        </Help>

        {error && (
          <div className="note note-error" role="alert">
            Something went wrong: {error}
          </div>
        )}

        {loading ? (
          <div className="hint" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Loading your apps…</div>
        ) : apps.length === 0 ? (
          <div className="empty">
            <Layers size={40} />
            <h3>You have no applications yet</h3>
            <p>Three short steps and your first app is online:</p>
            <ol>
              <li>Press <strong>New application</strong>.</li>
              <li>Choose what type of app it is (Flask, Node.js, static site…).</li>
              <li>Paste your GitHub repository link and press <strong>Create &amp; deploy</strong>.</li>
            </ol>
            <div><button type="button" className="btn blue" onClick={() => setWizard(true)}><Plus size={14} /> New application</button></div>
          </div>
        ) : (
          <>
            <div className="grid">
              {apps.map(app => {
                const url = app.status === 'running' ? appUrl(app) : undefined;
                const busy = busyId === app.id || app.status === 'building';
                return (
                  <div key={app.id} className={`panel${app.status === 'running' ? ' ok' : ''}`}>
                    <div className="panel-head">
                      <div style={{ minWidth: 0 }}>
                        <h3 style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{app.name}</h3>
                        <span className="chip" style={{ marginTop: 5 }}>{typeLabel(app.app_type)}</span>
                      </div>
                      <StatusBadge status={app.status} />
                    </div>
                    {url && (
                      <a className="url-box" href={url} target="_blank" rel="noreferrer" title="Open the app in a new tab">
                        <Globe size={13} /> {url}<ExternalLink size={13} style={{ marginLeft: 'auto' }} />
                      </a>
                    )}
                    <div className="kv">
                      <div><GitBranch size={12} /><span>{app.repo_url.replace('https://github.com/', '')} <b>({app.branch})</b></span></div>
                      <div><Globe size={12} /><span>domain: <b>{app.domain}</b></span></div>
                      {serverName(app.server_id) && <div><ServerIcon size={12} /><span>runs on <b>{serverName(app.server_id)}</b></span></div>}
                    </div>
                    {app.status === 'failed' && <div className="hint" style={{ color: 'var(--danger)' }}>The last deploy did not work. Press "Show the log" to see the first error, fix it in your repository, then deploy again.</div>}
                    {app.status === 'idle' && <div className="hint">Saved but not deployed yet. Press "Deploy now" to build and start it.</div>}
                    <div className="panel-foot">
                      <button type="button" className="btn ok sm" onClick={() => deploy(app)} disabled={busy} title="Build the latest code and start the app">
                        {busy ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Play size={13} />} {app.status === 'building' ? 'Deploying…' : 'Deploy now'}
                      </button>
                      <button type="button" className="btn ghost sm" onClick={() => openLatestLog(app)} title="Show the log of the last deploy">
                        <ScrollText size={13} /> Show the log
                      </button>
                      <button type="button" className="btn danger sm icon" onClick={() => setDelTarget(app)} disabled={busy} title="Remove from OmniDeploy" aria-label={`Delete ${app.name}`} style={{ marginLeft: 'auto' }}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <StatusLegend items={APP_STATUS_LEGEND} />
          </>
        )}

        {/* Deploy log of the selected deployment */}
        {view && (
          <section ref={logsRef} style={{ marginTop: 32 }}>
            <PageHead small title={`Deploy log · ${view.appName}`}
              text="Everything the platform did for this deploy, line by line, as it happens."
              actions={<button type="button" className="btn ghost sm" onClick={() => setView(null)}>Close the log</button>} />
            <Help id="deploy-log" title="How to read this log"
              steps={['Fetch code: your repository is downloaded from GitHub.', 'Build: the container image is created (dependencies are installed here).', 'Start & verify: the container is started and the platform checks that it answers.']}
              next="Green lines are fine. If something fails, the first red line usually names the missing file or package; fix it in your repository and deploy again.">
              The log is live: new lines appear while the deploy runs. When it finishes, the result and the link to your app are shown above the log.
            </Help>
            <DeployBanner status={view.status} appName={view.appName} url={view.url} errorText={errLine?.text} />
            <LogViewer lines={shownLines} status={view.status} minHeight={360} />
          </section>
        )}

        {/* Where apps run: servers the platform shares + the customer's own */}
        {!loading && (
          <section style={{ marginTop: 40 }}>
            <PageHead small title="Where your apps run"
              text="The machines your apps can be deployed to. Have your own Linux machine? Add it and your apps run there."
              actions={<button type="button" className="btn ghost" onClick={() => setAddServer(true)}><Plus size={14} /> Add my server</button>} />
            <Help id="customer-servers" title="What is a server here?"
              need={[
                'Nothing, if you use the server provided by OmniDeploy: it is already set up.',
                'To add your own: a Linux machine (Ubuntu or Debian) that stays on, its IP address, and five minutes to paste three commands on it.',
              ]}
              next={<>Press <strong>Add my server</strong> and follow the three steps. "Check again" re-tests a server; a verified server is ready to run apps.</>}>
              A server is a Linux computer that runs your apps: a laptop in the lab, a Raspberry Pi, a rented VPS. OmniDeploy logs in to it over SSH
              (the secure remote login Linux machines use) and starts your apps there with Docker. The platform may provide one for everyone.
            </Help>
            {servers.length === 0 ? (
              <div className="empty">
                <ServerIcon size={36} />
                <h3>No server yet</h3>
                <p>Apps need a machine to run on. Add your own Linux machine, or ask the platform owner to share one.</p>
                <div><button type="button" className="btn blue" onClick={() => setAddServer(true)}><Plus size={14} /> Add my server</button></div>
              </div>
            ) : (
              <>
                <div className="grid">
                  {servers.map(srv => {
                    const mine = srv.owner_id === customer.id;
                    return (
                      <ServerCard key={srv.id} server={srv} busy={srvBusy === srv.id} canManage={mine} canShare={false}
                        note={mine ? 'Your own server' : 'Provided by OmniDeploy'}
                        onVerify={() => verifyServer(srv)} onDelete={() => removeServer(srv)} />
                    );
                  })}
                </div>
                <StatusLegend items={SERVER_STATUS_LEGEND} />
              </>
            )}
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
          <Help id="delete-app" title="What will be deleted"
            steps={[
              'The running app is stopped and its container is removed from the server.',
              'The copy of your code on the server and the app\'s deploy logs are deleted.',
              `"${delTarget.name}" disappears from this page and its link stops working.`,
            ]}
            next={<><strong>Not touched:</strong> your GitHub repository, your account, and the server itself. You can create the app again at any time.</>}>
            This cannot be undone. Here is exactly what happens:
          </Help>
          <div className="form-actions">
            <button type="button" className="btn ghost" onClick={() => setDelTarget(null)} disabled={busyId === delTarget.id}>Cancel, keep it</button>
            <button type="button" className="btn danger solid" onClick={remove} disabled={busyId === delTarget.id}>
              {busyId === delTarget.id ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Trash2 size={13} />} Remove from OmniDeploy
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
