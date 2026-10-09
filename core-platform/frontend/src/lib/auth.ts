import { setAuthToken, tryBackend } from './backend';

export interface Customer { id: string; name: string; email: string; role?: 'admin' | 'customer'; demo?: boolean }

/** The customer portal and the admin site keep separate logins, even in the same browser. */
export type Portal = 'customer' | 'admin';
const tokenKey = (portal: Portal) => `deploystack.token.${portal}`;

// Storage can be missing or throw (private windows, blocked storage), so every access is guarded.
// "Keep me signed in" = localStorage (survives closing the browser); otherwise sessionStorage (this tab only).
export function savedToken(portal: Portal): string | null {
  try { return localStorage.getItem(tokenKey(portal)) || sessionStorage.getItem(tokenKey(portal)); } catch { return null; }
}
function saveToken(portal: Portal, token: string | null, remember = true) {
  setAuthToken(token);
  try {
    localStorage.removeItem(tokenKey(portal));
    sessionStorage.removeItem(tokenKey(portal));
    if (token) (remember ? localStorage : sessionStorage).setItem(tokenKey(portal), token);
  } catch { /* ignore */ }
}

/** Sign in. The admin site only accepts the admin; the customer portal only accepts customers. */
export async function login(portal: Portal, email: string, password: string, remember = true): Promise<Customer> {
  const r = await tryBackend('/auth/login', 'POST', { email, password }, null);
  const role = r.user.role || 'customer';
  if ((portal === 'admin') !== (role === 'admin')) {
    // Wrong site for this account: end the session the backend just opened, so it doesn't linger.
    await tryBackend('/auth/logout', 'POST', {}, r.access_token).catch(() => {});
  }
  if (portal === 'admin' && role !== 'admin') throw new Error('This is a customer account. Choose "Customer" above to sign in.');
  if (portal === 'customer' && role === 'admin') throw new Error('This is the admin account. Choose "Platform owner" above to sign in.');
  saveToken(portal, r.access_token, remember);
  return r.user;
}

export async function register(name: string, email: string, password: string, remember = true): Promise<Customer> {
  const r = await tryBackend('/auth/register', 'POST', { name, email, password }, null);
  saveToken('customer', r.access_token, remember);
  return r.user;
}

/** First-time setup on the admin laptop: create the admin account. */
export async function setupAdmin(name: string, email: string, password: string, remember = true): Promise<Customer> {
  const r = await tryBackend('/auth/setup-admin', 'POST', { name, email, password }, null);
  saveToken('admin', r.access_token, remember);
  return r.user;
}

export async function authStatus(): Promise<{ admin_exists: boolean; on_admin_laptop: boolean }> {
  return tryBackend('/auth/status', 'GET', undefined, null);
}

/** The signed-in user for this portal's saved token, or null (no token, expired, wrong role, or backend down). */
export async function currentUser(portal: Portal): Promise<Customer | null> {
  const token = savedToken(portal);
  if (!token) return null;
  try {
    const user: Customer = await tryBackend('/auth/me', 'GET', undefined, token);
    if ((portal === 'admin') !== (user.role === 'admin')) return null;
    setAuthToken(token);
    return user;
  } catch { return null; }
}

export async function logout(portal: Portal): Promise<void> {
  const token = savedToken(portal);
  saveToken(portal, null);
  if (token) await tryBackend('/auth/logout', 'POST', {}, token).catch(() => {});
}
