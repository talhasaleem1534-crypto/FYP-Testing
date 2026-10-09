import React, { useState } from 'react';
import { ArrowRight, Eye, EyeOff, FlaskConical, Loader2, ShieldCheck, User } from 'lucide-react';
import { Wordmark } from './components/Brand';
import { Customer, login, Portal, register, setupAdmin } from './lib/auth';

export type AuthStatus = { admin_exists: boolean; on_admin_laptop: boolean } | null;

/**
 * The sign-in page, shared by the customer portal (/) and the admin site (/admin).
 *
 * - Customers sign in or create an account. Accounts live on the platform laptop, never on this device.
 * - The platform owner signs in with the single admin account. It is created once, on the admin
 *   laptop, from /admin (`setup` mode); it can never be created from a customer's device.
 * - `portal` preselects the account type; `lockPortal` hides the switch (used by /admin).
 * - `onDemo` adds a "Try the demo" button (sample data, no account).
 */
export default function LoginPage({ onLogin, onDemo, backendOk, portal: initialPortal = 'customer', lockPortal = false, status = null }: {
  onLogin: (user: Customer, portal: Portal) => void;
  onDemo?: () => void;
  backendOk: boolean;
  portal?: Portal;
  lockPortal?: boolean;
  status?: AuthStatus;
}) {
  const [portal, setPortal] = useState<Portal>(initialPortal);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(true);
  const [forgot, setForgot] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const owner = portal === 'admin';
  // First-time setup: the owner account does not exist yet. Only possible on the admin laptop, from /admin.
  const setup = owner && status !== null && !status.admin_exists;
  const canSetup = setup && lockPortal && status!.on_admin_laptop;
  const creating = owner ? canSetup : mode === 'register';

  const choosePortal = (p: Portal) => { setPortal(p); setMode('login'); setErr(''); setForgot(false); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    if (creating && password.length < 8) { setErr('Password must be at least 8 characters.'); return; }
    setBusy(true);
    try {
      let user: Customer;
      if (owner) user = canSetup ? await setupAdmin(name, email, password, remember) : await login('admin', email, password, remember);
      else user = mode === 'register' ? await register(name, email, password, remember) : await login('customer', email, password, remember);
      onLogin(user, portal);
    } catch (e: any) {
      setErr(e.message === 'Failed to fetch'
        ? 'Cannot reach the platform. The admin laptop must be on, on the same network, and running the backend (port 3000).'
        : e.message);
    } finally { setBusy(false); }
  };

  const steps = [
    { title: 'Connect your server', text: 'Your own VPS, home lab or office machine. OmniDeploy reaches it over SSH with its own key.' },
    { title: 'Pick your app type', text: 'Flask, Django, Node.js, Next.js, a static site. The Dockerfile and port are set up for you.' },
    { title: 'Deploy and watch', text: 'Live build logs, a link to your running app, and an AI copilot that explains what broke.' },
  ];

  const heading = canSetup ? 'Create the owner account'
    : owner ? 'Owner sign-in'
    : mode === 'register' ? 'Create your account' : 'Welcome back';

  return (
    <div className="auth">
      <header className="auth-topbar">
        <Wordmark sub={lockPortal ? 'Admin site' : 'Customer portal'} size={34} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 22, fontSize: 13 }}>
          <span className="eyebrow" style={{ color: 'var(--text-secondary)' }}>
            <span className={`status-dot ${backendOk ? 'on' : 'off'}`} />
            {backendOk ? 'Platform online' : 'Platform offline'}
          </span>
          {lockPortal
            ? <a className="topbar-link" href="/" style={{ color: 'var(--text-secondary)' }}>Customer portal</a>
            : <a className="topbar-link" href="/admin" style={{ color: 'var(--text-secondary)' }}>Admin site</a>}
        </div>
      </header>

      <main className="auth-body">
        {/* What the platform does */}
        <section className="auth-pitch">
          <div className="eyebrow">Self-hosted deployment platform</div>
          <h1>Your server.<br />Your apps.<br /><em>No cloud bill.</em></h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 16, maxWidth: 460 }}>
            Point OmniDeploy at a Linux machine you already own. It clones your GitHub repo, builds a container,
            wires up the port and tells you, in plain words, when something goes wrong.
          </p>
          <ol className="auth-steps">
            {steps.map((s, i) => (
              <li key={s.title}>
                <span className="num">0{i + 1}</span>
                <div>
                  <div className="title">{s.title}</div>
                  <div className="text">{s.text}</div>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* The form */}
        <section className="auth-card" aria-label="Sign in">
          <div className="eyebrow">Account type</div>
          <div className="seg" role="group" aria-label="Account type">
            <button type="button" aria-pressed={!owner} disabled={lockPortal} onClick={() => choosePortal('customer')}>
              <User size={15} /> Customer
            </button>
            <button type="button" aria-pressed={owner} disabled={lockPortal} onClick={() => choosePortal('admin')}>
              <ShieldCheck size={15} /> Platform owner
            </button>
          </div>

          {!owner && (
            <div className="tabs" role="tablist">
              {(['login', 'register'] as const).map(m => (
                <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => { setMode(m); setErr(''); setForgot(false); }}>
                  {m === 'login' ? 'Sign in' : 'Create account'}
                </button>
              ))}
            </div>
          )}

          <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 26, marginBottom: 6 }}>{heading}</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 20 }}>
            {canSetup ? 'Done once, on this laptop. Customers sign up on the customer portal instead.'
              : owner ? 'The single owner account. Manage every customer, app and server.'
              : mode === 'register' ? 'Your account is stored on the platform, so you can sign in from any device.'
              : 'Sign in to see your apps, servers and deployment logs.'}
          </p>

          {owner && status === null && !backendOk && (
            <div className="note note-warn">
              The backend is not reachable, so the owner account cannot be checked yet.
              {lockPortal && <> Start it on this laptop: <code>cd core-platform/backend &amp;&amp; npm run start:dev</code></>}
            </div>
          )}

          {setup && !canSetup ? (
            <div className="note">
              No owner account exists yet. For safety it can only be created <strong>on the admin laptop</strong>:
              open <code>http://localhost:5173/admin</code> there.
            </div>
          ) : (
            <form onSubmit={submit} noValidate={false}>
              {creating && (
                <label className="field">
                  <span className="eyebrow">Your name</span>
                  <input className="input" value={name} onChange={e => setName(e.target.value)} required autoComplete="name" placeholder="Ada Lovelace" />
                </label>
              )}
              <label className="field">
                <span className="eyebrow">Email</span>
                <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" placeholder="you@example.com" inputMode="email" />
              </label>
              <label className="field">
                <span className="eyebrow">Password{creating && <span className="hint">at least 8 characters</span>}</span>
                <span className="input-wrap">
                  <input className="input" type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} required
                    minLength={creating ? 8 : undefined} autoComplete={creating ? 'new-password' : 'current-password'} placeholder="••••••••" />
                  <button type="button" className="input-eye" onClick={() => setShowPw(v => !v)} aria-label={showPw ? 'Hide password' : 'Show password'} title={showPw ? 'Hide password' : 'Show password'}>
                    {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </span>
              </label>

              <div className="auth-row">
                <label className="check">
                  <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />
                  Keep me signed in
                </label>
                {!creating && (
                  <button type="button" className="linkish" onClick={() => setForgot(v => !v)} aria-expanded={forgot}>Forgot password?</button>
                )}
              </div>

              {forgot && !creating && (
                <div className="note">
                  {owner
                    ? <>There is no e-mail reset. On the admin laptop, stop the backend, delete your account line from <code>~/.paas-data/users.json</code> and open <code>/admin</code> to create the owner account again.</>
                    : <>Passwords are never stored, so nobody can look yours up. Ask the platform owner to remove your account from the admin site, then create it again here.</>}
                </div>
              )}

              {err && <div className="note note-error" role="alert">{err}</div>}

              <button type="submit" className="btn-primary" disabled={busy}>
                {busy ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : null}
                {canSetup ? 'Create owner account' : creating ? 'Create my account' : 'Sign in'}
                {!busy && <ArrowRight size={16} />}
              </button>
            </form>
          )}

          {onDemo && (
            <>
              <div className="eyebrow" style={{ textAlign: 'center', margin: '18px 0 12px' }}>or</div>
              <button type="button" className="btn-outline" onClick={onDemo}>
                <FlaskConical size={15} color="var(--warn)" /> Try the demo (sample data, no account)
              </button>
            </>
          )}

          {!backendOk && (
            <p style={{ marginTop: 16, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.5 }}>
              Platform offline: the admin laptop must be running the backend (port 3000).
            </p>
          )}
        </section>
      </main>

      <footer className="auth-foot eyebrow">
        <span>OmniDeploy · self-hosted · version 7</span>
        <span>Accounts are stored on the platform laptop, passwords as scrypt hashes</span>
      </footer>
    </div>
  );
}
