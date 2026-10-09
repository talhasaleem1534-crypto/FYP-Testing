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

export default function DeployBanner(p: DeployBannerProps) {
  const [copied, setCopied] = useState(false);
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };

  if (p.status === 'building' || p.status === 'deploying') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderRadius: 12, background: 'rgba(0,242,254,0.07)', border: '1px solid rgba(0,242,254,0.3)', color: '#00f2fe' }}>
        <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} />
        <div><div style={{ fontWeight: 700 }}>Deploying {p.appName}…</div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>The app link appears here as soon as the deployment succeeds.</div></div>
      </div>
    );
  }

  if (p.status === 'success' && p.url) {
    return (
      <div style={{ padding: '18px 20px', borderRadius: 14, background: 'linear-gradient(135deg, rgba(16,185,129,0.20), rgba(0,242,254,0.08))', border: '1px solid rgba(52,211,153,0.55)', boxShadow: '0 0 28px rgba(16,185,129,0.12)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, color: '#34d399', fontWeight: 700, fontSize: 15, marginBottom: 10 }}>
          <CheckCircle2 size={20} /> {p.appName} deployed successfully{p.simulated && <span style={{ fontSize: 11, fontWeight: 600, background: 'rgba(245,158,11,0.2)', color: '#fbbf24', padding: '2px 8px', borderRadius: 10 }}>simulated</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <a href={p.url} target="_blank" rel="noreferrer"
            style={{ flex: '1 1 260px', minWidth: 0, fontSize: 20, fontWeight: 700, color: '#fff', textDecoration: 'none', wordBreak: 'break-all' }}>{p.url}</a>
          <a href={p.url} target="_blank" rel="noreferrer"
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 22px', borderRadius: 10, background: '#10b981', color: '#04120c', fontWeight: 800, fontSize: 14, textDecoration: 'none', boxShadow: '0 4px 16px rgba(16,185,129,0.4)' }}>
            <ExternalLink size={16} /> Open App
          </a>
          <button onClick={() => copy(p.url!)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '11px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.08)', color: '#e2e8f0', fontWeight: 600, fontSize: 13, border: '1px solid rgba(255,255,255,0.15)', cursor: 'pointer' }}>
            {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}
          </button>
        </div>
        {p.domainUrl && (
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <Globe size={13} /> Also routed by Traefik at
            <a href={p.domainUrl} target="_blank" rel="noreferrer" style={{ color: '#00f2fe' }}>{p.domainUrl}</a>
            <span style={{ opacity: 0.7 }}>(needs DNS or a hosts-file entry pointing the domain at this machine)</span>
          </div>
        )}
      </div>
    );
  }

  if (p.status === 'failed') {
    return (
      <div style={{ padding: '16px 20px', borderRadius: 14, background: 'rgba(244,63,94,0.10)', border: '1px solid rgba(244,63,94,0.5)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, color: '#fb7185', fontWeight: 700, fontSize: 15 }}>
          <AlertCircle size={20} /> {p.appName ? `${p.appName}: deployment failed` : 'Deployment failed'}
        </div>
        {p.errorText && <div style={{ margin: '8px 0 12px', fontFamily: 'var(--font-mono)', fontSize: 12.5, color: '#fecdd3', wordBreak: 'break-word' }}>{p.errorText}</div>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {p.onJumpToError && <button onClick={p.onJumpToError} style={btn('#fb7185')}><ArrowDownToLine size={14} /> Show only errors</button>}
          {p.onDiagnose && <button onClick={p.onDiagnose} style={btn('#a78bfa')}><Bot size={14} /> Diagnose with Copilot</button>}
        </div>
      </div>
    );
  }
  return null;
}

const btn = (c: string): React.CSSProperties => ({
  display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, fontWeight: 600, fontSize: 12.5, cursor: 'pointer',
  background: `${c}22`, color: c, border: `1px solid ${c}66`,
});
