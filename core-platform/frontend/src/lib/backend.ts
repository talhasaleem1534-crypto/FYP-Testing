// When opened from another device (window.location.hostname is an IP like 192.168.x.x),
// route requests to that machine on port 3000 rather than hardcoded localhost.
const envBackend = import.meta.env?.VITE_BACKEND_URL;
export const BACKEND_URL: string =
  typeof window !== 'undefined' && window.location?.hostname && !['localhost', '127.0.0.1'].includes(window.location.hostname)
    ? `http://${window.location.hostname}:3000`
    : (envBackend || 'http://localhost:3000');

// The signed-in user's token for this page (customer portal or admin site). Set by lib/auth.
let authToken: string | null = null;
export const setAuthToken = (token: string | null) => { authToken = token; };
export const getAuthToken = () => authToken;

/** Call the core-platform backend. Throws an Error carrying the backend's own message on failure. */
export const tryBackend = async (path: string, method = 'GET', body?: object, token: string | null = authToken) => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const opts: RequestInit = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${BACKEND_URL}${path}`, opts);
  if (!r.ok) {
    const text = await r.text();
    let msg = text;
    try { const j = JSON.parse(text); msg = Array.isArray(j.message) ? j.message.join('; ') : (j.message || text); } catch { /* not JSON */ }
    throw new Error(msg);
  }
  return r.json();
};
