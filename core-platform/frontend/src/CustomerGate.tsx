import React, { useEffect, useState } from 'react';
import LoginPage from './LoginPage';
import CustomerPortal from './CustomerPortal';
import { Loading, useBackendOk } from './AuthGate';
import { Customer, currentUser, logout } from './lib/auth';

/** The customer portal (`/`): login / sign-up page until a customer signs in, then their apps. */
export default function CustomerGate() {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [checking, setChecking] = useState(true);
  const backendOk = useBackendOk();

  useEffect(() => { currentUser('customer').then(c => { setCustomer(c); setChecking(false); }); }, []);

  if (checking) return <Loading />;
  if (!customer) return <LoginPage backendOk={backendOk} onLogin={setCustomer} />;
  return <CustomerPortal customer={customer} onLogout={async () => { await logout('customer'); setCustomer(null); }} />;
}
