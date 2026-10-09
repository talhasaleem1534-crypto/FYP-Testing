import React from 'react';
import { Box, MapPin, RefreshCw, Trash2, Users } from 'lucide-react';
import { ServerRecord } from '../lib/servers';
import ServerChecks from './ServerChecks';

function Badge({ status }: { status: string }) {
  const cls = status === 'verified' ? 'badge-verified' : status === 'pending' ? 'badge-building' : 'badge-failed';
  return <span className={`badge ${cls}`}>{status === 'unreachable' ? 'not ready' : status}</span>;
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
  const address = server.is_local
    ? 'the platform machine (the computer that runs OmniDeploy)'
    : `${server.ssh_user ? `${server.ssh_user}@` : ''}${server.host}${server.port && server.port !== 22 ? `:${server.port}` : ''}`;
  return (
    <div className={`panel${server.status === 'verified' ? ' ok' : ''}`}>
      <div className="panel-head">
        <div style={{ minWidth: 0 }}>
          <h3 style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{server.name}</h3>
          {note && <div className="hint">{note}</div>}
        </div>
        <Badge status={server.status} />
      </div>

      <div className="kv">
        <div><MapPin size={12} /><span>{address}</span></div>
        {server.docker_version && <div><Box size={12} /><span>Docker: {server.docker_version}</span></div>}
      </div>

      {server.checks?.length ? <ServerChecks checks={server.checks} compact /> : null}

      {server.status !== 'verified' && (
        <div className="hint" style={{ marginTop: 8 }}>
          {server.status === 'pending'
            ? 'Not checked yet. Press "Check again" to test the connection.'
            : 'Something is missing on this machine. Each red line above says what to fix; then press "Check again".'}
        </div>
      )}

      {(canShare || canManage) && (
        <div className="panel-foot">
          {canShare && onShare && (
            <label className="check" style={{ marginRight: 'auto', fontSize: 12 }}>
              <input type="checkbox" checked={!!server.shared} disabled={busy} onChange={e => onShare(e.target.checked)} />
              <Users size={12} /> Customers can deploy here
            </label>
          )}
          {canManage && onVerify && (
            <button type="button" className="btn ghost sm" onClick={onVerify} disabled={busy} style={{ marginLeft: canShare ? undefined : 'auto' }}>
              <RefreshCw size={12} style={busy ? { animation: 'spin 1s linear infinite' } : undefined} /> Check again
            </button>
          )}
          {canManage && onDelete && !server.is_local && (
            <button type="button" className="btn danger sm icon" onClick={onDelete} disabled={busy} title="Remove from OmniDeploy" aria-label={`Remove ${server.name}`}>
              <Trash2 size={12} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
