import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Tiny JSON-file store so apps, servers and deployment history survive a backend restart.
 * Files live in PAAS_DATA_DIR (default ~/.paas-data), are written atomically, and are created
 * with mode 0600 because the server records can contain SSH private keys.
 * Set PAAS_PERSISTENCE=off to keep everything in memory only (used by tests).
 */
@Injectable()
export class PersistenceService implements OnApplicationShutdown {
  private readonly logger = new Logger(PersistenceService.name);
  private readonly dir = process.env.PAAS_DATA_DIR || path.join(os.homedir(), '.paas-data');
  private readonly enabled = (process.env.PAAS_PERSISTENCE || 'on') !== 'off';
  private timers = new Map<string, NodeJS.Timeout>();
  private pending = new Map<string, unknown>();

  private file(key: string) {
    return path.join(this.dir, `${key.replace(/[^a-z0-9_-]/gi, '_')}.json`);
  }

  /** Folder holding the JSON files (shown to the admin on the Data & Storage page). */
  get directory(): string {
    return this.dir;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Full path of the file that stores `key`. */
  filePath(key: string): string {
    return this.file(key);
  }

  load<T>(key: string, fallback: T): T {
    if (!this.enabled) return fallback;
    try {
      const f = this.file(key);
      if (!fs.existsSync(f)) return fallback;
      return JSON.parse(fs.readFileSync(f, 'utf8')) as T;
    } catch (err: any) {
      this.logger.error(`Could not read '${key}' (${err.message}); starting empty. A copy is kept as *.corrupt.`);
      try { fs.renameSync(this.file(key), this.file(key) + '.corrupt'); } catch { /* ignore */ }
      return fallback;
    }
  }

  /** Debounced: bursts of changes (e.g. streaming deploy logs) become one write. */
  save(key: string, value: unknown): void {
    if (!this.enabled) return;
    this.pending.set(key, value);
    if (this.timers.has(key)) return;
    this.timers.set(key, setTimeout(() => this.flush(key), 400));
  }

  private flush(key: string) {
    this.timers.delete(key);
    if (!this.pending.has(key)) return;
    const value = this.pending.get(key);
    this.pending.delete(key);
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const target = this.file(key);
      const tmp = `${target}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, target);
    } catch (err: any) {
      this.logger.error(`Could not save '${key}': ${err.message}`);
    }
  }

  onApplicationShutdown() {
    for (const key of Array.from(this.pending.keys())) {
      clearTimeout(this.timers.get(key));
      this.flush(key);
    }
  }
}
