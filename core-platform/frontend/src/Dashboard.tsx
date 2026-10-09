import { useMemo, useState } from 'react';
import { Activity, Pause, Play, Trash2, Boxes, Rocket, Timer, Network, Gauge, Layers } from 'lucide-react';
import { BarDatum, ChartCard, Donut, HBars, Kpi, LineChart, NoData, Sparkline, StackedBars } from './components/Charts';
import { Sample, fmtDuration, seriesFor, totalSeries } from './lib/telemetry';
import type { Series } from './components/Charts';

export interface DeploymentRec {
  id: string; app_name: string; status: string; commit_sha?: string;
  created_at: string; finished_at?: string; app_url?: string; domain_url?: string; host_port?: number;
}
interface AppLite { id: string; name: string; status: string; replicas: number }

const WINDOWS = [{ label: '5 min', ms: 5 * 60e3 }, { label: '15 min', ms: 15 * 60e3 }, { label: '1 hour', ms: 60 * 60e3 }];
const STATUS_COLOR: Record<string, string> = { HEALTHY: '#34d399', DEGRADING: '#fbbf24', ANOMALOUS: '#fb7185' };

export default function Dashboard(p: {
  apps: AppLite[]; deployments: DeploymentRec[]; history: Sample[]; telemetryError: string; telemetryLoading: boolean;
  paused: boolean; onPause: (v: boolean) => void; onClearHistory: () => void;
  traffic: Series[]; trafficError: string; windowMs: number; onWindow: (ms: number) => void;
  demo: boolean; aiOk: boolean; promUrl: string;
}) {
  const { apps, deployments, history, windowMs } = p;
  const [showAllDays, setShowAllDays] = useState(false);

  const latest = history[history.length - 1];
  const containers = latest ? Object.entries(latest.c) : [];
  const counts = { HEALTHY: 0, DEGRADING: 0, ANOMALOUS: 0 } as Record<string, number>;
  containers.forEach(([, c]) => { counts[c.status] = (counts[c.status] || 0) + 1; });

  // ── deployment analytics ────────────────────────────────────────────────────
  const dep = useMemo(() => {
    const done = deployments.filter(d => d.status === 'success' || d.status === 'failed');
    const ok = done.filter(d => d.status === 'success');
    const durations = ok.filter(d => d.finished_at).map(d => ({ d, ms: new Date(d.finished_at!).getTime() - new Date(d.created_at).getTime() }));
    const avg = durations.length ? durations.reduce((a, x) => a + x.ms, 0) / durations.length : NaN;
    const days = showAllDays ? 30 : 14;
    const buckets: BarDatum[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const day = new Date(); day.setHours(0, 0, 0, 0); day.setDate(day.getDate() - i);
      const next = new Date(day); next.setDate(next.getDate() + 1);
      const inDay = done.filter(d => { const t = new Date(d.created_at).getTime(); return t >= day.getTime() && t < next.getTime(); });
      buckets.push({ label: `${day.getDate()}/${day.getMonth() + 1}`, values: { success: inDay.filter(d => d.status === 'success').length, failed: inDay.filter(d => d.status === 'failed').length } });
    }
    return {
      total: deployments.length, ok: ok.length, failed: done.length - ok.length,
      rate: done.length ? Math.round((ok.length / done.length) * 100) : null, avg, buckets,
      recent: durations.slice(0, 8).map(x => ({ label: `${x.d.app_name} ${x.d.commit_sha ? '· ' + x.d.commit_sha.slice(0, 7) : ''}`, value: x.ms / 1000, note: fmtDuration(x.ms) })),
    };
  }, [deployments, showAllDays]);

  // ── series ──────────────────────────────────────────────────────────────────
  const cpu = useMemo(() => seriesFor(history, c => c.cpu, windowMs), [history, windowMs]);
  const mem = useMemo(() => seriesFor(history, c => c.mem, windowMs), [history, windowMs]);
  const score = useMemo(() => seriesFor(history, c => c.score, windowMs), [history, windowMs]);
  const net = useMemo(() => [
    totalSeries(history, 'Inbound', '#00f2fe', c => c.netIn, windowMs),
    totalSeries(history, 'Outbound', '#a78bfa', c => c.netOut, windowMs),
  ], [history, windowMs]);
  const reqNow = p.traffic.length ? p.traffic.reduce((a, s) => a + (s.points[s.points.length - 1]?.v || 0), 0) : null;

  const running = apps.filter(a => a.status === 'running').length;
  const replicas = apps.filter(a => a.status === 'running').reduce((a, x) => a + x.replicas, 0);
  const noContainers = !latest || containers.length === 0;
  const waiting = p.telemetryError
    ? <>{p.telemetryError}<br />Start the AI engine and Docker, or turn on Demo Mode.</>
    : p.telemetryLoading ? 'Collecting the first samples… (the first scan takes a few seconds)' : 'No running containers found.';

  const hdr = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {WINDOWS.map(w => (
        <button key={w.ms} onClick={() => p.onWindow(w.ms)} style={{
          padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
          background: windowMs === w.ms ? 'rgba(0,242,254,0.15)' : 'rgba(255,255,255,0.05)', color: windowMs === w.ms ? '#00f2fe' : 'var(--text-secondary)',
          border: `1px solid ${windowMs === w.ms ? 'rgba(0,242,254,0.4)' : 'var(--glass-border)'}` }}>{w.label}</button>
      ))}
      <button onClick={() => p.onPause(!p.paused)} title={p.paused ? 'Resume live updates' : 'Pause live updates'}
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer', background: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)', border: '1px solid var(--glass-border)' }}>
        {p.paused ? <><Play size={12} /> Resume</> : <><Pause size={12} /> Pause</>}
      </button>
      <button onClick={p.onClearHistory} title="Clear collected samples"
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 8, fontSize: 12, cursor: 'pointer', background: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)', border: '1px solid var(--glass-border)' }}>
        <Trash2 size={12} />
      </button>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: p.paused ? '#fbbf24' : '#34d399' }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'currentColor', animation: p.paused ? undefined : 'pulse 2s infinite' }} />{p.paused ? 'Paused' : 'Live'}
      </span>
    </div>
  );

  return (
    <div className="animate-slide-up">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 24, fontWeight: 700 }}>Dashboard</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginTop: 5 }}>
            Live traffic, resource usage, anomaly scores and deployment history{p.demo ? ' — simulated data (Demo Mode)' : ''}.
          </p>
        </div>
        {hdr}
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14, marginBottom: 18 }}>
        <Kpi label="Applications" icon={<Layers size={15} />} value={`${running}/${apps.length}`} sub={`running · ${replicas} replica${replicas === 1 ? '' : 's'}`} color="#34d399" />
        <Kpi label="Deployments" icon={<Rocket size={15} />} value={dep.total} sub={dep.rate === null ? 'none finished yet' : `${dep.rate}% succeeded · ${dep.failed} failed`} />
        <Kpi label="Avg deploy time" icon={<Timer size={15} />} value={fmtDuration(dep.avg)} sub="successful deployments" />
        <Kpi label="Containers" icon={<Boxes size={15} />} value={containers.length}
          sub={`${counts.HEALTHY} healthy · ${counts.DEGRADING} degrading · ${counts.ANOMALOUS} anomalous`} color={counts.ANOMALOUS ? '#fb7185' : counts.DEGRADING ? '#fbbf24' : '#f8fafc'} />
        <Kpi label="Requests / sec" icon={<Network size={15} />} value={reqNow === null ? '–' : reqNow.toFixed(1)} sub={p.trafficError ? 'Prometheus not reachable' : 'via Traefik'} />
        <Kpi label="Anomaly alerts" icon={<Gauge size={15} />} value={counts.ANOMALOUS} sub="right now" color={counts.ANOMALOUS ? '#fb7185' : '#34d399'} />
      </div>

      {/* Traffic */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 16, marginBottom: 16 }}>
        <ChartCard title="HTTP requests / second" subtitle="Per application, measured by Traefik (needs the Traefik + Prometheus stack)">
          {p.trafficError ? (
            <NoData>Could not read request rates from Prometheus at <code>{p.promUrl}</code>.<br />
              Start the stack with <code>cd devops && docker compose up -d</code> and open a deployed app a few times.<br />
              <span style={{ opacity: 0.7 }}>({p.trafficError})</span></NoData>
          ) : <LineChart series={p.traffic} unit=" req/s" windowMs={windowMs} area={p.traffic.length === 1}
            emptyText="No requests seen yet — open one of your deployed apps through its domain." />}
        </ChartCard>
        <ChartCard title="Network throughput" subtitle="KB/s, summed over all running containers">
          {noContainers ? <NoData>{waiting}</NoData> : <LineChart series={net} unit=" KB/s" area windowMs={windowMs} />}
        </ChartCard>
      </div>

      {/* Resources */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 16, marginBottom: 16 }}>
        <ChartCard title="CPU usage" subtitle="% of one core, per container · dashed line = hard alert limit">
          {noContainers ? <NoData>{waiting}</NoData> : <LineChart series={cpu} unit="%" yMax={100} windowMs={windowMs} thresholds={[{ value: 85, label: 'alert 85%', color: '#fb7185' }]} />}
        </ChartCard>
        <ChartCard title="Memory usage" subtitle="% of the memory limit, per container">
          {noContainers ? <NoData>{waiting}</NoData> : <LineChart series={mem} unit="%" yMax={100} windowMs={windowMs} thresholds={[{ value: 82, label: 'alert 82%', color: '#fb7185' }]} />}
        </ChartCard>
      </div>

      {/* Anomaly */}
      <ChartCard title="Anomaly score (Isolation Forest)" subtitle="Lower = more unusual. Below the red line a container is flagged ANOMALOUS; between the lines it is DEGRADING."
        right={<span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-muted)' }}><Activity size={13} />ML</span>}>
        {noContainers || score.length === 0 ? <NoData>{waiting}</NoData> : (
          <LineChart series={score} height={190} yMin={-0.9} yMax={-0.25} decimals={3} windowMs={windowMs}
            thresholds={[
              ...(latest?.threshold != null ? [{ value: latest.threshold, label: 'anomalous', color: '#fb7185' }] : []),
              ...(latest?.degrading != null ? [{ value: latest.degrading, label: 'degrading', color: '#fbbf24' }] : []),
            ]} />
        )}
      </ChartCard>

      {/* Deployments */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, margin: '16px 0' }}>
        <ChartCard title={`Deployments per day (last ${showAllDays ? 30 : 14})`}
          right={<button onClick={() => setShowAllDays(v => !v)} style={{ fontSize: 11, color: 'var(--accent-cyan)', background: 'none', cursor: 'pointer' }}>{showAllDays ? 'show 14 days' : 'show 30 days'}</button>}>
          <StackedBars data={dep.buckets} colors={{ success: '#34d399', failed: '#fb7185' }} emptyText="No deployments yet — deploy an app to see history here." />
        </ChartCard>
        <ChartCard title="Outcomes">
          <Donut parts={[{ label: 'Succeeded', value: dep.ok, color: '#34d399' }, { label: 'Failed', value: dep.failed, color: '#fb7185' }]} center={dep.rate === null ? '–' : `${dep.rate}%`} />
        </ChartCard>
        <ChartCard title="Recent deploy durations" subtitle="Newest first">
          <HBars rows={dep.recent} emptyText="No successful deployments yet" />
        </ChartCard>
      </div>

      {/* Container table */}
      <ChartCard title="Containers right now" subtitle="Latest sample with a short CPU trend">
        {noContainers ? <NoData height={100}>{waiting}</NoData> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr style={{ color: 'var(--text-muted)', textAlign: 'left' }}>
                {['Container', 'Status', 'CPU', 'Memory', 'Net in / out (KB/s)', 'Restarts', 'Score', 'CPU trend'].map(h => <th key={h} style={{ padding: '6px 10px', fontWeight: 500, borderBottom: '1px solid var(--glass-border)' }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {containers.sort(([a], [b]) => a.localeCompare(b)).map(([name, c]) => (
                  <tr key={name} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <td style={{ padding: '7px 10px', fontWeight: 600 }}>{name}</td>
                    <td style={{ padding: '7px 10px' }}><span style={{ color: STATUS_COLOR[c.status] || '#94a3b8', fontWeight: 700 }}>● {c.status}</span></td>
                    <td style={{ padding: '7px 10px' }}>{c.cpu.toFixed(1)}%</td>
                    <td style={{ padding: '7px 10px' }}>{c.mem.toFixed(1)}%</td>
                    <td style={{ padding: '7px 10px' }}>{c.netIn.toFixed(0)} / {c.netOut.toFixed(0)}</td>
                    <td style={{ padding: '7px 10px' }}>{c.restarts}</td>
                    <td style={{ padding: '7px 10px', fontFamily: 'var(--font-mono)' }}>{c.score != null ? c.score.toFixed(4) : 'n/a'}</td>
                    <td style={{ padding: '7px 10px' }}><Sparkline values={history.slice(-30).map(s => s.c[name]?.cpu).filter((v): v is number => v !== undefined)} color={STATUS_COLOR[c.status]} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ChartCard>
    </div>
  );
}
