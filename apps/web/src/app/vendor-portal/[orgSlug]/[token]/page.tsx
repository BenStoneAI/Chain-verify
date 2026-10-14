import type { Metadata } from 'next';

import { VendorPortalForm } from '@/components/invoice-proof/VendorPortalForm';

import '../../../invoice-proof/invoice-proof-app.css';

export const metadata: Metadata = {
  title: 'Vendor Banking Verification | InvoiceProof',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function VendorPortalPage({ params }: { params: { orgSlug: string; token: string } }) {
  return (
    <div className="ipa-page">
      <VendorPortalForm orgSlug={params.orgSlug} token={params.token} />
    </div>
  );
}
