import { Injectable } from '@nestjs/common';

export interface TraefikLabelConfig {
  appName: string;
  domain: string;
  port?: number;
  /** Request a certificate and serve HTTPS. Only works for real, publicly resolvable domains. */
  enableTls?: boolean;
}

@Injectable()
export class ProxyService {
  /**
   * Plain `key=value` labels for `docker run --label`. They are passed to Docker as
   * separate arguments (no shell), so the backticks in Traefik's Host(`...`) rule are safe.
   */
  generateTraefikLabels(config: TraefikLabelConfig): string[] {
    const { appName, domain, port = 3000 } = config;
    const enableTls = config.enableTls ?? process.env.TRAEFIK_ENABLE_TLS === 'true';
    const resolver = process.env.TRAEFIK_CERT_RESOLVER || 'letsencrypt';
    const name = appName.toLowerCase().replace(/[^a-z0-9-_]/g, '-');

    const labels = [
      'traefik.enable=true',
      `traefik.http.routers.${name}.rule=Host(\`${domain}\`)`,
      `traefik.http.routers.${name}.entrypoints=${enableTls ? 'web,websecure' : 'web'}`,
      `traefik.http.services.${name}.loadbalancer.server.port=${port}`,
      'traefik.docker.network=paas-net',
      `paas.app=${appName}`,
    ];

    if (enableTls) {
      labels.push(
        `traefik.http.routers.${name}.tls=true`,
        `traefik.http.routers.${name}.tls.certresolver=${resolver}`,
      );
    }

    return labels;
  }
}
