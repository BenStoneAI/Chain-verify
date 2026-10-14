/**
 * Internal product keys. 'verify-api' is the internal key for Agent Gate (the
 * product formerly named VerifyAPI). It is kept because the activation API,
 * entitlements and usage rows match on it; it is never shown to customers.
 */
export type ProofProductSlug = 'invoice-proof' | 'audit-proof' | 'verify-api';

/** Public web route for each product. */
const PROOF_PRODUCT_ROUTES: Record<ProofProductSlug, string> = {
  'verify-api': '/agent-gate',
  'audit-proof': '/audit-proof',
  'invoice-proof': '/invoice-proof',
};

export function getProofProductRoute(product: ProofProductSlug): string {
  return PROOF_PRODUCT_ROUTES[product];
}

/**
 * Stripe Payment Links by plan slug.
 *
 * The `agent-gate-*` slugs are canonical. The `verify-api-*` slugs are kept as
 * aliases that point at the same live Payment Links, so links, bookmarks and
 * return URLs that still carry the old slug keep working.
 */
const AGENT_GATE_LINKS = {
  build: 'https://buy.stripe.com/00w9AS9mq5BtbYX73Q2wU0f',
  scale: 'https://buy.stripe.com/8x27sKbuy7JB2onewi2wU0g',
  production: 'https://buy.stripe.com/6oUbJ0eGKd3Vfb9bk62wU0h',
} as const;

export const STRIPE_PAYMENT_LINKS: Record<string, string> = {
  'agent-gate-build': AGENT_GATE_LINKS.build,
  'agent-gate-scale': AGENT_GATE_LINKS.scale,
  'agent-gate-production': AGENT_GATE_LINKS.production,
  // Legacy aliases (same Payment Links).
  'verify-api-build': AGENT_GATE_LINKS.build,
  'verify-api-scale': AGENT_GATE_LINKS.scale,
  'verify-api-production': AGENT_GATE_LINKS.production,
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

const AGENT_GATE_TIER_NAMES: Record<string, string> = {
  build: 'Agent Gate Build',
  scale: 'Agent Gate Scale',
  production: 'Agent Gate Production',
};

/**
 * Customer-facing plan label for a plan slug. Accepts the canonical
 * `agent-gate-*` slug and the legacy `verify-api-*` alias; any other slug is
 * returned as-is.
 */
export function getProofPlanDisplayName(planSlug: string): string {
  const match = /^(?:agent-gate|verify-api)-(build|scale|production)$/.exec(planSlug);
  return match ? AGENT_GATE_TIER_NAMES[match[1]] : planSlug;
}
