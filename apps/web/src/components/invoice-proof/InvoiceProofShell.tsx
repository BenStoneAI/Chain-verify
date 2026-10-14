import type { ReactNode } from 'react';

import ProductFooter from '@/components/proof/ProductFooter';
import ProductNav from '@/components/proof/ProductNav';

export interface InvoiceProofShellProps {
  children: ReactNode;
  /** Narrow single-column layout for forms and review screens. */
  narrow?: boolean;
}

export function InvoiceProofShell({ children, narrow = false }: InvoiceProofShellProps) {
  return (
    <div className="ipa-page">
      <ProductNav currentProduct="invoice-proof" />
      <main className={narrow ? 'ipa-main ipa-narrow' : 'ipa-main'}>{children}</main>
      <ProductFooter currentProduct="invoice-proof" />
    </div>
  );
}
