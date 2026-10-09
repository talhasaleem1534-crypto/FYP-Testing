import React, { useEffect, useState } from 'react';
import App from './App';
import LoginPage from './LoginPage';
import { Loading, useBackendOk } from './AuthGate';
import { authStatus, Customer, currentUser, logout } from './lib/auth';

/**
 * The admin site (`/admin`). The first time, on the admin laptop, the sign-in page asks to create the
 * owner account; after that it asks the owner to sign in. "Try the demo" opens the dashboard with sample data.
 */
export default function AdminGate() {
  const [admin, setAdmin] = useState<Customer | null>(null);
  const [checking, setChecking] = useState(true);
  const [status, setStatus] = useState<{ admin_exists: boolean; on_admin_laptop: boolean } | null>(null);
  const backendOk = useBackendOk();

  useEffect(() => {
    Promise.all([currentUser('admin'), authStatus().catch(() => null)]).then(([u, st]) => {
      setAdmin(u); setStatus(st); setChecking(false);
    });
  }, [backendOk]);

  if (checking) return <Loading />;
  if (admin) {
    return <App customer={admin} startInDemo={!!admin.demo}
      onLogout={async () => { if (!admin.demo) await logout('admin'); setAdmin(null); }} />;
  }
  return <LoginPage portal="admin" lockPortal status={status} backendOk={backendOk} onLogin={setAdmin}
    onDemo={() => setAdmin({ id: 'demo', name: 'Demo admin', email: 'demo mode', role: 'admin', demo: true })} />;
}
