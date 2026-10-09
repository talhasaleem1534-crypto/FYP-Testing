import { useMemo, useState } from 'react';
import { Activity, Pause, Play, Trash2, Boxes, Rocket, Timer, Network, Gauge, Layers } from 'lucide-react';
import {
  BarDatum, CHART_AMBER, CHART_BLUE, CHART_GREEN, CHART_GREY, CHART_RED, ChartCard, Donut, HBars, Kpi, LineChart, NoData, Sparkline, StackedBars,
} from './components/Charts';
import { Help, PageHead } from './components/ui';
import { Sample, fmtDuration, seriesFor, totalSeries } from './lib/telemetry';
import type { Series } from './components/Charts';

export interface DeploymentRec {
  id: string; app_name: string; status: string; commit_sha?: string;
  created_at: string; finished_at?: string; app_url?: string; domain_url?: string; host_port?: number;
}
interface AppLite { id: string; name: string; status: string; replicas: number }

const WINDOWS = [{ label: '5 min', ms: 5 * 60e3 }, { label: '15 min', ms: 15 * 60e3 }, { label: '1 hour', ms: 60 * 60e3 }];
/** Container health -> badge class and sparkline colour. */
const STATUS_BADGE: Record<string, string> = { HEALTHY: 'badge-success', DEGRADING: 'badge-pending', ANOMALOUS: 'badge-failed' };
const STATUS_COLOR: Record<string, string> = { HEALTHY: CHART_GREEN, DEGRADING: CHART_AMBER, ANOMALOUS: CHART_RED };

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
    totalSeries(history, 'Inbound', CHART_BLUE, c => c.netIn, windowMs),
    totalSeries(history, 'Outbound', CHART_GREY, c => c.netOut, windowMs),
  ], [history, windowMs]);
  const reqNow = p.traffic.length ? p.traffic.reduce((a, s) => a + (s.points[s.points.length - 1]?.v || 0), 0) : null;

  const running = apps.filter(a => a.status === 'running').length;
  const replicas = apps.filter(a => a.status === 'running').reduce((a, x) => a + x.replicas, 0);
  const noContainers = !latest || containers.length === 0;
  const waiting = p.telemetryError
    ? <>{p.telemetryError}<br />Start the AI engine and Docker, or turn on Demo Mode.</>
    : p.telemetryLoading ? 'Collecting the first samples… (the first scan takes a few seconds)' : 'No running containers found.';

  const hdr = (
    <>
      {WINDOWS.map(w => (
        <button key={w.ms} type="button" className={`btn sm ${windowMs === w.ms ? 'blue' : 'ghost'}`} aria-pressed={windowMs === w.ms} onClick={() => p.onWindow(w.ms)}>{w.label}</button>
      ))}
      <button type="button" className="btn ghost sm" onClick={() => p.onPause(!p.paused)} title={p.paused ? 'Resume live updates' : 'Pause live updates'}>
        {p.paused ? <><Play size={13} /> Resume</> : <><Pause size={13} /> Pause</>}
      </button>
      <button type="button" className="btn subtle sm icon" onClick={p.onClearHistory} title="Clear collected samples" aria-label="Clear collected samples">
        <Trash2 size={13} />
      </button>
      <span className="hint" style={{ display: 'inline-flex', alignItems: 'center', marginTop: 0, alignSelf: 'center' }}>
        <span className={`status-dot ${p.paused ? '' : 'on'}`} />{p.paused ? 'Paused' : 'Live'}
      </span>
    </>
  );

  return (
    <div className="animate-slide-up">
      <PageHead title="Dashboard" actions={hdr}
        text={<>Live traffic, resource usage, anomaly scores and deployment history{p.demo ? ' — simulated data (Demo Mode)' : ''}.</>} />

      <Help id="admin-dashboard" title="What am I looking at?"
        steps={[
          <>The <strong>AI engine</strong> reads every running container every 5 seconds and sends the CPU, memory, network and anomaly numbers here.</>,
          <>Requests per second come from <strong>Prometheus</strong>, which counts what the Traefik router sees. Without that stack the request chart stays empty.</>,
          <>In <strong>Demo Mode</strong> every number is simulated so you can explore the page without servers.</>,
        ]}
        next={<>When a container turns <strong>DEGRADING</strong>, keep an eye on it: its numbers are drifting away from normal. When it turns <strong>ANOMALOUS</strong>, open its log in Applications, ask the Copilot, and restart or redeploy the app if it stays red.</>}>
        Each chart is about the apps running on your servers. <strong>HTTP requests / second</strong> is how many visits the router sees for each app.
        {' '}<strong>CPU</strong> and <strong>Memory</strong> show how hard each container is working, as a percent.
        {' '}<strong>Network in / out</strong> is the data the containers receive and send.
        {' '}The <strong>anomaly score</strong> is the AI engine's opinion of how normal a container looks: lower is more unusual, and the dashed line is the limit.
      </Help>

      {/* KPIs */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', marginBottom: 16 }}>
        <Kpi label="Applications" icon={<Layers size={13} />} value={`${running}/${apps.length}`} sub={`running · ${replicas} replica${replicas === 1 ? '' : 's'}`} />
        <Kpi label="Deployments" icon={<Rocket size={13} />} value={dep.total} sub={dep.rate === null ? 'none finished yet' : `${dep.rate}% succeeded · ${dep.failed} failed`} />
        <Kpi label="Avg deploy time" icon={<Timer size={13} />} value={fmtDuration(dep.avg)} sub="successful deployments" />
        <Kpi label="Containers" icon={<Boxes size={13} />} value={containers.length}
          sub={`${counts.HEALTHY} healthy · ${counts.DEGRADING} degrading · ${counts.ANOMALOUS} anomalous`}
          color={counts.ANOMALOUS ? 'var(--danger)' : counts.DEGRADING ? 'var(--warn)' : 'var(--text-primary)'} />
        <Kpi label="Requests / sec" icon={<Network size={13} />} value={reqNow === null ? '–' : reqNow.toFixed(1)} sub={p.trafficError ? 'Prometheus not reachable' : 'via Traefik'} />
        <Kpi label="Anomaly alerts" icon={<Gauge size={13} />} value={counts.ANOMALOUS} sub="right now" color={counts.ANOMALOUS ? 'var(--danger)' : 'var(--ok)'} />
      </div>

      {/* Traffic */}
      <div className="grid two" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', marginBottom: 14 }}>
        <ChartCard title="HTTP requests / second" subtitle="Higher is busier. One line per app, counted by the Traefik router (needs the Traefik + Prometheus stack).">
          {p.trafficError ? (
            <NoData>Could not read request rates from Prometheus at <code>{p.promUrl}</code>.<br />
              Start the stack with <code>cd devops && docker compose up -d</code> and open a deployed app a few times.<br />
              <span style={{ opacity: 0.7 }}>({p.trafficError})</span></NoData>
          ) : <LineChart series={p.traffic} unit=" req/s" windowMs={windowMs} area={p.traffic.length === 1}
            emptyText="No requests seen yet — open one of your deployed apps through its domain." />}
        </ChartCard>
        <ChartCard title="Network in / out" subtitle="KB per second, all running containers added together. Inbound = received, outbound = sent.">
          {noContainers ? <NoData>{waiting}</NoData> : <LineChart series={net} unit=" KB/s" area windowMs={windowMs} />}
        </ChartCard>
      </div>

      {/* Resources */}
      <div className="grid two" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', marginBottom: 14 }}>
        <ChartCard title="CPU usage" subtitle="Higher is busier. % of one core, per container. Dashed line = alert limit.">
          {noContainers ? <NoData>{waiting}</NoData> : <LineChart series={cpu} unit="%" yMax={100} windowMs={windowMs} thresholds={[{ value: 85, label: 'alert 85%', color: 'var(--danger)' }]} />}
        </ChartCard>
        <ChartCard title="Memory usage" subtitle="Higher is fuller. % of the memory limit, per container. Dashed line = alert limit.">
          {noContainers ? <NoData>{waiting}</NoData> : <LineChart series={mem} unit="%" yMax={100} windowMs={windowMs} thresholds={[{ value: 82, label: 'alert 82%', color: 'var(--danger)' }]} />}
        </ChartCard>
      </div>

      {/* Anomaly */}
      <ChartCard title="Anomaly score" subtitle="Lower is more unusual; below the dashed line = anomaly. Between the two lines = degrading."
        right={<span className="chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Activity size={12} /> AI engine</span>}>
        {noContainers || score.length === 0 ? <NoData>{waiting}</NoData> : (
          <LineChart series={score} height={190} yMin={-0.9} yMax={-0.25} decimals={3} windowMs={windowMs}
            thresholds={[
              ...(latest?.threshold != null ? [{ value: latest.threshold, label: 'anomalous', color: 'var(--danger)' }] : []),
              ...(latest?.degrading != null ? [{ value: latest.degrading, label: 'degrading', color: 'var(--warn)' }] : []),
            ]} />
        )}
      </ChartCard>

      {/* Deployments */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', margin: '14px 0' }}>
        <ChartCard title={`Deployments per day (last ${showAllDays ? 30 : 14})`} subtitle="Green = succeeded, red = failed. Taller is more deploys that day."
          right={<button type="button" className="linkish" style={{ fontSize: 12, whiteSpace: 'nowrap' }} onClick={() => setShowAllDays(v => !v)}>{showAllDays ? 'show 14 days' : 'show 30 days'}</button>}>
          <StackedBars data={dep.buckets} colors={{ success: CHART_GREEN, failed: CHART_RED }} emptyText="No deployments yet — deploy an app to see history here." />
        </ChartCard>
        <ChartCard title="Outcomes" subtitle="Share of finished deployments that succeeded.">
          <Donut parts={[{ label: 'Succeeded', value: dep.ok, color: CHART_GREEN }, { label: 'Failed', value: dep.failed, color: CHART_RED }]} center={dep.rate === null ? '–' : `${dep.rate}%`} />
        </ChartCard>
        <ChartCard title="Recent deploy durations" subtitle="Newest first. Time from start until the app was online.">
          <HBars rows={dep.recent} emptyText="No successful deployments yet" />
        </ChartCard>
      </div>

      {/* Container table */}
      <ChartCard title="Containers right now" subtitle="The latest sample from every running container, with a short CPU trend.">
        {noContainers ? <NoData height={100}>{waiting}</NoData> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr>
                {['Container', 'Status', 'CPU', 'Memory', 'Net in / out (KB/s)', 'Restarts', 'Score', 'CPU trend'].map(h => <th key={h}>{h}</th>)}
              </tr></thead>
              <tbody>
                {containers.sort(([a], [b]) => a.localeCompare(b)).map(([name, c]) => (
                  <tr key={name}>
                    <td><b>{name}</b></td>
                    <td><span className={`badge ${STATUS_BADGE[c.status] || 'badge-idle'}`}>{c.status}</span></td>
                    <td>{c.cpu.toFixed(1)}%</td>
                    <td>{c.mem.toFixed(1)}%</td>
                    <td>{c.netIn.toFixed(0)} / {c.netOut.toFixed(0)}</td>
                    <td>{c.restarts}</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{c.score != null ? c.score.toFixed(4) : 'n/a'}</td>
                    <td><Sparkline values={history.slice(-30).map(s => s.c[name]?.cpu).filter((v): v is number => v !== undefined)} color={STATUS_COLOR[c.status]} /></td>
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
