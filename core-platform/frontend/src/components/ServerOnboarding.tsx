import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Hash, Loader2, Network, RefreshCw, Tag, UserRound } from 'lucide-react';
import { tryBackend } from '../lib/backend';
import { DEMO_KEY, demoVerifiedServer, PlatformKeyInfo, ServerRecord } from '../lib/servers';
import ServerChecks, { CommandBox } from './ServerChecks';
import { Help } from './ui';

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

  const missing = (k: 'name' | 'host' | 'ssh_user') => !!err && err.startsWith('Name, IP address') && !form[k].trim();

  // ── Result of "Connect & check" ───────────────────────────────────────────
  if (result) {
    const ok = result.status === 'verified';
    return (
      <div>
        <div className="steps">
          <span className="step done"><span className="n">1</span> Prepare the machine</span>
          <span className="step done"><span className="n">2</span> Trust the key</span>
          <span className="step done"><span className="n">3</span> Connect &amp; check</span>
          <span className="step on"><span className="n">4</span> Result</span>
        </div>

        <Help id="server-result" title={ok ? 'The server is ready' : 'The server is not ready yet'}
          steps={ok ? undefined : ['Read each red line below; it says what is missing.', 'Run the fix command on the server (copy it with the Copy button).', 'Press "Check the server again".']}>
          {ok
            ? 'OmniDeploy logged in, found Docker and git, and created its apps folder. You can now deploy applications to this machine.'
            : 'OmniDeploy tried to log in and look for Docker, git and its apps folder. Some checks failed. Nothing is broken; the server only needs a small fix.'}
        </Help>

        <div className={`panel ${ok ? 'ok' : 'bad'}`} style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 15, marginBottom: 12, color: ok ? 'var(--ok)' : 'var(--danger)' }}>
            {ok ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
            {ok ? `${result.name} is ready. Apps can be deployed to it.` : `${result.name} is not ready yet. Fix the red items on the server, then check again.`}
          </div>
          <ServerChecks checks={result.checks} />
        </div>

        {err && <div className="note note-error" role="alert">Could not check the server: {err}. Make sure the machine is on and reachable, then try again.</div>}

        <div className="form-actions">
          {!ok && (
            <button type="button" className="btn ghost" onClick={recheck} disabled={busy}>
              {busy ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={14} />} Check the server again
            </button>
          )}
          <button type="button" className="btn blue" onClick={() => onDone(result)}>
            {ok ? 'Done' : 'Close (keep it, check later)'}
          </button>
        </div>
      </div>
    );
  }

  // ── The three steps ───────────────────────────────────────────────────────
  return (
    <div>
      <div className="steps">
        <span className="step on"><span className="n">1</span> Prepare the machine</span>
        <span className="step on"><span className="n">2</span> Trust the key</span>
        <span className="step on"><span className="n">3</span> Connect &amp; check</span>
      </div>

      <Help id="server-add" title="What is a server here?"
        need={[
          'A Linux computer (Ubuntu or Debian) that stays on: a laptop, a desktop, a Raspberry Pi or a rented VPS.',
          'Its IP address, for example 192.168.1.30, and a user you can log in as.',
          'A terminal on that machine (or an SSH session to it) to paste three commands.',
        ]}>
        A server is just a Linux machine that runs your apps. OmniDeploy connects to it over SSH (the secure remote login Linux machines use),
        copies your code there and starts it with Docker. Do the three steps below once per machine; it takes about five minutes.
      </Help>

      {/* Step 1 */}
      <section style={{ marginBottom: 22 }}>
        <h4 style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>1. Prepare the Linux machine (once)</h4>
        <Help id="server-prepare" title="Why these commands?"
          steps={['Open a terminal on the server (or log in to it with SSH).', 'Paste each command below, one at a time, and press Enter. Enter your password when asked.', 'After the Docker command, log out and log in again so the permission takes effect.']}>
          OmniDeploy needs three things on the machine: an SSH server (so it can log in), git (the tool that downloads your code from GitHub) and Docker
          (the tool that packs your app into a container, a small box that runs the same way everywhere). The last command prints the server's IP address; you will need it in step 3.
        </Help>
        <div className="hint" style={{ marginBottom: 2 }}>Run these in a terminal on the server (Ubuntu/Debian):</div>
        {(key?.prepare_commands || DEMO_KEY.prepare_commands).map(c => <CommandBox key={c} cmd={c} />)}
      </section>

      {/* Step 2 */}
      <section style={{ marginBottom: 22 }}>
        <h4 style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>2. Let OmniDeploy log in</h4>
        <Help id="server-trust" title="What does this command do?"
          steps={['On the server, log in as the Linux user OmniDeploy should use (for example "ubuntu").', 'Paste the command below and press Enter. It prints nothing when it works.']}>
          It adds OmniDeploy's <em>public</em> key to the file <code>~/.ssh/authorized_keys</code> on the server. That file lists who may log in without a password.
          Only the public half of the key is shared; no password and no secret ever leaves the platform. You can remove the line from that file at any time to revoke access.
        </Help>
        {key ? <CommandBox cmd={key.trust_command} /> : <div className="hint" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> Loading the key…</div>}
      </section>

      {/* Step 3 */}
      <section>
        <h4 style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>3. Connect &amp; check</h4>
        <Help id="server-connect" title="What happens when you press Connect?"
          steps={['OmniDeploy logs in to the server over SSH with the key from step 2.', 'It checks that Docker and git are installed and that your user may use Docker.', 'It creates a folder for your apps and a private Docker network.', 'You get a checklist: green means fine, red says what to fix.']}>
          Tell OmniDeploy where the machine is and which user to log in as. Nothing is installed or changed on the server except the apps folder.
        </Help>

        <div className="form-grid">
          <label className="field">
            <span className="lbl"><span>Server name<span className="req">*</span></span></span>
            <span className="input-wrap"><span className="ico"><Tag size={15} /></span>
              <input className={`input${missing('name') ? ' bad' : ''}`} placeholder="e.g. linux-laptop" value={form.name} onChange={set('name')} />
            </span>
            <div className="hint">Any short name so you recognise it later, e.g. <code>linux-laptop</code> or <code>home-pi</code>.</div>
          </label>
          <label className="field">
            <span className="lbl"><span>IP address or hostname<span className="req">*</span></span></span>
            <span className="input-wrap"><span className="ico"><Network size={15} /></span>
              <input className={`input${missing('host') ? ' bad' : ''}`} placeholder="e.g. 192.168.1.30" value={form.host} onChange={set('host')} />
            </span>
            <div className="hint">The address printed by <code>ip -4 addr</code> in step 1, e.g. <code>192.168.1.30</code>, or a name like <code>server.local</code>.</div>
          </label>
          <label className="field">
            <span className="lbl"><span>SSH user<span className="req">*</span></span></span>
            <span className="input-wrap"><span className="ico"><UserRound size={15} /></span>
              <input className={`input${missing('ssh_user') ? ' bad' : ''}`} placeholder="e.g. ubuntu" value={form.ssh_user} onChange={set('ssh_user')} />
            </span>
            <div className="hint">The Linux user you log in as on that machine, the same one you used in step 2, e.g. <code>ubuntu</code>.</div>
          </label>
          <label className="field">
            <span className="lbl"><span>SSH port</span></span>
            <span className="input-wrap"><span className="ico"><Hash size={15} /></span>
              <input className="input" type="number" value={form.port} onChange={set('port')} />
            </span>
            <div className="hint">A port is a numbered door on the machine. SSH uses <code>22</code> unless you changed it; leave it as is.</div>
          </label>
        </div>

        {asAdmin && (
          <label className="field">
            <span className="check" style={{ fontSize: 13 }}>
              <input type="checkbox" checked={form.shared} onChange={set('shared')} /> Customers can deploy their apps to this server
            </span>
            <div className="hint">Admin only. When ticked, this machine appears in every customer's "Deploy to server" list. Untick it to keep it for your own apps.</div>
          </label>
        )}

        <details style={{ marginBottom: 14 }}>
          <summary className="hint" style={{ cursor: 'pointer', fontSize: 13 }}>Advanced: use my own SSH private key instead of step 2</summary>
          <label className="field" style={{ marginTop: 10 }}>
            <span className="lbl"><span>SSH private key (optional)</span></span>
            <textarea className="input" style={{ paddingLeft: 14, fontSize: 11 }} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" value={form.ssh_private_key} onChange={set('ssh_private_key')} rows={3} />
            <div className="hint">Only if you cannot run the command in step 2. Paste the whole private key file (it starts with <code>-----BEGIN</code>). It is stored on the platform machine only.</div>
          </label>
        </details>

        {err && <div className="note note-error" role="alert">{err} {err.startsWith('Name, IP address') ? 'Fill in the fields marked with * and press Connect again.' : 'Check that the machine is on, the address is right and you ran step 2 as that user, then try again.'}</div>}

        <div className="form-actions">
          <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className="btn blue" onClick={connect} disabled={busy}>
            {busy ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Connecting…</> : <><Network size={14} /> Connect &amp; check</>}
          </button>
        </div>
      </section>
    </div>
  );
}
