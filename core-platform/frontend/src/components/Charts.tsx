import React, { useEffect, useMemo, useRef, useState } from 'react';

export interface Point { t: number; v: number }
export interface Series { name: string; color: string; points: Point[]; dashed?: boolean }
export interface Threshold { value: number; label: string; color: string }

export const PALETTE = ['#00f2fe', '#a78bfa', '#f472b6', '#fbbf24', '#34d399', '#60a5fa', '#fb7185', '#2dd4bf'];

const fmtTime = (t: number, withSeconds: boolean) =>
  new Date(t).toLocaleTimeString([], withSeconds ? { hour: '2-digit', minute: '2-digit', second: '2-digit' } : { hour: '2-digit', minute: '2-digit' });

export const niceMax = (v: number) => {
  if (!isFinite(v) || v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
};

export function ChartCard({ title, subtitle, right, children, minHeight }: {
  title: string; subtitle?: string; right?: React.ReactNode; children: React.ReactNode; minHeight?: number;
}) {
  return (
    <div className="glass-panel" style={{ padding: '18px 20px', minHeight, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, gap: 10 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{title}</div>
          {subtitle && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{subtitle}</div>}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

export function NoData({ children, height = 180 }: { children: React.ReactNode; height?: number }) {
  return (
    <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.6, padding: '0 18px' }}>
      <div>{children}</div>
    </div>
  );
}

/** Multi-series time-series line chart (pure SVG, hover tooltip, clickable legend). */
export function LineChart({ series, height = 200, unit = '', yMax, yMin = 0, thresholds = [], area = false, windowMs, decimals = 1, emptyText }: {
  series: Series[]; height?: number; unit?: string; yMax?: number; yMin?: number; thresholds?: Threshold[];
  area?: boolean; windowMs?: number; decimals?: number; emptyText?: string;
}) {
  const padL = 44, padR = 12, padT = 10, padB = 24;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);          // real pixel width of the card, so the chart always fills it
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const visible = series.filter(s => !hidden[s.name]);
  const all = visible.flatMap(s => s.points);

  const dom = useMemo(() => {
    if (!all.length) return null;
    const tMax = Math.max(...all.map(p => p.t));
    const dataMin = Math.min(...all.map(p => p.t));
    // Show the whole window once enough data exists; until then zoom to what we have (at least 30 s).
    const tMin = windowMs ? Math.max(tMax - windowMs, Math.min(dataMin, tMax - 30000)) : dataMin;
    const dataMax = Math.max(...all.filter(p => p.t >= tMin).map(p => p.v), ...thresholds.map(t => t.value), 0);
    const hi = yMax ?? niceMax(dataMax * 1.1);
    const lo = Math.min(yMin, ...all.map(p => p.v));
    return { tMin, tMax: tMax === tMin ? tMin + 1 : tMax, lo, hi: hi === lo ? lo + 1 : hi };
  }, [all, windowMs, yMax, yMin, thresholds]);

  if (!dom) return <NoData height={height}>{emptyText || 'Waiting for data…'}</NoData>;

  const x = (t: number) => padL + ((t - dom.tMin) / (dom.tMax - dom.tMin)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - dom.lo) / (dom.hi - dom.lo)) * (height - padT - padB);
  const fmt = (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(Math.abs(v) < 10 ? decimals : 0));

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(f => dom.lo + f * (dom.hi - dom.lo));
  const xTicks = [0, 0.33, 0.66, 1].map(f => dom.tMin + f * (dom.tMax - dom.tMin));
  const withSeconds = dom.tMax - dom.tMin < 20 * 60 * 1000;

  const path = (pts: Point[]) => pts.filter(p => p.t >= dom.tMin).map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');

  const onMove = (e: React.MouseEvent) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const t = dom.tMin + ((px - padL) / (W - padL - padR)) * (dom.tMax - dom.tMin);
    let best: number | null = null, bd = Infinity;
    for (const p of all) { const d = Math.abs(p.t - t); if (d < bd) { bd = d; best = p.t; } }
    setHover(best);
  };

  const hoverVals = hover == null ? [] : visible.map(s => {
    let best: Point | null = null, bd = Infinity;
    for (const p of s.points) { const d = Math.abs(p.t - hover); if (d < bd) { bd = d; best = p; } }
    return { s, p: best };
  }).filter(h => h.p && Math.abs(h.p.t - hover) < (dom.tMax - dom.tMin) / 8);

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%' }}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${height}`} style={{ width: '100%', height, display: 'block' }}
        onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {yTicks.map((v, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="rgba(255,255,255,0.07)" />
            <text x={padL - 6} y={y(v) + 3} fontSize={10} fill="#64748b" textAnchor="end">{fmt(v)}</text>
          </g>
        ))}
        {xTicks.map((t, i) => (
          <text key={i} x={x(t)} y={height - 7} fontSize={10} fill="#64748b" textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}>{fmtTime(t, withSeconds)}</text>
        ))}
        {thresholds.map(th => (
          <g key={th.label}>
            <line x1={padL} x2={W - padR} y1={y(th.value)} y2={y(th.value)} stroke={th.color} strokeDasharray="5 4" opacity={0.8} />
            <text x={W - padR - 2} y={y(th.value) - 4} fontSize={10} fill={th.color} textAnchor="end">{th.label}</text>
          </g>
        ))}
        {visible.map(s => {
          const d = path(s.points);
          if (!d) return null;
          const pts = s.points.filter(p => p.t >= dom.tMin);
          return (
            <g key={s.name}>
              {area && pts.length > 1 && (
                <path d={`${d} L${x(pts[pts.length - 1].t)},${y(dom.lo)} L${x(pts[0].t)},${y(dom.lo)} Z`} fill={s.color} opacity={0.12} />
              )}
              <path d={d} fill="none" stroke={s.color} strokeWidth={1.8} strokeLinejoin="round" strokeDasharray={s.dashed ? '4 3' : undefined} />
            </g>
          );
        })}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={padT} y2={height - padB} stroke="rgba(255,255,255,0.25)" />}
        {hoverVals.map(({ s, p }) => <circle key={s.name} cx={x(p!.t)} cy={y(p!.v)} r={3.5} fill={s.color} stroke="#0a0d14" strokeWidth={1.5} />)}
      </svg>

      {hover != null && hoverVals.length > 0 && (
        <div style={{
          position: 'absolute', top: 6, pointerEvents: 'none', fontSize: 11, padding: '7px 10px', borderRadius: 8,
          background: 'rgba(10,13,20,0.95)', border: '1px solid var(--glass-border)', zIndex: 5, minWidth: 130,
          left: `${Math.min(Math.max(((x(hover) / W) * 100), 12), 68)}%`,
        }}>
          <div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>{fmtTime(hover, true)}</div>
          {hoverVals.map(({ s, p }) => (
            <div key={s.name} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color }} />
              <span style={{ flex: 1, color: 'var(--text-secondary)' }}>{s.name}</span>
              <strong>{p!.v.toFixed(decimals)}{unit}</strong>
            </div>
          ))}
        </div>
      )}

      {series.length > 1 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', marginTop: 6 }}>
          {series.map(s => (
            <button key={s.name} onClick={() => setHidden(h => ({ ...h, [s.name]: !h[s.name] }))} title="Click to show/hide"
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: hidden[s.name] ? '#475569' : 'var(--text-secondary)', textDecoration: hidden[s.name] ? 'line-through' : 'none', background: 'none', cursor: 'pointer' }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: hidden[s.name] ? '#334155' : s.color }} />{s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export interface BarDatum { label: string; values: Record<string, number> }

/** Stacked vertical bars (e.g. deployments per day, success vs failed). */
export function StackedBars({ data, colors, height = 180, emptyText }: {
  data: BarDatum[]; colors: Record<string, string>; height?: number; emptyText?: string;
}) {
  const keys = Object.keys(colors);
  const totals = data.map(d => keys.reduce((a, k) => a + (d.values[k] || 0), 0));
  const max = Math.max(...totals, 0);
  if (!data.length || max === 0) return <NoData height={height}>{emptyText || 'No data yet'}</NoData>;
  const top = niceMax(max);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height, paddingTop: 8, borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
        {data.map((d, i) => (
          <div key={i} title={`${d.label}: ${keys.map(k => `${k} ${d.values[k] || 0}`).join(', ')}`}
            style={{ flex: 1, display: 'flex', flexDirection: 'column-reverse', height: '100%', justifyContent: 'flex-start', minWidth: 6 }}>
            {keys.map(k => (d.values[k] || 0) > 0 && (
              <div key={k} style={{ height: `${((d.values[k] || 0) / top) * 100}%`, background: colors[k], opacity: 0.9, borderRadius: 2 }} />
            ))}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
        {data.map((d, i) => (
          <div key={i} style={{ flex: 1, minWidth: 6, fontSize: 9, color: 'var(--text-muted)', textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden' }}>
            {data.length <= 8 || i % 2 === 0 ? d.label : ''}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
        {keys.map(k => <span key={k} style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: colors[k] }} />{k}</span>)}
      </div>
    </div>
  );
}

/** Simple horizontal bars (e.g. duration per deployment). */
export function HBars({ rows, unit = '', emptyText }: { rows: { label: string; value: number; color?: string; note?: string }[]; unit?: string; emptyText?: string }) {
  if (!rows.length) return <NoData height={140}>{emptyText || 'No data yet'}</NoData>;
  const max = Math.max(...rows.map(r => r.value), 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
          <div style={{ width: 150, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.label}>{r.label}</div>
          <div style={{ flex: 1, height: 10, background: 'rgba(255,255,255,0.06)', borderRadius: 5, overflow: 'hidden' }}>
            <div style={{ width: `${(r.value / max) * 100}%`, height: '100%', background: r.color || 'var(--accent-cyan)', borderRadius: 5 }} />
          </div>
          <div style={{ width: 70, textAlign: 'right', color: 'var(--text-primary)' }}>{r.note ?? `${r.value.toFixed(1)}${unit}`}</div>
        </div>
      ))}
    </div>
  );
}

export function Donut({ parts, size = 130, center }: { parts: { label: string; value: number; color: string }[]; size?: number; center?: string }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  if (!total) return <NoData height={size}>No data yet</NoData>;
  const r = size / 2 - 12, c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={14} />
        {parts.filter(p => p.value > 0).map(p => {
          const len = (p.value / total) * c;
          const el = <circle key={p.label} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={p.color} strokeWidth={14}
            strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} transform={`rotate(-90 ${size / 2} ${size / 2})`} />;
          offset += len;
          return el;
        })}
        {center && <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" fontSize={20} fontWeight={700} fill="#f8fafc">{center}</text>}
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {parts.map(p => (
          <div key={p.label} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--text-secondary)' }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: p.color }} />{p.label}
            <strong style={{ color: 'var(--text-primary)', marginLeft: 4 }}>{p.value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Sparkline({ values, color = '#00f2fe', width = 90, height = 24 }: { values: number[]; color?: string; width?: number; height?: number }) {
  if (values.length < 2) return <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>–</span>;
  const max = Math.max(...values, 1), min = Math.min(...values, 0);
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * width).toFixed(1)},${(height - 2 - ((v - min) / (max - min || 1)) * (height - 4)).toFixed(1)}`).join(' ');
  return <svg width={width} height={height}><polyline points={pts} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" /></svg>;
}

export function Kpi({ label, value, sub, color = 'var(--text-primary)', icon }: { label: string; value: React.ReactNode; sub?: React.ReactNode; color?: string; icon?: React.ReactNode }) {
  return (
    <div className="glass-panel" style={{ padding: '16px 18px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        <span>{label}</span>{icon}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, marginTop: 6, color }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
