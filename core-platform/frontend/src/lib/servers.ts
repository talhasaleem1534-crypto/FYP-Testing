/** One line of a server's "Connect & check" result (SSH, Docker, git, apps folder, network). */
export interface ServerCheck { key: string; label: string; ok: boolean; detail: string; fix?: string }

export interface ServerRecord {
  id: string; name: string; host: string; port: number; ssh_user: string; status: string;
  docker_version?: string; last_error?: string; checks?: ServerCheck[];
  is_local?: boolean; shared?: boolean; owner_id?: string; auth_method?: string; apps_dir?: string;
}

export interface PlatformKeyInfo { public_key: string; trust_command: string; prepare_commands: string[] }

/** Used when the backend is offline (Demo Mode). */
export const DEMO_KEY: PlatformKeyInfo = {
  public_key: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDemoDemoDemoDemoDemoDemoDemoDemoDemoDemo deploystack-platform',
  trust_command: "mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDemoDemoDemoDemoDemoDemoDemoDemoDemoDemo deploystack-platform' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys",
  prepare_commands: [
    'sudo apt update && sudo apt install -y openssh-server git curl',
    'curl -fsSL https://get.docker.com | sudo sh',
    'sudo usermod -aG docker $USER   # then log out and log in again',
    'ip -4 addr   # the server IP, e.g. 192.168.1.30',
  ],
};

export function demoVerifiedServer(f: { name: string; host: string; port: number; ssh_user: string }): ServerRecord {
  return {
    id: 'srv-' + Date.now(), ...f, status: 'verified', docker_version: 'Docker 27.0.3 (simulated)', shared: true, auth_method: 'platform_key',
    checks: [
      { key: 'ssh', label: 'SSH connection', ok: true, detail: `Logged in as ${f.ssh_user}` },
      { key: 'docker', label: 'Docker', ok: true, detail: 'Docker 27.0.3 (simulated)' },
      { key: 'git', label: 'git', ok: true, detail: 'git version 2.43.0' },
      { key: 'folder', label: 'Apps folder', ok: true, detail: `/home/${f.ssh_user}/paas-apps` },
      { key: 'network', label: 'Docker network', ok: true, detail: 'paas-net ready' },
    ],
  };
}
