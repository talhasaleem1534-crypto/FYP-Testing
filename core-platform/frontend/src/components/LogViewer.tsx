import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, AlertTriangle, ArrowDown, CheckCircle2, ChevronDown, ChevronRight, Copy, Download,
  ExternalLink, Loader2, Search, Trash2, WrapText, Check, Circle, XCircle,
} from 'lucide-react';
import {
  Level, LogGroup, LogLine, URL_RE, countByLevel, groupLines, parseLogs, pipelineStages, splitHighlight, toPlainText,
} from '../lib/logs';

const LEVEL_STYLE: Record<Level, { color: string; bg?: string; label: string }> = {
  error:   { color: '#fb7185', bg: 'rgba(244,63,94,0.10)', label: 'ERR' },
  warn:    { color: '#fbbf24', bg: 'rgba(245,158,11,0.08)', label: 'WRN' },
  success: { color: '#34d399', label: 'OK' },
  step:    { color: '#00f2fe', label: 'STEP' },
  info:    { color: '#e2e8f0', label: 'INF' },
  dim:     { color: '#7d8aa1', label: '' },
};

type Filter = 'all' | 'error' | 'warn' | 'step';

/** Turn a rewritten URL (hostname swapped for the browser's) so "localhost" links work remotely too. */
export const browserUrl = (u: string) => {
  try {
    const url = new URL(u);
    if ((url.hostname === 'localhost' || url.hostname === '127.0.0.1') && window.location.hostname !== 'localhost') url.hostname = window.location.hostname;
    return url.toString().replace(/\/$/, u.endsWith('/') ? '/' : '');
  } catch { return u; }
};

function Text({ text, query }: { text: string; query: string }) {
  // linkify URLs, then highlight search matches inside the remaining text
  const nodes: React.ReactNode[] = [];
  let last = 0, k = 0;
  const re = new RegExp(URL_RE.source, 'g');
  let m: RegExpExecArray | null;
  const plain = (s: string) => splitHighlight(s, query).map(p => p.hit
    ? <mark key={k++} style={{ background: '#fbbf24', color: '#0a0d14', borderRadius: 2, padding: '0 1px' }}>{p.text}</mark>
    : <React.Fragment key={k++}>{p.text}</React.Fragment>);
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(...plain(text.slice(last, m.index)));
    const url = m[0].replace(/[.,;]+$/, '');
    nodes.push(
      <a key={k++} href={browserUrl(url)} target="_blank" rel="noreferrer"
        style={{ color: '#00f2fe', textDecoration: 'underline', textUnderlineOffset: 2, wordBreak: 'break-all' }}>{url}</a>,
    );
    last = m.index + url.length;
    re.lastIndex = last;
  }
  if (last < text.length) nodes.push(...plain(text.slice(last)));
  return <>{nodes}</>;
}

function Row({ l, query, wrap, showNums }: { l: LogLine; query: string; wrap: boolean; showNums: boolean }) {
  const st = LEVEL_STYLE[l.level];
  if (l.isAppUrl) {
    const url = browserUrl(l.urls[0]);
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '8px 0', padding: '10px 14px', borderRadius: 10,
        background: 'linear-gradient(90deg, rgba(52,211,153,0.18), rgba(0,242,254,0.10))', border: '1px solid rgba(52,211,153,0.5)' }}>
        <span style={{ fontSize: 12, color: '#34d399', fontWeight: 700, letterSpacing: '0.5px' }}>APP URL</span>
        <a href={url} target="_blank" rel="noreferrer" style={{ color: '#fff', fontWeight: 700, fontSize: 15, textDecoration: 'none', flex: 1, wordBreak: 'break-all' }}>{l.urls[0]}</a>
        <a href={url} target="_blank" rel="noreferrer"
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, background: '#10b981', color: '#04120c', fontWeight: 700, fontSize: 12, textDecoration: 'none' }}>
          <ExternalLink size={13} /> Open
        </a>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', gap: 10, padding: '1px 8px', background: st.bg, borderLeft: `2px solid ${l.level === 'error' || l.level === 'warn' ? st.color : 'transparent'}`, alignItems: 'baseline' }}>
      {showNums && <span style={{ width: 30, textAlign: 'right', color: '#3b475c', userSelect: 'none', flexShrink: 0 }}>{l.n}</span>}
      <span style={{ width: 74, color: '#4b5870', flexShrink: 0, userSelect: 'none', fontSize: 11 }}>{l.time.replace(/ (AM|PM)$/, '')}</span>
      <span style={{ color: st.color, whiteSpace: wrap ? 'pre-wrap' : 'pre', wordBreak: wrap ? 'break-word' : undefined, fontWeight: l.level === 'step' ? 700 : 400, flex: 1, minWidth: 0 }}>
        <Text text={l.text} query={query} />
      </span>
    </div>
  );
}

function StageBar({ stages }: { stages: { label: string; state: string }[] }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {stages.map((s, i) => {
        const c = s.state === 'done' ? '#34d399' : s.state === 'active' ? '#00f2fe' : s.state === 'failed' ? '#fb7185' : '#4b5870';
        return (
          <React.Fragment key={s.label}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 20, fontSize: 12, fontWeight: 600, color: c, background: `${c}18`, border: `1px solid ${c}55` }}>
              {s.state === 'done' ? <Check size={13} /> : s.state === 'active' ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
                : s.state === 'failed' ? <XCircle size={13} /> : <Circle size={11} />}
              {i + 1}. {s.label}
            </div>
            {i < stages.length - 1 && <div style={{ width: 14, height: 1, background: '#334155' }} />}
          </React.Fragment>
        );
      })}
    </div>
  );
}

export interface LogViewerProps {
  lines: string[];                 // raw log entries ("[time] text")
  status: string;                  // idle | building | deploying | success | failed
  title?: string;
  onClear?: () => void;
  minHeight?: number;
  /** Change `nonce` to make the viewer switch to `value`. */
  filterRequest?: { value: 'all' | 'error' | 'warn' | 'step'; nonce: number };
}

export default function LogViewer({ lines, status, title, onClear, minHeight = 460, filterRequest }: LogViewerProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [wrap, setWrap] = useState(true);
  const [showNums, setShowNums] = useState(false);
  const [follow, setFollow] = useState(true);
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { if (filterRequest) setFilter(filterRequest.value); }, [filterRequest?.nonce]);

  const parsed = useMemo(() => parseLogs(lines), [lines]);
  const finished = status === 'success' || status === 'failed';
  const groups = useMemo(() => groupLines(parsed, finished, status === 'failed'), [parsed, finished, status]);
  const counts = useMemo(() => countByLevel(parsed), [parsed]);
  const stages = useMemo(() => pipelineStages(parsed, status), [parsed, status]);
  const showStages = parsed.some(l => l.level === 'step') && status !== 'idle';

  const q = query.trim().toLowerCase();
  const pass = (l: LogLine) => {
    if (filter === 'error' && l.level !== 'error') return false;
    if (filter === 'warn' && l.level !== 'warn' && l.level !== 'error') return false;
    if (filter === 'step' && l.level !== 'step' && l.level !== 'success' && !l.isAppUrl) return false;
    return !q || l.text.toLowerCase().includes(q);
  };
  const flat = filter !== 'all' || !!q;           // when filtering, show a flat list instead of folded groups
  const flatLines = flat ? parsed.filter(l => !l.divider && pass(l)) : [];

  // Follow the stream unless the user scrolled up.
  useEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [lines, follow, filter, query, collapsed]);
  const onScroll = () => {
    const el = box.current; if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (atBottom !== follow) setFollow(atBottom);
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(toPlainText(lines)); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };
  const download = () => {
    const blob = new Blob([toPlainText(lines) + '\n'], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(title || 'deploy').replace(/[^a-z0-9._-]/gi, '_')}-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const toggleAll = (open: boolean) => setCollapsed(Object.fromEntries(groups.map(g => [g.id, !open])));

  const pill = (id: Filter, label: string, n: number | null, color: string) => (
    <button key={id} onClick={() => setFilter(id)} style={{
      padding: '5px 11px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
      background: filter === id ? `${color}28` : 'rgba(255,255,255,0.04)', color: filter === id ? color : 'var(--text-secondary)',
      border: `1px solid ${filter === id ? color : 'var(--glass-border)'}`,
    }}>{label}{n !== null && <span style={{ marginLeft: 6, opacity: 0.85 }}>{n}</span>}</button>
  );
  const tool = (onClick: () => void, icon: React.ReactNode, label: string, active = false) => (
    <button onClick={onClick} title={label} style={{
      display: 'flex', alignItems: 'center', gap: 5, padding: '6px 10px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
      background: active ? 'rgba(0,242,254,0.14)' : 'rgba(255,255,255,0.05)', color: active ? '#00f2fe' : 'var(--text-secondary)',
      border: `1px solid ${active ? 'rgba(0,242,254,0.4)' : 'var(--glass-border)'}`,
    }}>{icon}{label}</button>
  );

  const groupIcon = (g: LogGroup) => g.status === 'failed' ? <AlertCircle size={14} color="#fb7185" />
    : g.status === 'running' ? <Loader2 size={14} color="#00f2fe" style={{ animation: 'spin 1s linear infinite' }} />
    : <CheckCircle2 size={14} color="#34d399" />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {showStages && <StageBar stages={stages} />}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        {pill('all', 'All', parsed.filter(l => !l.divider).length, '#94a3b8')}
        {pill('error', 'Errors', counts.error, '#fb7185')}
        {pill('warn', 'Warnings', counts.warn, '#fbbf24')}
        {pill('step', 'Key events', null, '#00f2fe')}
        <div style={{ position: 'relative', flex: '1 1 180px', minWidth: 160 }}>
          <Search size={13} style={{ position: 'absolute', left: 10, top: 9, color: 'var(--text-muted)' }} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search logs…"
            style={{ width: '100%', padding: '7px 10px 7px 29px', background: 'rgba(0,0,0,0.35)', border: '1px solid var(--glass-border)', borderRadius: 8, color: '#fff', fontSize: 12 }} />
        </div>
        {tool(() => setWrap(w => !w), <WrapText size={13} />, 'Wrap', wrap)}
        {tool(() => setShowNums(n => !n), <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>#</span>, 'Line #', showNums)}
        {!flat && groups.length > 1 && <>
          {tool(() => toggleAll(true), <ChevronDown size={13} />, 'Expand all')}
          {tool(() => toggleAll(false), <ChevronRight size={13} />, 'Collapse all')}
        </>}
        {tool(copy, copied ? <Check size={13} /> : <Copy size={13} />, copied ? 'Copied' : 'Copy')}
        {tool(download, <Download size={13} />, 'Download')}
        {onClear && tool(onClear, <Trash2 size={13} />, 'Clear')}
      </div>

      <div style={{ position: 'relative' }}>
        <div ref={box} onScroll={onScroll} className="terminal-window"
          style={{ minHeight, maxHeight: 'calc(100vh - 330px)', overflowY: 'auto', fontFamily: 'var(--font-mono)', fontSize: 12.5, lineHeight: 1.65, padding: '12px 6px' }}>
          {parsed.length === 0 && <div style={{ color: '#4b5870', padding: 20 }}>No log output yet. Deploy an application to see its pipeline here.</div>}

          {flat ? (
            <>
              <div style={{ color: '#64748b', padding: '0 8px 8px', fontSize: 11 }}>{flatLines.length} matching line{flatLines.length === 1 ? '' : 's'}</div>
              {flatLines.map(l => <Row key={l.n} l={l} query={query} wrap={wrap} showNums={showNums} />)}
            </>
          ) : groups.map(g => {
            const open = !collapsed[g.id];
            const errs = g.lines.filter(l => l.level === 'error').length;
            // The step header line is already shown on the folding button; only the fallback "Setup" group has no header line.
            const bodyLines = g.title === 'Setup' ? g.lines : g.lines.slice(1);
            return (
              <div key={g.id} style={{ marginBottom: 6 }}>
                <button onClick={() => setCollapsed(c => ({ ...c, [g.id]: open }))} style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', cursor: 'pointer', padding: '6px 8px', margin: '4px 0 2px',
                  background: 'rgba(255,255,255,0.035)', borderRadius: 6, color: '#e2e8f0', fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 600,
                }}>
                  {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  {groupIcon(g)}
                  <span style={{ flex: 1 }}>{g.title}</span>
                  {errs > 0 && <span style={{ color: '#fb7185', fontSize: 11 }}>{errs} error{errs > 1 ? 's' : ''}</span>}
                  <span style={{ color: '#64748b', fontSize: 11, fontWeight: 400 }}>{g.lines.length} lines</span>
                </button>
                {open && bodyLines.map(l => <Row key={l.n} l={l} query={query} wrap={wrap} showNums={showNums} />)}
              </div>
            );
          })}
          {status === 'building' || status === 'deploying' ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#00f2fe', padding: '6px 10px', fontSize: 12 }}>
              <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Running…
            </div>
          ) : null}
        </div>
        {!follow && (
          <button onClick={() => { setFollow(true); box.current && (box.current.scrollTop = box.current.scrollHeight); }}
            style={{ position: 'absolute', right: 16, bottom: 14, display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 20, background: '#00f2fe', color: '#04121a', fontWeight: 700, fontSize: 12, cursor: 'pointer', boxShadow: '0 4px 14px rgba(0,242,254,0.35)' }}>
            <ArrowDown size={13} /> Jump to latest
          </button>
        )}
      </div>
    </div>
  );
}
