import React from 'react';
import ReactDOM from 'react-dom/client';
import CustomerGate from './CustomerGate';
import AdminGate from './AdminGate';
import './index.css';

// Two sites from one build:
//   /        customer portal (customers open this from their own device)
//   /admin   admin site (the platform owner, on the admin laptop)
const isAdminSite = window.location.pathname.replace(/\/+$/, '').startsWith('/admin');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isAdminSite ? <AdminGate /> : <CustomerGate />}
  </React.StrictMode>,
);
