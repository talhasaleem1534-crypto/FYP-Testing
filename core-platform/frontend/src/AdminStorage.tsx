import React, { useEffect, useState } from 'react';
import { Copy, Database, FolderGit2, HardDrive, Laptop, Loader2, RefreshCw, Server as ServerIcon, ShieldAlert, Wifi } from 'lucide-react';
import { tryBackend } from './lib/backend';

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

function CopyPath({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button title="Copy path" aria-label="Copy path" onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1200); } catch { /* blocked */ } }}
      style={{ background: 'transparent', color: done ? '#34d399' : 'var(--text-muted)', padding: 2, display: 'inline-flex' }}>
      <Copy size={12} />
    </button>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="glass-panel" style={{ padding: 20, marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 15, marginBottom: 14 }}>{icon}{title}</div>
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

  const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 12, wordBreak: 'break-all' };
  const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' };
  const td: React.CSSProperties = { padding: '10px', fontSize: 13, borderTop: '1px solid var(--glass-border)', verticalAlign: 'top' };

  return (
    <div className="animate-slide-up">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 22, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 24, fontWeight: 700 }}>Data &amp; Storage</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginTop: 5 }}>Everything customers send is saved on this admin laptop. Here is exactly where.</p>
        </div>
        <button onClick={load} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 14px', background: 'rgba(255,255,255,0.06)', border: '1px solid var(--glass-border)', borderRadius: 8, color: 'var(--text-secondary)', fontSize: 13 }}>
          <RefreshCw size={13} /> Refresh
        </button>
      </div>
      {err && <div style={{ color: '#fb7185', fontSize: 13, marginBottom: 14 }}>⚠️ {err}</div>}
      {!data && !err && <div style={{ display: 'flex', gap: 8, color: 'var(--text-muted)' }}><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Loading…</div>}

      {data && (
        <>
          <Section icon={<Laptop size={17} color="var(--accent-cyan)" />} title="This machine (the admin laptop)">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, fontSize: 13, color: 'var(--text-secondary)' }}>
              <div>Computer name<br /><strong style={{ color: 'var(--text-primary)' }}>{data.machine.hostname}</strong></div>
              <div>Operating system<br /><strong style={{ color: 'var(--text-primary)' }}>{data.machine.os}</strong></div>
              <div>Runs as user<br /><strong style={{ color: 'var(--text-primary)' }}>{data.machine.user}</strong></div>
            </div>
            <div style={{ marginTop: 14, padding: '11px 14px', background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.3)', borderRadius: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: '#34d399', marginBottom: 6 }}><Wifi size={14} /> Customer portal link (open on the customer's device, same Wi-Fi/network)</div>
              {data.machine.customer_portal_urls.length === 0
                ? <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>No network connection found on this laptop.</div>
                : data.machine.customer_portal_urls.map(u => <div key={u} style={{ ...mono, fontSize: 14, color: 'var(--text-primary)' }}>{u} <CopyPath text={u} /></div>)}
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>Admin site (this laptop only): <span style={mono}>{data.machine.admin_url}</span></div>
            </div>
          </Section>

          <Section icon={<Database size={17} color="var(--accent-cyan)" />} title="Accounts and platform records">
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
              Folder: <span style={{ ...mono, color: 'var(--text-primary)' }}>{data.data_dir}</span> <CopyPath text={data.data_dir} />
              {!data.persistence_enabled && <span style={{ color: '#fbbf24' }}> — saving is turned OFF (PAAS_PERSISTENCE=off): data is lost on restart</span>}
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
                <thead><tr><th style={th}>File</th><th style={th}>What is inside</th><th style={th}>Records</th><th style={th}>Size / updated</th></tr></thead>
                <tbody>
                  {data.data_files.map(f => (
                    <tr key={f.name}>
                      <td style={td}><div style={{ ...mono, fontWeight: 600, color: 'var(--text-primary)' }}>{f.name} <CopyPath text={f.path} /></div></td>
                      <td style={{ ...td, color: 'var(--text-secondary)' }}>
                        {f.what}
                        {f.sensitive && <div style={{ display: 'flex', gap: 5, marginTop: 4, fontSize: 12, color: '#fbbf24' }}><ShieldAlert size={12} style={{ flexShrink: 0, marginTop: 2 }} />{f.sensitive}</div>}
                      </td>
                      <td style={td}>{f.exists ? f.records ?? '–' : <span style={{ color: 'var(--text-muted)' }}>not created yet</span>}</td>
                      <td style={{ ...td, fontSize: 12, color: 'var(--text-muted)' }}>{f.exists ? <>{size(f.size_bytes)}<br />{f.modified && new Date(f.modified).toLocaleString()}</> : '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10 }}>On Linux/macOS the files are readable only by the user running the backend (permission 600). On Windows they are protected by your user account folder.</div>
          </Section>

          <Section icon={<FolderGit2 size={17} color="var(--accent-cyan)" />} title="Customers' code (cloned from GitHub)">
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
              Folder: <span style={{ ...mono, color: 'var(--text-primary)' }}>{data.apps_dir}</span> <CopyPath text={data.apps_dir} />
            </div>
            {data.app_checkouts.length === 0 ? <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Nothing cloned yet. A folder appears here after an app's first deploy.</div> : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
                  <thead><tr><th style={th}>Folder</th><th style={th}>Owner</th><th style={th}>Files</th><th style={th}>Size</th></tr></thead>
                  <tbody>
                    {data.app_checkouts.map(c => (
                      <tr key={c.name}>
                        <td style={td}><div style={{ ...mono, color: 'var(--text-primary)' }}>{c.path} <CopyPath text={c.path} /></div></td>
                        <td style={{ ...td, color: 'var(--text-secondary)' }}>{c.owner}</td>
                        <td style={td}>{c.files}{c.truncated ? '+' : ''}</td>
                        <td style={td}>{size(c.bytes)}{c.truncated ? '+' : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section icon={<ServerIcon size={17} color="var(--accent-cyan)" />} title="Customers' code on Linux servers">
            {!data.server_checkouts?.length ? <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No app is deployed to a Linux server yet.</div> : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
                  <thead><tr><th style={th}>App</th><th style={th}>Server</th><th style={th}>Folder on that server</th><th style={th}>Owner</th></tr></thead>
                  <tbody>
                    {data.server_checkouts.map(c => (
                      <tr key={c.app}>
                        <td style={{ ...td, fontWeight: 600 }}>{c.app}</td>
                        <td style={{ ...td, color: 'var(--text-secondary)' }}>{c.server}<div style={{ ...mono, color: 'var(--text-muted)' }}>{c.host}</div></td>
                        <td style={td}><span style={{ ...mono, color: 'var(--text-primary)' }}>{c.path}</span></td>
                        <td style={{ ...td, color: 'var(--text-secondary)' }}>{c.owner}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section icon={<HardDrive size={17} color="var(--accent-cyan)" />} title="Built apps">
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{data.docker_note}</div>
          </Section>
        </>
      )}
    </div>
  );
}
