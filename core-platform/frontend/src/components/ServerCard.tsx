import React from 'react';
import { RefreshCw, Trash2, Users } from 'lucide-react';
import { ServerRecord } from '../lib/servers';
import ServerChecks from './ServerChecks';

function Badge({ status }: { status: string }) {
  const cls = status === 'verified' ? 'badge-verified' : status === 'pending' ? 'badge-building' : 'badge-failed';
  return <span className={`badge ${cls}`}><span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />{status === 'unreachable' ? 'not ready' : status}</span>;
}

/** One server: where it is, whether it is ready (checklist), and - if allowed - share / re-check / delete. */
export default function ServerCard({ server, note, canManage, canShare, busy, onVerify, onShare, onDelete }: {
  server: ServerRecord;
  /** Extra line, e.g. the owner's email (admin) or "Provided by the platform" (customer). */
  note?: string;
  canManage: boolean;
  canShare: boolean;
  busy?: boolean;
  onVerify?: () => void;
  onShare?: (shared: boolean) => void;
  onDelete?: () => void;
}) {
  const small: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, padding: '7px 11px', borderRadius: 8, fontSize: 12, fontWeight: 600 };
  return (
    <div className="glass-panel" style={{ padding: 20, borderColor: server.status === 'verified' ? 'rgba(52,211,153,0.3)' : undefined }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 17 }}>{server.name}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, wordBreak: 'break-all' }}>
            {server.is_local ? 'the platform machine' : `${server.ssh_user ? `${server.ssh_user}@` : ''}${server.host}${server.port && server.port !== 22 ? `:${server.port}` : ''}`}
          </div>
          {note && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>{note}</div>}
        </div>
        <Badge status={server.status} />
      </div>
      {server.checks?.length ? (
        <div style={{ background: 'rgba(0,0,0,0.25)', borderRadius: 8, padding: '9px 11px', marginBottom: 12 }}><ServerChecks checks={server.checks} compact /></div>
      ) : server.docker_version ? (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>🐳 {server.docker_version}</div>
      ) : null}
      {(canShare || canManage) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {canShare && onShare && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)', marginRight: 'auto' }}>
              <input type="checkbox" checked={!!server.shared} disabled={busy} onChange={e => onShare(e.target.checked)} />
              <Users size={12} /> Customers can deploy here
            </label>
          )}
          {canManage && onVerify && (
            <button onClick={onVerify} disabled={busy} style={{ ...small, background: 'rgba(255,255,255,0.06)', border: '1px solid var(--glass-border)', color: 'var(--text-secondary)', marginLeft: canShare ? undefined : 'auto' }}>
              <RefreshCw size={12} style={busy ? { animation: 'spin 1s linear infinite' } : undefined} /> Check again
            </button>
          )}
          {canManage && onDelete && !server.is_local && (
            <button onClick={onDelete} disabled={busy} title="Remove server" aria-label={`Remove ${server.name}`} style={{ ...small, background: 'rgba(244,63,94,0.12)', border: '1px solid rgba(244,63,94,0.35)', color: '#fb7185' }}>
              <Trash2 size={12} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
