import { useEffect, useState } from 'react';
import { Loader2, RefreshCw, Users } from 'lucide-react';
import { tryBackend } from './lib/backend';
import { FALLBACK_APP_TYPES } from './lib/appTypes';
import { Help, PageHead } from './components/ui';

export interface CustomerRow {
  id: string; name: string; email: string; role: 'admin' | 'customer'; created_at: string; last_login_at?: string;
  active_sessions: number; deployments: number;
  password_storage: { algorithm: string; salt_preview: string; hash_preview: string };
  apps: { id: string; name: string; status: string; app_type: string; repo_url: string; domain: string; host_port?: number }[];
}

const DEMO: CustomerRow[] = [
  { id: 'd1', name: 'Ayesha Khan', email: 'ayesha@example.com', role: 'customer', created_at: new Date(Date.now() - 3 * 86400e3).toISOString(), last_login_at: new Date(Date.now() - 3600e3).toISOString(), active_sessions: 1, deployments: 4,
    password_storage: { algorithm: 'scrypt (salted, 64-byte hash)', salt_preview: '9f2c41ab…', hash_preview: 'f228f53c3c7f…' },
    apps: [{ id: 'a1', name: 'hello-flask', status: 'running', app_type: 'flask', repo_url: 'https://github.com/ayesha/hello-flask', domain: 'hello.local', host_port: 4000 }] },
  { id: 'd2', name: 'Bilal Ahmed', email: 'bilal@example.com', role: 'customer', created_at: new Date(Date.now() - 86400e3).toISOString(), active_sessions: 0, deployments: 0,
    password_storage: { algorithm: 'scrypt (salted, 64-byte hash)', salt_preview: '0c77e1d2…', hash_preview: '033e3d1b8060…' }, apps: [] },
];

const when = (iso?: string) => (iso ? new Date(iso).toLocaleString() : 'never');
const typeLabel = (id: string) => FALLBACK_APP_TYPES.find(t => t.id === id)?.label || id;
const APP_BADGE: Record<string, string> = { running: 'badge-running', building: 'badge-building', deploying: 'badge-deploying', failed: 'badge-failed', idle: 'badge-idle' };

/** Admin page: every account on the platform and what each customer has deployed. */
export default function AdminCustomers({ demo, onRows }: { demo: boolean; onRows?: (rows: CustomerRow[]) => void }) {
  const [rows, setRows] = useState<CustomerRow[]>(demo ? DEMO : []);
  const [loading, setLoading] = useState(!demo);
  const [err, setErr] = useState('');

  const load = () => {
    if (demo) { setRows(DEMO); setLoading(false); return; }
    setLoading(true);
    tryBackend('/admin/customers').then(r => { setRows(r); onRows?.(r); setErr(''); })
      .catch(e => setErr(e.message)).finally(() => setLoading(false));
  };
  useEffect(load, [demo]);

  const customers = rows.filter(r => r.role === 'customer');

  return (
    <div className="animate-slide-up">
      <PageHead title="Customers"
        text={<>Everyone who signed up on the customer portal, and what they deployed. {customers.length} customer{customers.length === 1 ? '' : 's'}.</>}
        actions={<button type="button" className="btn ghost sm" onClick={load}><RefreshCw size={13} /> Refresh</button>} />

      <Help id="admin-customers" title="What am I looking at?"
        next={<>Passwords are never stored. Each one is turned into a salted <strong>scrypt</strong> hash, so not even the owner can read it back.
          Only the first characters of the hash are shown here. The file itself is listed on <strong>Data &amp; Storage</strong>.</>}>
        Each row is one account. Customers create their own account on the customer portal; the <strong>admin</strong> row is you.
        {' '}For every account you can see when it signed up, when it last signed in, how its password is stored, and the apps it owns.
      </Help>

      {err && <div className="note note-error">{err}</div>}
      {loading ? (
        <div className="hint" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Loading…</div>
      ) : rows.length === 0 ? (
        <div className="empty"><Users size={36} /><h3>Nobody has signed up yet.</h3><p>Accounts appear here as soon as someone creates one on the customer portal.</p></div>
      ) : (
        <div className="panel table-wrap">
          <table className="table" style={{ minWidth: 760 }}>
            <thead><tr><th>Account</th><th>Signed up / last login</th><th>Password stored as</th><th>Applications</th></tr></thead>
            <tbody>
              {rows.map(u => (
                <tr key={u.id}>
                  <td>
                    <b>{u.name}</b>
                    <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{u.email}</div>
                    <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span className="chip" style={u.role === 'admin' ? { color: 'var(--text-primary)', borderColor: 'var(--accent)' } : undefined}>{u.role}</span>
                      {u.active_sessions > 0 && <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}><span className="status-dot on" />signed in</span>}
                    </div>
                  </td>
                  <td style={{ fontSize: 12 }}>{when(u.created_at)}<br /><span style={{ color: 'var(--text-muted)' }}>last: {when(u.last_login_at)}</span></td>
                  <td style={{ fontSize: 12 }}>
                    <div>{u.password_storage.algorithm}</div>
                    <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>hash {u.password_storage.hash_preview}</code>
                  </td>
                  <td>
                    {u.apps.length === 0 ? <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{u.role === 'admin' ? '—' : 'none yet'}</span> : u.apps.map(a => (
                      <div key={a.id} style={{ marginBottom: 8 }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <b>{a.name}</b>
                          <span className="chip">{typeLabel(a.app_type)}</span>
                          <span className={`badge ${APP_BADGE[a.status] || 'badge-idle'}`}>{a.status}</span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', wordBreak: 'break-all' }}>{a.repo_url}{a.host_port ? ` · port ${a.host_port}` : ''}</div>
                      </div>
                    ))}
                    {u.deployments > 0 && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{u.deployments} deployment{u.deployments === 1 ? '' : 's'}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
