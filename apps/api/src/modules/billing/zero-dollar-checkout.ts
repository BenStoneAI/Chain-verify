import type Stripe from 'stripe';

/**
 * Pre-tax, pre-discount subtotal of a Checkout Session. Falls back to the first
 * line item's subtotal when the session-level field is absent.
 */
export function checkoutSubtotal(session: Stripe.Checkout.Session): number | null {
  const sessionLevel = session.amount_subtotal;
  if (typeof sessionLevel === 'number') return sessionLevel;
  const lineLevel = session.line_items?.data?.[0]?.amount_subtotal;
  return typeof lineLevel === 'number' ? lineLevel : null;
}

export type CheckoutPaymentVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Decides whether a Checkout Session's payment state is acceptable for provisioning.
 *
 * - `paid`: accepted (unchanged behavior).
 * - `no_payment_required`: accepted ONLY when a Stripe discount covering 100% of a
 *   positive subtotal explains the $0 total, and (subscription mode) the subscription
 *   exists and, when expanded, is `active`. A trial or a bare $0 session is not an
 *   authorized discount.
 * - anything else: rejected.
 */
export function evaluateCheckoutPayment(session: Stripe.Checkout.Session): CheckoutPaymentVerdict {
  if (session.payment_status === 'paid') return { ok: true };

  if (session.payment_status !== 'no_payment_required') {
    return {
      ok: false,
      reason: `Session payment_status is ${session.payment_status}, expected paid or a fully discounted checkout`,
    };
  }

  if (session.amount_total !== 0) {
    return { ok: false, reason: 'no_payment_required session must have amount_total of 0' };
  }

  const subtotal = checkoutSubtotal(session);
  const discount = session.total_details?.amount_discount;
  if (subtotal === null || subtotal <= 0 || discount !== subtotal) {
    return {
      ok: false,
      reason: 'Zero-dollar checkout rejected: no Stripe discount covering 100% of the subtotal explains it',
    };
  }

  if (session.mode === 'subscription') {
    if (!session.subscription) {
      return { ok: false, reason: 'Zero-dollar subscription checkout has no subscription' };
    }
    if (typeof session.subscription === 'object' && session.subscription.status !== 'active') {
      return {
        ok: false,
        reason: `Zero-dollar checkout rejected: subscription status is ${session.subscription.status}, expected active`,
      };
    }
  }

  return { ok: true };
}
