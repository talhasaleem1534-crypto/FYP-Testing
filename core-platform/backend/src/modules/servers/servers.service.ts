import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as os from 'os';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { ExecutionService, Runner } from '../execution/execution.service';
import { PersistenceService } from '../persistence/persistence.service';
import { Server, ServerCheck, ServerStatus } from './server.interface';
import { isAdmin, Requester } from '../auth/requester';
import { PlatformKeyService } from './platform-key.service';

export { Server, ServerStatus } from './server.interface';

export const LOCAL_SERVER_ID = 'local-server';
const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '::1'];
/** Addresses that mean "the platform machine itself" - a customer must give their server's real IP. */
const LOOPBACK_LIKE = /^(127\.|0\.0\.0\.0$|localhost$|::1$|\[::1\]$)/i;

/** Where apps are cloned on this machine. Override with PAAS_APPS_DIR (e.g. a Docker volume). */
export function localAppsDir(): string {
  return process.env.PAAS_APPS_DIR || path.join(os.homedir(), 'paas-apps');
}

/** Turn a failed `docker version` into a fix the user can run on the server. */
function dockerProblem(stderr: string, code: number, user: string): { detail: string; fix: string } {
  if (code === 127 || /not installed|not found/.test(stderr)) {
    return { detail: 'Docker is not installed', fix: 'curl -fsSL https://get.docker.com | sudo sh' };
  }
  if (/permission denied/i.test(stderr)) {
    return { detail: `User '${user}' may not use Docker`, fix: `sudo usermod -aG docker ${user}   # then log out and in again (or reboot)` };
  }
  if (/Cannot connect to the Docker daemon|Is the docker daemon running/i.test(stderr)) {
    return { detail: 'Docker is installed but not running', fix: 'sudo systemctl enable --now docker' };
  }
  return { detail: stderr || 'Docker did not answer', fix: 'Check with: docker version' };
}

@Injectable()
export class ServersService {
  private readonly logger = new Logger(ServersService.name);
  private servers: Map<string, Server> = new Map();
  private settings: { local_shared: boolean };
  /** Set by ApplicationsService: how many apps use a server (a server in use cannot be deleted). */
  private appsOnServer: (serverId: string) => number = () => 0;

  constructor(
    private readonly executionService: ExecutionService,
    private readonly store: PersistenceService,
    private readonly platformKey: PlatformKeyService,
  ) {
    this.settings = { local_shared: true, ...this.store.load('server_settings', {}) };
    // Restore remote servers registered before the last restart (localhost is always re-created).
    for (const s of this.store.load<Server[]>('servers', [])) {
      if (!s.is_local) this.servers.set(s.id, s);
    }
    // Auto-register localhost on startup. Never let a failure here crash the app.
    this.registerLocalhost().catch(err =>
      this.logger.error(`Could not verify localhost server: ${err?.message || err}`),
    );
  }

  setUsageCounter(fn: (serverId: string) => number) {
    this.appsOnServer = fn;
  }

  private async registerLocalhost() {
    if (this.servers.has(LOCAL_SERVER_ID)) return;

    const server: Server = {
      id: LOCAL_SERVER_ID,
      name: 'localhost (this machine)',
      host: '127.0.0.1',
      port: 22,
      ssh_user: os.userInfo().username,
      ssh_private_key: '',
      status: 'pending',
      docker_available: false,
      is_local: true,
      apps_dir: localAppsDir(),
      shared: this.settings.local_shared,
      created_at: new Date().toISOString(),
    };
    this.servers.set(LOCAL_SERVER_ID, server);
    await this.verifyServer(LOCAL_SERVER_ID);
  }

  /**
   * Register a server. The admin's servers are shared with customers unless `shared` is false;
   * a customer's server belongs to that customer only. Without a private key the platform key is used.
   */
  async createServer(dto: {
    name: string; host: string; port?: number;
    ssh_user: string; ssh_private_key?: string; shared?: boolean;
  }, requester?: Requester): Promise<Server> {
    const host = dto.host.trim();
    const customer = !isAdmin(requester);
    if (customer && LOOPBACK_LIKE.test(host)) {
      throw new BadRequestException(`'${host}' means the platform machine itself. Enter your server's network IP address (e.g. 192.168.1.30).`);
    }
    const isLocal = !customer && LOCAL_HOSTS.includes(host);
    const ownKey = (dto.ssh_private_key || '').trim();

    const id = uuidv4();
    const server: Server = {
      id,
      name: dto.name.trim(),
      host,
      port: dto.port || 22,
      ssh_user: dto.ssh_user,
      ssh_private_key: ownKey,
      auth_method: ownKey ? 'private_key' : 'platform_key',
      status: 'pending',
      docker_available: false,
      is_local: isLocal,
      apps_dir: isLocal ? localAppsDir() : '',
      owner_id: customer ? requester.id : undefined,
      shared: customer ? false : dto.shared ?? true,
      created_at: new Date().toISOString(),
    };

    this.servers.set(id, server);
    this.persist();
    return this.verifyServer(id, requester);
  }

  /** The key used to log in to `server`: its own key, or the platform key. */
  keyFor(server: Server): string {
    return server.ssh_private_key || this.platformKey.privateKey;
  }

  /** Run `fn` on the server (this machine, or over SSH). Throws a readable Error if SSH fails. */
  withServer<T>(server: Server, fn: (runner: Runner) => Promise<T>): Promise<T> {
    return this.executionService.onServer(server, this.keyFor(server), fn);
  }

  /** Connect and check everything a deployment needs. Saves the checklist on the server record. */
  async verifyServer(id: string, requester?: Requester): Promise<Server> {
    const server = this.servers.get(id);
    if (!server) throw new NotFoundException(`Server ${id} not found`);
    if (!this.canManage(server, requester)) throw new NotFoundException(`Server ${id} not found`);

    const checks: ServerCheck[] = [];
    const add = (c: ServerCheck) => checks.push(c);
    try {
      await this.withServer(server, async runner => {
        if (!server.is_local) add({ key: 'ssh', label: 'SSH connection', ok: true, detail: `Logged in as ${server.ssh_user}` });

        const docker = await runner.exec('docker', ['version', '--format', '{{.Server.Version}}'], { timeoutMs: 20_000 });
        if (docker.code === 0 && docker.stdout) {
          server.docker_version = `Docker ${docker.stdout}${server.is_local ? '' : ' (SSH)'}`;
          add({ key: 'docker', label: 'Docker', ok: true, detail: server.docker_version });
        } else {
          const p = dockerProblem(docker.stderr, docker.code, server.ssh_user);
          server.docker_version = 'Docker not available';
          add({ key: 'docker', label: 'Docker', ok: false, detail: p.detail, fix: p.fix });
        }

        if (!server.is_local) {
          const git = await runner.exec('git', ['--version'], { timeoutMs: 15_000 });
          add(git.code === 0
            ? { key: 'git', label: 'git', ok: true, detail: git.stdout || 'installed' }
            : { key: 'git', label: 'git', ok: false, detail: 'git is not installed', fix: 'sudo apt install -y git' });

          // Apps live in the SSH user's home folder: <home>/paas-apps.
          const home = (await runner.exec('sh', ['-c', 'printf %s "$HOME"'], { timeoutMs: 15_000 })).stdout.trim();
          if (home.startsWith('/')) {
            server.apps_dir = runner.host.join(home, 'paas-apps');
            try {
              await runner.host.mkdirp(server.apps_dir);
              add({ key: 'folder', label: 'Apps folder', ok: true, detail: server.apps_dir });
            } catch (e: any) {
              add({ key: 'folder', label: 'Apps folder', ok: false, detail: e.message, fix: `Make sure ${server.ssh_user} can write to ${home}` });
            }
          } else {
            add({ key: 'folder', label: 'Apps folder', ok: false, detail: 'Could not find the home folder of the SSH user' });
          }
        }

        if (checks.find(c => c.key === 'docker')?.ok) {
          await runner.ensureNetwork('paas-net');
          add({ key: 'network', label: 'Docker network', ok: true, detail: 'paas-net ready' });
        }
      });
    } catch (err: any) {
      // Could not even open SSH: explain why (the message comes from explainSshError).
      add({ key: 'ssh', label: 'SSH connection', ok: false, detail: err.message });
    }

    const failed = checks.filter(c => !c.ok);
    server.checks = checks;
    server.docker_available = !!checks.find(c => c.key === 'docker')?.ok;
    server.status = failed.length ? 'unreachable' : 'verified';
    server.last_error = failed.length ? failed.map(c => `${c.label}: ${c.detail}`).join(' · ') : undefined;
    server.verified_at = new Date().toISOString();
    if (failed.length) this.logger.warn(`Server '${server.name}' (${server.host}) not ready: ${server.last_error}`);
    else this.logger.log(`Server '${server.name}' verified. ${server.docker_version}`);

    this.servers.set(id, server);
    this.persist();
    return this.safeServer(server, requester);
  }

  /** Admin: let customers deploy to this server (or stop them). */
  setShared(id: string, shared: boolean): Server {
    const server = this.getServerById(id);
    if (server.owner_id) throw new BadRequestException("A customer's own server cannot be shared.");
    server.shared = shared;
    if (server.is_local) {
      this.settings.local_shared = shared;
      this.store.save('server_settings', this.settings);
    }
    this.persist();
    return this.safeServer(server);
  }

  /** Remove a server that no app uses any more. Admin, or the customer who added it. */
  deleteServer(id: string, requester?: Requester) {
    const server = this.getServerById(id);
    if (!this.canManage(server, requester)) throw new NotFoundException(`Server '${id}' not found`);
    if (server.is_local) throw new BadRequestException('The platform machine itself cannot be removed.');
    const used = this.appsOnServer(server.id);
    if (used > 0) throw new ConflictException(`${used} application(s) still use '${server.name}'. Delete them first.`);
    this.servers.delete(server.id);
    this.persist();
    return { deleted: true, name: server.name };
  }

  /** Internal lookup - returns the real record (including the private key). Never send this to a client. */
  getServerById(id: string): Server {
    const s = this.servers.get(id);
    if (s) return s;
    const found = Array.from(this.servers.values()).find(sv => sv.name === id || sv.host === id);
    if (!found) throw new NotFoundException(`Server '${id}' not found`);
    return found;
  }

  /** API-safe lookup. */
  getPublicServerById(id: string): Server {
    return this.safeServer(this.getServerById(id));
  }

  async getAllServers(): Promise<Server[]> {
    return Array.from(this.servers.values()).map(s => this.safeServer(s));
  }

  /** Re-check / delete: the admin, or the customer who registered it. */
  canManage(server: Server, requester?: Requester): boolean {
    return isAdmin(requester) || (!!server.owner_id && server.owner_id === requester.id);
  }

  /** Deploy to: the admin anywhere; a customer to their own servers and the ones the admin shared. */
  canUse(server: Server, requester?: Requester): boolean {
    return this.canManage(server, requester) || (!server.owner_id && !!server.shared);
  }

  /**
   * Servers this requester may see (API-safe). Order = what the New Application form offers first:
   * the customer's own servers, then shared Linux servers, then the platform machine.
   */
  getServersFor(requester?: Requester): Server[] {
    const rank = (s: Server) => (s.owner_id ? 0 : s.is_local ? 2 : 1);
    return Array.from(this.servers.values())
      .filter(s => this.canUse(s, requester))
      // Customers are only offered shared servers that passed verification (their own are always listed).
      .filter(s => isAdmin(requester) || s.owner_id || s.status === 'verified')
      .sort((a, b) => rank(a) - rank(b))
      .map(s => this.safeServer(s, requester));
  }

  /** Internal record of a server this requester may deploy to; "not found" otherwise. */
  getServerFor(id: string, requester?: Requester): Server {
    const s = this.getServerById(id);
    if (!this.canUse(s, requester)) throw new NotFoundException(`Server '${id}' not found`);
    return s;
  }

  getPublicServerFor(id: string, requester?: Requester): Server {
    return this.safeServer(this.getServerFor(id, requester), requester);
  }

  getLocalServer(): Server | undefined {
    return this.servers.get(LOCAL_SERVER_ID);
  }

  /** Where a running app is opened: the server's address (null = the machine serving the page). */
  publicHost(server: Server): string | null {
    return server.is_local ? null : server.host;
  }

  private persist() {
    this.store.save('servers', Array.from(this.servers.values()).filter(s => !s.is_local));
  }

  private safeServer(s: Server, requester?: Requester): Server {
    const safe = { ...s, ssh_private_key: s.ssh_private_key ? '[STORED]' : '' };
    if (isAdmin(requester) || this.canManage(s, requester)) return safe;
    // A customer looking at a server the admin shared: only what they need to pick it.
    return {
      ...safe,
      name: s.is_local ? 'DeployStack platform server' : s.name,
      host: s.is_local ? 'platform' : s.host,
      ssh_user: '', apps_dir: '', last_error: undefined, checks: undefined, docker_version: undefined,
    };
  }
}
