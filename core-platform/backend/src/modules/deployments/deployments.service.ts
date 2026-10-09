import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { Deployment, DeploymentStatus } from './deployment.interface';
import { ApplicationsService, primaryContainerName } from '../applications/applications.service';
import { Application } from '../applications/application.interface';
import { ServersService } from '../servers/servers.service';
import { Server } from '../servers/server.interface';
import { ExecutionService, Runner, sanitizeTag } from '../execution/execution.service';
import { ProxyService } from '../proxy/proxy.service';
import { DeploymentsGateway } from './deployments.gateway';
import { PersistenceService } from '../persistence/persistence.service';
import { getAppType, prepareBuild } from '../app-types/app-types';
import { isAdmin, Requester } from '../auth/requester';

const MAX_DEPLOYMENTS_KEPT = 200;

@Injectable()
export class DeploymentsService {
  private readonly logger = new Logger(DeploymentsService.name);
  private deployments: Map<string, Deployment> = new Map();

  constructor(
    private readonly applicationsService: ApplicationsService,
    private readonly serversService: ServersService,
    private readonly executionService: ExecutionService,
    private readonly proxyService: ProxyService,
    private readonly gateway: DeploymentsGateway,
    private readonly store: PersistenceService,
  ) {
    for (const d of this.store.load<Deployment[]>('deployments', [])) {
      if (['queued', 'building', 'deploying'].includes(d.status)) {
        d.status = 'failed';
        d.logs.push('[Platform] Backend restarted while this deployment was running; it was interrupted.');
        d.finished_at = d.finished_at || new Date().toISOString();
      }
      this.deployments.set(d.id, d);
    }
  }

  private persist() {
    // Keep the file small: only the tail of each deployment's log is stored.
    this.store.save('deployments', Array.from(this.deployments.values()).map(d => ({ ...d, logs: d.logs.slice(-400) })));
  }

  async triggerDeployment(
    appIdOrName: string,
    commitSha: string = 'manual-' + Date.now().toString(36),
    commitMessage: string = 'Manual deploy via dashboard',
    requester?: Requester,
  ): Promise<Deployment> {
    const app = this.applicationsService.getApplicationFor(appIdOrName, requester);
    const server = this.serversService.getServerById(app.server_id);

    // Two pipelines racing on the same checkout / container name corrupt each other.
    if (app.status === 'building') {
      throw new ConflictException(`A deployment of '${app.name}' is already in progress`);
    }
    await this.applicationsService.updateStatus(app.id, 'building');

    const deployment: Deployment = {
      id: uuidv4(),
      application_id: app.id,
      app_name: app.name,
      server_id: server.id,
      owner_id: app.owner_id,
      commit_sha: sanitizeTag(commitSha),
      commit_message: (commitMessage || '').slice(0, 500),
      status: 'queued',
      logs: [],
      created_at: new Date().toISOString(),
    };

    this.deployments.set(deployment.id, deployment);
    this.pruneOldDeployments();
    this.persist();

    // Run async - don't await
    this.runPipeline(deployment, app, server).catch(err => {
      this.logger.error(`Pipeline crashed for ${deployment.id}: ${err.message}`);
    });

    return deployment;
  }

  private pruneOldDeployments() {
    while (this.deployments.size > MAX_DEPLOYMENTS_KEPT) {
      const oldest = this.deployments.keys().next().value;
      if (oldest === undefined) break;
      this.deployments.delete(oldest);
    }
  }

  private log(dep: Deployment, line: string) {
    const ts = new Date().toLocaleTimeString();
    const formatted = `[${ts}] ${line}`;
    dep.logs.push(formatted);
    this.persist();
    this.gateway.emitLog(dep.id, formatted, dep.owner_id);
    this.logger.log(`[Deploy:${dep.id.substring(0, 6)}] ${line}`);
  }

  private setStatus(dep: Deployment, status: DeploymentStatus) {
    dep.status = status;
    this.persist();
    this.gateway.emitStatusChange(dep.id, status, dep.owner_id);
  }

  private async runPipeline(deployment: Deployment, app: Application, server: Server) {
    this.setStatus(deployment, 'building');
    const L = (line: string) => this.log(deployment, line);

    L(`🚀 ═══════════════════════════════════════`);
    L(`🚀  DEPLOYMENT STARTED: ${app.name}`);
    L(`🚀 ═══════════════════════════════════════`);
    L(`📋 Repository: ${app.repo_url} (${app.branch})`);
    L(`🧩 App type:  ${getAppType(app.app_type).label}`);
    L(`🖥️  Target: ${server.name} (${server.is_local ? 'this machine' : `${server.ssh_user}@${server.host} over SSH`})`);
    L(`🌐 Domain:  ${app.domain} → port ${app.host_port}`);

    if (!server.is_local) L(`\n🔐 Connecting to ${server.host} over SSH...`);
    try {
      // Every step below runs on the app's server: this machine, or the Linux server over SSH.
      await this.serversService.withServer(server, runner => {
        if (!server.is_local) L(`✅ Connected as ${runner.host.label}`);
        return this.runSteps(deployment, app, server, runner, L);
      });
    } catch (err: any) {
      // Only reached when the SSH connection itself fails (runSteps handles its own errors).
      L(`\n❌ ══════════════════════════════════════════════`);
      L(`❌  DEPLOYMENT FAILED`);
      L(`❌ ══════════════════════════════════════════════`);
      L(`💥 Error: Cannot connect to ${server.name}: ${err.message}`);
      await this.applicationsService.updateStatus(app.id, app.current_image ? 'running' : 'failed');
      deployment.finished_at = new Date().toISOString();
      this.setStatus(deployment, 'failed');
    }
  }

  /** Clone → Dockerfile → build → swap container (with rollback), all through `runner`. Never throws. */
  private async runSteps(deployment: Deployment, app: Application, server: Server, runner: Runner, L: (line: string) => void) {
    const repoDir = runner.host.join(server.apps_dir, app.name);
    const containerName = primaryContainerName(app.name);
    const previousName = `${containerName}-prev`;
    let hadPrevious = false;
    let newContainerStarted = false;

    try {
      if (!server.apps_dir) {
        throw new Error(`Server '${server.name}' has not been verified yet. Open Servers and press "Re-verify".`);
      }
      if (app.build_method !== 'dockerfile') {
        throw new Error(`build_method '${app.build_method}' is not supported yet. Use 'dockerfile'.`);
      }

      // ── Docker ──────────────────────────────────────────────────────────────
      L(`\n🐳 Checking Docker on ${runner.host.label}...`);
      const docker = await runner.isDockerAvailable();
      if (!docker.available) {
        throw new Error(
          server.is_local
            ? `Docker daemon is not reachable (${docker.error}). Start Docker Desktop (or the docker service) and retry.`
            : `Docker is not reachable on ${server.host} (${docker.error}). On the server run: sudo systemctl start docker`,
        );
      }
      L(`✅ ${docker.version}`);
      await runner.ensureNetwork('paas-net');

      // ── Step 1: Clone / pull ────────────────────────────────────────────────
      L(`\n📦 STEP 1/4 — Fetching repository...`);
      const branch = await runner.cloneOrPullRepo(app.repo_url, app.branch, repoDir, line => L(`  ${line}`));
      if (!branch) throw new Error(`Git clone/pull failed for ${app.repo_url}`);

      const actualSha = (await runner.headSha(repoDir)) || deployment.commit_sha;
      deployment.commit_sha = actualSha;
      L(`✅ Repository ready. Branch: ${branch}, commit: ${actualSha}`);

      // ── Step 2: Dockerfile ──────────────────────────────────────────────────
      // The customer told us what kind of app this is (Flask, Next.js...), so we build it that way.
      // 'auto' (and apps created before app types existed) keep the old file-based detection.
      const appType = getAppType(app.app_type);
      let dockerfile = 'Dockerfile';
      if (appType.id === 'auto') {
        L(`\n📄 STEP 2/4 — Detecting runtime & Dockerfile...`);
        const dockerfileStatus = await runner.generateDockerfileIfMissing(repoDir, app.port, line => L(`  ${line}`));
        if (dockerfileStatus === 'none') {
          throw new Error('Cannot auto-detect runtime. Please add a Dockerfile to your repository root.');
        }
      } else {
        L(`\n📄 STEP 2/4 — Preparing a ${appType.label} build...`);
        const plan = await prepareBuild(appType, runner.host, repoDir, app.port, app.start_command);
        plan.messages.forEach(m => L(`  ${m}`));
        if (!plan.ok) throw new Error(plan.error);
        dockerfile = plan.dockerfile;
      }

      // ── Step 3: Build ───────────────────────────────────────────────────────
      const imageTag = `paas-${app.name}:${sanitizeTag(actualSha)}`;
      L(`\n🔨 STEP 3/4 — Building Docker image: ${imageTag}`);
      const built = await runner.buildDockerImage(imageTag, repoDir, line => L(`  ${line}`), dockerfile);
      if (!built) throw new Error('Docker build failed. Check the logs above for errors.');
      L(`✅ Image built successfully: ${imageTag}`);

      // ── Step 4: Swap container (with rollback) ──────────────────────────────
      this.setStatus(deployment, 'deploying');
      L(`\n🚢 STEP 4/4 — Starting container on port ${app.host_port}...`);

      // The old container holds the name and the host port, so park it (stopped, not deleted)
      // until the new one has proven itself. If the new one fails we put the old one back.
      await runner.removeContainer(previousName);
      const old = await runner.containerState(containerName);
      if (old.exists) {
        L(`  ⏸️  Parking current container as '${previousName}' (kept for rollback)`);
        await runner.stopContainer(containerName);
        hadPrevious = await runner.renameContainer(containerName, previousName);
      }

      const labels = this.proxyService.generateTraefikLabels({ appName: app.name, domain: app.domain, port: app.port });
      newContainerStarted = await runner.runDockerContainer({
        containerName,
        imageTag,
        hostPort: app.host_port,
        containerPort: app.port,
        envVars: app.env_vars,
        networkName: 'paas-net',
        labels,
        onLine: line => L(`  ${line}`),
      });
      if (!newContainerStarted) throw new Error(`Failed to start container '${containerName}'`);

      L(`  🩺 Verifying the container stays up...`);
      const health = await runner.waitUntilHealthy(containerName);
      if (!health.ok) {
        const logs = await runner.containerLogs(containerName, 25);
        if (logs) logs.split('\n').forEach(l => L(`  │ ${l}`));
        throw new Error(`New container is not healthy: ${health.reason}`);
      }

      // New container is good - the parked one is no longer needed.
      if (hadPrevious) {
        await runner.removeContainer(previousName);
        L(`  🗑️  Removed previous container`);
      }

      // Re-create the extra replicas from the new image.
      this.applicationsService.setCurrentImage(app.id, imageTag);
      if (app.replicas > 1) {
        for (const name of await runner.listAppContainers(app.name)) {
          if (name !== containerName) await runner.removeContainer(name);
        }
        const total = await this.applicationsService.reconcileReplicas(app, runner, line => L(`  ${line}`));
        L(`  ⚖️  ${total}/${app.replicas} replicas running`);
      }

      L(`\n✅ ══════════════════════════════════════════════`);
      L(`✅  DEPLOYMENT SUCCESSFUL!`);
      L(`✅ ══════════════════════════════════════════════`);
      deployment.app_url = this.applicationsService.appUrl(app) || `http://localhost:${app.host_port}`;
      deployment.domain_url = `http://${app.domain}`;
      deployment.host_port = app.host_port;
      L(`🌐 App URL:     ${deployment.app_url}`);
      L(`📦 Container:   ${containerName} (running)`);
      L(`🏷️  Image:       ${imageTag}`);
      L(`🔀 Domain:      ${deployment.domain_url} (via Traefik, if configured)`);

      // Update the app record BEFORE announcing the result: the dashboard refetches apps on the event.
      await this.applicationsService.updateStatus(app.id, 'running', actualSha);
      deployment.finished_at = new Date().toISOString();
      this.setStatus(deployment, 'success');
    } catch (err: any) {
      L(`\n❌ ══════════════════════════════════════════════`);
      L(`❌  DEPLOYMENT FAILED`);
      L(`❌ ══════════════════════════════════════════════`);
      L(`💥 Error: ${err.message}`);

      let restored = false;
      try {
        if (newContainerStarted) await runner.removeContainer(containerName);
        if (hadPrevious) {
          const renamed = await runner.renameContainer(previousName, containerName);
          restored = renamed && (await runner.startContainer(containerName));
        }
      } catch (rollbackErr: any) {
        L(`⚠️  Rollback error: ${rollbackErr.message}`);
      }
      if (hadPrevious) {
        L(restored
          ? `🛡️  Rolled back: the previous version is running again.`
          : `⚠️  Rollback failed - the previous container is parked as '${previousName}'.`);
      }

      // A failed build/start must not mark the app 'failed' while its previous version is still
      // serving traffic: report what is actually running (and do it before announcing the result).
      const stillUp = await runner.containerState(containerName).catch(() => ({ running: false }));
      await this.applicationsService.updateStatus(app.id, restored || stillUp.running ? 'running' : 'failed');
      deployment.finished_at = new Date().toISOString();
      this.setStatus(deployment, 'failed');
    }
  }

  /** Customers only see deployments of their own apps. */
  private canSee(dep: Deployment, requester?: Requester): boolean {
    return isAdmin(requester) || (!!dep.owner_id && dep.owner_id === requester.id);
  }

  getDeploymentById(id: string, requester?: Requester): Deployment {
    const dep = this.deployments.get(id);
    if (!dep || !this.canSee(dep, requester)) throw new NotFoundException(`Deployment '${id}' not found`);
    return dep;
  }

  getAllDeployments(requester?: Requester): Deployment[] {
    return Array.from(this.deployments.values()).filter(d => this.canSee(d, requester)).reverse();
  }

  getDeploymentsByApp(idOrName: string, requester?: Requester): Deployment[] {
    const app = this.applicationsService.getApplicationFor(idOrName, requester);
    return Array.from(this.deployments.values())
      .filter(d => d.application_id === app.id)
      .reverse();
  }
}
