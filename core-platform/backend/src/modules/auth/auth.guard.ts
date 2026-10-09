import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { timingSafeEqual } from 'crypto';
import { AuthService } from './auth.service';
import { ADMIN_ONLY, IS_PUBLIC, isLoopback, Requester, trustLocalhost } from './requester';

const sameSecret = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Runs before every HTTP route. Works out who is calling (see Requester) and blocks:
 *  - anyone not signed in, unless the route is @Public()
 *  - customers on @AdminOnly() routes
 * Customers' access to individual apps/deployments is checked in the services (owner_id).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly auth: AuthService) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (ctx.getType() !== 'http') return true;
    const targets = [ctx.getHandler(), ctx.getClass()];
    const req = ctx.switchToHttp().getRequest();
    req.requester = this.identify(req.headers, req.socket?.remoteAddress);

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    if (!req.requester) throw new UnauthorizedException('Please sign in first.');
    if (this.reflector.getAllAndOverride<boolean>(ADMIN_ONLY, targets) && req.requester.role !== 'admin') {
      throw new ForbiddenException('Only the platform admin can do this.');
    }
    return true;
  }

  /** Shared with the WebSocket gateway. */
  identify(headers: Record<string, any>, remoteAddress?: string): Requester | null {
    const authHeader: string | undefined = headers?.authorization;
    if (authHeader) {
      // A token was sent: it must be valid. Never fall back to "localhost admin" for a bad token.
      const user = this.auth.userFromAuthHeader(authHeader);
      return user ? this.auth.toRequester(user) : null;
    }
    const internal = process.env.INTERNAL_API_TOKEN;
    const given = headers?.['x-internal-token'];
    if (internal && typeof given === 'string' && sameSecret(given, internal)) {
      return { id: 'internal', role: 'admin', name: 'Platform service', email: '', via: 'internal' };
    }
    if (trustLocalhost() && isLoopback(remoteAddress)) {
      return { id: 'localhost', role: 'admin', name: 'Admin laptop', email: '', via: 'localhost' };
    }
    return null;
  }
}
