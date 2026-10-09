import { useCallback, useEffect, useRef, useState } from 'react';
import type { Series } from '../components/Charts';
import { PALETTE } from '../components/Charts';

export interface ContainerSample {
  cpu: number; mem: number; netIn: number; netOut: number; restarts: number;
  score: number | null; status: string;
}
export interface Sample { t: number; c: Record<string, ContainerSample>; threshold: number | null; degrading: number | null }

const MAX_SAMPLES = 720;           // 1 hour at 5 s
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// ── Container telemetry (AI engine /containers/anomaly) ───────────────────────
interface DemoState { name: string; cpu: number; mem: number; net: number; base: { cpu: number; mem: number; net: number } }

function demoStep(states: DemoState[], tick: number): Record<string, ContainerSample> {
  const out: Record<string, ContainerSample> = {};
  for (const s of states) {
    s.cpu = clamp(s.cpu + rand(-3, 3) + (s.base.cpu - s.cpu) * 0.15, 0.5, 100);
    s.mem = clamp(s.mem + rand(-0.8, 0.8) + (s.base.mem - s.mem) * 0.05, 1, 100);
    s.net = clamp(s.net + rand(-25, 25) + (s.base.net - s.net) * 0.2, 0, 4000);
    let cpu = s.cpu, mem = s.mem;
    if (s.name === 'api-service') {
      const phase = tick % 90;                      // periodic CPU spike + slow memory climb
      if (phase > 70 && phase < 80) cpu = clamp(cpu + 60, 0, 100);
      mem = clamp(mem + (tick % 180) / 6, 0, 95);
    }
    const bad = cpu > 85 || mem > 82;
    const mid = !bad && (cpu > 55 || mem > 60);
    out[s.name] = {
      cpu, mem, netIn: s.net, netOut: s.net * 0.55, restarts: 0,
      score: bad ? rand(-0.78, -0.66) : mid ? rand(-0.62, -0.5) : rand(-0.45, -0.36),
      status: bad ? 'ANOMALOUS' : mid ? 'DEGRADING' : 'HEALTHY',
    };
  }
  return out;
}

export function useTelemetry(opts: { enabled: boolean; demo: boolean; aiUrl: string; intervalMs?: number }) {
  const { enabled, demo, aiUrl, intervalMs = 5000 } = opts;
  const [history, setHistory] = useState<Sample[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [paused, setPaused] = useState(false);
  const busy = useRef(false);
  const demoStates = useRef<DemoState[]>([]);
  const tick = useRef(0);

  const push = useCallback((s: Sample) => setHistory(h => [...h.slice(-(MAX_SAMPLES - 1)), s]), []);

  // demo: pre-fill 5 minutes so charts are not empty on first view
  useEffect(() => {
    if (!demo) return;
    demoStates.current = [
      { name: 'my-portfolio', cpu: 14, mem: 34, net: 180, base: { cpu: 14, mem: 34, net: 180 } },
      { name: 'api-service',  cpu: 20, mem: 41, net: 320, base: { cpu: 20, mem: 41, net: 320 } },
      { name: 'traefik',      cpu: 3,  mem: 6,  net: 90,  base: { cpu: 3,  mem: 6,  net: 90 } },
    ];
    const now = Date.now();
    const seed: Sample[] = [];
    for (let i = 60; i > 0; i--) { tick.current++; seed.push({ t: now - i * intervalMs, c: demoStep(demoStates.current, tick.current), threshold: -0.6453, degrading: -0.5849 }); }
    setHistory(seed); setError('');
  }, [demo, intervalMs]);

  useEffect(() => {
    if (!enabled || paused) return;
    const run = async () => {
      if (busy.current) return;
      busy.current = true; setLoading(true);
      try {
        if (demo) {
          tick.current++;
          push({ t: Date.now(), c: demoStep(demoStates.current, tick.current), threshold: -0.6453, degrading: -0.5849 });
          setError('');
        } else {
          const r = await fetch(`${aiUrl}/containers/anomaly`, { signal: AbortSignal.timeout(20000) });
          if (!r.ok) throw new Error(`AI engine returned HTTP ${r.status}`);
          const d = await r.json();
          if (d.error) { setError(d.error); return; }
          const c: Record<string, ContainerSample> = {};
          let threshold: number | null = null, degrading: number | null = null;
          for (const x of d.containers || []) {
            c[x.container_name] = {
              cpu: x.cpu_percent, mem: x.mem_percent, netIn: x.net_in_kb, netOut: x.net_out_kb,
              restarts: x.restart_count, score: x.score ?? null, status: x.status || (x.is_anomaly ? 'ANOMALOUS' : 'HEALTHY'),
            };
            threshold = x.threshold ?? threshold; degrading = x.degrading_threshold ?? degrading;
          }
          push({ t: Date.now(), c, threshold, degrading });
          setError('');
        }
      } catch (e: any) {
        setError(`AI engine unreachable: ${e.message}`);
      } finally { busy.current = false; setLoading(false); }
    };
    run();
    const t = setInterval(run, intervalMs);
    return () => clearInterval(t);
  }, [enabled, paused, demo, aiUrl, intervalMs, push]);

  const clear = useCallback(() => setHistory([]), []);
  return { history, error, loading, paused, setPaused, clear };
}

/** Per-container series for one metric. */
export function seriesFor(history: Sample[], pick: (c: ContainerSample) => number | null, windowMs: number, maxSeries = 8): Series[] {
  const cut = Date.now() - windowMs;
  const names = new Map<string, number>();
  for (const s of history) for (const [n, c] of Object.entries(s.c)) names.set(n, (names.get(n) || 0) + (pick(c) ?? 0));
  // keep the busiest containers when there are many
  const top = [...names.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxSeries).map(([n]) => n).sort();
  return top.map((name, i) => ({
    name, color: PALETTE[i % PALETTE.length],
    points: history.filter(s => s.t >= cut && s.c[name] && pick(s.c[name]) !== null).map(s => ({ t: s.t, v: pick(s.c[name]) as number })),
  })).filter(s => s.points.length);
}

export function totalSeries(history: Sample[], name: string, color: string, pick: (c: ContainerSample) => number, windowMs: number): Series {
  const cut = Date.now() - windowMs;
  return { name, color, points: history.filter(s => s.t >= cut).map(s => ({ t: s.t, v: Object.values(s.c).reduce((a, c) => a + pick(c), 0) })) };
}

// ── HTTP request rate from Traefik via Prometheus ─────────────────────────────
const INTERNAL = /@internal$|^prometheus|^api$|^dashboard$|^noop$/;

export function useTraffic(opts: { enabled: boolean; demo: boolean; promUrl: string; windowMs: number }) {
  const { enabled, demo, promUrl, windowMs } = opts;
  const [series, setSeries] = useState<Series[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const run = async () => {
      if (demo) {
        const now = Date.now(), step = 15000, n = Math.floor(windowMs / step);
        const mk = (name: string, color: string, base: number, amp: number, ph: number): Series => ({
          name, color, points: Array.from({ length: n }, (_, i) => {
            const t = now - (n - i) * step;
            return { t, v: Math.max(0, base + amp * Math.sin(t / 60000 + ph) + rand(-amp / 4, amp / 4)) };
          }),
        });
        setSeries([mk('my-portfolio', PALETTE[0], 14, 8, 0), mk('api-service', PALETTE[1], 38, 20, 1.7)]);
        setError('');
        return;
      }
      try {
        const end = Math.floor(Date.now() / 1000), start = end - Math.floor(windowMs / 1000);
        const q = encodeURIComponent('sum by (service) (rate(traefik_service_requests_total[1m]))');
        const r = await fetch(`${promUrl}/api/v1/query_range?query=${q}&start=${start}&end=${end}&step=15`, { signal: AbortSignal.timeout(6000) });
        if (!r.ok) throw new Error(`Prometheus returned HTTP ${r.status}`);
        const d = await r.json();
        const res: any[] = d?.data?.result || [];
        const out: Series[] = res
          .map((x, i) => ({ name: String(x.metric?.service || 'unknown').replace(/@docker$/, ''), color: PALETTE[i % PALETTE.length],
            points: (x.values || []).map((v: [number, string]) => ({ t: v[0] * 1000, v: Number(v[1]) })).filter((p: any) => isFinite(p.v)) }))
          .filter(s => !INTERNAL.test(s.name) && s.points.length);
        if (alive) { setSeries(out); setError(''); }
      } catch (e: any) {
        if (alive) { setSeries([]); setError(e.message); }
      }
    };
    run();
    const t = setInterval(run, 15000);
    return () => { alive = false; clearInterval(t); };
  }, [enabled, demo, promUrl, windowMs]);

  return { series, error };
}

export const fmtDuration = (ms: number) => {
  if (!isFinite(ms) || ms < 0) return '–';
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
};
