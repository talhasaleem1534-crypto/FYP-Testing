import React, { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, FileText, Loader2, Play } from 'lucide-react';
import { AppTypeInfo, FALLBACK_APP_TYPES, loadAppTypes, usesStartCommand } from './lib/appTypes';

export interface NewAppPayload {
  name: string; repo_url: string; branch: string; domain: string; port: number;
  server_id: string; app_type: string; start_command?: string;
}

const CATEGORY_COLOR: Record<string, string> = {
  Python: '#facc15', JavaScript: '#4facfe', Go: '#22d3ee', Other: '#a78bfa',
};
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

  const input: React.CSSProperties = {
    width: '100%', padding: '10px 14px', background: 'rgba(0,0,0,0.4)', border: '1px solid var(--glass-border)',
    borderRadius: 8, color: '#fff', fontSize: 13, marginTop: 5,
  };
  const label: React.CSSProperties = { display: 'block', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 14 };

  // ── Step 1: pick the type ──────────────────────────────────────────────────
  if (!type) {
    const groups = CATEGORY_ORDER.map(c => ({ c, items: types.filter(t => t.category === c) })).filter(g => g.items.length);
    return (
      <div>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 18 }}>
          <strong style={{ color: 'var(--text-primary)' }}>Step 1 of 2 — What type of app is this?</strong><br />
          We use your answer to choose the right language version, install your dependencies and start the app.
        </p>
        <div style={{ maxHeight: '60vh', overflowY: 'auto', paddingRight: 4 }}>
          {groups.map(({ c, items }) => (
            <div key={c} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>{c}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
                {items.map(t => (
                  <button key={t.id} onClick={() => pick(t)} data-type={t.id}
                    style={{ textAlign: 'left', padding: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--glass-border)', borderLeft: `3px solid ${CATEGORY_COLOR[t.category] || '#94a3b8'}`, borderRadius: 10, color: 'var(--text-primary)' }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{t.label}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.45 }}>{t.description}</div>
                    {t.required_files.length > 0 && (
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
                        <FileText size={11} /> needs {t.required_files.join(' or ')}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
          <button onClick={onCancel} style={{ padding: '9px 16px', background: 'rgba(255,255,255,0.06)', border: '1px solid var(--glass-border)', borderRadius: 8, color: 'var(--text-secondary)', fontSize: 13 }}>Cancel</button>
        </div>
      </div>
    );
  }

  // ── Step 2: details ────────────────────────────────────────────────────────
  const showStart = usesStartCommand(type.id);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <button onClick={() => setType(null)} title="Choose another type"
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 10px', background: 'rgba(255,255,255,0.06)', borderRadius: 8, color: 'var(--text-secondary)', fontSize: 12 }}>
          <ArrowLeft size={13} /> Change type
        </button>
        <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
          <strong style={{ color: 'var(--text-primary)' }}>Step 2 of 2</strong> — {type.label}
        </div>
      </div>

      {/* What the platform will do for this type */}
      <div style={{ background: 'rgba(0,242,254,0.06)', border: '1px solid rgba(0,242,254,0.2)', borderRadius: 10, padding: '12px 14px', marginBottom: 18, fontSize: 13 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>What we will do</div>
        <ol style={{ margin: '0 0 0 18px', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          {type.steps.map(s => <li key={s}>{s}</li>)}
        </ol>
        {(type.required_files.length > 0 || type.tips.length > 0) && (
          <div style={{ marginTop: 8, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            {type.required_files.length > 0 && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                <CheckCircle2 size={13} color="#34d399" style={{ marginTop: 3, flexShrink: 0 }} />
                <span>Your repository must contain <code>{type.required_files.join(' or ')}</code></span>
              </div>
            )}
            {type.tips.map(t => (
              <div key={t} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                <CheckCircle2 size={13} color="#34d399" style={{ marginTop: 3, flexShrink: 0 }} /><span>{t}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', columnGap: 14 }}>
        <label style={label}>App name<input style={input} placeholder="e.g. my-flask-app" value={form.name} onChange={set('name')} /></label>
        <label style={label}>Branch<input style={input} placeholder="main" value={form.branch} onChange={set('branch')} /></label>
      </div>
      <label style={label}>Git repository URL<input style={input} placeholder="https://github.com/you/your-repo" value={form.repo_url} onChange={set('repo_url')} /></label>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', columnGap: 14 }}>
        <label style={label}>Domain<input style={input} placeholder="app.example.com or app.local" value={form.domain} onChange={set('domain')} /></label>
        <label style={label}>Port your app listens on<input style={input} type="number" value={form.port} onChange={set('port')} /></label>
      </div>
      {showStart && (
        <label style={label}>Start command <span style={{ textTransform: 'none' }}>(leave empty for the default)</span>
          <input style={{ ...input, fontFamily: 'var(--font-mono)' }} placeholder={type.default_start_command || 'Detected automatically'}
            value={form.start_command} onChange={set('start_command')} />
        </label>
      )}
      {servers.length > 0 && (
        <label style={label}>Deploy to server
          <select style={input} value={form.server_id || servers[0].id} onChange={set('server_id')}>
            {servers.map(s => <option key={s.id} value={s.id}>{s.name} ({s.host}){s.status && s.status !== 'verified' ? ' - not ready' : ''}</option>)}
          </select>
        </label>
      )}

      {err && <div style={{ color: '#fb7185', fontSize: 12, marginBottom: 12, lineHeight: 1.5 }}>⚠️ {err}</div>}

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <button onClick={onCancel} disabled={!!busy} style={{ padding: '9px 16px', background: 'rgba(255,255,255,0.06)', border: '1px solid var(--glass-border)', borderRadius: 8, color: 'var(--text-secondary)', fontSize: 13 }}>Cancel</button>
        <button onClick={() => submit(false)} disabled={!!busy}
          style={{ padding: '9px 16px', background: 'rgba(255,255,255,0.08)', border: '1px solid var(--glass-border)', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
          {busy === 'create' && <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />} Create only
        </button>
        <button onClick={() => submit(true)} disabled={!!busy}
          style={{ padding: '9px 20px', background: 'linear-gradient(135deg,var(--accent-blue),var(--accent-purple))', color: '#fff', borderRadius: 8, fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 7 }}>
          {busy === 'deploy' ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Play size={14} />} Create &amp; deploy
        </button>
      </div>
    </div>
  );
}
