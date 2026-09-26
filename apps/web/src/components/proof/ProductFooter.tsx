'use client';

import Link from 'next/link';

import { cn } from '@/lib/utils';

interface FooterColumn {
  heading: string;
  links: Array<{ label: string; href: string; external?: boolean }>;
}

const FOOTER_COLUMNS: FooterColumn[] = [
  {
    heading: 'Products',
    links: [
      { label: 'InvoiceProof', href: '/invoice-proof' },
      { label: 'AuditProof', href: '/audit-proof' },
      { label: 'VerifyAPI', href: '/verify-api' },
      { label: 'Proof Reports', href: '/proof-reports' },
      { label: 'Pricing', href: '/pricing' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { label: 'About', href: '/about' },
      { label: 'Book Pilot', href: '/book-pilot' },
      { label: 'Contact', href: '/contact' },
    ],
  },
  {
    heading: 'Legal',
    links: [
      { label: 'Terms', href: '/terms' },
      { label: 'Privacy', href: '/privacy' },
      { label: 'Security', href: '/security' },
    ],
  },
];

export interface ProductFooterProps {
  currentProduct?: 'invoice-proof' | 'audit-proof' | 'verify-api';
}

export function ProductFooter({ currentProduct }: ProductFooterProps) {
  return (
    <footer
      className="border-t border-white/10 bg-[#03050A]"
      role="contentinfo"
      aria-label="Site footer"
    >
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:py-16">
        {/* Column grid */}
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {FOOTER_COLUMNS.map((col) => (
            <div key={col.heading}>
              <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-white/40">
                {col.heading}
              </h2>
              <ul role="list" className="space-y-2.5">
                {col.links.map((link) => {
                  const isCurrentProductLink =
                    currentProduct !== undefined &&
                    (link.href === `/${currentProduct}`);
                  return (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        aria-current={isCurrentProductLink ? 'page' : undefined}
                        className={cn(
                          'text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C5CFF] focus-visible:ring-offset-2 focus-visible:ring-offset-[#03050A] rounded-sm',
                          isCurrentProductLink
                            ? 'font-medium'
                            : 'text-white/50 hover:text-white',
                        )}
                        style={
                          isCurrentProductLink ? { color: '#7C5CFF' } : undefined
                        }
                      >
                        {link.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}

          {/* Platform column */}
          <div>
            <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-white/40">
              Platform
            </h2>
            <p className="text-xs leading-relaxed text-white/30">
              The full SwarmSync agent platform{' '}
              <Link
                href="/agents"
                className="text-white/40 underline underline-offset-2 transition-colors duration-150 hover:text-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C5CFF] focus-visible:ring-offset-2 focus-visible:ring-offset-[#03050A] rounded-sm"
                aria-label="Go to the full SwarmSync agent platform"
              >
                →
              </Link>
            </p>
          </div>
        </div>

        {/* Bottom strip */}
        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-white/10 pt-8 sm:flex-row">
          <p className="text-xs text-white/30">
            &copy; 2026 SwarmSync.ai
            <span aria-hidden="true" className="mx-2 text-white/20">
              ·
            </span>
            Verification for AI-generated work
          </p>
          <p className="text-xs text-white/20">
            Built on the{' '}
            <Link
              href="/agents"
              className="text-white/30 underline underline-offset-2 transition-colors duration-150 hover:text-white/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C5CFF] rounded-sm"
            >
              SwarmSync
            </Link>{' '}
            agent network
          </p>
        </div>
      </div>
    </footer>
  );
}

export default ProductFooter;
