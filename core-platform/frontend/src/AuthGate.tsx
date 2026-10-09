import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { BACKEND_URL } from './lib/backend';

/** Full-screen "Loading…" shown while a gate checks the saved login. */
export function Loading() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', gap: 10 }}>
      <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> Loading…
    </div>
  );
}

/** True while the platform backend answers /health (checked every 8 s). */
export function useBackendOk(): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    const ping = () => fetch(`${BACKEND_URL}/health`, { signal: AbortSignal.timeout(2000) })
      .then(r => setOk(r.ok)).catch(() => setOk(false));
    ping();
    const t = setInterval(ping, 8000);
    return () => clearInterval(t);
  }, []);
  return ok;
}
