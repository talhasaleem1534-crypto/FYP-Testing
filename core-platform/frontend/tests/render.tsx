// Server-side render smoke tests for the new UI pieces (no browser needed).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToString } from 'react-dom/server';
import './setup-window';

import DeployBanner from '../src/components/DeployBanner';
import LogViewer from '../src/components/LogViewer';
import { Donut, HBars, LineChart, StackedBars } from '../src/components/Charts';
import Dashboard from '../src/Dashboard';
import { seriesFor, totalSeries, Sample } from '../src/lib/telemetry';
import LoginPage from '../src/LoginPage';
import NewAppWizard from '../src/NewAppWizard';
import { FALLBACK_APP_TYPES, usesStartCommand } from '../src/lib/appTypes';
import CustomerPortal from '../src/CustomerPortal';
import AdminCustomers from '../src/AdminCustomers';
import AdminStorage from '../src/AdminStorage';
import ServerOnboarding from '../src/components/ServerOnboarding';
import ServerChecks from '../src/components/ServerChecks';
import ServerCard from '../src/components/ServerCard';
import { DEMO_KEY } from '../src/lib/servers';

const text = (html: string) => html.replace(/<!-- -->/g, '');   // React SSR separates adjacent text nodes with comments
const load = (n: string) => JSON.parse(readFileSync(resolve(process.cwd(), 'tests', 'fixtures', `${n}.json`), 'utf8'));
const ok = load('deploy_success'), bad = load('deploy_failed');
let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log('  ✓', name); };

const now = Date.now();
const history: Sample[] = Array.from({ length: 40 }, (_, i) => ({
  t: now - (40 - i) * 5000, threshold: -0.6453, degrading: -0.5849,
  c: {
    web: { cpu: 10 + i % 7, mem: 30, netIn: 100 + i, netOut: 50, restarts: 0, score: -0.4, status: 'HEALTHY' },
    api: { cpu: 20 + i, mem: 50 + i / 2, netIn: 300, netOut: 150, restarts: i > 35 ? 2 : 0, score: i > 35 ? -0.7 : -0.45, status: i > 35 ? 'ANOMALOUS' : 'HEALTHY' },
  },
}));

const deployments = [
  { id: 'd1', app_name: 'web', status: 'success', created_at: new Date(now - 3600e3).toISOString(), finished_at: new Date(now - 3500e3).toISOString(), commit_sha: 'abc1234' },
  { id: 'd2', app_name: 'api', status: 'failed', created_at: new Date(now - 86400e3).toISOString(), finished_at: new Date(now - 86300e3).toISOString() },
];
const props = (over: any = {}) => ({
  apps: [{ id: 'a', name: 'web', status: 'running', replicas: 2 }, { id: 'b', name: 'api', status: 'failed', replicas: 1 }],
  deployments, history, telemetryError: '', telemetryLoading: false, paused: false, onPause: () => {}, onClearHistory: () => {},
  traffic: [{ name: 'web', color: '#0ff', points: history.map((s, i) => ({ t: s.t, v: i % 9 })) }], trafficError: '',
  windowMs: 15 * 60e3, onWindow: () => {}, demo: false, aiOk: true, promUrl: 'http://x:9090', ...over,
});

test('Dashboard renders KPIs, charts and the container table', () => {
  const html = renderToString(<Dashboard {...props()} />);
  for (const needle of ['Dashboard', 'HTTP requests / second', 'CPU usage', 'Anomaly score', 'Deployments per day', 'Containers right now', '50%', 'api', 'web']) {
    assert.ok(html.includes(needle), `missing "${needle}"`);
  }
  assert.ok((html.match(/<path /g) || []).length >= 4, 'charts should draw paths');
});

test('Dashboard degrades gracefully: no data, errors, no deployments', () => {
  const html = renderToString(<Dashboard {...props({ history: [], deployments: [], traffic: [], trafficError: 'Failed to fetch', telemetryError: 'AI engine unreachable: x', apps: [] })} />);
  assert.ok(html.includes('AI engine unreachable'));
  assert.ok(html.includes('Could not read request rates'));
  assert.ok(html.includes('No deployments yet'));
});

test('charts survive edge cases (empty, one point, flat line, NaN-free)', () => {
  renderToString(<LineChart series={[]} />);
  renderToString(<LineChart series={[{ name: 'a', color: '#fff', points: [{ t: now, v: 5 }] }]} />);
  renderToString(<LineChart series={[{ name: 'a', color: '#fff', points: [{ t: now, v: 0 }, { t: now + 1000, v: 0 }] }]} area />);
  const svg = renderToString(<LineChart series={[{ name: 'a', color: '#fff', points: [{ t: now - 5000, v: 1 }, { t: now, v: 3 }] }]} />);
  assert.ok(!/NaN|Infinity/.test(svg), 'no NaN/Infinity in SVG attributes');
  renderToString(<StackedBars data={[]} colors={{ a: '#fff' }} />);
  renderToString(<HBars rows={[]} />);
  renderToString(<Donut parts={[{ label: 'a', value: 0, color: '#fff' }]} />);
});

test('series helpers respect the time window', () => {
  assert.equal(seriesFor(history, c => c.cpu, 60e3).length, 2);
  const inWindow = seriesFor(history, c => c.cpu, 60e3)[0].points.length;
  assert.ok(inWindow > 0 && inWindow <= 13, String(inWindow));
  const t = totalSeries(history, 'in', '#fff', c => c.netIn, 3600e3);
  assert.equal(t.points[0].v, history[0].c.web.netIn + history[0].c.api.netIn);
});

test('LogViewer: success log shows the highlighted APP URL row with an Open link', () => {
  const html = renderToString(<LogViewer lines={ok.logs} status="success" />);
  assert.ok(html.includes('APP URL'));
  assert.ok(html.includes('href="http://dash.example:4000"'), 'URL host should follow the browser host');
  assert.ok(html.includes('>Open<') || html.includes('Open</a>'));
  assert.ok(html.includes('Fetch code') && html.includes('Start &amp; verify'));
});

test('LogViewer: failed log shows error counts and no APP URL row', () => {
  const html = renderToString(<LogViewer lines={bad.logs} status="failed" />);
  assert.ok(!html.includes('APP URL'));
  assert.ok(/Errors<span[^>]*>[1-9]/.test(html), 'error pill should have a count');
});

test('LogViewer: empty and idle states', () => {
  assert.ok(renderToString(<LogViewer lines={[]} status="idle" />).includes('No log output yet'));
});

test('DeployBanner: success is a big clickable link; failure offers diagnosis; building shows progress', () => {
  const s = renderToString(<DeployBanner status="success" appName="blog" url="http://localhost:4000" domainUrl="http://blog.local" />);
  assert.ok(s.includes('href="http://localhost:4000"') && s.includes('Open App') && s.includes('Copy') && s.includes('blog.local'));
  const f = renderToString(<DeployBanner status="failed" appName="blog" errorText="boom" onDiagnose={() => {}} onJumpToError={() => {}} />);
  assert.ok(f.includes('Diagnose with Copilot') && f.includes('boom'));
  assert.ok(text(renderToString(<DeployBanner status="building" appName="blog" />)).includes('Deploying blog'));
  assert.equal(renderToString(<DeployBanner status="idle" appName="x" />), '');
});

test('LoginPage: punch line + form only, offline hint only when the platform is down, demo button only when offered', () => {
  const off = text(renderToString(<LoginPage backendOk={false} onLogin={() => {}} />));
  assert.ok(off.includes('Sign in') && off.includes('Create account'));
  assert.ok(off.includes('type="password"') && off.includes('Platform offline'));
  assert.ok(off.includes('No cloud bill'), 'punch line is shown');
  assert.ok(!off.includes('Pick your app type'), 'the how-it-works details are behind the login now');
  assert.ok(!off.includes('Confirm password'), 'sign-in form has no confirm field');
  assert.ok(!off.includes('Try the demo'), 'customer portal has no demo button');
  const on = text(renderToString(<LoginPage backendOk={true} onLogin={() => {}} onDemo={() => {}} />));
  assert.ok(!on.includes('Platform offline') && on.includes('Try the demo'));
});

test('LoginPage: create-account tab asks for name, password and confirm password', () => {
  const reg = text(renderToString(<LoginPage backendOk={true} onLogin={() => {}} initialMode="register" />));
  assert.ok(reg.includes('Your name') && reg.includes('Confirm password') && reg.includes('Create my account'));
  assert.equal((reg.match(/type="password"/g) || []).length, 2, 'two password fields');
  assert.ok(reg.includes('One account per email'));
});

test('LoginPage on /admin: account type locked to owner, no Create account tab, setup form only on the admin laptop', () => {
  const owner = text(renderToString(<LoginPage backendOk={true} onLogin={() => {}} portal="admin" lockPortal status={{ admin_exists: true, on_admin_laptop: true }} />));
  assert.ok(owner.includes('Owner sign-in') && !owner.includes('Create account') && !owner.includes('Platform owner?'));
  const setup = text(renderToString(<LoginPage backendOk={true} onLogin={() => {}} portal="admin" lockPortal status={{ admin_exists: false, on_admin_laptop: true }} />));
  assert.ok(setup.includes('Create the owner account') && setup.includes('Confirm password'));
  const remote = text(renderToString(<LoginPage backendOk={true} onLogin={() => {}} portal="admin" lockPortal status={{ admin_exists: false, on_admin_laptop: false }} />));
  assert.ok(remote.includes('only be created') && !remote.includes('Create owner account'));
});

test('NewAppWizard: step 1 lists every app type, grouped, with the files each one needs', () => {
  const html = text(renderToString(<NewAppWizard servers={[{ id: 's', name: 'lab', host: '1.2.3.4' }]} useBackend={false} onCreate={async () => {}} onCancel={() => {}} />));
  assert.ok(html.includes('What type of app is this?'));
  for (const t of FALLBACK_APP_TYPES) assert.ok(html.includes(`data-type="${t.id}"`), `missing card ${t.id}`);
  assert.ok(html.indexOf('>Python<') < html.indexOf('>JavaScript<'), 'Python group first');
  assert.ok(html.includes('needs requirements.txt') && html.includes('needs index.html'));
});

test('app types: ids unique, sensible ports, start command only where it applies', () => {
  const ids = FALLBACK_APP_TYPES.map(t => t.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(FALLBACK_APP_TYPES.every(t => t.default_port > 0 && t.default_port < 65536));
  assert.equal(FALLBACK_APP_TYPES.find(t => t.id === 'flask')!.default_port, 5000);
  assert.ok(usesStartCommand('flask') && usesStartCommand('django') && !usesStartCommand('static') && !usesStartCommand('dockerfile'));
});

test('CustomerPortal: shows the customer and their apps area, none of the admin pages', () => {
  const html = text(renderToString(<CustomerPortal customer={{ id: 'c1', name: 'Ayesha Khan', email: 'ayesha@example.com', role: 'customer' }} onLogout={() => {}} />));
  assert.ok(html.includes('Customer portal') && html.includes('Ayesha Khan') && html.includes('My applications') && html.includes('New application'));
  assert.ok(html.includes('Sign out'));
  for (const adminOnly of ['Private Servers', 'Data &amp; Storage', 'Health Monitor', 'Customers<']) assert.ok(!html.includes(adminOnly), `customer must not see ${adminOnly}`);
});

test('AdminCustomers (demo): accounts, roles, apps, and only a hash preview of passwords', () => {
  const html = text(renderToString(<AdminCustomers demo={true} />));
  assert.ok(html.includes('ayesha@example.com') && html.includes('bilal@example.com') && html.includes('hello-flask'));
  assert.ok(html.includes('scrypt') && html.includes('Passwords are never stored'));
  assert.ok(/hash [0-9a-f]{12}…/.test(html), 'only a 12-character hash preview');
});

test('AdminStorage (demo): data folder, every data file, code folder and the customer portal link', () => {
  const html = text(renderToString(<AdminStorage demo={true} />));
  for (const f of ['users.json', 'sessions.json', 'applications.json']) assert.ok(html.includes(f), f);
  assert.ok(html.includes('.paas-data') && html.includes('paas-apps') && html.includes('http://192.168.1.20:5173/'));
  assert.ok(html.includes('Passwords are NOT stored'));
});

test('ServerOnboarding: prepare commands, trust command with the platform key, connect form; share box only for the admin', () => {
  const admin = text(renderToString(<ServerOnboarding asAdmin demo onDone={() => {}} onCancel={() => {}} />));
  assert.ok(admin.includes('Prepare the Linux machine') && admin.includes('get.docker.com') && admin.includes('openssh-server'));
  assert.ok(admin.includes('authorized_keys') && admin.includes(DEMO_KEY.public_key));
  assert.ok(admin.includes('IP address') && admin.includes('SSH user') && admin.includes('Connect &amp; check'));
  assert.ok(admin.includes('Customers can deploy their apps to this server'));
  const customer = text(renderToString(<ServerOnboarding asAdmin={false} demo onDone={() => {}} onCancel={() => {}} />));
  assert.ok(!customer.includes('Customers can deploy their apps to this server'));
});

test('ServerChecks / ServerCard: failures show the fix command; customers get no admin buttons', () => {
  const checks = [
    { key: 'ssh', label: 'SSH connection', ok: true, detail: 'Logged in as ubuntu' },
    { key: 'docker', label: 'Docker', ok: false, detail: "User 'ubuntu' may not use Docker", fix: 'sudo usermod -aG docker ubuntu' },
  ];
  const html = text(renderToString(<ServerChecks checks={checks} />));
  assert.ok(html.includes('Logged in as ubuntu') && html.includes('sudo usermod -aG docker ubuntu') && html.includes('Fix - run on the server'));
  const srv = { id: 's', name: 'linux-laptop', host: '192.168.1.30', port: 22, ssh_user: 'ubuntu', status: 'unreachable', checks, shared: true };
  const adminCard = text(renderToString(<ServerCard server={srv} canManage canShare onVerify={() => {}} onShare={() => {}} onDelete={() => {}} />));
  assert.ok(adminCard.includes('ubuntu@192.168.1.30') && adminCard.includes('not ready') && adminCard.includes('Customers can deploy here') && adminCard.includes('Check again'));
  const customerCard = text(renderToString(<ServerCard server={{ ...srv, status: 'verified' }} note="Provided by DeployStack" canManage={false} canShare={false} />));
  assert.ok(customerCard.includes('Provided by DeployStack') && !customerCard.includes('Check again') && !customerCard.includes('Customers can deploy here'));
});

console.log(`\n${passed} render tests passed`);
