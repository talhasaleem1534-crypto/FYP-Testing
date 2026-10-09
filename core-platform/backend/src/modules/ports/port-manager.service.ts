import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class PortManagerService {
  private readonly logger = new Logger(PortManagerService.name);
  private readonly BASE_PORT = 4000;
  private readonly MAX_PORT = 5000;
  private usedPorts: Set<number> = new Set([3000, 8001, 8080, 9090]); // reserved

  allocatePort(appName?: string): number {
    for (let p = this.BASE_PORT; p <= this.MAX_PORT; p++) {
      if (!this.usedPorts.has(p)) {
        this.usedPorts.add(p);
        this.logger.log(`Allocated port ${p}${appName ? ' for ' + appName : ''}`);
        return p;
      }
    }
    throw new Error('No available ports in range 4000–5000');
  }

  /** Re-reserve a port that was allocated before a restart. */
  markUsed(port: number): void {
    this.usedPorts.add(port);
  }

  releasePort(port: number): void {
    this.usedPorts.delete(port);
    this.logger.log(`Released port ${port}`);
  }

  isPortUsed(port: number): boolean {
    return this.usedPorts.has(port);
  }
}
