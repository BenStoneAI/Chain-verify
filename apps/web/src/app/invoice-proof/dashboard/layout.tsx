import { requireAuth } from '@/lib/auth-guard';
import type { ReactNode } from 'react';

export default async function InvoiceProofDashboardLayout({ children }: { children: ReactNode }) {
  await requireAuth('/invoice-proof/dashboard');
  return <>{children}</>;
}
