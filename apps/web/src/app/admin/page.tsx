'use client';

import './admin.css';

import { AdminDashboard } from './AdminDashboard';
import { AdminKeyGate } from './AdminKeyGate';

// Internal-only admin surface. Not linked from marketing nav, and excluded
// from the sitemap/robots (see apps/web/src/app/robots.ts) — it is reached
// only by whoever holds an admin key.
export default function AdminPage() {
  return (
    <AdminKeyGate>
      {(adminKey, signOut) => (
        <div className="cva-admin">
          <header className="cva-topbar">
            <span className="cva-brand">Chain Verify Admin</span>
            <button type="button" className="cva-btn-secondary" onClick={signOut}>
              Sign out
            </button>
          </header>
          <AdminDashboard adminKey={adminKey} onAuthError={signOut} />
        </div>
      )}
    </AdminKeyGate>
  );
}
