'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

import { DEFAULT_API_BASE } from '@/lib/constants';

function WelcomeInner() {
  const params = useSearchParams();
  const sessionId = params.get('session_id');
  const plan = params.get('plan') ?? 'invoiceproof-pilot';
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');

  useEffect(() => {
    if (!sessionId) {
      setStatus('ok');
      return;
    }
    fetch(`${DEFAULT_API_BASE}/billing/checkout/session/${sessionId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(() => setStatus('ok'))
      .catch(() => setStatus('error'));
  }, [sessionId]);

  return (
    <main className="mx-auto max-w-xl px-4 py-24 text-white">
      <h1 className="text-3xl font-bold">Welcome to InvoiceProof</h1>
      {status === 'loading' && <p className="mt-4 text-white/60">Confirming payment…</p>}
      {status === 'ok' && (
        <>
          <p className="mt-4 text-white/70">
            Your {plan} plan is active. Run verifications on the product page or sign in to manage
            entitlements.
          </p>
          <div className="mt-8 flex flex-wrap gap-4">
            <Link href="/invoice-proof#demo" className="rounded-lg bg-[#7C5CFF] px-5 py-2.5 text-sm font-semibold">
              Try a demo verification
            </Link>
            <Link href="/login" className="rounded-lg border border-white/20 px-5 py-2.5 text-sm">
              Sign in
            </Link>
          </div>
        </>
      )}
      {status === 'error' && (
        <p className="mt-4 text-amber-400">
          Payment may still be processing. Check your email or contact support@swarmsync.ai.
        </p>
      )}
    </main>
  );
}

export default function InvoiceProofWelcomePage() {
  return (
    <Suspense fallback={<main className="py-24 text-white">Loading…</main>}>
      <WelcomeInner />
    </Suspense>
  );
}
