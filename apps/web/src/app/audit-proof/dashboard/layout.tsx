import { requireAuth } from '@/lib/auth-guard';
import type { ReactNode } from 'react';

export default async function AuditProofDashboardLayout({ children }: { children: ReactNode }) {
  await requireAuth('/audit-proof/dashboard');
  return <>{children}</>;
}
