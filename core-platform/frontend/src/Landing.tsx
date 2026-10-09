import React from 'react';
import {
  Activity, Bot, Boxes, Database, GitBranch, HardDrive, Layers, LayoutDashboard, Lock, LogIn,
  Radar, RotateCcw, ScrollText, Server as ServerIcon, Shield, Sparkles, UserPlus, Wifi, Zap,
} from 'lucide-react';
import { Wordmark } from './components/Brand';
import { FALLBACK_APP_TYPES } from './lib/appTypes';
import { savedToken } from './lib/auth';

const REPO = 'https://github.com/talhasaleem1534-crypto/FYP-Testing';
const DOC = (f: string) => `${REPO}/blob/main/${f}`;

/**
 * The public front page (/). Everything a visitor needs to know before they sign in; the
 * product itself is behind /login (customers) and /admin (the platform owner).
 * Modelled on coolify.io, reduced to what OmniDeploy actually does: private servers only.
 */
export default function Landing() {
  // A returning customer gets "My apps" instead of "Sign in" (the token is checked for real on /login).
  const known = typeof window !== 'undefined' && !!savedToken('customer');

  return (
    <div className="land">
      <nav className="land-nav" aria-label="Main">
        <div className="wrap">
          <a href="/" aria-label="OmniDeploy home"><Wordmark size={30} mono /></a>
          <div className="links">
            <a href="#how">How it works</a>
            <a href="#why">Private servers</a>
            <a href="#features">Features</a>
            <a href="#types">App types</a>
            <a href={DOC('README.md')} target="_blank" rel="noreferrer">Docs</a>
          </div>
          <div className="spacer" />
          <div className="actions">
            <a className="btn ghost sm" href="/admin">Admin</a>
            <a className="btn ghost sm" href="/login"><LogIn size={14} /> {known ? 'My apps' : 'Sign in'}</a>
            <a className="btn blue sm" href="/login?signup"><UserPlus size={14} /> Create account</a>
          </div>
        </div>
      </nav>

      {/* ── hero ── */}
      <header className="land-hero wrap">
        <span className="pill"><i /> Runs entirely on hardware you own. Nothing leaves your network.</span>
        <h1>Self-hosting for your <em>own servers.</em></h1>
        <p className="sub">
          A self-hosted alternative to Vercel, Heroku and Railway built for private servers: a VPS, a home lab,
          an office machine. Connect it over SSH, pick your app type, push to GitHub, and OmniDeploy builds, runs
          and routes it. An AI copilot explains what broke, and an anomaly detector warns before a container crashes.
        </p>
        <div className="cta">
          <a className="btn blue lg" href="/login?signup"><UserPlus size={16} /> Create account</a>
          <a className="btn ghost lg" href="/login"><LogIn size={16} /> Sign in</a>
        </div>
        <div className="facts">
          <span><b>{FALLBACK_APP_TYPES.length}</b> app types</span>
          <span><b>1</b> SSH key to trust</span>
          <span><b>0</b> cloud accounts</span>
          <span><b>~96%</b> of injected container faults caught</span>
        </div>

        <MockDashboard />
        <p className="caption"><b>Applications.</b> Every app with its type, status, port and server, and the live log of the last deployment.</p>
      </header>

      {/* ── how it works ── */}
      <section className="land-section wrap" id="how">
        <div className="eyebrow">How it works</div>
        <h2>Push your code. OmniDeploy does the rest.</h2>
        <p className="lead">Every push is cloned, built into a container and started on the private server you connected over SSH.</p>
        <div className="flow" aria-label="git push, then OmniDeploy, then your servers">
          <div className="box"><div className="t"><GitBranch size={15} style={{ verticalAlign: -2 }} /> git push</div><div className="s">GitHub webhook</div></div>
          <div className="dash" />
          <div className="box core"><div className="t">OmniDeploy</div><div className="s">clone · build · run · route</div></div>
          <div className="dash" />
          <div className="servers">
            {['home-lab', 'office-vm', 'raspberry-pi'].map((n, i) => (
              <div className="srv" key={n}><i /> {n}
                <span className="bars">{[4, 7, 5, 9, 6, 11, 8, 5, 10, 7].map((h, j) => <b key={j} style={{ height: ((h + i * 2) % 12) + 3 }} />)}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── why private servers ── */}
      <section className="land-section wrap" id="why">
        <div className="eyebrow">Private servers only</div>
        <h2>Why your own machine</h2>
        <p className="lead">OmniDeploy does not sell hosting and does not talk to any cloud provider. It only deploys to Linux machines you already control.</p>
        <div className="cards">
          <Card icon={<HardDrive size={16} />} title="No cloud bill" text="A student laptop, an old desktop or a cheap VPS is enough. There is no per-app fee and nothing to upgrade." />
          <Card icon={<Lock size={16} />} title="Your data stays in your building" text="Source code, containers, logs and accounts live on the platform laptop and your server. Passwords are stored as scrypt hashes, never in clear." />
          <Card icon={<Wifi size={16} />} title="Works on a LAN" text="Three devices are enough: the platform laptop, the Linux server, and the customer's browser. Internet is only needed to pull from GitHub." />
        </div>
      </section>

      {/* ── features ── */}
      <section className="land-section wrap" id="features">
        <div className="eyebrow">Features</div>
        <h2>Everything you need to ship</h2>
        <p className="lead">One dashboard for your servers, applications, logs and container health.</p>
        <div className="cards">
          <div className="card wide">
            <div className="ic"><Bot size={16} /></div>
            <div>
              <h3>AI Ops Copilot</h3>
              <p>Ask in plain English and get the answer in plain English. A pattern catalog answers the common failures instantly at no cost (port already in use, 502 Bad Gateway, missing Dockerfile); harder questions and commands such as "scale my-shop to 2 replicas" go to a Claude tool-calling agent.</p>
            </div>
            <code>"Why is my app crashing with 502 Bad Gateway?"</code>
          </div>
          <div className="card wide">
            <div className="ic"><Radar size={16} /></div>
            <div>
              <h3>Catches trouble before the crash</h3>
              <p>An Isolation Forest trained on container telemetry (CPU, memory, restarts, network) scores every running container and flags the slow degradation fixed thresholds miss: memory creeping up while restarts climb. Combined with hard limits it catches about 96% of injected faults with under 1% false alarms.</p>
              <div className="tags"><span className="tag ok">HEALTHY</span><span className="tag warn">DEGRADING</span><span className="tag bad">ANOMALOUS</span></div>
            </div>
            <code>python -m anomaly.evaluate</code>
          </div>

          <Card icon={<Layers size={16} />} title="Any app type" text="Flask, FastAPI, Django, Node.js, Next.js, React/Vue/Vite, static HTML, Go, your own Dockerfile, or let it detect the type. Each one knows its files, port and start command." />
          <Card icon={<ServerIcon size={16} />} title="Any private server" text="A VPS, a home lab, an office VM or a Raspberry Pi. Add it with one command that trusts the platform's SSH key; Connect & check verifies SSH, Docker, git and the apps folder." />
          <Card icon={<GitBranch size={16} />} title="Push to deploy" text="A GitHub webhook (signature-checked) redeploys the exact repository and branch you registered. Nothing else triggers a build." />
          <Card icon={<Boxes size={16} />} title="Generated Dockerfiles" text="No Dockerfile? One is written for your app type, and the deploy log shows what was checked and generated. Have one? It is used as is." />
          <Card icon={<ScrollText size={16} />} title="Readable build logs" text="Pipeline steps, folded sections, error and warning filters, search, copy and download, and a big Open App button with your URL. Every past deployment keeps its log." />
          <Card icon={<RotateCcw size={16} />} title="Automatic rollback" text="The previous container is kept while the new one starts. If the health check fails, the old version comes back and the failed deploy is explained." />
          <Card icon={<Zap size={16} />} title="Replicas and routing" text="Scale an app to several replicas; Traefik discovers the containers and load-balances between them. Ports are assigned automatically and freed when an app is deleted, together with its containers, images and source." />
          <Card icon={<Activity size={16} />} title="Live dashboard" text="Requests per second (Traefik via Prometheus), CPU, memory, network and the anomaly score per container, plus deployment analytics per day." />
          <Card icon={<Shield size={16} />} title="Customer isolation" text="Every customer only sees their own apps, servers and logs. Every backend route needs a signed-in session." />
          <Card icon={<LayoutDashboard size={16} />} title="Admin site" text="The platform owner sees every customer, every app with its owner, every server, and exactly which files on the laptop hold the data." />
          <Card icon={<Database size={16} />} title="State survives restarts" text="Apps, servers, accounts and deployment history are saved as JSON on the platform laptop and restored on start." />
          <Card icon={<Sparkles size={16} />} title="Demo mode" text="Try the whole dashboard with simulated servers, deployments and telemetry before connecting a real machine." />
        </div>
      </section>

      {/* ── app types ── */}
      <section className="land-section wrap" id="types">
        <div className="eyebrow">What type of app is this?</div>
        <h2>Pick the type, the rest is set up for you</h2>
        <p className="lead">The first question a new application asks. Each answer brings its required files, default port, start command and Dockerfile recipe.</p>
        <div className="types">
          {FALLBACK_APP_TYPES.map(t => <span key={t.id}>{t.label}</span>)}
        </div>
      </section>

      {/* ── final call ── */}
      <section className="land-cta">
        <div className="wrap">
          <h2>Your server. Your apps. <em>No cloud bill.</em></h2>
          <p>Create a customer account, connect a server, and put your first app online.</p>
          <div className="cta" style={{ display: 'flex', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
            <a className="btn blue lg" href="/login?signup"><UserPlus size={16} /> Create account</a>
            <a className="btn ghost lg" href="/login">Sign in</a>
          </div>
        </div>
      </section>

      <footer className="land-foot wrap">
        <div className="cols">
          <div>
            <Wordmark size={30} mono />
            <p className="tag-line">Self-hosted platform to deploy apps from GitHub to your own private servers, with an AI copilot and container anomaly detection.</p>
          </div>
          <div>
            <h4>Product</h4>
            <ul>
              <li><a href="/login">Customer sign-in</a></li>
              <li><a href="/login?signup">Create account</a></li>
              <li><a href="/admin">Admin site</a></li>
              <li><a href="/admin">Demo mode</a></li>
            </ul>
          </div>
          <div>
            <h4>Docs</h4>
            <ul>
              <li><a href={DOC('README.md')} target="_blank" rel="noreferrer">README</a></li>
              <li><a href={DOC('docs/MULTI_DEVICE_SETUP.md')} target="_blank" rel="noreferrer">Three-device setup</a></li>
              <li><a href={DOC('docs/COOLIFY_HOW_IT_WORKS.md')} target="_blank" rel="noreferrer">How it compares to Coolify</a></li>
              <li><a href={DOC('docs/architecture.md')} target="_blank" rel="noreferrer">Architecture</a></li>
            </ul>
          </div>
          <div>
            <h4>Project</h4>
            <ul>
              <li><a href={REPO} target="_blank" rel="noreferrer">GitHub repository</a></li>
              <li>Salman: platform &amp; DevOps</li>
              <li>Talha: AI &amp; machine learning</li>
              <li>Inspired by <a href="https://coolify.io" target="_blank" rel="noreferrer">Coolify</a></li>
            </ul>
          </div>
        </div>
        <div className="legal">
          <span>© 2026 OmniDeploy. Final year project. Source code on GitHub.</span>
          <span>Version 7 · self-hosted · private servers only</span>
        </div>
      </footer>
    </div>
  );
}

function Card({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="card">
      <div className="ic">{icon}</div>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

/** A drawn (not photographed) picture of the Applications page, so it stays crisp and on-theme. */
function MockDashboard() {
  const rows = [
    { name: 'my-portfolio', type: 'Next.js', status: 'running', port: 4001, server: 'home-lab', when: '2 min ago' },
    { name: 'shop-api', type: 'FastAPI', status: 'building', port: 4002, server: 'home-lab', when: 'now' },
    { name: 'thesis-site', type: 'Static HTML', status: 'running', port: 4003, server: 'office-vm', when: 'yesterday' },
    { name: 'inventory', type: 'Django', status: 'failed', port: 4004, server: 'raspberry-pi', when: '3 days ago' },
  ];
  return (
    <div className="shot" aria-hidden="true">
      <div className="side">
        <div className="grp">Workspace</div>
        <div className="it on"><Boxes size={13} /> Applications</div>
        <div className="it"><ServerIcon size={13} /> Private servers</div>
        <div className="it"><ScrollText size={13} /> Deployments</div>
        <div className="grp">AI Ops</div>
        <div className="it"><Bot size={13} /> Copilot</div>
        <div className="it"><Radar size={13} /> Health monitor</div>
        <div className="it"><Activity size={13} /> Dashboard</div>
      </div>
      <div className="main">
        <div className="head">
          <div><h3>Applications</h3><p>4 apps on 3 private servers</p></div>
          <span className="btn blue sm" style={{ pointerEvents: 'none' }}>+ New application</span>
        </div>
        <table>
          <thead><tr><th>Application</th><th>Type</th><th>Status</th><th>Port</th><th>Server</th><th>Last deploy</th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.name}>
                <td><b>{r.name}</b></td><td>{r.type}</td>
                <td><span className={`badge badge-${r.status}`}>{r.status}</span></td>
                <td className="mono">:{r.port}</td><td className="mono">{r.server}</td><td>{r.when}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="log">
          <div><span className="dim">[21:14:02]</span> STEP 3/4 Building image for <b>shop-api</b> (FastAPI)</div>
          <div><span className="dim">[21:14:40]</span> STEP 4/4 Health check on :4002 <span className="ok">passed</span></div>
          <div><span className="dim">[21:14:41]</span> <span className="ok">✓ Deployed.</span> APP URL <span className="url">http://192.168.1.20:4002</span></div>
        </div>
      </div>
    </div>
  );
}
