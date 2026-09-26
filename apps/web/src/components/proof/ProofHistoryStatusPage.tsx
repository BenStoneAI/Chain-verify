import Link from 'next/link';

import ProductFooter from '@/components/proof/ProductFooter';
import ProductNav from '@/components/proof/ProductNav';

type ProductKey = 'invoice-proof' | 'audit-proof' | 'verify-api';

interface ProofHistoryStatusPageProps {
  currentProduct: ProductKey;
  productLabel: string;
  title: string;
  demoHref: string;
  dashboardHref: string;
  docsHref?: string;
}

export function ProofHistoryStatusPage({
  currentProduct,
  productLabel,
  title,
  demoHref,
  dashboardHref,
  docsHref,
}: ProofHistoryStatusPageProps) {
  return (
    <div className="min-h-screen bg-[#03050A] text-white">
      <ProductNav currentProduct={currentProduct} />
      <main className="mx-auto flex min-h-[70vh] w-full max-w-4xl flex-col justify-center px-6 py-28">
        <p className="mb-4 font-mono text-xs uppercase tracking-[0.22em] text-cyan-200">
          {productLabel} records
        </p>
        <h1 className="font-[var(--font-display)] text-4xl font-semibold leading-tight md:text-5xl">
          {title}
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-7 text-white/60">
          Anonymous demo runs return a proof ID on the result screen and appear in the public
          sandbox report list. Account history, API logs, and retained private records appear in the
          product dashboard after login.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href={`/reports?product=${currentProduct}`}
            className="rounded-lg bg-[#7C5CFF] px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
          >
            View sandbox reports
          </Link>
          <Link
            href={dashboardHref}
            className="rounded-lg border border-white/15 px-4 py-2.5 text-sm font-semibold text-white/75 transition hover:bg-white/8 hover:text-white"
          >
            Open account dashboard
          </Link>
          <Link
            href={demoHref}
            className="rounded-lg border border-white/15 px-4 py-2.5 text-sm font-semibold text-white/75 transition hover:bg-white/8 hover:text-white"
          >
            Run self-serve demo
          </Link>
          {docsHref && (
            <Link
              href={docsHref}
              className="rounded-lg border border-white/15 px-4 py-2.5 text-sm font-semibold text-white/75 transition hover:bg-white/8 hover:text-white"
            >
              View API docs
            </Link>
          )}
        </div>
      </main>
      <ProductFooter currentProduct={currentProduct} />
    </div>
  );
}
