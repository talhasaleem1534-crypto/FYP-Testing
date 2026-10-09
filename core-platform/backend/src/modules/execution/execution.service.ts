import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ExecOptions, ExecResult, Host, LocalHost, SshHost } from './host';
import type { Server } from '../servers/server.interface';

export { ExecOptions, ExecResult } from './host';

export interface ContainerState {
  exists: boolean;
  status?: string;
  running?: boolean;
  restarting?: boolean;
  exitCode?: number;
}

export interface RunContainerOptions {
  containerName: string;
  imageTag: string;
  containerPort: number;
  /** Publish this host port. Omit for extra replicas (only Traefik needs to reach them). */
  hostPort?: number;
  envVars?: Record<string, string>;
  networkName?: string;
  labels?: string[];
  onLine?: (line: string) => void;
}

const SAFE_REPO_URL = /^(https?:\/\/|ssh:\/\/|git:\/\/|git@)[^\s'"`$;|&<>\\]+$/i;
const SAFE_BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function assertSafeRepoUrl(url: string): string {
  const trimmed = (url || '').trim();
  if (!SAFE_REPO_URL.test(trimmed)) {
    throw new BadRequestException(
      'repo_url must start with https://, ssh://, git:// or git@ and contain no spaces or shell characters',
    );
  }
  return trimmed;
}

export function assertSafeBranch(branch: string): string {
  const trimmed = (branch || '').trim();
  if (!SAFE_BRANCH.test(trimmed) || trimmed.includes('..')) {
    throw new BadRequestException('Invalid branch name');
  }
  return trimmed;
}

export function assertSafeEnvVars(env: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env || {})) {
    if (!ENV_NAME.test(k)) throw new BadRequestException(`Invalid environment variable name '${k}'`);
    if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') {
      throw new BadRequestException(`Environment variable '${k}' must be a string`);
    }
    out[k] = String(v);
  }
  return out;
}

/** Docker image tags allow [A-Za-z0-9_.-] and must not start with '.' or '-'. */
export function sanitizeTag(raw: string): string {
  const cleaned = (raw || '').replace(/[^A-Za-z0-9_.-]/g, '').replace(/^[.-]+/, '').slice(0, 60);
  return cleaned || 'latest';
}

/**
 * All git / docker / Dockerfile steps of a deployment, run on one Host
 * (this machine, or a Linux server over SSH - see host.ts).
 */
export class Runner {
  protected readonly logger = new Logger('Runner');

  constructor(readonly host: Host) {}

  exec(file: string, args: string[], opts: ExecOptions = {}): Promise<ExecResult> {
    return this.host.exec(file, args, opts);
  }

  // ── Docker daemon / network ────────────────────────────────────────────────

  /** True only if the Docker *daemon* answers (not merely that the CLI is installed). */
  async isDockerAvailable(): Promise<{ available: boolean; version?: string; error?: string }> {
    const r = await this.exec('docker', ['version', '--format', '{{.Server.Version}}'], { timeoutMs: 15_000 });
    if (r.code === 0 && r.stdout) return { available: true, version: `Docker ${r.stdout}` };
    return { available: false, error: r.stderr || 'Docker daemon not reachable' };
  }

  async ensureNetwork(name = 'paas-net'): Promise<void> {
    const inspect = await this.exec('docker', ['network', 'inspect', name], { timeoutMs: 15_000 });
    if (inspect.code === 0) return;
    const created = await this.exec('docker', ['network', 'create', name], { timeoutMs: 15_000 });
    if (created.code !== 0) this.logger.warn(`Could not create network ${name}: ${created.stderr}`);
  }

  // ── Git ────────────────────────────────────────────────────────────────────

  /**
   * Pick the branch to deploy: the requested one if it exists, otherwise the
   * remote's default branch, otherwise main/master.
   */
  async resolveBranch(repoUrl: string, preferred: string, onLine: (line: string) => void): Promise<string> {
    const url = assertSafeRepoUrl(repoUrl);
    const want = assertSafeBranch(preferred);

    const exact = await this.exec('git', ['ls-remote', '--heads', url, `refs/heads/${want}`], { timeoutMs: 60_000 });
    if (exact.code === 0 && exact.stdout.trim()) return want;

    const head = await this.exec('git', ['ls-remote', '--symref', url, 'HEAD'], { timeoutMs: 60_000 });
    const m = head.code === 0 ? head.stdout.match(/ref:\s+refs\/heads\/(\S+)\s+HEAD/) : null;
    if (m) {
      onLine(`⚠️  Branch '${want}' not found. Using the repository default: '${m[1]}'`);
      return m[1];
    }

    for (const candidate of ['main', 'master']) {
      const r = await this.exec('git', ['ls-remote', '--heads', url, `refs/heads/${candidate}`], { timeoutMs: 60_000 });
      if (r.code === 0 && r.stdout.trim()) {
        onLine(`⚠️  Branch '${want}' not found. Using '${candidate}' instead.`);
        return candidate;
      }
    }
    onLine(`⚠️  Could not reach the repository to verify branch '${want}'; trying it as-is.`);
    return want;
  }

  /**
   * Clone the repo, or update an existing checkout to the tip of the branch.
   * Returns the branch that was actually checked out, or null on failure.
   */
  async cloneOrPullRepo(
    repoUrl: string,
    branch: string,
    destDir: string,
    onLine: (line: string) => void,
  ): Promise<string | null> {
    const url = assertSafeRepoUrl(repoUrl);
    onLine(`🔍 Resolving branch for ${url}...`);
    const resolved = await this.resolveBranch(url, branch, onLine);

    const h = this.host;
    if (await h.exists(h.join(destDir, '.git'))) {
      onLine(`📥 Updating existing checkout to origin/${resolved}...`);
      const steps: string[][] = [
        ['remote', 'set-url', 'origin', url],
        ['fetch', '--depth', '1', 'origin', resolved],
        ['checkout', '-f', '-B', resolved, 'FETCH_HEAD'],
        // Remove files we generated last time (e.g. an auto-written Dockerfile) so they can't block checkout.
        ['clean', '-fd'],
      ];
      for (const args of steps) {
        const r = await this.exec('git', args, { cwd: destDir, onLine });
        if (r.code !== 0) {
          onLine(`ERROR: git ${args[0]} failed: ${r.stderr}`);
          return null;
        }
      }
      return resolved;
    }

    onLine(`📥 Cloning ${url} (branch: ${resolved})...`);
    await h.mkdirp(destDir);
    if ((await h.listDir(destDir)).length > 0) {
      onLine(`ERROR: ${destDir} exists, is not empty and is not a git checkout. Remove it and retry.`);
      return null;
    }
    const r = await this.exec('git', ['clone', '--branch', resolved, '--depth', '1', url, '.'], {
      cwd: destDir,
      onLine,
    });
    return r.code === 0 ? resolved : null;
  }

  async headSha(repoDir: string): Promise<string | null> {
    const r = await this.exec('git', ['rev-parse', '--short', 'HEAD'], { cwd: repoDir, timeoutMs: 15_000 });
    return r.code === 0 && r.stdout ? r.stdout : null;
  }

  // ── Docker image / containers ──────────────────────────────────────────────

  async buildDockerImage(
    imageTag: string,
    contextDir: string,
    onLine: (line: string) => void,
    dockerfile = 'Dockerfile',
  ): Promise<boolean> {
    onLine(`🔨 Building Docker image: ${imageTag}`);
    const args = ['build', '-t', imageTag];
    if (dockerfile !== 'Dockerfile') args.push('-f', dockerfile);
    const r = await this.exec('docker', [...args, '.'], {
      cwd: contextDir,
      onLine,
      timeoutMs: 30 * 60_000,
    });
    return r.code === 0;
  }

  async runDockerContainer(opts: RunContainerOptions): Promise<boolean> {
    const { containerName, imageTag, hostPort, containerPort, envVars = {}, networkName = 'paas-net', labels = [], onLine } = opts;

    const args = ['run', '-d', '--name', containerName, '--restart', 'unless-stopped', '--network', networkName];
    if (hostPort) args.push('-p', `${hostPort}:${containerPort}`);
    for (const l of labels) args.push('--label', l);
    for (const [k, v] of Object.entries(envVars)) args.push('-e', `${k}=${v}`);
    args.push(imageTag);

    onLine?.(`🚀 docker run ${containerName} (${imageTag})`);
    const r = await this.exec('docker', args, { timeoutMs: 120_000 });
    if (r.code !== 0) onLine?.(`ERROR: ${r.stderr}`);
    return r.code === 0;
  }

  async containerState(name: string): Promise<ContainerState> {
    const r = await this.exec(
      'docker',
      ['inspect', '--format', '{{.State.Status}}|{{.State.Running}}|{{.State.Restarting}}|{{.State.ExitCode}}', name],
      { timeoutMs: 15_000 },
    );
    if (r.code !== 0 || !r.stdout) return { exists: false };
    const [status, running, restarting, exitCode] = r.stdout.split('|');
    return {
      exists: true,
      status,
      running: running === 'true',
      restarting: restarting === 'true',
      exitCode: Number(exitCode),
    };
  }

  async stopContainer(name: string): Promise<void> {
    await this.exec('docker', ['stop', '-t', '10', name], { timeoutMs: 60_000 });
  }

  async startContainer(name: string): Promise<boolean> {
    return (await this.exec('docker', ['start', name], { timeoutMs: 60_000 })).code === 0;
  }

  async renameContainer(from: string, to: string): Promise<boolean> {
    return (await this.exec('docker', ['rename', from, to], { timeoutMs: 15_000 })).code === 0;
  }

  async removeContainer(name: string): Promise<void> {
    await this.exec('docker', ['rm', '-f', name], { timeoutMs: 60_000 });
  }

  async containerLogs(name: string, tail = 30): Promise<string> {
    const r = await this.exec('docker', ['logs', '--tail', String(tail), name], { timeoutMs: 15_000 });
    return [r.stdout, r.stderr].filter(Boolean).join('\n');
  }

  /**
   * Wait until the container has stayed up for `stableMs`. A container that starts and
   * crashes a second later must NOT be reported as a successful deployment.
   */
  async waitUntilHealthy(name: string, timeoutMs = 20_000, stableMs = 3_000): Promise<{ ok: boolean; reason?: string }> {
    const start = Date.now();
    let upSince: number | null = null;
    while (Date.now() - start < timeoutMs) {
      const s = await this.containerState(name);
      if (!s.exists) return { ok: false, reason: 'container disappeared' };
      if (s.running && !s.restarting) {
        upSince = upSince ?? Date.now();
        if (Date.now() - upSince >= stableMs) return { ok: true };
      } else {
        if (s.status === 'exited' || s.status === 'dead') {
          return { ok: false, reason: `container exited with code ${s.exitCode}` };
        }
        if (s.restarting) return { ok: false, reason: 'container is crash-looping' };
        upSince = null;
      }
      await new Promise(r => setTimeout(r, 500));
    }
    return upSince ? { ok: true } : { ok: false, reason: 'container did not start in time' };
  }

  /** Remove every image built for an app (paas-<app>:*). Returns how many were removed. */
  async removeAppImages(appName: string): Promise<number> {
    const list = await this.exec(
      'docker',
      ['images', '--format', '{{.Repository}}:{{.Tag}}', '--filter', `reference=paas-${appName}:*`],
      { timeoutMs: 30_000 },
    );
    if (list.code !== 0) return 0;
    let removed = 0;
    for (const ref of list.stdout.split(/\r?\n/).map(s => s.trim()).filter(r => r && !r.includes('<none>'))) {
      if ((await this.exec('docker', ['rmi', '-f', ref], { timeoutMs: 60_000 })).code === 0) removed++;
    }
    return removed;
  }

  /** Delete an app's checkout, but only if it really is <appsDir>/<appName>. */
  async removeCheckout(appsDir: string, appName: string): Promise<boolean> {
    const h = this.host;
    const target = h.join(appsDir, appName);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(appName) || h.dirname(target) !== h.join(appsDir)) {
      throw new BadRequestException('Refusing to delete a path outside the apps directory');
    }
    if (!(await h.exists(target))) return false;
    await h.removeTree(target);
    return true;
  }

  /** Names of all containers (running or not) that belong to an app. */
  async listAppContainers(appName: string): Promise<string[]> {
    const r = await this.exec(
      'docker',
      ['ps', '-a', '--filter', `label=paas.app=${appName}`, '--format', '{{.Names}}'],
      { timeoutMs: 15_000 },
    );
    return r.code === 0 ? r.stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean) : [];
  }

  // ── Dockerfile generation ──────────────────────────────────────────────────

  /** Auto-generate a Dockerfile if the repo doesn't have one. Returns what happened. */
  async generateDockerfileIfMissing(
    repoDir: string,
    containerPort: number,
    onLine: (line: string) => void,
  ): Promise<'existing' | 'generated-node' | 'generated-python' | 'generated-go' | 'none'> {
    const h = this.host;
    const at = (f: string) => h.join(repoDir, f);
    const dockerfilePath = at('Dockerfile');
    let isUserDockerfile = false;
    if (await h.exists(dockerfilePath)) {
      try {
        const firstLine = (await h.readFile(dockerfilePath)).split('\n')[0] || '';
        if (!firstLine.includes('Auto-generated by DeployStack')) {
          isUserDockerfile = true;
        }
      } catch {
        isUserDockerfile = true;
      }
    }

    if (isUserDockerfile) {
      onLine(`📄 Detected existing Dockerfile.`);
      return 'existing';
    }

    const pkgPath = at('package.json');
    if (await h.exists(pkgPath)) {
      let pkg: any;
      try {
        pkg = JSON.parse(await h.readFile(pkgPath));
      } catch (e: any) {
        onLine(`❌ package.json is not valid JSON: ${e.message}`);
        return 'none';
      }
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      const hasNext = !!deps.next;
      const hasVite = !!deps.vite;
      const hasVueCli = !!deps['@vue/cli-service'] || !!deps['vue-cli-service'];
      const hasCRA = !!deps['react-scripts'];
      const hasAngular = !!deps['@angular/cli'];
      const isStaticSPA = (hasVite || hasVueCli || hasCRA || hasAngular) && !hasNext && !deps.express && !deps.koa && !deps.fastify && !deps['@nestjs/core'];
      const hasStart = !!pkg.scripts?.start;
      const hasBuild = !!pkg.scripts?.build;

      // Smart entry point detection: verify file existence on disk
      let entry = 'index.js';
      const candidateEntries = [
        typeof pkg.main === 'string' && /^[\w./-]+$/.test(pkg.main) ? pkg.main : null,
        'src/index.js',
        'src/server.js',
        'src/app.js',
        'server.js',
        'app.js',
        'index.js',
      ].filter(Boolean) as string[];

      for (const cand of candidateEntries) {
        if (await h.exists(at(cand))) {
          entry = cand;
          break;
        }
      }

      // If root index.js exists but doesn't call listen / createServer (e.g. library repo like expressjs/express with examples/hello-world)
      if (entry === 'index.js' && (await h.exists(h.join(repoDir, 'examples', 'hello-world', 'index.js')))) {
        try {
          const content = await h.readFile(at('index.js'));
          if (!content.includes('listen') && !content.includes('createServer')) {
            entry = 'examples/hello-world/index.js';
            onLine(`ℹ️ Detected library repository with runnable example. Using 'examples/hello-world/index.js'.`);
          }
        } catch { /* ignore */ }
      }

      let dockerfile: string;
      if (isStaticSPA) {
        // Static SPA served by nginx, listening on the SAME port Traefik/-p will target.
        // Single-quoted in the Dockerfile's RUN, so the shell writes $uri literally.
        const nginxConf = `server { listen ${containerPort}; root /usr/share/nginx/html; location / { try_files $uri /index.html; } }`;
        dockerfile = `# Auto-generated by DeployStack PaaS
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
ENV NODE_OPTIONS="--openssl-legacy-provider"
RUN npm run build
RUN mkdir -p /out && (cp -r dist/. /out/ 2>/dev/null || cp -r build/. /out/ 2>/dev/null || cp -r out/. /out/ 2>/dev/null)

FROM nginx:alpine
COPY --from=builder /out /usr/share/nginx/html
RUN echo '${nginxConf}' > /etc/nginx/conf.d/default.conf
EXPOSE ${containerPort}
CMD ["nginx", "-g", "daemon off;"]`;
      } else if (hasNext) {
        dockerfile = `# Auto-generated by DeployStack PaaS
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
ENV NODE_OPTIONS="--openssl-legacy-provider"
RUN npm run build
EXPOSE ${containerPort}
ENV PORT=${containerPort}
ENV HOSTNAME="0.0.0.0"
CMD ["npm", "run", "start"]`;
      } else {
        const cmd = hasStart ? `["npm", "start"]` : `["node", "${entry}"]`;
        dockerfile = `# Auto-generated by DeployStack PaaS
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
ENV NODE_OPTIONS="--openssl-legacy-provider"
${hasBuild ? 'RUN npm run build\n' : ''}EXPOSE ${containerPort}
ENV PORT=${containerPort}
CMD ${cmd}`;
      }

      await h.writeFile(dockerfilePath, dockerfile);
      onLine(`📝 Auto-generated Dockerfile for Node.js app (port ${containerPort}, entry: ${entry}).`);
      return 'generated-node';
    }

    if (await h.exists(at('requirements.txt'))) {
      const entry = (await h.exists(at('main.py'))) && !(await h.exists(at('app.py')))
        ? 'main.py' : 'app.py';
      await h.writeFile(dockerfilePath, `# Auto-generated by DeployStack PaaS
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE ${containerPort}
ENV PORT=${containerPort}
CMD ["python", "${entry}"]`);
      onLine(`📝 Auto-generated Dockerfile for Python app (port ${containerPort}, entry ${entry}).`);
      return 'generated-python';
    }

    if (await h.exists(at('go.mod'))) {
      await h.writeFile(dockerfilePath, `# Auto-generated by DeployStack PaaS
FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.* ./
RUN go mod download
COPY . .
RUN go build -o app .

FROM alpine:latest
WORKDIR /app
COPY --from=builder /app/app .
EXPOSE ${containerPort}
ENV PORT=${containerPort}
CMD ["./app"]`);
      onLine(`📝 Auto-generated Dockerfile for Go app (port ${containerPort}).`);
      return 'generated-go';
    }

    onLine(`❌ Could not detect app runtime. Please add a Dockerfile to your repository.`);
    return 'none';
  }
}

/** The deploy toolbox for THIS machine, plus a way to get one for any registered server. */
@Injectable()
export class ExecutionService extends Runner {
  constructor() {
    super(new LocalHost());
  }

  /**
   * Run `fn` with a Runner for `server`: this machine for the local server, otherwise a fresh
   * SSH session (closed afterwards). Throws a beginner-friendly Error if SSH cannot connect.
   */
  async onServer<T>(server: Server, privateKey: string, fn: (runner: Runner) => Promise<T>): Promise<T> {
    if (server.is_local) return fn(this);
    const host = await SshHost.connect({ host: server.host, port: server.port, username: server.ssh_user, privateKey });
    try {
      return await fn(new Runner(host));
    } finally {
      host.close();
    }
  }
}
