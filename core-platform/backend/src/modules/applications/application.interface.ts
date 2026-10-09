export type AppStatus = 'idle' | 'building' | 'running' | 'failed' | 'stopped';

export interface Application {
  id: string;
  name: string;
  repo_url: string;
  branch: string;
  server_id: string;
  build_method: 'dockerfile' | 'nixpacks' | 'compose';
  /** What the customer picked in "What type of app is this?" (see app-types.ts). Older records: 'auto'. */
  app_type?: string;
  /** Optional override of the app type's start command. */
  start_command?: string;
  /** The customer who created the app. Empty = created by the admin. */
  owner_id?: string;
  domain: string;
  port: number;           // Container port (inside Docker)
  host_port: number;      // Mapped host port (accessible from browser)
  env_vars: Record<string, string>;
  replicas: number;
  status: AppStatus;
  current_image?: string; // Image the running containers were started from
  current_commit_sha?: string;
  last_deployed_at?: string;
  created_at: string;
  updated_at: string;
}
