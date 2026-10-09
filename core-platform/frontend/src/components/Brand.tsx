import React from 'react';

/** The OmniDeploy mark: a ring (the server) with a dot (your app) and a line through it (the pipe). */
export function OmniMark({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" style={{ flexShrink: 0, display: 'block' }}>
      <rect width="32" height="32" rx="5" fill="var(--bg-primary)" stroke="var(--line-strong)" />
      <circle cx="16" cy="16" r="9.5" fill="none" stroke="var(--text-primary)" strokeWidth="2.2" />
      <circle cx="16" cy="16" r="3.4" fill="var(--accent)" />
      <path d="M16 2.5v6M16 23.5v6" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

/** Mark + wordmark, with an optional second line ("Customer portal", "Admin site", ...). */
export function Wordmark({ sub, size = 36 }: { sub?: string; size?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
      <OmniMark size={size} />
      <div style={{ lineHeight: 1.15 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: size * 0.5, letterSpacing: '-0.01em' }}>
          Omni<span style={{ color: 'var(--accent)' }}>Deploy</span>
        </div>
        {sub && <div className="eyebrow" style={{ marginTop: 2 }}>{sub}</div>}
      </div>
    </div>
  );
}

/** Alias used by the dashboard headers (App.tsx, CustomerPortal.tsx). */
export function Brand({ subtitle, size = 38 }: { subtitle?: string; size?: number }) {
  return <Wordmark sub={subtitle} size={size} />;
}
