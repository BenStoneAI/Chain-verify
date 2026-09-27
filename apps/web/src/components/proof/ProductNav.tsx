'use client';

import { ChevronDown, Menu, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { ChainVerifyMark } from '@/components/brand/ChainVerifyMark';
import { ThemeToggle } from '@/components/brand/ThemeToggle';
import { ProofCheckoutButton } from '@/components/proof/ProofCheckoutButton';

export interface ProductNavProps {
  currentProduct: 'invoice-proof' | 'audit-proof' | 'verify-api';
  pageAnchors?: Array<{ label: string; href: string }>;
}

const PRODUCTS = [
  { id: 'verify-api' as const, label: 'VerifyAPI', description: 'Verify AI outputs before users rely on them.', href: '/verify-api' },
  { id: 'audit-proof' as const, label: 'AuditProof', description: 'Audit-ready proof for AI agent work.', href: '/audit-proof' },
  { id: 'invoice-proof' as const, label: 'InvoiceProof', description: 'AI invoice review your finance team can prove.', href: '/invoice-proof' },
];

const PRODUCT_CTA = {
  'invoice-proof': { label: 'Start pilot – $750', planSlug: 'invoiceproof-pilot' },
  'audit-proof': { label: 'Start pilot – $2,500', planSlug: 'auditproof-pilot' },
  'verify-api': { label: 'Start free', href: '/register' },
} as const;

export function ProductNav({ currentProduct, pageAnchors = [] }: ProductNavProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [productsOpen, setProductsOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    const onDown = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) setProductsOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setProductsOpen(false);
        setMobileOpen(false);
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    onScroll();
    return () => {
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  return (
    <header className={`cv-product-nav ${scrolled ? 'is-scrolled' : ''}`}>
      <div className="cv-product-nav-inner">
        <Link href="/" className="cv-brand" aria-label="ChainVerify home">
          <ChainVerifyMark className="cv-brand-mark" />
          <span>ChainVerify</span>
        </Link>

        <div className="cv-product-nav-center">
          {pageAnchors.map((anchor) => (
            <a key={anchor.href} href={anchor.href}>{anchor.label}</a>
          ))}
        </div>

        <div className="cv-product-nav-actions">
          <div className="cv-product-picker" ref={dropdownRef}>
            <button type="button" onClick={() => setProductsOpen(v => !v)} aria-expanded={productsOpen}>
              Products <ChevronDown size={15} className={productsOpen ? 'rotated' : ''} />
            </button>
            {productsOpen && (
              <div className="cv-product-menu">
                {PRODUCTS.map(product => (
                  <Link
                    key={product.id}
                    href={product.href}
                    className={product.id === currentProduct ? 'is-current' : ''}
                    onClick={() => setProductsOpen(false)}
                  >
                    <strong>{product.label}</strong>
                    <span>{product.description}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <ThemeToggle />

          {currentProduct === 'verify-api' ? (
            <Link href={PRODUCT_CTA['verify-api'].href} className="cv-nav-cta">{PRODUCT_CTA['verify-api'].label} <span>→</span></Link>
          ) : (
            <ProofCheckoutButton product={currentProduct} planSlug={PRODUCT_CTA[currentProduct].planSlug} className="cv-nav-cta">
              {PRODUCT_CTA[currentProduct].label} <span>→</span>
            </ProofCheckoutButton>
          )}

          <button className="cv-mobile-menu-button" type="button" onClick={() => setMobileOpen(v => !v)} aria-label={mobileOpen ? 'Close menu' : 'Open menu'}>
            {mobileOpen ? <X size={20}/> : <Menu size={20}/>}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="cv-mobile-menu">
          <div className="cv-mobile-page-links">
            {pageAnchors.map(anchor => <a key={anchor.href} href={anchor.href} onClick={() => setMobileOpen(false)}>{anchor.label}</a>)}
          </div>
          <div className="cv-mobile-products">
            {PRODUCTS.map(product => (
              <Link key={product.id} href={product.href} onClick={() => setMobileOpen(false)}>
                <strong>{product.label}</strong><span>{product.description}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </header>
  );
}

export default ProductNav;
