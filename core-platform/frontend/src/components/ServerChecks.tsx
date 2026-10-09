import React, { useState } from 'react';
import { Check, CheckCircle2, Copy, XCircle } from 'lucide-react';
import { ServerCheck } from '../lib/servers';

/** A command the user copies to the Linux server. A black mono box with a "Copy" button. */
export function CommandBox({ cmd }: { cmd: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="note" style={{ display: 'flex', alignItems: 'flex-start', gap: 8, margin: '6px 0 0' }}>
      <code style={{ flex: 1, wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>{cmd}</code>
      <button type="button" className="btn ghost sm" title="Copy" aria-label="Copy command" style={{ flexShrink: 0 }}
        onClick={async () => { try { await navigator.clipboard.writeText(cmd.replace(/\s+#.*$/, '')); setDone(true); setTimeout(() => setDone(false), 1200); } catch { /* blocked */ } }}>
        {done ? <><Check size={13} style={{ color: 'var(--ok)' }} /> Copied</> : <><Copy size={13} /> Copy</>}
      </button>
    </div>
  );
}

/** The SSH / Docker / git / folder / network checklist of a server, with the fix for each failure. */
export default function ServerChecks({ checks, compact = false }: { checks?: ServerCheck[]; compact?: boolean }) {
  if (!checks?.length) return null;
  return (
    <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: compact ? 4 : 8, fontSize: compact ? 12 : 13 }}>
      {checks.map(c => (
        <li key={c.key}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, color: c.ok ? 'var(--text-secondary)' : 'var(--danger)' }}>
            {c.ok
              ? <CheckCircle2 size={14} aria-label="passed" style={{ color: 'var(--ok)', flexShrink: 0, marginTop: 2 }} />
              : <XCircle size={14} aria-label="failed" style={{ flexShrink: 0, marginTop: 2 }} />}
            <span><b style={{ color: c.ok ? 'var(--text-primary)' : 'var(--danger)', fontWeight: 600 }}>{c.label}</b> — {c.detail}</span>
          </div>
          {!c.ok && c.fix && !compact && (
            <div style={{ marginLeft: 21, marginTop: 4 }}>
              <div className="hint">Fix - run on the server, then press "Check again":</div>
              <CommandBox cmd={c.fix} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
