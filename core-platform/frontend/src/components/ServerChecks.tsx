import React, { useState } from 'react';
import { Check, CheckCircle2, Copy, XCircle } from 'lucide-react';
import { ServerCheck } from '../lib/servers';

/** A command the user copies to the Linux server. */
export function CommandBox({ cmd }: { cmd: string }) {
  const [done, setDone] = useState(false);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, background: '#06090e', border: '1px solid #1e293b', borderRadius: 8, padding: '8px 10px', marginTop: 6 }}>
      <code style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12, color: '#7dd3fc', wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>{cmd}</code>
      <button type="button" title="Copy" aria-label="Copy command"
        onClick={async () => { try { await navigator.clipboard.writeText(cmd.replace(/\s+#.*$/, '')); setDone(true); setTimeout(() => setDone(false), 1200); } catch { /* blocked */ } }}
        style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 6, padding: 5, color: done ? '#34d399' : 'var(--text-muted)', flexShrink: 0 }}>
        {done ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </div>
  );
}

/** The SSH / Docker / git / folder / network checklist of a server, with the fix for each failure. */
export default function ServerChecks({ checks, compact = false }: { checks?: ServerCheck[]; compact?: boolean }) {
  if (!checks?.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 3 : 6 }}>
      {checks.map(c => (
        <div key={c.key} style={{ fontSize: compact ? 12 : 13 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, color: c.ok ? 'var(--text-secondary)' : '#fb7185' }}>
            {c.ok ? <CheckCircle2 size={14} color="#34d399" style={{ flexShrink: 0, marginTop: 2 }} /> : <XCircle size={14} style={{ flexShrink: 0, marginTop: 2 }} />}
            <span><strong style={{ color: c.ok ? 'var(--text-primary)' : '#fb7185' }}>{c.label}</strong> — {c.detail}</span>
          </div>
          {!c.ok && c.fix && !compact && <div style={{ marginLeft: 20 }}><div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Fix - run on the server:</div><CommandBox cmd={c.fix} /></div>}
        </div>
      ))}
    </div>
  );
}
