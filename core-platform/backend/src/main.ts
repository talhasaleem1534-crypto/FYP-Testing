import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger, INestApplicationContext } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { AppModule } from './app.module';
import { lanAddresses } from './modules/admin/admin.service';

const FRONTEND_PORTS = [Number(process.env.FRONTEND_PORT) || 5173, 4173]; // vite dev, vite preview

/**
 * Check whether an origin should be allowed for CORS and WebSocket connections.
 * Allows localhost, all private LAN/hotspot IPs (192.168.x, 10.x, 172.16-31.x),
 * and dynamic host addresses so mobile hotspot or WiFi changes never break customer access.
 */
function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  const configured = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);
  if (configured.includes('*') || configured.includes(origin)) return true;

  // Allow any loopback origin
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;

  // Allow any private LAN or hotspot IPv4 address
  if (/^https?:\/\/(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/.test(origin)) return true;

  // Dynamically check host's current network interface IPs
  const lan = lanAddresses().flatMap(ip => FRONTEND_PORTS.map(port => `http://${ip}:${port}`));
  return lan.includes(origin);
}

/** Socket.IO adapter that applies the same dynamic CORS allow-list as the REST API. */
class CorsIoAdapter extends IoAdapter {
  constructor(app: INestApplicationContext) {
    super(app);
  }
  createIOServer(port: number, options?: any) {
    return super.createIOServer(port, {
      ...options,
      cors: {
        origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
          callback(null, isAllowedOrigin(origin));
        },
        credentials: true,
      },
    });
  }
}

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  // rawBody: true keeps the unparsed request body so webhook signatures can be verified.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });

  app.enableCors({
    origin: (origin, callback) => {
      callback(null, isAllowedOrigin(origin));
    },
    credentials: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type,Accept,Authorization,X-Requested-With',
  });
  app.useWebSocketAdapter(new CorsIoAdapter(app));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );
  app.enableShutdownHooks();

  const port = Number(process.env.PORT) || 3000;
  // Loopback by default: this API can build and run containers, so don't expose it to the
  // network unless asked. For customers on other devices set HOST=0.0.0.0 in .env.
  const host = process.env.HOST || '127.0.0.1';
  await app.listen(port, host);
  logger.log(`🚀 Core Platform Backend running on http://${host}:${port}`);
  const ips = lanAddresses();
  if (['127.0.0.1', 'localhost', '::1'].includes(host)) {
    logger.warn(`Only this laptop can reach the backend. For customers on other devices set HOST=0.0.0.0 in core-platform/backend/.env`);
  } else if (ips.length) {
    logger.log(`👤 Customer portal (other devices on this network): ${ips.map(ip => `http://${ip}:${FRONTEND_PORTS[0]}/`).join('  ')}`);
    logger.log(`🛠️  Admin site (this laptop): http://localhost:${FRONTEND_PORTS[0]}/admin`);
  }
}

bootstrap();
