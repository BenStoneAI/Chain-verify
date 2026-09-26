'use client';

/**
 * C-6: Displays a visible "TEST MODE" banner when the Stripe key is a test key.
 * Reads NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY — if it starts with pk_test_, the
 * banner is shown. This lets QA see they are in sandbox without any risk of
 * confusion with live checkout.
 */

export function StripeTestModeBanner() {
  const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';
  if (!key.startsWith('pk_test_')) return null;

  return (
    <div
      role="status"
      aria-label="Stripe test mode active"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        padding: '6px 16px',
        background: '#f59e0b',
        color: '#000',
        fontFamily: 'ui-monospace, SFMono-Regular, monospace',
        fontSize: '12px',
        fontWeight: 700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase' as const,
      }}
    >
      <span aria-hidden="true">&#9888;</span>
      STRIPE TEST MODE — No real charges will be made
      <span aria-hidden="true">&#9888;</span>
    </div>
  );
}
