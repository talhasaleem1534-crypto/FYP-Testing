import React, { useState } from 'react';
import { Zap, Server as ServerIcon, Layers, Rocket, Loader2, FlaskConical } from 'lucide-react';
import { Customer, login, register } from './lib/auth';

/**
 * The customer portal's first page: sign in or create an account.
 * The account is saved on the platform (the admin laptop), not on this device.
 * `onDemo` (optional) adds a "Try the demo" button that uses simulated data.
 */
export default function LoginPage({ onLogin, onDemo, backendOk }: {
  onLogin: (c: Customer) => void;
  onDemo?: () => void;
  backendOk: boolean;
}) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    if (mode === 'register' && password.length < 8) { setErr('Password must be at least 8 characters.'); return; }
    setBusy(true);
    try {
      onLogin(mode === 'login' ? await login('customer', email, password) : await register(name, email, password));
    } catch (e: any) {
      setErr(e.message === 'Failed to fetch' ? 'Cannot reach the platform. Check that the admin laptop is on, on the same network, and running the backend (port 3000).' : e.message);
    } finally { setBusy(false); }
  };

  const input: React.CSSProperties = {
    width: '100%', padding: '11px 14px', background: 'rgba(0,0,0,0.4)', border: '1px solid var(--glass-border)',
    borderRadius: 8, color: '#fff', fontSize: 14, marginTop: 5,
  };
  const label: React.CSSProperties = { display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 14 };

  const steps = [
    { icon: ServerIcon, title: 'Connect your server', text: 'Your own VPS, home lab or office machine. We reach it over SSH.' },
    { icon: Layers, title: 'Pick your app type', text: 'Flask, Django, Node.js, Next.js, static site... we set up the rest.' },
    { icon: Rocket, title: 'Deploy and watch', text: 'Live build logs, a link to your app, and AI help when something breaks.' },
  ];

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 48, padding: '40px 16px' }}>
      {/* What the platform does */}
      <div style={{ flex: '1 1 340px', maxWidth: 440 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 26 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: 'linear-gradient(135deg, var(--accent-cyan), var(--accent-purple))', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'var(--shadow-glow)' }}>
            <Zap size={22} color="#fff" />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 20 }}>DeployStack AI</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Deploy to your own server</div>
          </div>
        </div>
        <h1 style={{ fontSize: 30, lineHeight: 1.25, fontWeight: 700, marginBottom: 12 }}>Put your app online in three steps.</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: 15, lineHeight: 1.6, marginBottom: 28 }}>
          You bring the server, we handle Docker, builds and routing. No cloud bill from us.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {steps.map(({ icon: Icon, title, text }, i) => (
            <div key={title} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <div style={{ flexShrink: 0, width: 36, height: 36, borderRadius: 10, background: 'rgba(79,172,254,0.12)', border: '1px solid rgba(79,172,254,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-cyan)' }}>
                <Icon size={17} />
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{i + 1}. {title}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 2, lineHeight: 1.5 }}>{text}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Sign in / create account */}
      <div className="glass-panel" style={{ flex: '1 1 340px', maxWidth: 400, padding: 30 }}>
        <div style={{ display: 'flex', background: 'rgba(0,0,0,0.3)', borderRadius: 10, padding: 4, marginBottom: 24 }}>
          {(['login', 'register'] as const).map(m => (
            <button key={m} type="button" onClick={() => { setMode(m); setErr(''); }}
              style={{ flex: 1, padding: '9px 0', borderRadius: 8, fontSize: 14, fontWeight: 600,
                background: mode === m ? 'rgba(79,172,254,0.18)' : 'transparent',
                color: mode === m ? 'var(--accent-cyan)' : 'var(--text-secondary)' }}>
              {m === 'login' ? 'Sign in' : 'Create account'}
            </button>
          ))}
        </div>

        <form onSubmit={submit}>
          {mode === 'register' && (
            <label style={label}>Your name
              <input style={input} value={name} onChange={e => setName(e.target.value)} required autoComplete="name" />
            </label>
          )}
          <label style={label}>Email
            <input style={input} type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" />
          </label>
          <label style={label}>Password{mode === 'register' && <span style={{ color: 'var(--text-muted)' }}> (at least 8 characters)</span>}
            <input style={input} type="password" value={password} onChange={e => setPassword(e.target.value)} required
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
          </label>

          {err && <div style={{ color: '#fb7185', fontSize: 13, marginBottom: 14, lineHeight: 1.5 }}>⚠️ {err}</div>}

          <button type="submit" disabled={busy}
            style={{ width: '100%', padding: '12px 0', background: 'linear-gradient(135deg, var(--accent-blue), var(--accent-purple))', color: '#fff', borderRadius: 10, fontWeight: 700, fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: busy ? 0.7 : 1 }}>
            {busy && <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />}
            {mode === 'login' ? 'Sign in' : 'Create my account'}
          </button>
        </form>

        {onDemo && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '22px 0 16px', color: 'var(--text-muted)', fontSize: 12 }}>
              <div style={{ flex: 1, height: 1, background: 'var(--glass-border)' }} />or<div style={{ flex: 1, height: 1, background: 'var(--glass-border)' }} />
            </div>
            <button type="button" onClick={onDemo}
              style={{ width: '100%', padding: '11px 0', background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.35)', color: '#fbbf24', borderRadius: 10, fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <FlaskConical size={15} /> Try the demo (no account needed)
            </button>
          </>
        )}
        {!backendOk && (
          <div style={{ marginTop: 14, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.5 }}>
            Platform offline - the admin laptop must be running the backend (port 3000).
          </div>
        )}
      </div>
    </div>
  );
}
