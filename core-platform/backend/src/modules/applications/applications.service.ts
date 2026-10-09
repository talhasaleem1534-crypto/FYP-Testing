import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { Application, AppStatus } from './application.interface';
import { CreateApplicationDto, ScaleApplicationDto } from './dto/create-application.dto';
import { ServersService } from '../servers/servers.service';
import { ExecutionService, Runner, assertSafeBranch, assertSafeEnvVars, assertSafeRepoUrl } from '../execution/execution.service';
import { PortManagerService } from '../ports/port-manager.service';
import { ProxyService } from '../proxy/proxy.service';
import { PersistenceService } from '../persistence/persistence.service';
import { getAppType } from '../app-types/app-types';
import { isAdmin, Requester } from '../auth/requester';

/** Normalise a git URL so https://GitHub.com/a/b.git/ and https://github.com/a/b compare equal. */
export function normalizeRepoUrl(url: string): string {
  return (url || '')
    .trim()
    .toLowerCase()
    .replace(/^git@([^:]+):/, 'https://$1/')
    .replace(/^(ssh|git):\/\/(git@)?/, 'https://')
    .replace(/\.git\/?$/, '')
    .replace(/\/+$/, '');
}

export const primaryContainerName = (appName: string) => `paas-${appName}`;
export const replicaContainerName = (appName: string, index: number) =>
  index === 1 ? primaryContainerName(appName) : `paas-${appName}-r${index}`;

@Injectable()
export class ApplicationsService {
  private readonly logger = new Logger(ApplicationsService.name);
  private applications: Map<string, Application> = new Map();

  constructor(
    private readonly serversService: ServersService,
    private readonly executionService: ExecutionService,
    private readonly portManager: PortManagerService,
    private readonly proxyService: ProxyService,
    private readonly store: PersistenceService,
  ) {
    // Restore apps saved before the last restart.
    for (const a of this.store.load<Application[]>('applications', [])) {
      // A deploy that was running when the backend stopped can never finish.
      if (a.status === 'building') a.status = a.current_image ? 'running' : 'idle';
      this.applications.set(a.id, a);
      this.portManager.markUsed(a.host_port);
    }
    if (this.applications.size) this.logger.log(`Restored ${this.applications.size} application(s) from disk`);
    // A server that still has apps cannot be deleted.
    this.serversService.setUsageCounter(serverId => this.getAllApplications().filter(a => a.server_id === serverId).length);
  }

  /** Where the running app is opened: http://<server IP>:<port>, or null when it runs on the platform machine. */
  appUrl(app: Application): string | null {
    try {
      const host = this.serversService.publicHost(this.serversService.getServerById(app.server_id));
      return host ? `http://${host}:${app.host_port}` : null;
    } catch { return null; }
  }

  /** The app as returned by the API (adds app_url). */
  present(app: Application) {
    return { ...app, app_url: this.appUrl(app) };
  }

  private persist() {
    this.store.save('applications', Array.from(this.applications.values()));
  }

  /** `requester` undefined = called by the platform itself (webhooks, AI engine): full access. */
  async createApplication(dto: CreateApplicationDto, requester?: Requester): Promise<Application> {
    const repoUrl = assertSafeRepoUrl(dto.repo_url);
    const branch = assertSafeBranch(dto.branch || 'main');
    const envVars = assertSafeEnvVars(dto.env_vars);

    const cleanName = dto.name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    if (!cleanName) throw new BadRequestException('Application name must contain letters or digits');
    if (Array.from(this.applications.values()).some(a => a.name === cleanName)) {
      throw new ConflictException(`An application named '${cleanName}' already exists`);
    }

    // Unknown server ids are an error - silently falling back to localhost hid typos.
    const server = dto.server_id ? this.serversService.getServerFor(dto.server_id, requester) : this.serversService.getLocalServer();
    if (!server) throw new NotFoundException('No server available. Register a server first.');

    const hostPort = this.portManager.allocatePort(cleanName);
    const now = new Date().toISOString();

    const app: Application = {
      id: uuidv4(),
      name: cleanName,
      repo_url: repoUrl,
      branch,
      server_id: server.id,
      build_method: dto.build_method || 'dockerfile',
      app_type: dto.app_type || 'auto',
      start_command: dto.start_command?.trim() || undefined,
      owner_id: requester?.role === 'customer' ? requester.id : undefined,
      domain: dto.domain.trim().toLowerCase(),
      port: dto.port || getAppType(dto.app_type).default_port,
      host_port: hostPort,
      env_vars: envVars,
      replicas: 1,
      status: 'idle',
      created_at: now,
      updated_at: now,
    };

    this.applications.set(app.id, app);
    this.persist();
    this.logger.log(`Application created: ${app.name} (${app.app_type}) → port ${hostPort} → ${app.domain}`);
    return app;
  }

  getAllApplications(): Application[] {
    return Array.from(this.applications.values());
  }

  canAccess(app: Application, requester?: Requester): boolean {
    return isAdmin(requester) || app.owner_id === requester.id;
  }

  /** Apps this requester may see: everything for the admin, only their own for a customer. */
  getApplicationsFor(requester?: Requester): Application[] {
    return this.getAllApplications().filter(a => this.canAccess(a, requester));
  }

  /** Like getApplicationById, but a customer gets "not found" for someone else's app. */
  getApplicationFor(idOrName: string, requester?: Requester): Application {
    const app = this.getApplicationById(idOrName);
    if (!this.canAccess(app, requester)) throw new NotFoundException(`Application '${idOrName}' not found`);
    return app;
  }

  getApplicationById(idOrName: string): Application {
    const direct = this.applications.get(idOrName);
    if (direct) return direct;
    const needle = idOrName.toLowerCase().trim();
    const found = Array.from(this.applications.values()).find(a => a.name === needle);
    if (!found) throw new NotFoundException(`Application '${idOrName}' not found`);
    return found;
  }

  /** Match a webhook payload to a registered app. Exact (normalised) match only. */
  findApplicationByRepo(repoUrl: string, branch: string): Application | undefined {
    const wanted = normalizeRepoUrl(repoUrl);
    if (!wanted) return undefined;
    return Array.from(this.applications.values()).find(
      a => normalizeRepoUrl(a.repo_url) === wanted && a.branch === branch,
    );
  }

  async updateStatus(id: string, status: AppStatus, commitSha?: string): Promise<Application> {
    const app = this.getApplicationById(id);
    app.status = status;
    if (commitSha) {
      app.current_commit_sha = commitSha;
      app.last_deployed_at = new Date().toISOString();
    }
    app.updated_at = new Date().toISOString();
    this.persist();
    return app;
  }

  setCurrentImage(id: string, image: string): void {
    const app = this.getApplicationById(id);
    app.current_image = image;
    app.updated_at = new Date().toISOString();
    this.persist();
  }

  /**
   * Make the number of running containers match app.replicas.
   * Replica 1 is the primary container (created by the deploy pipeline); replicas 2..N
   * share its image, env and Traefik labels, so Traefik load-balances across them.
   * Returns how many containers exist for the app afterwards.
   */
  async reconcileReplicas(app: Application, runner: Runner, onLine?: (line: string) => void): Promise<number> {
    const log = (l: string) => { onLine?.(l); this.logger.log(l); };
    const existing = new Set(await runner.listAppContainers(app.name));
    const wanted = new Set<string>();
    for (let i = 1; i <= app.replicas; i++) wanted.add(replicaContainerName(app.name, i));

    // Remove surplus replicas (never the primary).
    for (const name of existing) {
      if (!wanted.has(name) && name !== primaryContainerName(app.name)) {
        log(`➖ Removing replica ${name}`);
        await runner.removeContainer(name);
        existing.delete(name);
      }
    }

    // Start missing replicas.
    if (app.current_image) {
      const labels = this.proxyService.generateTraefikLabels({ appName: app.name, domain: app.domain, port: app.port });
      for (let i = 2; i <= app.replicas; i++) {
        const name = replicaContainerName(app.name, i);
        if (existing.has(name)) {
          const st = await runner.containerState(name);
          if (st.running) continue;
          await runner.removeContainer(name); // dead replica: recreate it
        }
        log(`➕ Starting replica ${name}`);
        const ok = await runner.runDockerContainer({
          containerName: name,
          imageTag: app.current_image,
          containerPort: app.port,
          envVars: app.env_vars,
          labels,
          onLine: log,
        });
        if (ok) existing.add(name);
      }
    }
    return existing.size;
  }

  async scaleApplication(idOrName: string, dto: ScaleApplicationDto, requester?: Requester) {
    const app = this.getApplicationFor(idOrName, requester);
    if (app.status === 'building') {
      throw new ConflictException(`'${app.name}' is being deployed right now - try again when it finishes`);
    }

    app.replicas = dto.replicas;
    app.updated_at = new Date().toISOString();
    this.persist();

    // Not deployed yet: remember the target, it is applied on the first deploy.
    if (!app.current_image) {
      return { app_name: app.name, replicas_requested: app.replicas, replicas_running: 0, status: 'pending_first_deploy' };
    }

    const server = this.serversService.getServerById(app.server_id);
    let running: number;
    try {
      running = await this.serversService.withServer(server, runner => this.reconcileReplicas(app, runner));
    } catch (err: any) {
      throw new ConflictException(`Cannot reach server '${server.name}': ${err.message}`);
    }
    if (running !== app.replicas) {
      throw new InternalServerErrorException(
        `Requested ${app.replicas} replica(s) but ${running} container(s) are running. Check the backend logs.`,
      );
    }
    return { app_name: app.name, replicas_requested: app.replicas, replicas_running: running, status: 'scaled' };
  }

  /**
   * Delete an application: stop and remove ALL its containers (primary, replicas, parked rollback copy),
   * its images and its git checkout, free its host port, and forget it. Deployment history is kept.
   * `force` deletes the record even if Docker cannot be reached (containers may then be left behind).
   */
  async deleteApplication(idOrName: string, force = false, requester?: Requester) {
    const app = this.getApplicationFor(idOrName, requester);
    if (app.status === 'building') {
      throw new ConflictException(`'${app.name}' is being deployed right now - wait for it to finish before deleting`);
    }
    const server = this.serversService.getServerById(app.server_id);
    const warnings: string[] = [];
    const removedContainers: string[] = [];
    let removedImages = 0;
    let removedFiles = false;

    try {
      await this.serversService.withServer(server, async runner => {
        const docker = await runner.isDockerAvailable();
        if (!docker.available) {
          if (!force) {
            throw new ConflictException(
              `Docker is not reachable (${docker.error}), so '${app.name}' cannot be cleaned up. ` +
              `Start Docker and retry, or delete with force=true to remove only the record.`,
            );
          }
          warnings.push(`Docker unreachable: containers/images of '${app.name}' were NOT removed.`);
        } else {
          const names = new Set(await runner.listAppContainers(app.name));
          names.add(primaryContainerName(app.name));
          names.add(`${primaryContainerName(app.name)}-prev`);
          for (const name of names) {
            const st = await runner.containerState(name);
            if (!st.exists) continue;
            await runner.removeContainer(name);
            removedContainers.push(name);
          }
          removedImages = await runner.removeAppImages(app.name);
        }
        if (server.apps_dir) {
          try {
            removedFiles = await runner.removeCheckout(server.apps_dir, app.name);
          } catch (err: any) {
            warnings.push(`Could not delete the checkout: ${err.message}`);
          }
        }
      });
    } catch (err: any) {
      if (err instanceof ConflictException) throw err;
      // SSH to the server failed.
      if (!force) {
        throw new ConflictException(
          `Cannot connect to server '${server.name}' (${err.message}), so '${app.name}' cannot be cleaned up. ` +
          `Fix the connection and retry, or delete with force=true to remove only the record.`,
        );
      }
      warnings.push(`Server '${server.name}' unreachable: nothing of '${app.name}' was removed there.`);
    }

    this.portManager.releasePort(app.host_port);
    this.applications.delete(app.id);
    this.persist();
    this.logger.log(`Application deleted: ${app.name} (${removedContainers.length} container(s), ${removedImages} image(s))`);
    return {
      deleted: true,
      app_name: app.name,
      removed_containers: removedContainers,
      removed_images: removedImages,
      removed_files: removedFiles,
      warnings,
    };
  }
}
