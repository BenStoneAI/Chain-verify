import {
  auditProofPlanConfigs,
  invoiceProofPlanConfigs,
  verifyApiPlanConfigs,
} from './billing.js';

export type ProofProductSlug = 'invoice-proof' | 'audit-proof' | 'verify-api';
export type ProofCheckoutMode = 'payment' | 'subscription';
export interface ProofBillingPlanConfig {
  /** Canonical plan slug. */
  slug: string;
  /**
   * Legacy slugs that resolve to this same plan object (same price, limits,
   * Stripe price env vars). Existing Payment Links, entitlements and Stripe
   * metadata that carry an alias keep working.
   */
  aliases?: readonly string[];
  name: string;
  product: ProofProductSlug;
  priceCents: number;
  checkoutMode: ProofCheckoutMode;
  monthlyLimit: number | null;
  stripePriceIdEnv?: string;
  overageStripePriceIdEnv?: string;
}

const priceEnv = (key: string) => process.env[key] ?? '';

export const proofBillingPlanConfigs: ProofBillingPlanConfig[] = [
  { slug: 'invoiceproof-pilot', name: 'InvoiceProof Pilot', product: 'invoice-proof', priceCents: 75000, checkoutMode: 'payment', monthlyLimit: 100, stripePriceIdEnv: 'INVOICEPROOF_PILOT_PRICE_ID' },
  { slug: 'invoiceproof-verify', name: 'InvoiceProof Verify', product: 'invoice-proof', priceCents: 150000, checkoutMode: 'subscription', monthlyLimit: 500, stripePriceIdEnv: 'INVOICEPROOF_VERIFY_MONTHLY_PRICE_ID' },
  { slug: 'invoiceproof-protect', name: 'InvoiceProof Protect', product: 'invoice-proof', priceCents: 350000, checkoutMode: 'subscription', monthlyLimit: 2500, stripePriceIdEnv: 'INVOICEPROOF_PROTECT_MONTHLY_PRICE_ID' },
  { slug: 'invoiceproof-govern', name: 'InvoiceProof Govern', product: 'invoice-proof', priceCents: 750000, checkoutMode: 'subscription', monthlyLimit: 10000, stripePriceIdEnv: 'INVOICEPROOF_GOVERN_MONTHLY_PRICE_ID' },
  { slug: 'auditproof-pilot', name: 'AuditProof Pilot', product: 'audit-proof', priceCents: 250000, checkoutMode: 'payment', monthlyLimit: 100, stripePriceIdEnv: 'AUDITPROOF_PILOT_PRICE_ID' },
  { slug: 'auditproof-eu-sprint', name: 'AuditProof EU AI Act Sprint', product: 'audit-proof', priceCents: 1200000, checkoutMode: 'payment', monthlyLimit: null, stripePriceIdEnv: 'AUDITPROOF_EU_SPRINT_PRICE_ID' },
  { slug: 'auditproof-comply', name: 'AuditProof Comply', product: 'audit-proof', priceCents: 180000, checkoutMode: 'subscription', monthlyLimit: 500, stripePriceIdEnv: 'AUDITPROOF_COMPLY_MONTHLY_PRICE_ID' },
  { slug: 'auditproof-govern', name: 'AuditProof Govern', product: 'audit-proof', priceCents: 450000, checkoutMode: 'subscription', monthlyLimit: 2000, stripePriceIdEnv: 'AUDITPROOF_GOVERN_MONTHLY_PRICE_ID' },
  { slug: 'auditproof-certify', name: 'AuditProof Certify', product: 'audit-proof', priceCents: 900000, checkoutMode: 'subscription', monthlyLimit: 10000, stripePriceIdEnv: 'AUDITPROOF_CERTIFY_MONTHLY_PRICE_ID' },
  // Agent Gate (formerly VerifyAPI). The internal product key stays 'verify-api'
  // and the Stripe price env var names are unchanged; only the customer-facing
  // name and the canonical slug move. Legacy `verify-api-*` slugs are aliases.
  { slug: 'agent-gate-build', aliases: ['verify-api-build'], name: 'Agent Gate Build', product: 'verify-api', priceCents: 9900, checkoutMode: 'subscription', monthlyLimit: 5000, stripePriceIdEnv: 'VERIFY_API_BUILD_MONTHLY_PRICE_ID' },
  { slug: 'agent-gate-scale', aliases: ['verify-api-scale'], name: 'Agent Gate Scale', product: 'verify-api', priceCents: 49900, checkoutMode: 'subscription', monthlyLimit: 50000, stripePriceIdEnv: 'VERIFY_API_SCALE_MONTHLY_PRICE_ID', overageStripePriceIdEnv: 'VERIFY_API_SCALE_OVERAGE_PRICE_ID' },
  { slug: 'agent-gate-production', aliases: ['verify-api-production'], name: 'Agent Gate Production', product: 'verify-api', priceCents: 120000, checkoutMode: 'subscription', monthlyLimit: 250000, stripePriceIdEnv: 'VERIFY_API_PRODUCTION_MONTHLY_PRICE_ID', overageStripePriceIdEnv: 'VERIFY_API_PRODUCTION_OVERAGE_PRICE_ID' },
];

/** Resolves a canonical slug or any legacy alias to the single plan object. */
export function getProofBillingPlan(slug: string): ProofBillingPlanConfig | undefined {
  return proofBillingPlanConfigs.find((p) => p.slug === slug || p.aliases?.includes(slug));
}

/**
 * Returns the canonical slug for a plan slug or legacy alias. Unknown slugs are
 * returned unchanged so callers can keep treating them as opaque.
 */
export function canonicalProofPlanSlug(slug: string): string {
  return getProofBillingPlan(slug)?.slug ?? slug;
}

export function resolveProofPlanLimits(planSlug: string): { monthlyLimit: number | null; product: ProofProductSlug | null } {
  const billing = getProofBillingPlan(planSlug);
  if (billing) {
    return { monthlyLimit: billing.monthlyLimit, product: billing.product };
  }
  const verify = verifyApiPlanConfigs.find((p) => p.slug === planSlug);
  if (verify) {
    return { monthlyLimit: verify.monthlyRuns, product: 'verify-api' };
  }
  const audit = auditProofPlanConfigs.find((p) => p.slug === planSlug);
  if (audit) {
    return { monthlyLimit: audit.monthlyRuns, product: 'audit-proof' };
  }
  const invoice = invoiceProofPlanConfigs.find((p) => p.slug === planSlug);
  if (invoice) {
    return { monthlyLimit: invoice.monthlyInvoices, product: 'invoice-proof' };
  }
  return { monthlyLimit: null, product: null };
}

export function resolveStripePriceIdForProofPlan(
  plan: ProofBillingPlanConfig,
  isSandbox = false,
): string | undefined {
  if (!plan.stripePriceIdEnv) return undefined;
  // Sandbox/test checkout reads a separate `<VAR>_TEST` price id. Live and test
  // catalog prices must use different env vars because a live Stripe key cannot
  // reference a test-mode price id (and vice versa). When the resolved var is
  // empty, the caller falls back to inline price_data at the plan amount.
  const envKey = isSandbox ? `${plan.stripePriceIdEnv}_TEST` : plan.stripePriceIdEnv;
  const id = priceEnv(envKey);
  return id || undefined;
}

export function resolveStripeOveragePriceIdForProofPlan(
  plan: ProofBillingPlanConfig,
  isSandbox = false,
): string | undefined {
  if (!plan.overageStripePriceIdEnv) return undefined;
  const envKey = isSandbox ? `${plan.overageStripePriceIdEnv}_TEST` : plan.overageStripePriceIdEnv;
  const id = priceEnv(envKey);
  return id || undefined;
}

export function defaultProofSuccessUrl(product: ProofProductSlug, planSlug: string): string {
  const base = process.env.STRIPE_WEB_URL ?? process.env.WEB_URL ?? 'http://localhost:3000';
  return `${base}${proofProductRoute(product)}/welcome?plan=${planSlug}`;
}

export function defaultProofCancelUrl(product: ProofProductSlug): string {
  const base = process.env.STRIPE_WEB_URL ?? process.env.WEB_URL ?? 'http://localhost:3000';
  return `${base}${proofProductRoute(product)}?checkout=cancel`;
}

/** Public web route for a product. The internal 'verify-api' key maps to /agent-gate. */
function proofProductRoute(product: ProofProductSlug): string {
  return product === 'verify-api' ? '/agent-gate' : `/${product}`;
}
