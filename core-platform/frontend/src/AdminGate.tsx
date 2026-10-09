import React, { useEffect, useState } from 'react';
import { FlaskConical, Loader2, ShieldCheck } from 'lucide-react';
import App from './App';
import { Loading, useBackendOk } from './AuthGate';
import { authStatus, Customer, currentUser, login, logout, setupAdmin } from './lib/auth';

/**
 * The admin site (`/admin`). The first time, on the admin laptop, it asks to create the admin
 * account; after that it asks the admin to sign in. "Try the demo" opens the dashboard with sample data.
 */
export default function AdminGate() {
  const [admin, setAdmin] = useState<Customer | null>(null);
  const [checking, setChecking] = useState(true);
  const [status, setStatus] = useState<{ admin_exists: boolean; on_admin_laptop: boolean } | null>(null);
  const backendOk = useBackendOk();

  useEffect(() => {
    Promise.all([currentUser('admin'), authStatus().catch(() => null)]).then(([u, st]) => {
      setAdmin(u); setStatus(st); setChecking(false);
    });
  }, [backendOk]);

  if (checking) return <Loading />;
  if (admin) {
    return <App customer={admin} startInDemo={!!admin.demo}
      onLogout={async () => { if (!admin.demo) await logout('admin'); setAdmin(null); }} />;
  }
  return <AdminLogin status={status} onLogin={setAdmin}
    onDemo={() => setAdmin({ id: 'demo', name: 'Demo admin', email: 'demo mode', role: 'admin', demo: true })} />;
}

function AdminLogin({ status, onLogin, onDemo }: {
  status: { admin_exists: boolean; on_admin_laptop: boolean } | null;
  onLogin: (c: Customer) => void;
  onDemo: () => void;
}) {
  const setup = status !== null && !status.admin_exists;
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    if (setup && password.length < 8) { setErr('Password must be at least 8 characters.'); return; }
    setBusy(true);
    try {
      onLogin(setup ? await setupAdmin(name, email, password) : await login('admin', email, password));
    } catch (e: any) {
      setErr(e.message === 'Failed to fetch' ? 'The backend is not running on this laptop (port 3000).' : e.message);
    } finally { setBusy(false); }
  };

  const input: React.CSSProperties = { width: '100%', padding: '11px 14px', background: 'rgba(0,0,0,0.4)', border: '1px solid var(--glass-border)', borderRadius: 8, color: '#fff', fontSize: 14, marginTop: 5 };
  const label: React.CSSProperties = { display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 14 };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 16px' }}>
      <div className="glass-panel" style={{ width: '100%', maxWidth: 420, padding: 30 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
          <div style={{ width: 42, height: 42, borderRadius: 11, background: 'linear-gradient(135deg, #f59e0b, var(--accent-purple))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ShieldCheck size={21} color="#fff" />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 18 }}>DeployStack admin</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{setup ? 'First-time setup' : 'Platform owner sign-in'}</div>
          </div>
        </div>

        {status === null && (
          <p style={{ fontSize: 13, color: '#fbbf24', marginBottom: 16, lineHeight: 1.6 }}>
            The backend is not reachable. Start it on this laptop (<code>cd core-platform/backend && npm run start:dev</code>), or try the demo.
          </p>
        )}

        {setup && !status!.on_admin_laptop ? (
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            No admin account exists yet. For safety it can only be created <strong>on the admin laptop</strong>:
            open <code>http://localhost:5173/admin</code> there.
          </p>
        ) : status !== null && (
          <form onSubmit={submit}>
            {setup && (
              <>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 16 }}>
                  Create the admin account. This is done once; customers sign up on the customer portal instead.
                </p>
                <label style={label}>Your name<input style={input} value={name} onChange={e => setName(e.target.value)} required /></label>
              </>
            )}
            <label style={label}>Email<input style={input} type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" /></label>
            <label style={label}>Password{setup && <span style={{ color: 'var(--text-muted)' }}> (at least 8 characters)</span>}
              <input style={input} type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete={setup ? 'new-password' : 'current-password'} />
            </label>
            {err && <div style={{ color: '#fb7185', fontSize: 13, marginBottom: 14, lineHeight: 1.5 }}>⚠️ {err}</div>}
            <button type="submit" disabled={busy}
              style={{ width: '100%', padding: '12px 0', background: 'linear-gradient(135deg, var(--accent-blue), var(--accent-purple))', color: '#fff', borderRadius: 10, fontWeight: 700, fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: busy ? 0.7 : 1 }}>
              {busy && <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />}
              {setup ? 'Create admin account' : 'Sign in'}
            </button>
          </form>
        )}

        <button type="button" onClick={onDemo}
          style={{ width: '100%', marginTop: 16, padding: '10px 0', background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.35)', color: '#fbbf24', borderRadius: 10, fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <FlaskConical size={14} /> Try the demo (sample data)
        </button>
      </div>
    </div>
  );
}
