import React, { useEffect, useState } from 'react';
import { Check, Copy, Database, FolderGit2, HardDrive, Laptop, Loader2, RefreshCw, Server as ServerIcon, ShieldAlert, Wifi } from 'lucide-react';
import { tryBackend } from './lib/backend';
import { Help, PageHead } from './components/ui';

interface Storage {
  machine: { hostname: string; os: string; user: string; lan_addresses: string[]; customer_portal_urls: string[]; admin_url: string; backend_port: number };
  data_dir: string;
  persistence_enabled: boolean;
  data_files: { name: string; path: string; exists: boolean; size_bytes: number; modified: string | null; records: number | null; what: string; sensitive?: string }[];
  apps_dir: string;
  app_checkouts: { name: string; path: string; bytes: number; files: number; truncated: boolean; owner: string }[];
  /** Apps deployed to Linux servers: their code lives there, not on this laptop. */
  server_checkouts?: { app: string; server: string; host: string; path: string; owner: string }[];
  docker_note: string;
}

const DEMO: Storage = {
  machine: { hostname: 'admin-laptop', os: 'Windows_NT 10.0', user: 'talha', lan_addresses: ['192.168.1.20'], customer_portal_urls: ['http://192.168.1.20:5173/'], admin_url: 'http://localhost:5173/admin', backend_port: 3000 },
  data_dir: 'C:\\Users\\talha\\.paas-data', persistence_enabled: true,
  data_files: [
    { name: 'users.json', path: 'C:\\Users\\talha\\.paas-data\\users.json', exists: true, size_bytes: 1334, modified: new Date().toISOString(), records: 3, what: 'Customer and admin accounts (name, email, role, sign-up and last login time)', sensitive: 'Passwords are NOT stored. Only a salted scrypt hash of each password is kept.' },
    { name: 'sessions.json', path: 'C:\\Users\\talha\\.paas-data\\sessions.json', exists: true, size_bytes: 572, modified: new Date().toISOString(), records: 2, what: 'Who is signed in right now (login tokens, valid 7 days)' },
    { name: 'applications.json', path: 'C:\\Users\\talha\\.paas-data\\applications.json', exists: true, size_bytes: 665, modified: new Date().toISOString(), records: 1, what: 'Every application: owner, Git repository, app type, domain, ports, environment variables' },
    { name: 'platform_ssh_key.json', path: 'C:\\Users\\talha\\.paas-data\\platform_ssh_key.json', exists: true, size_bytes: 520, modified: new Date().toISOString(), records: null, what: "The platform's SSH key pair, used to log in to Linux servers", sensitive: 'Contains the PRIVATE key: whoever has this file can log in to every server that trusts the platform key. Never share it.' },
  ],
  server_checkouts: [{ app: 'hello-flask', server: 'linux-laptop', host: '192.168.1.30', path: '/home/ubuntu/paas-apps/hello-flask', owner: 'ayesha@example.com' }],
  apps_dir: 'C:\\Users\\talha\\paas-apps',
  app_checkouts: [{ name: 'hello-flask', path: 'C:\\Users\\talha\\paas-apps\\hello-flask', bytes: 48211, files: 12, truncated: false, owner: 'ayesha@example.com' }],
  docker_note: 'Built images and running containers are stored by Docker on this machine (docker images / docker ps).',
};

const size = (b: number) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`);

const MONO: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 12, wordBreak: 'break-all', color: 'var(--text-primary)' };

/** A file or folder path in monospace, with a copy button next to it. */
function Path({ text, strong = false, size: fs }: { text: string; strong?: boolean; size?: number }) {
  const [done, setDone] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1200); } catch { /* blocked */ } };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, maxWidth: '100%' }}>
      <code style={{ ...MONO, fontSize: fs ?? 12, fontWeight: strong ? 600 : 400 }}>{text}</code>
      <button type="button" title="Copy path" aria-label="Copy path" onClick={copy} className="btn subtle sm icon" style={{ padding: 3, color: done ? 'var(--ok)' : 'var(--text-muted)' }}>
        {done ? <Check size={12} /> : <Copy size={12} />}
      </button>
    </span>
  );
}

function Section({ icon, title, hint, children }: { icon: React.ReactNode; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <div className="panel-head" style={{ alignItems: 'center' }}>
        <div>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{icon}{title}</h3>
          {hint && <div className="hint">{hint}</div>}
        </div>
      </div>
      {children}
    </div>
  );
}

/** Admin page: where accounts, app records and customers' code are saved on this laptop. */
export default function AdminStorage({ demo }: { demo: boolean }) {
  const [data, setData] = useState<Storage | null>(demo ? DEMO : null);
  const [err, setErr] = useState('');
  const load = () => {
    if (demo) { setData(DEMO); return; }
    setData(null);
    tryBackend('/admin/storage').then(d => { setData(d); setErr(''); }).catch(e => setErr(e.message));
  };
  useEffect(load, [demo]);

  return (
    <div className="animate-slide-up">
      <PageHead title="Data & Storage" text="Everything customers send is saved on this admin laptop. Here is exactly where."
        actions={<button type="button" className="btn ghost sm" onClick={load}><RefreshCw size={13} /> Refresh</button>} />

      <Help id="admin-storage" title="What am I looking at?"
        steps={[
          <><strong>Accounts, sessions, apps, servers and deployments</strong> are small JSON text files in one data folder on this laptop.</>,
          <><strong>Cloned code</strong> is one folder per app inside the apps folder (or on the Linux server the app was deployed to).</>,
          <><strong>Built images and containers</strong> are kept by Docker itself.</>,
        ]}
        next={<>To back up, copy the data folder to another drive (add the apps folder if you want the code too). Deleting an app removes its code folder and its record. Nothing is sent to the cloud.</>}>
        OmniDeploy does not use a database server. Every record is a plain file you can open, copy or delete yourself. The paths below are on this machine.
      </Help>

      {err && <div className="note note-error">{err}</div>}
      {!data && !err && <div className="hint" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Loading…</div>}

      {data && (
        <>
          <Section icon={<Laptop size={16} />} title="This machine (the admin laptop)" hint="The computer OmniDeploy is running on.">
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', marginBottom: 14 }}>
              <div className="stat"><div className="v" style={{ fontSize: 18 }}>{data.machine.hostname}</div><div className="l">Computer name</div></div>
              <div className="stat"><div className="v" style={{ fontSize: 18 }}>{data.machine.os}</div><div className="l">Operating system</div></div>
              <div className="stat"><div className="v" style={{ fontSize: 18 }}>{data.machine.user}</div><div className="l">Runs as user</div></div>
            </div>
            <div className="kv" style={{ marginBottom: 0 }}>
              <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}><Wifi size={14} /> Customer portal link (open on the customer's device, same Wi-Fi/network)</div>
              {data.machine.customer_portal_urls.length === 0
                ? <div>No network connection found on this laptop.</div>
                : data.machine.customer_portal_urls.map(u => <div key={u}><Path text={u} strong size={14} /></div>)}
              <div style={{ color: 'var(--text-muted)' }}>Admin site (this laptop only): <code style={MONO}>{data.machine.admin_url}</code></div>
            </div>
          </Section>

          <Section icon={<Database size={16} />} title="Accounts and platform records" hint="JSON files: one per kind of record. Copy this folder to back up the platform.">
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
              Folder: <Path text={data.data_dir} strong />
            </div>
            {!data.persistence_enabled && <div className="note note-warn">Saving is turned OFF (<code>PAAS_PERSISTENCE=off</code>): records are lost when the backend restarts.</div>}
            <div className="table-wrap">
              <table className="table" style={{ minWidth: 640 }}>
                <thead><tr><th>File</th><th>What is inside</th><th>Records</th><th>Size / updated</th></tr></thead>
                <tbody>
                  {data.data_files.map(f => (
                    <tr key={f.name}>
                      <td><Path text={f.name} strong /><div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}><code style={{ ...MONO, fontSize: 11, color: 'inherit' }}>{f.path}</code></div></td>
                      <td>
                        {f.what}
                        {f.sensitive && <div style={{ display: 'flex', gap: 5, marginTop: 4, fontSize: 12, color: 'var(--warn)' }}><ShieldAlert size={12} style={{ flexShrink: 0, marginTop: 2 }} />{f.sensitive}</div>}
                      </td>
                      <td>{f.exists ? f.records ?? '–' : <span style={{ color: 'var(--text-muted)' }}>not created yet</span>}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{f.exists ? <>{size(f.size_bytes)}<br />{f.modified && new Date(f.modified).toLocaleString()}</> : '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="hint" style={{ marginTop: 10 }}>On Linux/macOS the files are readable only by the user running the backend (permission 600). On Windows they are protected by your user account folder.</div>
          </Section>

          <Section icon={<FolderGit2 size={16} />} title="Customers' code (cloned from GitHub)" hint="One folder per app. Deleting the app removes its folder.">
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
              Folder: <Path text={data.apps_dir} strong />
            </div>
            {data.app_checkouts.length === 0 ? <div className="hint">Nothing cloned yet. A folder appears here after an app's first deploy.</div> : (
              <div className="table-wrap">
                <table className="table" style={{ minWidth: 560 }}>
                  <thead><tr><th>Folder</th><th>Owner</th><th>Files</th><th>Size</th></tr></thead>
                  <tbody>
                    {data.app_checkouts.map(c => (
                      <tr key={c.name}>
                        <td><Path text={c.path} /></td>
                        <td>{c.owner}</td>
                        <td>{c.files}{c.truncated ? '+' : ''}</td>
                        <td>{size(c.bytes)}{c.truncated ? '+' : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section icon={<ServerIcon size={16} />} title="Customers' code on Linux servers" hint="Apps deployed to a private server keep their code on that server, not on this laptop.">
            {!data.server_checkouts?.length ? <div className="hint">No app is deployed to a Linux server yet.</div> : (
              <div className="table-wrap">
                <table className="table" style={{ minWidth: 560 }}>
                  <thead><tr><th>App</th><th>Server</th><th>Folder on that server</th><th>Owner</th></tr></thead>
                  <tbody>
                    {data.server_checkouts.map(c => (
                      <tr key={c.app}>
                        <td><b>{c.app}</b></td>
                        <td>{c.server}<div><code style={{ ...MONO, color: 'var(--text-muted)' }}>{c.host}</code></div></td>
                        <td><code style={MONO}>{c.path}</code></td>
                        <td>{c.owner}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section icon={<HardDrive size={16} />} title="Built apps" hint="Docker keeps these; they are rebuilt on the next deploy.">
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{data.docker_note}</div>
          </Section>
        </>
      )}
    </div>
  );
}
