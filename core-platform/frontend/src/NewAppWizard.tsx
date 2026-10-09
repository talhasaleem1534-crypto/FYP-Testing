import React, { useEffect, useState } from 'react';
import { ArrowLeft, FileText, GitBranch, Globe, Hash, Link2, Loader2, Play, Server as ServerIcon, Tag, Terminal } from 'lucide-react';
import { AppTypeInfo, FALLBACK_APP_TYPES, loadAppTypes, usesStartCommand } from './lib/appTypes';
import { Help } from './components/ui';

export interface NewAppPayload {
  name: string; repo_url: string; branch: string; domain: string; port: number;
  server_id: string; app_type: string; start_command?: string;
}

const CATEGORY_ORDER = ['Python', 'JavaScript', 'Go', 'Other'];

/**
 * "New Application" in two steps, like choosing a template:
 *   1. What type of app is this?  (Flask, Next.js, Static HTML ...)
 *   2. Where is the code, and where should it run?  (port and start command are pre-filled from step 1)
 */
export default function NewAppWizard({ servers, useBackend, onCreate, onCancel }: {
  servers: { id: string; name: string; host: string; status?: string }[];
  useBackend: boolean;
  /** Creates the app (and deploys it when `deploy` is true). Throws with a readable message on failure. */
  onCreate: (payload: NewAppPayload, deploy: boolean) => Promise<void>;
  onCancel: () => void;
}) {
  const [types, setTypes] = useState<AppTypeInfo[]>(FALLBACK_APP_TYPES);
  const [type, setType] = useState<AppTypeInfo | null>(null);
  const [form, setForm] = useState({ name: '', repo_url: '', branch: 'main', domain: '', port: '', start_command: '', server_id: '' });
  const [busy, setBusy] = useState<'create' | 'deploy' | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => { loadAppTypes(useBackend).then(setTypes); }, [useBackend]);

  const pick = (t: AppTypeInfo) => {
    setType(t);
    setErr('');
    setForm(f => ({ ...f, port: String(t.default_port), start_command: '' }));
  };

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const submit = async (deploy: boolean) => {
    if (!type) return;
    setErr('');
    if (!form.name.trim() || !form.repo_url.trim() || !form.domain.trim()) { setErr('App name, Git repository and domain are required.'); return; }
    if (servers.length === 0) { setErr('Register a server first (Private Servers page).'); return; }
    setBusy(deploy ? 'deploy' : 'create');
    try {
      await onCreate({
        name: form.name.trim(), repo_url: form.repo_url.trim(), branch: form.branch.trim() || 'main',
        domain: form.domain.trim(), port: parseInt(form.port) || type.default_port,
        server_id: form.server_id || servers[0].id, app_type: type.id,
        start_command: usesStartCommand(type.id) && form.start_command.trim() ? form.start_command.trim() : undefined,
      }, deploy);
    } catch (e: any) {
      setErr(e.message);
    } finally { setBusy(null); }
  };

  /** Outline a required field in red once the user tried to submit without it. */
  const missing = (k: 'name' | 'repo_url' | 'domain') => err.startsWith('App name, Git repository') && !form[k].trim();

  const steps = (at: 1 | 2) => (
    <div className="steps">
      <span className={`step ${at === 1 ? 'on' : 'done'}`}><span className="n">1</span> What type of app?</span>
      <span className={`step ${at === 2 ? 'on' : ''}`}><span className="n">2</span> Where is the code, where should it run?</span>
    </div>
  );

  // ── Step 1: pick the type ──────────────────────────────────────────────────
  if (!type) {
    const groups = CATEGORY_ORDER.map(c => ({ c, items: types.filter(t => t.category === c) })).filter(g => g.items.length);
    return (
      <div>
        {steps(1)}
        <Help id="wizard-type" title="Step 1 of 2 — What type of app is this?"
          need={['The language or framework your app is written in (Flask, Node.js, plain HTML...). Look at the files in your repository if unsure.']}
          next={<>If you are not sure, pick <strong>"Not sure - detect it for me"</strong>; we look at your files and choose for you. You can change the type at any time.</>}>
          Your answer decides which language version we install, how your dependencies (the libraries your code imports) are installed,
          which port your app is expected to listen on, and which command starts it. Each card says which file your repository must contain.
        </Help>
        <div style={{ maxHeight: '55vh', overflowY: 'auto', paddingRight: 4 }}>
          {groups.map(({ c, items }) => (
            <div key={c} style={{ marginBottom: 16 }}>
              <div className="eyebrow" style={{ marginBottom: 8 }}>{c}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 10 }}>
                {items.map(t => (
                  <button key={t.id} type="button" className="choice" onClick={() => pick(t)} data-type={t.id} aria-pressed={false}>
                    <div className="t">{t.label}</div>
                    <div className="d">{t.description}</div>
                    {t.required_files.length > 0 && (
                      <div className="f"><FileText size={11} /> needs {t.required_files.join(' or ')}</div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="form-actions">
          <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    );
  }

  // ── Step 2: details ────────────────────────────────────────────────────────
  const showStart = usesStartCommand(type.id);
  const chosen = servers.find(s => s.id === (form.server_id || servers[0]?.id));
  return (
    <div>
      {steps(2)}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <button type="button" className="btn ghost sm" onClick={() => setType(null)} title="Choose another type">
          <ArrowLeft size={13} /> Change type
        </button>
        <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
          <strong style={{ color: 'var(--text-primary)' }}>Step 2 of 2</strong> — you chose <span className="chip">{type.label}</span>
        </div>
      </div>

      {/* What the platform will do for this type */}
      <Help id="wizard-details" title="What we will do with your code"
        steps={[
          'Download (clone) your repository from GitHub using git.',
          ...type.steps,
          'Give you a link to open the running app.',
        ]}
        need={[
          ...(type.required_files.length > 0 ? [<>Your repository must contain <code>{type.required_files.join(' or ')}</code>.</>] : []),
          ...type.tips,
          'The repository must be public (no password needed to download it).',
        ]}
        next="Fill in the form below. Fields marked with * are required; the others already have a sensible value.">
        OmniDeploy fetches your code, builds it into a container (a small box that runs the same way on every machine) and starts it on the server you pick.
      </Help>

      <div className="form-grid">
        <label className="field">
          <span className="lbl"><span>App name<span className="req">*</span></span></span>
          <span className="input-wrap"><span className="ico"><Tag size={15} /></span>
            <input className={`input${missing('name') ? ' bad' : ''}`} placeholder="e.g. my-flask-app" value={form.name} onChange={set('name')} />
          </span>
          <div className="hint">Letters, numbers and dashes, e.g. <code>my-flask-app</code>. Used in the container name and the app's link.</div>
        </label>
        <label className="field">
          <span className="lbl"><span>Branch</span></span>
          <span className="input-wrap"><span className="ico"><GitBranch size={15} /></span>
            <input className="input" placeholder="main" value={form.branch} onChange={set('branch')} />
          </span>
          <div className="hint">A branch is a named version of your code in git. Usually <code>main</code> (or <code>master</code> on older repositories).</div>
        </label>
      </div>
      <label className="field">
        <span className="lbl"><span>Git repository URL<span className="req">*</span></span></span>
        <span className="input-wrap"><span className="ico"><Link2 size={15} /></span>
          <input className={`input${missing('repo_url') ? ' bad' : ''}`} placeholder="https://github.com/you/your-repo" value={form.repo_url} onChange={set('repo_url')} />
        </span>
        <div className="hint">The link of your public GitHub repository, copied from the browser address bar, e.g. <code>https://github.com/you/your-repo</code>.</div>
      </label>
      <div className="form-grid">
        <label className="field">
          <span className="lbl"><span>Domain<span className="req">*</span></span></span>
          <span className="input-wrap"><span className="ico"><Globe size={15} /></span>
            <input className={`input${missing('domain') ? ' bad' : ''}`} placeholder="app.example.com or app.local" value={form.domain} onChange={set('domain')} />
          </span>
          <div className="hint">A name for your app, e.g. <code>myapp.local</code>. The router uses it to send visitors to the right app. You still get a direct link with a port.</div>
        </label>
        <label className="field">
          <span className="lbl"><span>Port your app listens on</span></span>
          <span className="input-wrap"><span className="ico"><Hash size={15} /></span>
            <input className="input" type="number" value={form.port} onChange={set('port')} />
          </span>
          <div className="hint">The port (numbered door) your code listens on inside the container. Pre-filled with the usual value for {type.label} (<code>{type.default_port}</code>); change it only if your code uses another one.</div>
        </label>
      </div>
      {showStart && (
        <label className="field">
          <span className="lbl"><span>Start command (optional)</span></span>
          <span className="input-wrap"><span className="ico"><Terminal size={15} /></span>
            <input className="input" style={{ fontFamily: 'var(--font-mono)' }} placeholder={type.default_start_command || 'Detected automatically'}
              value={form.start_command} onChange={set('start_command')} />
          </span>
          <div className="hint">The command that starts your app. Leave it empty to use the default{type.default_start_command ? <>: <code>{type.default_start_command}</code></> : ''}.</div>
        </label>
      )}
      {servers.length > 0 && (
        <label className="field">
          <span className="lbl"><span>Deploy to server</span></span>
          <span className="input-wrap"><span className="ico"><ServerIcon size={15} /></span>
            <select className="input" value={form.server_id || servers[0].id} onChange={set('server_id')}>
              {servers.map(s => <option key={s.id} value={s.id}>{s.name} ({s.host}){s.status && s.status !== 'verified' ? ' - not ready' : ''}</option>)}
            </select>
          </span>
          <div className="hint">
            Which machine runs your app. {chosen && chosen.status && chosen.status !== 'verified'
              ? 'This server is marked "not ready": the deploy will fail until it passes its checks.'
              : 'Pick a server marked verified; "not ready" servers cannot run apps yet.'}
          </div>
        </label>
      )}
      {servers.length === 0 && (
        <div className="note note-warn">There is no server to deploy to yet. Add a server first (section "Where your apps run"), then come back here.</div>
      )}

      {err && <div className="note note-error" role="alert">{err} {err.startsWith('App name, Git repository') ? 'Fill in the fields marked with * and try again.' : ''}</div>}

      <div className="form-actions" style={{ alignItems: 'center' }}>
        <button type="button" className="btn ghost" onClick={onCancel} disabled={!!busy}>Cancel</button>
        <button type="button" className="btn ghost" onClick={() => submit(false)} disabled={!!busy} title="Save the app without deploying it">
          {busy === 'create' && <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />} Create only
        </button>
        <button type="button" className="btn blue" onClick={() => submit(true)} disabled={!!busy}>
          {busy === 'deploy' ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Play size={14} />} Create &amp; deploy
        </button>
      </div>
      <div className="hint" style={{ textAlign: 'right', marginTop: 6 }}>"Create only" saves the app without deploying it. "Create &amp; deploy" saves it and starts the build right away.</div>
    </div>
  );
}
