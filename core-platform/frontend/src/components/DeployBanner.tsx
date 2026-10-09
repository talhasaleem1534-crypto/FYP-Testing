import { useState } from 'react';
import { AlertCircle, Bot, Check, CheckCircle2, Copy, ExternalLink, Globe, Loader2, ArrowDownToLine } from 'lucide-react';

export interface DeployBannerProps {
  status: string;                 // building | deploying | success | failed
  appName: string;
  url?: string;                   // direct URL (host port)
  domainUrl?: string;             // via Traefik
  simulated?: boolean;
  errorText?: string;
  onDiagnose?: () => void;
  onJumpToError?: () => void;
}

/**
 * The one-line verdict above the deploy log: "still building", "it works, here is the link" or
 * "it failed, here is the first error and what to do". Renders nothing while idle.
 */
export default function DeployBanner(p: DeployBannerProps) {
  const [copied, setCopied] = useState(false);
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };

  if (p.status === 'building' || p.status === 'deploying') {
    return (
      <div className="panel" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <Loader2 size={20} style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />
        <div>
          <div style={{ fontWeight: 600 }}>Deploying {p.appName}… this takes one to three minutes</div>
          <div className="hint">We are fetching your code, building it and starting it. The link to your app appears here as soon as it is online. You can watch the log below while you wait.</div>
        </div>
      </div>
    );
  }

  if (p.status === 'success' && p.url) {
    return (
      <div className="panel ok" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontWeight: 600, fontSize: 15, marginBottom: 10, flexWrap: 'wrap' }}>
          <CheckCircle2 size={20} style={{ color: 'var(--ok)', flexShrink: 0 }} /> {p.appName} is online
          {p.simulated && <span className="badge badge-pending">simulated</span>}
        </div>
        <div className="hint" style={{ marginBottom: 10 }}>Your app is running. Open it in a new tab with the button, or copy the link to share it with someone on the same network.</div>
        <a className="url-box" href={p.url} target="_blank" rel="noreferrer"><Globe size={14} /> {p.url}</a>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <a className="btn blue lg" href={p.url} target="_blank" rel="noreferrer"><ExternalLink size={16} /> Open App</a>
          <button type="button" className="btn ghost" onClick={() => copy(p.url!)}>
            {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy link</>}
          </button>
        </div>
        {p.domainUrl && (
          <div className="hint" style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <Globe size={13} /> Also reachable by its domain name at
            <a href={p.domainUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--text-primary)' }}>{p.domainUrl}</a>
            <span>(only after you point that name at this machine, in DNS or in your hosts file)</span>
          </div>
        )}
      </div>
    );
  }

  if (p.status === 'failed') {
    return (
      <div className="panel bad" style={{ marginBottom: 12 }} role="alert">
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, color: 'var(--danger)', fontWeight: 600, fontSize: 15 }}>
          <AlertCircle size={20} style={{ flexShrink: 0 }} /> {p.appName ? `${p.appName}: deployment failed` : 'Deployment failed'}
        </div>
        {p.errorText && (
          <div className="note note-error" style={{ margin: '10px 0 0' }}>
            <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>The first error in the log</span>
            <code style={{ wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>{p.errorText}</code>
          </div>
        )}
        <div className="hint" style={{ margin: '10px 0 12px' }}>
          What to do: read the first red line in the log below; it usually names the missing file or package. Fix it in your repository, push, and press Deploy now again. The copilot can explain the error in plain words.
        </div>
        {(p.onJumpToError || p.onDiagnose) && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {p.onJumpToError && <button type="button" className="btn ghost sm" onClick={p.onJumpToError}><ArrowDownToLine size={14} /> Show only errors</button>}
            {p.onDiagnose && <button type="button" className="btn blue sm" onClick={p.onDiagnose}><Bot size={14} /> Diagnose with Copilot</button>}
          </div>
        )}
      </div>
    );
  }
  return null;
}
