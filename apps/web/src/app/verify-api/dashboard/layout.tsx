import { requireAuth } from '@/lib/auth-guard';
import type { ReactNode } from 'react';

export default async function VerifyApiDashboardLayout({ children }: { children: ReactNode }) {
  await requireAuth('/verify-api/dashboard');
  return <>{children}</>;
}
