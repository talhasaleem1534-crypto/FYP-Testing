import React from 'react';
import ReactDOM from 'react-dom/client';
import Landing from './Landing';
import CustomerGate from './CustomerGate';
import AdminGate from './AdminGate';
import './index.css';

// Three pages from one build:
//   /          public front page (what OmniDeploy is, sign-in / create-account buttons)
//   /login     customer portal (customers open this from their own device; /login?signup opens Create account)
//   /admin     admin site (the platform owner, on the admin laptop)
const path = window.location.pathname.replace(/\/+$/, '');
const page = path.startsWith('/admin') ? <AdminGate /> : path.startsWith('/login') ? <CustomerGate /> : <Landing />;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{page}</React.StrictMode>,
);
