import Link from 'next/link';
import { ChainVerifyMark } from '@/components/brand/ChainVerifyMark';
import { getProofProductRoute, type ProofProductSlug } from '@/lib/stripe-payment-links';

export interface ProductFooterProps {
  currentProduct?: ProofProductSlug;
}

const columns = [
  { heading: 'Products', links: [['Agent Gate','/agent-gate'],['AuditProof','/audit-proof'],['InvoiceProof','/invoice-proof']] },
  { heading: 'Explore', links: [['How it works','/#how-it-works'],['Proof model','/#proof'],['Agent Gate demo','/agent-gate#proof']] },
  { heading: 'Company', links: [['Contact','/contact'],['Security','/security'],['Privacy','/privacy']] },
];

export function ProductFooter({ currentProduct }: ProductFooterProps) {
  const currentRoute = currentProduct ? getProofProductRoute(currentProduct) : null;
  return (
    <footer className="cv-footer">
      <div className="cv-footer-top">
        <div className="cv-footer-brand">
          <Link href="/" className="cv-brand" aria-label="ChainVerify home">
            <ChainVerifyMark className="cv-brand-mark" /><span>ChainVerify</span>
          </Link>
          <p>Independent verification for AI work and high-stakes workflows.</p>
        </div>
        <div className="cv-footer-columns">
          {columns.map(column => (
            <div key={column.heading}>
              <h2>{column.heading}</h2>
              {column.links.map(([label,href]) => (
                <Link key={href} href={href} className={href === currentRoute ? 'is-current' : ''}>{label}</Link>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="cv-footer-bottom">
        <span>© 2026 ChainVerify</span>
        <span className="cv-live-dot"><i/>Verification layer online</span>
      </div>
    </footer>
  );
}

export default ProductFooter;
