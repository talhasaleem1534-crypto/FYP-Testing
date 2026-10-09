import React, { useState } from 'react';
import { CheckCircle2, Info, X } from 'lucide-react';

/*
 * Small shared pieces used by every screen so the customer portal and the admin site read the
 * same way: a page title with a one-line purpose, a plain-language explanation box, a status
 * legend. Styles live in index.css (.page-head, .help, .legend ...).
 */

/** Title + one sentence that says what the page is for + optional action buttons on the right. */
export function PageHead({ title, text, actions, small = false }: { title: string; text?: React.ReactNode; actions?: React.ReactNode; small?: boolean }) {
  return (
    <div className="page-head">
      <div>
        {small ? <h2>{title}</h2> : <h1>{title}</h1>}
        {text && <p>{text}</p>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

/**
 * The explanation box. Shown at the top of a page or a step: what this is, what you need,
 * what will happen. Readers who know it can hide it; the choice is remembered per `id`.
 */
export function Help({ id, title = 'What is this?', children, need, steps, next }: {
  id: string;
  title?: string;
  /** One or two short sentences in plain words. */
  children?: React.ReactNode;
  /** "You will need" checklist. */
  need?: React.ReactNode[];
  /** Numbered "what happens next" or "how to do it" list. */
  steps?: React.ReactNode[];
  /** Optional closing sentence ("Next: ..."). */
  next?: React.ReactNode;
}) {
  const key = `omnideploy.help.${id}`;
  const [hidden, setHidden] = useState<boolean>(() => { try { return localStorage.getItem(key) === 'hidden'; } catch { return false; } });
  const toggle = (h: boolean) => { setHidden(h); try { h ? localStorage.setItem(key, 'hidden') : localStorage.removeItem(key); } catch { /* ignore */ } };

  if (hidden) {
    return <button type="button" className="help-show" onClick={() => toggle(false)}><Info size={13} /> Show the explanation for this page</button>;
  }
  return (
    <section className="help" aria-label={title}>
      <div className="help-head"><Info size={15} /> {title}
        <button type="button" className="linkish" onClick={() => toggle(true)} aria-label="Hide this explanation"><X size={11} style={{ verticalAlign: -1 }} /> Hide</button>
      </div>
      {children && <p>{children}</p>}
      {need && need.length > 0 && (
        <>
          <h5>You will need</h5>
          <ul>{need.map((n, i) => <li key={i}><CheckCircle2 size={14} /><span>{n}</span></li>)}</ul>
        </>
      )}
      {steps && steps.length > 0 && (
        <>
          <h5>What happens</h5>
          <ol>{steps.map((s, i) => <li key={i}><span>{s}</span></li>)}</ol>
        </>
      )}
      {next && <p>{next}</p>}
    </section>
  );
}

/** A small line under a list explaining what each status word means. */
export function StatusLegend({ items }: { items: { cls: string; label: string; meaning: string }[] }) {
  return (
    <div className="legend">
      {items.map(i => <span key={i.label}><span className={`badge ${i.cls}`}>{i.label}</span> {i.meaning}</span>)}
    </div>
  );
}

export const APP_STATUS_LEGEND = [
  { cls: 'badge-running', label: 'running', meaning: 'your app is online' },
  { cls: 'badge-building', label: 'building', meaning: 'being built and started right now' },
  { cls: 'badge-idle', label: 'idle', meaning: 'created, not deployed yet' },
  { cls: 'badge-failed', label: 'failed', meaning: 'the last deploy did not work; open the log' },
];

export const SERVER_STATUS_LEGEND = [
  { cls: 'badge-verified', label: 'verified', meaning: 'OmniDeploy can log in and Docker works' },
  { cls: 'badge-building', label: 'pending', meaning: 'not checked yet' },
  { cls: 'badge-failed', label: 'not ready', meaning: 'something is missing; open the checklist' },
];
