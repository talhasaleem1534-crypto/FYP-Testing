import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AuthService } from '../auth/auth.service';
import { ApplicationsService } from '../applications/applications.service';
import { DeploymentsService } from '../deployments/deployments.service';
import { PersistenceService } from '../persistence/persistence.service';
import { localAppsDir, ServersService } from '../servers/servers.service';

/** What each data file holds - shown next to the file on the admin's Data & Storage page. */
const DATA_FILES: { key: string; what: string; sensitive?: string }[] = [
  { key: 'users', what: 'Customer and admin accounts (name, email, role, sign-up and last login time)', sensitive: 'Passwords are NOT stored. Only a salted scrypt hash of each password is kept.' },
  { key: 'sessions', what: 'Who is signed in right now (login tokens, valid 7 days)', sensitive: 'Anyone holding a token is signed in as that user until it expires or they sign out.' },
  { key: 'applications', what: 'Every application: owner, Git repository, app type, domain, ports, environment variables' },
  { key: 'servers', what: 'Registered servers', sensitive: 'Contains the SSH private keys of remote servers.' },
  { key: 'deployments', what: 'Deployment history and the last 400 log lines of each deployment' },
  { key: 'platform_ssh_key', what: "The platform's SSH key pair, used to log in to Linux servers", sensitive: 'Contains the PRIVATE key: whoever has this file can log in to every server that trusts the platform key. Never share it.' },
];

/** Total size of a folder, stopping after `limit` entries so a huge node_modules can't hang the request. */
function folderSize(dir: string, limit = 20_000): { bytes: number; files: number; truncated: boolean } {
  let bytes = 0, files = 0, seen = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (++seen > limit) return { bytes, files, truncated: true };
      const full = path.join(current, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile()) { try { bytes += fs.statSync(full).size; files++; } catch { /* vanished */ } }
    }
  }
  return { bytes, files, truncated: false };
}

/** IPv4 addresses other devices on the same network can use to reach this laptop. */
export function lanAddresses(): string[] {
  return Object.values(os.networkInterfaces()).flat()
    .filter((i): i is os.NetworkInterfaceInfo => !!i && i.family === 'IPv4' && !i.internal)
    .map(i => i.address);
}

@Injectable()
export class AdminService {
  constructor(
    private readonly auth: AuthService,
    private readonly apps: ApplicationsService,
    private readonly deployments: DeploymentsService,
    private readonly store: PersistenceService,
    private readonly servers: ServersService,
  ) {}

  /** Every account with its apps. The password itself is never available - only a short preview of its hash. */
  customers() {
    const allApps = this.apps.getAllApplications();
    const allDeps = this.deployments.getAllDeployments();
    return this.auth.allUsers().map(u => {
      const apps = allApps.filter(a => a.owner_id === u.id);
      return {
        ...this.auth.publicUser(u),
        active_sessions: this.auth.activeSessions(u.id),
        password_storage: {
          algorithm: 'scrypt (salted, 64-byte hash)',
          salt_preview: u.password_salt.slice(0, 8) + '…',
          hash_preview: u.password_hash.slice(0, 12) + '…',
        },
        deployments: allDeps.filter(d => d.owner_id === u.id).length,
        apps: apps.map(a => ({
          id: a.id, name: a.name, status: a.status, app_type: a.app_type || 'auto',
          repo_url: a.repo_url, domain: a.domain, host_port: a.host_port, created_at: a.created_at,
        })),
      };
    });
  }

  /** Where everything is saved on this (the admin's) machine. */
  storage(frontendPort = Number(process.env.FRONTEND_PORT) || 5173) {
    const ips = lanAddresses();
    const appsDir = localAppsDir();
    const owners = new Map(this.auth.allUsers().map(u => [u.id, u.email]));
    const appByName = new Map(this.apps.getAllApplications().map(a => [a.name, a]));

    let checkouts: string[] = [];
    try { checkouts = fs.readdirSync(appsDir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); } catch { /* not created yet */ }

    return {
      machine: {
        hostname: os.hostname(),
        os: `${os.type()} ${os.release()}`,
        user: os.userInfo().username,
        lan_addresses: ips,
        customer_portal_urls: ips.map(ip => `http://${ip}:${frontendPort}/`),
        admin_url: `http://localhost:${frontendPort}/admin`,
        backend_port: Number(process.env.PORT) || 3000,
      },
      data_dir: this.store.directory,
      persistence_enabled: this.store.isEnabled,
      data_files: DATA_FILES.map(f => {
        const file = this.store.filePath(f.key);
        let size = 0, modified: string | null = null, records: number | null = null;
        try {
          const st = fs.statSync(file);
          size = st.size; modified = st.mtime.toISOString();
          const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
          records = Array.isArray(parsed) ? parsed.length : null;
        } catch { /* not written yet */ }
        return { name: path.basename(file), path: file, exists: modified !== null, size_bytes: size, modified, records, what: f.what, sensitive: f.sensitive };
      }),
      apps_dir: appsDir,
      app_checkouts: checkouts.map(name => {
        const app = appByName.get(name);
        return {
          name, path: path.join(appsDir, name), ...folderSize(path.join(appsDir, name)),
          owner: app ? (app.owner_id ? owners.get(app.owner_id) || 'deleted customer' : 'admin') : 'no app (left over)',
        };
      }),
      // Apps deployed to Linux servers keep their code ON that server, not on this laptop.
      server_checkouts: this.apps.getAllApplications().flatMap(a => {
        let server;
        try { server = this.servers.getServerById(a.server_id); } catch { return []; }
        if (server.is_local) return [];
        return [{
          app: a.name, server: server.name, host: server.host,
          path: server.apps_dir ? `${server.apps_dir}/${a.name}` : '(server not verified yet)',
          owner: a.owner_id ? owners.get(a.owner_id) || 'deleted customer' : 'admin',
        }];
      }),
      docker_note: 'Built images and running containers are stored by Docker on the machine that runs them: this laptop for local apps, the Linux server for apps deployed there (docker images / docker ps).',
    };
  }
}
