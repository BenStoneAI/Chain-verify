export type ProofProductSlug = 'invoice-proof' | 'audit-proof' | 'verify-api';

export const STRIPE_PAYMENT_LINKS: Record<string, string> = {
  'verify-api-build': 'https://buy.stripe.com/00w9AS9mq5BtbYX73Q2wU0f',
  'verify-api-scale': 'https://buy.stripe.com/8x27sKbuy7JB2onewi2wU0g',
  'verify-api-production': 'https://buy.stripe.com/6oUbJ0eGKd3Vfb9bk62wU0h',
  'auditproof-pilot': 'https://buy.stripe.com/9B6dR86ae6Fx5Az2NA2wU0i',
  'auditproof-eu-sprint': 'https://buy.stripe.com/bJe3cudCGaVNgfd9bY2wU0j',
  'auditproof-comply': 'https://buy.stripe.com/7sY4gy6ae4xp0gf73Q2wU0k',
  'auditproof-govern': 'https://buy.stripe.com/7sYeVc8imbZR1kjfAm2wU0l',
  'auditproof-certify': 'https://buy.stripe.com/9B6aEW6ae3tl0gf87U2wU0m',
  'invoiceproof-pilot': 'https://buy.stripe.com/cNi9AS8im2ph3srdse2wU0n',
  'invoiceproof-verify': 'https://buy.stripe.com/00w8wO7ei4xpfb9ag22wU0o',
  'invoiceproof-protect': 'https://buy.stripe.com/3cI14m9mq6Fx5Az3RE2wU0p',
  'invoiceproof-govern': 'https://buy.stripe.com/28EdR8gOS3tle75coa2wU0q',
};

export function getStripePaymentLink(planSlug: string): string | undefined {
  return STRIPE_PAYMENT_LINKS[planSlug];
}
