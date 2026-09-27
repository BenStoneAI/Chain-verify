'use client';

import { ChevronDown, Menu, X } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import { ProofCheckoutButton } from '@/components/proof/ProofCheckoutButton';

export interface ProductNavProps {
  currentProduct: 'invoice-proof' | 'audit-proof' | 'verify-api';
  pageAnchors?: Array<{ label: string; href: string }>;
}

const PRODUCT_CTA = {
  'invoice-proof': { label: 'Start pilot – $750', planSlug: 'invoiceproof-pilot' },
  'audit-proof': { label: 'Start pilot – $2,500', planSlug: 'auditproof-pilot' },
  'verify-api': { label: 'Start free', href: '/register' },
} as const;

const ctaButtonClass =
  'rounded-lg px-4 py-2 text-sm font-medium text-[#071017] transition-opacity duration-150 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7BD8FF] focus-visible:ring-offset-2 focus-visible:ring-offset-[#090C12]';

const PRODUCTS = [
  {
    id: 'invoice-proof' as const,
    label: 'InvoiceProof',
    description: 'AI invoice review your finance team can prove.',
    href: '/invoice-proof',
  },
  {
    id: 'audit-proof' as const,
    label: 'AuditProof',
    description: 'Audit-ready proof for AI agent work.',
    href: '/audit-proof',
  },
  {
    id: 'verify-api' as const,
    label: 'VerifyAPI',
    description: 'Verify AI outputs before your users rely on them.',
    href: '/verify-api',
  },
] as const;


export function ProductNav({ currentProduct, pageAnchors = [] }: ProductNavProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [productsOpen, setProductsOpen] = useState(false);
  const [mobileProductsOpen, setMobileProductsOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const productsButtonRef = useRef<HTMLButtonElement>(null);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setProductsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close dropdown on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (productsOpen) {
          setProductsOpen(false);
          productsButtonRef.current?.focus();
        }
        if (mobileOpen) {
          setMobileOpen(false);
          mobileMenuButtonRef.current?.focus();
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [productsOpen, mobileOpen]);

  // Scroll detection for backdrop
  useEffect(() => {
    function handleScroll() {
      setScrolled(window.scrollY > 16);
    }
    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Lock body scroll when mobile menu is open
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileOpen]);

  const currentProductMeta = PRODUCTS.find((p) => p.id === currentProduct)!;

  return (
    <>
      <header
        className={cn(
          'fixed inset-x-0 top-0 z-50 transition-all duration-300',
          scrolled
            ? 'border-b border-white/10 bg-[#090C12]/90 backdrop-blur-xl'
            : 'bg-[#090C12]',
        )}
        role="banner"
      >
        <nav
          className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6"
          aria-label="Product navigation"
        >
          {/* Logo */}
          <Link
            href="/"
            className="flex shrink-0 items-center gap-2 no-underline"
            aria-label="ChainVerify home"
          >
            <Image
              src="/chainverify-logo.svg"
              alt="ChainVerify"
              width={168}
              height={42}
              quality={75}
              priority
              sizes="(max-width: 639px) 142px, 168px"
              className="h-8 w-auto sm:h-9"
            />
          </Link>

          {/* Desktop: page anchors */}
          {pageAnchors.length > 0 && (
            <ul
              className="hidden items-center gap-6 md:flex"
              role="list"
              aria-label="Page sections"
            >
              {pageAnchors.map((anchor) => (
                <li key={anchor.href}>
                  <a
                    href={anchor.href}
                    className="text-sm text-white/60 transition-colors duration-150 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7BD8FF] focus-visible:ring-offset-2 focus-visible:ring-offset-[#090C12]"
                  >
                    {anchor.label}
                  </a>
                </li>
              ))}
            </ul>
          )}

          {/* Desktop right side */}
          <div className="hidden items-center gap-4 md:flex">
            {/* Products dropdown */}
            <div ref={dropdownRef} className="relative">
              <button
                ref={productsButtonRef}
                type="button"
                onClick={() => setProductsOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={productsOpen}
                aria-controls="products-dropdown"
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors duration-150',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7BD8FF] focus-visible:ring-offset-2 focus-visible:ring-offset-[#090C12]',
                  productsOpen ? 'text-white' : 'text-white/60 hover:text-white',
                )}
              >
                Products
                <ChevronDown
                  aria-hidden="true"
                  className={cn(
                    'h-4 w-4 transition-transform duration-200',
                    productsOpen && 'rotate-180',
                  )}
                />
              </button>

              {productsOpen && (
                <div
                  id="products-dropdown"
                  role="menu"
                  aria-label="Products menu"
                  className="absolute right-0 top-full mt-2 w-72 rounded-xl border border-white/10 bg-[#101722] py-1 shadow-2xl"
                >
                  {PRODUCTS.map((product) => {
                    const isCurrent = product.id === currentProduct;
                    return isCurrent ? (
                      <div
                        key={product.id}
                        role="menuitem"
                        aria-current="page"
                        className="flex flex-col gap-0.5 px-4 py-3"
                      >
                        <span
                          className="text-sm font-medium"
                          style={{ color: '#7BD8FF' }}
                        >
                          {product.label}
                        </span>
                        <span className="text-xs text-white/40">
                          {product.description}
                        </span>
                      </div>
                    ) : (
                      <Link
                        key={product.id}
                        href={product.href}
                        role="menuitem"
                        onClick={() => setProductsOpen(false)}
                        className="flex flex-col gap-0.5 px-4 py-3 text-white/70 transition-colors duration-150 hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#7BD8FF]"
                      >
                        <span className="text-sm font-medium">{product.label}</span>
                        <span className="text-xs text-white/40">{product.description}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>

            {currentProduct === 'verify-api' ? (
              <Link
                href={PRODUCT_CTA['verify-api'].href}
                className={ctaButtonClass}
                style={{ backgroundColor: '#7BD8FF' }}
              >
                {PRODUCT_CTA['verify-api'].label}
              </Link>
            ) : (
              <ProofCheckoutButton
                product={currentProduct}
                planSlug={PRODUCT_CTA[currentProduct].planSlug}
                className={ctaButtonClass}
              >
                <span style={{ display: 'block', borderRadius: 8, padding: '8px 16px' }}>
                  {PRODUCT_CTA[currentProduct].label}
                </span>
              </ProofCheckoutButton>
            )}
          </div>

          {/* Mobile: hamburger */}
          <button
            ref={mobileMenuButtonRef}
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-md text-white/70 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7BD8FF] focus-visible:ring-offset-2 focus-visible:ring-offset-[#090C12] md:hidden"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileOpen}
            aria-controls="mobile-menu"
          >
            {mobileOpen ? (
              <X aria-hidden="true" className="h-5 w-5" />
            ) : (
              <Menu aria-hidden="true" className="h-5 w-5" />
            )}
          </button>
        </nav>
      </header>

      {/* Mobile menu drawer */}
      {mobileOpen && (
        <div
          id="mobile-menu"
          ref={mobileMenuRef}
          className="fixed inset-x-0 top-16 z-40 border-b border-white/10 bg-[#090C12] pb-6 md:hidden"
          role="dialog"
          aria-label="Mobile navigation menu"
          aria-modal="true"
        >
          <div className="mx-auto max-w-7xl space-y-1 px-4 pt-4 sm:px-6">
            {/* Page anchors */}
            {pageAnchors.length > 0 && (
              <div className="border-b border-white/10 pb-3">
                <p className="mb-2 px-3 text-xs font-medium uppercase tracking-wider text-white/30">
                  On this page
                </p>
                {pageAnchors.map((anchor) => (
                  <a
                    key={anchor.href}
                    href={anchor.href}
                    onClick={() => setMobileOpen(false)}
                    className="block rounded-md px-3 py-2 text-sm text-white/70 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#7BD8FF]"
                  >
                    {anchor.label}
                  </a>
                ))}
              </div>
            )}

            {/* Products section */}
            <div className="border-b border-white/10 pb-3 pt-2">
              <button
                type="button"
                onClick={() => setMobileProductsOpen((v) => !v)}
                aria-expanded={mobileProductsOpen}
                className="flex w-full items-center justify-between rounded-md px-3 py-2 text-sm font-medium text-white/70 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#7BD8FF]"
              >
                <span>Products</span>
                <ChevronDown
                  aria-hidden="true"
                  className={cn(
                    'h-4 w-4 transition-transform duration-200',
                    mobileProductsOpen && 'rotate-180',
                  )}
                />
              </button>

              {mobileProductsOpen && (
                <div className="mt-1 space-y-0.5 pl-3">
                  {PRODUCTS.map((product) => {
                    const isCurrent = product.id === currentProduct;
                    return isCurrent ? (
                      <div
                        key={product.id}
                        aria-current="page"
                        className="rounded-md px-3 py-2"
                      >
                        <span
                          className="text-sm font-medium"
                          style={{ color: '#7BD8FF' }}
                        >
                          {product.label}
                        </span>
                        <p className="mt-0.5 text-xs text-white/40">{product.description}</p>
                      </div>
                    ) : (
                      <Link
                        key={product.id}
                        href={product.href}
                        onClick={() => setMobileOpen(false)}
                        className="block rounded-md px-3 py-2 transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#7BD8FF]"
                      >
                        <span className="text-sm font-medium text-white/70">{product.label}</span>
                        <p className="mt-0.5 text-xs text-white/40">{product.description}</p>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="pt-3">
              {currentProduct === 'verify-api' ? (
                <Link
                  href={PRODUCT_CTA['verify-api'].href}
                  onClick={() => setMobileOpen(false)}
                  className="block w-full rounded-lg px-4 py-3 text-center text-sm font-medium text-[#071017]"
                  style={{ backgroundColor: '#7BD8FF' }}
                >
                  {PRODUCT_CTA['verify-api'].label}
                </Link>
              ) : (
                <ProofCheckoutButton
                  product={currentProduct}
                  planSlug={PRODUCT_CTA[currentProduct].planSlug}
                  className="block w-full rounded-lg px-4 py-3 text-center text-sm font-medium text-white"
                >
                  {PRODUCT_CTA[currentProduct].label}
                </ProofCheckoutButton>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default ProductNav;
