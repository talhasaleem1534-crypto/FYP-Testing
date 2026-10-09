export type DeploymentStatus = 'queued' | 'building' | 'deploying' | 'success' | 'failed';

export interface Deployment {
  id: string;
  application_id: string;
  app_name: string;
  server_id: string;
  /** Copied from the app when the deploy starts, so live logs only go to this customer (and the admin). */
  owner_id?: string;
  commit_sha: string;
  commit_message: string;
  status: DeploymentStatus;
  logs: string[];
  created_at: string;
  finished_at?: string;
  /** Set on success. `app_url` assumes the browser runs on the Docker host; clients can rebuild it from host_port. */
  app_url?: string;
  domain_url?: string;
  host_port?: number;
}
