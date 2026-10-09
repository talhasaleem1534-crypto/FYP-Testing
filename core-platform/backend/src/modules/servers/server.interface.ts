export type ServerStatus = 'pending' | 'verified' | 'unreachable';

/** One line of the "Connect & verify" checklist (SSH, Docker, git, apps folder, network). */
export interface ServerCheck {
  key: 'ssh' | 'docker' | 'git' | 'folder' | 'network';
  label: string;
  ok: boolean;
  detail: string;
  /** What to run / do on the server when the check fails. */
  fix?: string;
}

export interface Server {
  id: string;
  name: string;
  host: string;
  port: number;
  ssh_user: string;
  /** Own key pasted at registration. Empty = the platform key is used. Never returned by the API - see ServersService.safeServer(). */
  ssh_private_key: string;
  auth_method?: 'platform_key' | 'private_key';
  status: ServerStatus;
  docker_version?: string;
  docker_available: boolean;
  is_local: boolean;
  /** Where apps are cloned on that machine (for SSH servers: <home>/paas-apps, found during verification). */
  apps_dir: string;
  last_error?: string;
  checks?: ServerCheck[];
  verified_at?: string;
  /** The customer who registered it. Empty = registered by the admin. */
  owner_id?: string;
  /** Admin servers only: customers may deploy here. */
  shared?: boolean;
  created_at: string;
}
