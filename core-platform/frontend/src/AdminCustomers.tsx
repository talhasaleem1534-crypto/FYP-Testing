import React, { useEffect, useState } from 'react';
import { KeyRound, Loader2, RefreshCw, Users } from 'lucide-react';
import { tryBackend } from './lib/backend';
import { FALLBACK_APP_TYPES } from './lib/appTypes';

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
  const th: React.CSSProperties = { textAlign: 'left', padding: '10px 12px', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 };
  const td: React.CSSProperties = { padding: '12px', fontSize: 13, borderTop: '1px solid var(--glass-border)', verticalAlign: 'top' };

  return (
    <div className="animate-slide-up">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 22, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 24, fontWeight: 700 }}>Customers</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginTop: 5 }}>
            Everyone who signed up on the customer portal, and what they deployed. {customers.length} customer{customers.length === 1 ? '' : 's'}.
          </p>
        </div>
        <button onClick={load} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 14px', background: 'rgba(255,255,255,0.06)', border: '1px solid var(--glass-border)', borderRadius: 8, color: 'var(--text-secondary)', fontSize: 13 }}>
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '11px 14px', background: 'rgba(0,242,254,0.06)', border: '1px solid rgba(0,242,254,0.2)', borderRadius: 10, fontSize: 13, color: 'var(--text-secondary)', marginBottom: 18, lineHeight: 1.6 }}>
        <KeyRound size={15} style={{ flexShrink: 0, marginTop: 3, color: 'var(--accent-cyan)' }} />
        <span>Passwords are never stored. Each one is turned into a salted <strong>scrypt</strong> hash, so not even the admin can read it back.
          Only the first characters of the hash are shown here. The full file is listed on <strong>Data &amp; Storage</strong>.</span>
      </div>

      {err && <div style={{ color: '#fb7185', fontSize: 13, marginBottom: 14 }}>⚠️ {err}</div>}
      {loading ? (
        <div style={{ display: 'flex', gap: 8, color: 'var(--text-muted)' }}><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}><Users size={40} style={{ opacity: 0.3 }} /><div style={{ marginTop: 8 }}>Nobody has signed up yet.</div></div>
      ) : (
        <div className="glass-panel" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
            <thead><tr><th style={th}>Account</th><th style={th}>Signed up / last login</th><th style={th}>Password stored as</th><th style={th}>Applications</th></tr></thead>
            <tbody>
              {rows.map(u => (
                <tr key={u.id}>
                  <td style={td}>
                    <div style={{ fontWeight: 600 }}>{u.name}</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{u.email}</div>
                    <span style={{ display: 'inline-block', marginTop: 5, fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 5, background: u.role === 'admin' ? 'rgba(245,158,11,0.18)' : 'rgba(79,172,254,0.15)', color: u.role === 'admin' ? '#fbbf24' : 'var(--accent-cyan)', textTransform: 'uppercase' }}>{u.role}</span>
                    {u.active_sessions > 0 && <span style={{ marginLeft: 6, fontSize: 11, color: '#34d399' }}>● signed in</span>}
                  </td>
                  <td style={{ ...td, fontSize: 12, color: 'var(--text-secondary)' }}>{when(u.created_at)}<br /><span style={{ color: 'var(--text-muted)' }}>last: {when(u.last_login_at)}</span></td>
                  <td style={{ ...td, fontSize: 12 }}>
                    <div style={{ color: 'var(--text-secondary)' }}>{u.password_storage.algorithm}</div>
                    <code style={{ fontSize: 11, color: 'var(--text-muted)' }}>hash {u.password_storage.hash_preview}</code>
                  </td>
                  <td style={td}>
                    {u.apps.length === 0 ? <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{u.role === 'admin' ? '—' : 'none yet'}</span> : u.apps.map(a => (
                      <div key={a.id} style={{ marginBottom: 6 }}>
                        <strong>{a.name}</strong> <span style={{ fontSize: 11, color: '#c4b5fd' }}>{typeLabel(a.app_type)}</span>{' '}
                        <span style={{ fontSize: 11, color: a.status === 'running' ? '#34d399' : a.status === 'failed' ? '#fb7185' : 'var(--text-muted)' }}>{a.status}</span>
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
