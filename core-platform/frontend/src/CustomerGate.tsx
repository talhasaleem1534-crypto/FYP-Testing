import React, { useEffect, useState } from 'react';
import LoginPage from './LoginPage';
import CustomerPortal from './CustomerPortal';
import { Loading, useBackendOk } from './AuthGate';
import { authStatus, Customer, currentUser, logout } from './lib/auth';

/**
 * The customer portal (`/`): the sign-in page until a customer signs in, then their apps.
 * The platform owner can also sign in here; they are then sent to the admin site (/admin).
 */
export default function CustomerGate() {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [checking, setChecking] = useState(true);
  const [status, setStatus] = useState<{ admin_exists: boolean; on_admin_laptop: boolean } | null>(null);
  const backendOk = useBackendOk();

  useEffect(() => { currentUser('customer').then(c => { setCustomer(c); setChecking(false); }); }, []);
  useEffect(() => { authStatus().then(setStatus).catch(() => setStatus(null)); }, [backendOk]);

  if (checking) return <Loading />;
  if (!customer) {
    // /?signup opens the Create account tab straight away (handy link for new customers).
    const signup = typeof window !== 'undefined' && /(^|[?&])signup(=|&|$)/.test(window.location.search || '');
    return <LoginPage backendOk={backendOk} status={status} initialMode={signup ? 'register' : 'login'}
      onLogin={(user, portal) => { if (portal === 'admin') window.location.assign('/admin'); else setCustomer(user); }} />;
  }
  return <CustomerPortal customer={customer} onLogout={async () => { await logout('customer'); setCustomer(null); }} />;
}
