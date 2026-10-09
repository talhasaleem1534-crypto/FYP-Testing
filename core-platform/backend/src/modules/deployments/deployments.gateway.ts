import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';

const ADMINS = 'admins';
const userRoom = (id: string) => `user:${id}`;

/**
 * Live deploy logs over Socket.IO. The browser connects with `auth: { token }`.
 * The admin receives every deployment's events; a customer only receives events of their own apps.
 * CORS for the socket is configured centrally in main.ts (CorsIoAdapter).
 */
@WebSocketGateway()
export class DeploymentsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(DeploymentsGateway.name);

  constructor(private readonly authGuard: AuthGuard) {}

  handleConnection(client: Socket) {
    const token = client.handshake.auth?.token;
    const requester = this.authGuard.identify(
      token ? { authorization: `Bearer ${token}` } : {},
      client.handshake.address,
    );
    if (!requester) {
      this.logger.warn(`WebSocket ${client.id} rejected: not signed in`);
      client.disconnect(true);
      return;
    }
    client.data.requester = requester;
    client.join(requester.role === 'admin' ? ADMINS : userRoom(requester.id));
    this.logger.log(`WebSocket connected: ${client.id} (${requester.role} ${requester.email || requester.via})`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected from WebSocket: ${client.id}`);
  }

  /** Follow one deployment. Admin only - customers already get their own apps' events. */
  @SubscribeMessage('join_deployment')
  handleJoinDeployment(client: Socket, deploymentId: string) {
    if (client.data.requester?.role !== 'admin') return { status: 'forbidden', deploymentId };
    client.join(`deployment_${deploymentId}`);
    return { status: 'joined', deploymentId };
  }

  /** Rooms that may see a deployment owned by `ownerId` (the admin always; the owner if any). */
  private audience(ownerId?: string) {
    return ownerId ? this.server.to(ADMINS).to(userRoom(ownerId)) : this.server.to(ADMINS);
  }

  emitLog(deploymentId: string, logLine: string, ownerId?: string) {
    if (!this.server) return;
    const payload = { deploymentId, log: logLine, timestamp: new Date().toISOString() };
    this.server.to(`deployment_${deploymentId}`).emit('deploy_log', payload);
    this.audience(ownerId).emit('global_deploy_log', payload);
  }

  emitStatusChange(deploymentId: string, status: string, ownerId?: string) {
    if (!this.server) return;
    const payload = { deploymentId, status, timestamp: new Date().toISOString() };
    this.server.to(`deployment_${deploymentId}`).emit('status_change', payload);
    this.audience(ownerId).emit('global_status_change', payload);
  }
}
