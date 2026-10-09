import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NodeSSH } from 'node-ssh';
import { Logger } from '@nestjs/common';

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface ExecOptions {
  cwd?: string;
  timeoutMs?: number;
  /** Called for every non-empty output line (stdout and stderr) while the command runs. */
  onLine?: (line: string) => void;
}

/**
 * The machine a deployment runs on. Every git / docker / file step of the pipeline goes through
 * this interface, so the same code deploys to this machine (LocalHost) or to a customer's Linux
 * server over SSH (SshHost) - exactly how Coolify works: it is an SSH orchestrator.
 */
export interface Host {
  readonly kind: 'local' | 'ssh';
  /** e.g. "this machine" or "deploy@192.168.1.30" - used in log lines. */
  readonly label: string;
  exec(file: string, args: string[], opts?: ExecOptions): Promise<ExecResult>;
  exists(p: string): Promise<boolean>;
  readFile(p: string): Promise<string>;
  writeFile(p: string, content: string): Promise<void>;
  listDir(p: string): Promise<{ name: string; dir: boolean }[]>;
  mkdirp(p: string): Promise<void>;
  removeTree(p: string): Promise<void>;
  /** Path helpers for this host's OS (Windows paths locally, Linux paths on a server). */
  join(...parts: string[]): string;
  dirname(p: string): string;
  close(): void;
}

/** Splits streamed output into lines for onLine. */
function lineSplitter(onLine?: (line: string) => void) {
  let partial = '';
  return (chunk: Buffer | string) => {
    if (!onLine) return;
    partial += chunk.toString();
    const lines = partial.split(/\r?\n/);
    partial = lines.pop() ?? '';
    lines.forEach(l => l.trim() && onLine(l.trim()));
  };
}

// ── This machine ─────────────────────────────────────────────────────────────

export class LocalHost implements Host {
  readonly kind = 'local' as const;
  readonly label = 'this machine';
  private readonly logger = new Logger('LocalHost');

  private env(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      // Never block waiting for a git username/password on a headless server.
      GIT_TERMINAL_PROMPT: '0',
      GCM_INTERACTIVE: 'never',
    };
    // Docker Desktop on Windows sometimes isn't on the PATH of a service-started Node.
    const extraPaths = [
      path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'DockerDesktop', 'resources', 'bin'),
      'C:\\Program Files\\Docker\\Docker\\resources\\bin',
      'C:\\Program Files\\Docker\\Docker\\resources',
    ].filter(p => fs.existsSync(p));
    if (extraPaths.length) {
      const current = env.PATH || env.Path || '';
      env.PATH = [...extraPaths, current].join(path.delimiter);
      if (process.platform === 'win32') env.Path = env.PATH;
    }
    return env;
  }

  /**
   * Run a program WITHOUT a shell. Arguments are passed as an array, so repo URLs,
   * branch names, env values etc. can never be interpreted as shell syntax, and the
   * same code works on Windows, macOS and Linux.
   */
  exec(file: string, args: string[], opts: ExecOptions = {}): Promise<ExecResult> {
    const { cwd, timeoutMs = 300_000, onLine } = opts;
    this.logger.log(`[EXEC] ${file} ${args.join(' ')}`);

    return new Promise(resolve => {
      let stdout = '';
      let stderr = '';
      let settled = false;
      const done = (r: ExecResult) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(r);
        }
      };

      let child;
      try {
        child = spawn(file, args, { cwd: cwd || os.tmpdir(), env: this.env(), shell: false });
      } catch (err: any) {
        return resolve({ stdout: '', stderr: err.message, code: 1 });
      }

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        done({ stdout, stderr: `${stderr}\nTimed out after ${timeoutMs}ms`.trim(), code: 124 });
      }, timeoutMs);

      const outLines = lineSplitter(onLine);
      const errLines = lineSplitter(onLine);
      child.stdout.on('data', (c: Buffer) => { stdout += c.toString('utf8'); outLines(c); });
      child.stderr.on('data', (c: Buffer) => { stderr += c.toString('utf8'); errLines(c); });
      child.on('error', (err: any) => {
        const msg = err.code === 'ENOENT' ? `'${file}' was not found on PATH` : err.message;
        onLine?.(`ERROR: ${msg}`);
        done({ stdout, stderr: msg, code: 127 });
      });
      child.on('close', code => done({ stdout: stdout.trim(), stderr: stderr.trim(), code: code ?? 1 }));
    });
  }

  async exists(p: string) { return fs.existsSync(p); }
  async readFile(p: string) { return fs.readFileSync(p, 'utf8'); }
  async writeFile(p: string, content: string) { fs.writeFileSync(p, content); }
  async listDir(p: string) {
    return fs.readdirSync(p, { withFileTypes: true }).map(e => ({ name: e.name, dir: e.isDirectory() }));
  }
  async mkdirp(p: string) { fs.mkdirSync(p, { recursive: true }); }
  async removeTree(p: string) { fs.rmSync(p, { recursive: true, force: true, maxRetries: 3 }); }
  join(...parts: string[]) { return path.join(...parts); }
  dirname(p: string) { return path.dirname(p); }
  close() { /* nothing to close */ }
}

// ── A Linux server over SSH ──────────────────────────────────────────────────

/** Quote one argument for the remote POSIX shell: 'it'\''s' - nothing inside can be shell syntax. */
export function shellQuote(s: string): string {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

export interface SshTarget {
  host: string;
  port: number;
  username: string;
  privateKey: string;
}

/** Turn ssh2's error into something a beginner can act on. */
export function explainSshError(err: any, target: { host: string; port: number; username: string }): string {
  const msg: string = err?.message || String(err);
  const code: string = err?.code || '';
  if (code === 'ECONNREFUSED' || /ECONNREFUSED/.test(msg)) {
    return `Nothing is listening for SSH on ${target.host}:${target.port}. On the server run: sudo apt install -y openssh-server && sudo systemctl enable --now ssh`;
  }
  if (['ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH'].includes(code) || /Timed out while waiting for handshake|ETIMEDOUT|EHOSTUNREACH/.test(msg)) {
    return `Cannot reach ${target.host}. Is the server on, on the same network, and is the IP right? (check with: ip -4 addr on the server)`;
  }
  if (code === 'ENOTFOUND' || /ENOTFOUND|getaddrinfo/.test(msg)) {
    return `The address '${target.host}' could not be found. Use the server's IP address (e.g. 192.168.1.30).`;
  }
  if (/authentication methods failed|All configured authentication/i.test(msg)) {
    return `The server refused the key for user '${target.username}'. Run the "trust the platform" command (step 2) on the server while logged in as ${target.username}, then try again.`;
  }
  if (/Cannot parse privateKey|Unsupported key format/i.test(msg)) {
    return `The private key could not be read (${msg}). Leave the key empty to use the platform key instead.`;
  }
  return msg;
}

export class SshHost implements Host {
  readonly kind = 'ssh' as const;
  readonly label: string;
  private readonly logger = new Logger('SshHost');

  private constructor(private readonly ssh: NodeSSH, target: SshTarget) {
    this.label = `${target.username}@${target.host}`;
  }

  /** Open the SSH connection. Throws an Error whose message explains how to fix the problem. */
  static async connect(target: SshTarget): Promise<SshHost> {
    const ssh = new NodeSSH();
    try {
      await ssh.connect({
        host: target.host,
        port: target.port,
        username: target.username,
        privateKey: target.privateKey,
        readyTimeout: 15_000,
        keepaliveInterval: 10_000,
      });
    } catch (err: any) {
      ssh.dispose();
      throw new Error(explainSshError(err, target));
    }
    return new SshHost(ssh, target);
  }

  /**
   * Same contract as LocalHost.exec. Every argument is single-quoted, and `timeout` (coreutils)
   * stops the remote program if it runs too long. Exit code 124 = timed out, like locally.
   */
  async exec(file: string, args: string[], opts: ExecOptions = {}): Promise<ExecResult> {
    const { cwd, timeoutMs = 300_000, onLine } = opts;
    const secs = Math.max(1, Math.ceil(timeoutMs / 1000));
    const program = [file, ...args].map(shellQuote).join(' ');
    const command = `${cwd ? `cd ${shellQuote(cwd)} && ` : ''}GIT_TERMINAL_PROMPT=0 timeout ${secs} ${program}`;
    this.logger.log(`[SSH ${this.label}] ${file} ${args.join(' ')}`);
    try {
      const r = await this.ssh.execCommand(command, { onStdout: lineSplitter(onLine), onStderr: lineSplitter(onLine) });
      let code = r.code ?? 1;
      let stderr = r.stderr;
      if (code === 127 && /not found/.test(stderr)) {
        stderr = `'${file}' is not installed on the server (${stderr})`;
        onLine?.(`ERROR: ${stderr}`);
      }
      if (code === 124) stderr = `${stderr}\nTimed out after ${timeoutMs}ms`.trim();
      return { stdout: r.stdout.trim(), stderr: stderr.trim(), code };
    } catch (err: any) {
      onLine?.(`ERROR: SSH connection problem: ${err.message}`);
      return { stdout: '', stderr: `SSH connection problem: ${err.message}`, code: 255 };
    }
  }

  private async sh(script: string, stdin?: string): Promise<ExecResult> {
    const r = await this.ssh.execCommand(script, stdin !== undefined ? { stdin } : {});
    return { stdout: r.stdout, stderr: r.stderr, code: r.code ?? 1 };
  }

  async exists(p: string) { return (await this.sh(`test -e ${shellQuote(p)}`)).code === 0; }

  async readFile(p: string) {
    const r = await this.sh(`cat ${shellQuote(p)}`);
    if (r.code !== 0) throw new Error(`Cannot read ${p} on the server: ${r.stderr}`);
    return r.stdout;
  }

  async writeFile(p: string, content: string) {
    const r = await this.sh(`cat > ${shellQuote(p)}`, content);
    if (r.code !== 0) throw new Error(`Cannot write ${p} on the server: ${r.stderr}`);
  }

  async listDir(p: string) {
    // One line per entry: "d name" or "f name" (works with GNU and busybox find).
    const r = await this.sh(`cd ${shellQuote(p)} && for e in * .[!.]*; do [ -e "$e" ] || continue; if [ -d "$e" ]; then echo "d $e"; else echo "f $e"; fi; done`);
    if (r.code !== 0) throw new Error(`Cannot list ${p} on the server: ${r.stderr}`);
    return r.stdout.split('\n').filter(Boolean).map(l => ({ name: l.slice(2), dir: l[0] === 'd' }));
  }

  async mkdirp(p: string) {
    const r = await this.sh(`mkdir -p ${shellQuote(p)}`);
    if (r.code !== 0) throw new Error(`Cannot create ${p} on the server: ${r.stderr}`);
  }

  async removeTree(p: string) {
    const r = await this.sh(`rm -rf -- ${shellQuote(p)}`);
    if (r.code !== 0) throw new Error(`Cannot delete ${p} on the server: ${r.stderr}`);
  }

  join(...parts: string[]) { return path.posix.join(...parts); }
  dirname(p: string) { return path.posix.dirname(p); }
  close() { this.ssh.dispose(); }
}
