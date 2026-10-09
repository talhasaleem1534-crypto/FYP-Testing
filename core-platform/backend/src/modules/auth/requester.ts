import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';

export type Role = 'admin' | 'customer';

/**
 * Who is making a request:
 *  - 'token'     a signed-in customer or admin (Authorization: Bearer <token>)
 *  - 'localhost' a request without a token from the admin laptop itself (curl, tests, the AI engine)
 *  - 'internal'  another platform service presenting INTERNAL_API_TOKEN (e.g. the AI engine in Docker)
 * Only 'token' requesters can be customers; the other two act as admin.
 */
export interface Requester {
  id: string;
  role: Role;
  name: string;
  email: string;
  via: 'token' | 'localhost' | 'internal';
}

export const isAdmin = (r?: Requester) => !r || r.role === 'admin';

/** The requester the AuthGuard attached to the request. */
export const CurrentRequester = createParamDecorator((_: unknown, ctx: ExecutionContext): Requester =>
  ctx.switchToHttp().getRequest().requester);

export const IS_PUBLIC = 'auth:public';
/** Anyone may call this route, signed in or not. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ADMIN_ONLY = 'auth:adminOnly';
/** Only the admin (or the admin laptop itself) may call this route. */
export const AdminOnly = () => SetMetadata(ADMIN_ONLY, true);

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
export const isLoopback = (address?: string) => !!address && LOOPBACK.has(address);

/** Requests from the admin laptop without a token are trusted as admin unless PAAS_TRUST_LOCALHOST=off. */
export const trustLocalhost = () => (process.env.PAAS_TRUST_LOCALHOST || 'on') !== 'off';
