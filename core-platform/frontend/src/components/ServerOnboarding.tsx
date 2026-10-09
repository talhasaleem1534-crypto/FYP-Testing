import React, { useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { tryBackend } from '../lib/backend';
import { DEMO_KEY, demoVerifiedServer, PlatformKeyInfo, ServerRecord } from '../lib/servers';
import ServerChecks, { CommandBox } from './ServerChecks';

/**
 * "Add a server" in three steps (like Coolify's onboarding):
 *  1. prepare the Linux machine (SSH server, Docker, git)
 *  2. trust the platform's SSH key (one command)
 *  3. enter its IP and user → the platform connects and checks everything
 */
export default function ServerOnboarding({ asAdmin, demo, onDone, onCancel }: {
  asAdmin: boolean;
  demo: boolean;
  onDone: (server: ServerRecord) => void;
  onCancel: () => void;
}) {
  const [key, setKey] = useState<PlatformKeyInfo | null>(demo ? DEMO_KEY : null);
  const [form, setForm] = useState({ name: '', host: '', port: '22', ssh_user: '', ssh_private_key: '', shared: true });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState<ServerRecord | null>(null);

  useEffect(() => {
    if (demo) { setKey(DEMO_KEY); return; }
    tryBackend('/servers/platform-key').then(setKey).catch(e => setErr(`Could not load the platform key: ${e.message}`));
  }, [demo]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value }));

  const connect = async () => {
    setErr('');
    if (!form.name.trim() || !form.host.trim() || !form.ssh_user.trim()) { setErr('Name, IP address and SSH user are required.'); return; }
    setBusy(true);
    try {
      const body = {
        name: form.name.trim(), host: form.host.trim(), port: parseInt(form.port) || 22, ssh_user: form.ssh_user.trim(),
        ...(form.ssh_private_key.trim() ? { ssh_private_key: form.ssh_private_key.trim() } : {}),
        ...(asAdmin ? { shared: form.shared } : {}),
      };
      if (demo) { await new Promise(r => setTimeout(r, 900)); setResult(demoVerifiedServer(body)); return; }
      setResult(await tryBackend('/servers', 'POST', body));
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const recheck = async () => {
    if (!result) return;
    setBusy(true); setErr('');
    try { setResult(await tryBackend(`/servers/${result.id}/verify`, 'POST', {})); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const input: React.CSSProperties = { width: '100%', padding: '10px 12px', background: 'rgba(0,0,0,0.4)', border: '1px solid var(--glass-border)', borderRadius: 8, color: '#fff', fontSize: 13, marginTop: 5 };
  const label: React.CSSProperties = { display: 'block', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 };
  const stepTitle: React.CSSProperties = { fontWeight: 700, fontSize: 14, marginBottom: 4 };
  const btn: React.CSSProperties = { padding: '9px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 7 };

  // ── Result of "Connect & check" ───────────────────────────────────────────
  if (result) {
    const ok = result.status === 'verified';
    return (
      <div>
        <div style={{ padding: '12px 14px', borderRadius: 10, marginBottom: 14, background: ok ? 'rgba(52,211,153,0.1)' : 'rgba(244,63,94,0.1)', border: `1px solid ${ok ? 'rgba(52,211,153,0.35)' : 'rgba(244,63,94,0.35)'}`, color: ok ? '#34d399' : '#fb7185', fontWeight: 600, fontSize: 14 }}>
          {ok ? `✅ ${result.name} is ready. Apps can be deployed to it.` : `⚠️ ${result.name} is not ready yet. Fix the red items on the server, then check again.`}
        </div>
        <ServerChecks checks={result.checks} />
        {err && <div style={{ color: '#fb7185', fontSize: 12, marginTop: 12 }}>⚠️ {err}</div>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18, flexWrap: 'wrap' }}>
          {!ok && (
            <button onClick={recheck} disabled={busy} style={{ ...btn, background: 'rgba(255,255,255,0.08)', border: '1px solid var(--glass-border)', color: '#fff' }}>
              {busy ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={14} />} Check again
            </button>
          )}
          <button onClick={() => onDone(result)} style={{ ...btn, background: 'linear-gradient(135deg,var(--accent-blue),var(--accent-purple))', color: '#fff' }}>
            {ok ? 'Done' : 'Close (keep it, check later)'}
          </button>
        </div>
      </div>
    );
  }

  // ── The three steps ───────────────────────────────────────────────────────
  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <div style={stepTitle}>1. Prepare the Linux machine (once)</div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Run these in a terminal on the server (Ubuntu/Debian):</div>
        {(key?.prepare_commands || DEMO_KEY.prepare_commands).map(c => <CommandBox key={c} cmd={c} />)}
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={stepTitle}>2. Let OmniDeploy log in</div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          On the server, logged in as the user OmniDeploy should use, run this. It adds the platform's <em>public</em> key; no password is shared.
        </div>
        {key ? <CommandBox cmd={key.trust_command} /> : <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>Loading the key…</div>}
      </div>

      <div style={stepTitle}>3. Connect</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', columnGap: 12, marginTop: 8 }}>
        <label style={label}>Server name<input style={input} placeholder="e.g. linux-laptop" value={form.name} onChange={set('name')} /></label>
        <label style={label}>IP address<input style={input} placeholder="e.g. 192.168.1.30" value={form.host} onChange={set('host')} /></label>
        <label style={label}>SSH user<input style={input} placeholder="e.g. ubuntu" value={form.ssh_user} onChange={set('ssh_user')} /></label>
        <label style={label}>SSH port<input style={input} type="number" value={form.port} onChange={set('port')} /></label>
      </div>
      {asAdmin && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
          <input type="checkbox" checked={form.shared} onChange={set('shared')} /> Customers can deploy their apps to this server
        </label>
      )}
      <details style={{ marginBottom: 12, fontSize: 12, color: 'var(--text-muted)' }}>
        <summary style={{ cursor: 'pointer' }}>Advanced: use my own SSH private key instead of step 2</summary>
        <textarea placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" value={form.ssh_private_key} onChange={set('ssh_private_key')} rows={3}
          style={{ ...input, fontFamily: 'var(--font-mono)', fontSize: 11, resize: 'vertical' }} />
      </details>

      {err && <div style={{ color: '#fb7185', fontSize: 12, marginBottom: 12, lineHeight: 1.5 }}>⚠️ {err}</div>}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} disabled={busy} style={{ ...btn, background: 'rgba(255,255,255,0.06)', border: '1px solid var(--glass-border)', color: 'var(--text-secondary)' }}>Cancel</button>
        <button onClick={connect} disabled={busy} style={{ ...btn, background: 'linear-gradient(135deg,var(--accent-blue),var(--accent-purple))', color: '#fff' }}>
          {busy ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Connecting…</> : 'Connect & check'}
        </button>
      </div>
    </div>
  );
}
