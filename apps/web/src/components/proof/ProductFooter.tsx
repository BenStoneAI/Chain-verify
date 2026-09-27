import Link from 'next/link';
import { ChainVerifyMark } from '@/components/brand/ChainVerifyMark';

export interface ProductFooterProps {
  currentProduct?: 'invoice-proof' | 'audit-proof' | 'verify-api';
}

const columns = [
  { heading: 'Products', links: [['VerifyAPI','/verify-api'],['AuditProof','/audit-proof'],['InvoiceProof','/invoice-proof']] },
  { heading: 'Explore', links: [['How it works','/#how-it-works'],['Proof model','/#proof'],['API','/verify-api#api-example']] },
  { heading: 'Company', links: [['Email us','mailto:proof@chainverify.org'],['Home','/'],['Proof model','/#proof']] },
];

export function ProductFooter({ currentProduct }: ProductFooterProps) {
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
                <Link key={href} href={href} className={href === `/${currentProduct}` ? 'is-current' : ''}>{label}</Link>
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
