import { ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { PersistenceService } from '../persistence/persistence.service';
import { Requester, Role } from './requester';

/** A customer or admin account. password_hash is never sent to the browser - see publicUser(). */
export interface User {
  id: string;
  name: string;
  email: string;
  /** Accounts created before roles existed have no role: they are customers. */
  role?: Role;
  password_salt: string;
  password_hash: string;
  created_at: string;
  last_login_at?: string;
}

interface Session {
  token: string;
  user_id: string;
  expires_at: string;
}

const SESSION_DAYS = 7;

/** scrypt is built into Node: slow on purpose, so stolen hashes are hard to brute-force. */
function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString('hex');
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private users = new Map<string, User>();
  private sessions = new Map<string, Session>();

  constructor(private readonly store: PersistenceService) {
    for (const u of this.store.load<User[]>('users', [])) this.users.set(u.id, u);
    const now = Date.now();
    for (const s of this.store.load<Session[]>('sessions', [])) {
      if (new Date(s.expires_at).getTime() > now) this.sessions.set(s.token, s);
    }
  }

  private persist() {
    this.store.save('users', Array.from(this.users.values()));
    this.store.save('sessions', Array.from(this.sessions.values()));
  }

  publicUser(u: User) {
    return { id: u.id, name: u.name, email: u.email, role: u.role || 'customer', created_at: u.created_at, last_login_at: u.last_login_at };
  }

  toRequester(u: User): Requester {
    return { id: u.id, role: u.role || 'customer', name: u.name, email: u.email, via: 'token' };
  }

  hasAdmin(): boolean {
    return Array.from(this.users.values()).some(u => u.role === 'admin');
  }

  getUser(id: string): User | undefined {
    return this.users.get(id);
  }

  allUsers(): User[] {
    return Array.from(this.users.values());
  }

  activeSessions(userId: string): number {
    const now = Date.now();
    return Array.from(this.sessions.values()).filter(s => s.user_id === userId && new Date(s.expires_at).getTime() > now).length;
  }

  private findByEmail(email: string): User | undefined {
    const wanted = email.trim().toLowerCase();
    return Array.from(this.users.values()).find(u => u.email === wanted);
  }

  private startSession(user: User) {
    user.last_login_at = new Date().toISOString();
    const session: Session = {
      token: randomBytes(32).toString('hex'),
      user_id: user.id,
      expires_at: new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString(),
    };
    this.sessions.set(session.token, session);
    this.persist();
    return { access_token: session.token, expires_at: session.expires_at, user: this.publicUser(user) };
  }

  /** Customers sign up here. Always creates a customer - never an admin. */
  register(dto: { name: string; email: string; password: string }) {
    return this.createUser(dto, 'customer');
  }

  /**
   * Create the one admin account. Only allowed while no admin exists, and only from the admin
   * laptop itself (the controller checks the request comes from localhost).
   */
  setupAdmin(dto: { name: string; email: string; password: string }) {
    if (this.hasAdmin()) throw new ConflictException('The admin account already exists. Sign in instead.');
    return this.createUser(dto, 'admin');
  }

  private createUser(dto: { name: string; email: string; password: string }, role: Role) {
    const email = dto.email.trim().toLowerCase();
    if (this.findByEmail(email)) throw new ConflictException('An account with this email already exists. Sign in instead.');
    const salt = randomBytes(16).toString('hex');
    const user: User = {
      id: uuidv4(),
      name: dto.name.trim(),
      email,
      role,
      password_salt: salt,
      password_hash: hashPassword(dto.password, salt),
      created_at: new Date().toISOString(),
    };
    this.users.set(user.id, user);
    this.logger.log(`New ${role} account: ${email}`);
    return this.startSession(user);
  }

  login(dto: { email: string; password: string }) {
    const user = this.findByEmail(dto.email);
    // Same message whether the email or the password is wrong, so emails can't be probed.
    const fail = () => new UnauthorizedException('Wrong email or password.');
    if (!user) throw fail();
    const given = Buffer.from(hashPassword(dto.password, user.password_salt), 'hex');
    const stored = Buffer.from(user.password_hash, 'hex');
    if (given.length !== stored.length || !timingSafeEqual(given, stored)) throw fail();
    return this.startSession(user);
  }

  /** The user behind an `Authorization: Bearer <token>` header, or null. */
  userFromAuthHeader(header: string | undefined): User | null {
    const token = (header || '').replace(/^Bearer\s+/i, '').trim();
    const session = token ? this.sessions.get(token) : undefined;
    if (!session) return null;
    if (new Date(session.expires_at).getTime() <= Date.now()) {
      this.sessions.delete(token);
      this.persist();
      return null;
    }
    return this.users.get(session.user_id) || null;
  }

  logout(header: string | undefined) {
    const token = (header || '').replace(/^Bearer\s+/i, '').trim();
    if (this.sessions.delete(token)) this.persist();
    return { logged_out: true };
  }
}
