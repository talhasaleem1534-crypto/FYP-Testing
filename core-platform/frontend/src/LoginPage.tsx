import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, Eye, EyeOff, FlaskConical, Loader2, Lock, Mail, UserRound } from 'lucide-react';
import { Wordmark } from './components/Brand';
import { Customer, login, Portal, register, setupAdmin } from './lib/auth';

export type AuthStatus = { admin_exists: boolean; on_admin_laptop: boolean } | null;

/** The short lines shown on the visual panel. Everything longer is explained after sign-in. */
const LINES: { h: React.ReactNode; p: string }[] = [
  { h: <>Your server. Your apps. <em>No cloud bill.</em></>, p: 'OmniDeploy runs your apps on a machine you already own.' },
  { h: <>Push to GitHub. <em>It is live</em> on your own hardware.</>, p: 'Clone, build, run and route. Nothing to configure by hand.' },
  { h: <>When something breaks, <em>it tells you why.</em></>, p: 'Live build logs and an AI copilot that reads them for you.' },
];

/**
 * The sign-in page, shared by the customer portal (/) and the admin site (/admin).
 * One card: the form on the left, the punch line on the right.
 *
 * - Customers sign in or create an account (password typed twice). The backend refuses a second
 *   account with the same email (409); the page then offers to switch to Sign in.
 * - The platform owner signs in with the single admin account. It is created once, on the admin
 *   laptop, from /admin (`setup` mode); it can never be created from a customer's device.
 * - `portal` preselects the account type; `lockPortal` hides the switch (used by /admin).
 * - `initialMode` opens the Create account form (used for /?signup links).
 * - `onDemo` adds a "Try the demo" button (sample data, no account).
 */
export default function LoginPage({ onLogin, onDemo, backendOk, portal: initialPortal = 'customer', lockPortal = false, status = null, initialMode = 'login' }: {
  onLogin: (user: Customer, portal: Portal) => void;
  onDemo?: () => void;
  backendOk: boolean;
  portal?: Portal;
  lockPortal?: boolean;
  status?: AuthStatus;
  initialMode?: 'login' | 'register';
}) {
  const [portal, setPortal] = useState<Portal>(initialPortal);
  const [mode, setMode] = useState<'login' | 'register'>(initialMode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(true);
  const [forgot, setForgot] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [emailTaken, setEmailTaken] = useState(false);
  const [slide, setSlide] = useState(0);

  const owner = portal === 'admin';
  // First-time setup: the owner account does not exist yet. Only possible on the admin laptop, from /admin.
  const setup = owner && status !== null && !status.admin_exists;
  const canSetup = setup && lockPortal && status!.on_admin_laptop;
  const creating = owner ? canSetup : mode === 'register';
  const mismatch = creating && confirm.length > 0 && confirm !== password;
  const tooShort = creating && password.length > 0 && password.length < 8;

  const reset = () => { setErr(''); setEmailTaken(false); setForgot(false); setConfirm(''); };
  const choosePortal = (p: Portal) => { setPortal(p); setMode('login'); reset(); };
  const chooseMode = (m: 'login' | 'register') => { setMode(m); reset(); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(''); setEmailTaken(false);
    if (creating) {
      if (password.length < 8) { setErr('Password must be at least 8 characters.'); return; }
      if (confirm !== password) { setErr('The two passwords do not match.'); return; }
    }
    setBusy(true);
    try {
      let user: Customer;
      if (owner) user = canSetup ? await setupAdmin(name, email, password, remember) : await login('admin', email, password, remember);
      else user = mode === 'register' ? await register(name, email, password, remember) : await login('customer', email, password, remember);
      onLogin(user, portal);
    } catch (e: any) {
      const msg: string = e.message || 'Something went wrong.';
      if (msg === 'Failed to fetch') {
        setErr('Cannot reach the platform. The admin laptop must be on, on the same network, and running the backend (port 3000).');
      } else if (creating && /already exists/i.test(msg)) {
        // The backend keeps one account per email. Offer the way out instead of a dead end.
        setEmailTaken(true);
        setErr(`An account with ${email.trim().toLowerCase()} already exists.`);
      } else {
        setErr(msg);
      }
    } finally { setBusy(false); }
  };

  const heading = canSetup ? 'Create the owner account'
    : owner ? 'Owner sign-in'
    : mode === 'register' ? 'Create account' : 'Sign in';
  const lead = canSetup ? 'Done once, on this laptop. Customers sign up on the customer portal instead.'
    : owner ? 'The single owner account for every customer, app and server.'
    : mode === 'register' ? 'One account per email. Sign in from any device afterwards.'
    : 'Your apps, servers and deployment logs.';

  return (
    <div className="auth">
      <div className="auth-card">
        {/* ── left: the form ── */}
        <section className="auth-form" aria-label={heading}>
          <a className="brand" href="/" aria-label="OmniDeploy front page" style={{ color: 'inherit', textDecoration: 'none' }}><Wordmark sub={lockPortal ? 'Admin site' : 'Customer portal'} size={32} mono /></a>

          <h1>{heading}</h1>
          <p className="lead">{lead}</p>

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
            <form onSubmit={submit}>
              {creating && (
                <label className="field">
                  <span className="lbl">Your name</span>
                  <span className="input-wrap"><span className="ico"><UserRound size={15} /></span>
                    <input className="input" value={name} onChange={e => setName(e.target.value)} required autoComplete="name" placeholder="Enter your name" />
                  </span>
                </label>
              )}
              <label className="field">
                <span className="lbl">Email</span>
                <span className="input-wrap"><span className="ico"><Mail size={15} /></span>
                  <input className={`input${emailTaken ? ' bad' : ''}`} type="email" value={email} onChange={e => { setEmail(e.target.value); setEmailTaken(false); }}
                    required autoComplete="email" placeholder="Enter your email" inputMode="email" />
                </span>
              </label>
              <label className="field">
                <span className="lbl">Password
                  {creating && <span className={`hint${tooShort ? ' bad' : ''}`}>{tooShort ? `${8 - password.length} more character${8 - password.length === 1 ? '' : 's'}` : 'at least 8 characters'}</span>}
                </span>
                <span className="input-wrap eye"><span className="ico"><Lock size={15} /></span>
                  <input className="input" type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} required
                    minLength={creating ? 8 : undefined} autoComplete={creating ? 'new-password' : 'current-password'} placeholder="Enter your password" />
                  <button type="button" className="input-eye" onClick={() => setShowPw(v => !v)} aria-label={showPw ? 'Hide password' : 'Show password'} title={showPw ? 'Hide password' : 'Show password'}>
                    {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </span>
              </label>
              {creating && (
                <label className="field">
                  <span className="lbl">Confirm password
                    {confirm.length > 0 && <span className={`hint ${mismatch ? 'bad' : 'good'}`}>{mismatch ? 'does not match' : 'matches'}</span>}
                  </span>
                  <span className="input-wrap"><span className="ico"><Lock size={15} /></span>
                    <input className={`input${mismatch ? ' bad' : ''}`} type={showPw ? 'text' : 'password'} value={confirm} onChange={e => setConfirm(e.target.value)} required
                      autoComplete="new-password" placeholder="Enter it again" aria-invalid={mismatch || undefined} />
                  </span>
                </label>
              )}

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

              {err && (
                <div className="note note-error" role="alert">
                  {err}
                  {emailTaken && !owner && (
                    <button type="button" className="linkish accent" onClick={() => chooseMode('login')}>Sign in instead</button>
                  )}
                </div>
              )}

              <button type="submit" className="btn-primary" disabled={busy || mismatch}>
                {busy && <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} />}
                {canSetup ? 'Create owner account' : creating ? 'Create my account' : 'Sign in'}
              </button>
            </form>
          )}

          {onDemo && (
            <button type="button" className="btn-outline" onClick={onDemo}>
              <FlaskConical size={14} color="var(--warn)" /> Try the demo (sample data, no account)
            </button>
          )}

          <div className="bottom">
            {!owner && (mode === 'login'
              ? <span>Don't have an account? <button type="button" className="linkish accent" onClick={() => chooseMode('register')}>Create account</button></span>
              : <span>Already have an account? <button type="button" className="linkish accent" onClick={() => chooseMode('login')}>Sign in</button></span>)}
            {!lockPortal && (owner
              ? <button type="button" className="linkish" onClick={() => choosePortal('customer')}>Customer sign-in</button>
              : <button type="button" className="linkish" onClick={() => choosePortal('admin')}>Platform owner?</button>)}
            {lockPortal && <a className="linkish" href="/login">Customer portal</a>}
          </div>
        </section>

        {/* ── right: the punch line ── */}
        <aside className="auth-visual" aria-label="About OmniDeploy">
          <Art />
          <span className="status"><span className={`status-dot ${backendOk ? 'on' : 'off'}`} />{backendOk ? 'Platform online' : 'Platform offline'}</span>
          <div className="line" key={slide}>
            <h2>{LINES[slide].h}</h2>
            <p>{LINES[slide].p}</p>
          </div>
          <div className="nav">
            <div className="dots" aria-hidden="true">{LINES.map((_, i) => <i key={i} className={i === slide ? 'on' : ''} />)}</div>
            <div className="arrows">
              <button type="button" aria-label="Previous" onClick={() => setSlide(s => (s + LINES.length - 1) % LINES.length)}><ChevronLeft size={16} /></button>
              <button type="button" aria-label="Next" onClick={() => setSlide(s => (s + 1) % LINES.length)}><ChevronRight size={16} /></button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

/** Background art for the visual panel: a set of nested curves, like contour lines, in near-black greys. */
function Art() {
  const rings = Array.from({ length: 16 }, (_, i) => 60 + i * 42);
  return (
    <svg className="art" viewBox="0 0 640 640" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <radialGradient id="auth-glow" cx="78%" cy="72%" r="60%">
          <stop offset="0%" stopColor="#262626" />
          <stop offset="100%" stopColor="#0a0a0a" />
        </radialGradient>
      </defs>
      <rect width="640" height="640" fill="url(#auth-glow)" />
      <g fill="none" stroke="#ffffff" strokeWidth="1">
        {rings.map((r, i) => (
          <circle key={r} cx="500" cy="470" r={r} strokeOpacity={0.04 + (i % 4 === 0 ? 0.06 : 0)} />
        ))}
      </g>
      <circle cx="500" cy="470" r="312" fill="none" stroke="#ffffff" strokeOpacity="0.22" strokeWidth="1.5" strokeDasharray="4 10" />
      <circle cx="500" cy="470" r="18" fill="none" stroke="#ffffff" strokeOpacity="0.8" strokeWidth="2" />
      <circle cx="500" cy="470" r="4" fill="#ffffff" />
    </svg>
  );
}
