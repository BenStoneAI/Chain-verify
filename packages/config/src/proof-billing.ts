import {
  auditProofPlanConfigs,
  invoiceProofPlanConfigs,
  verifyApiPlanConfigs,
} from './billing.js';

export type ProofProductSlug = 'invoice-proof' | 'audit-proof' | 'verify-api';
export type PlatformPlanSlug = 'free' | 'pro' | 'premier';
export type PlatformAccessDuration = 'ongoing' | 'pilot_90d' | 'sprint_90d' | 'contract';
export type ProofCheckoutMode = 'payment' | 'subscription';

export interface ProofPlatformBundleRule {
  proofPlanSlug: string;
  bundledPlatformPlan: PlatformPlanSlug;
  platformAccessDuration: PlatformAccessDuration;
}

export const proofPlatformBundleMatrix: ProofPlatformBundleRule[] = [
  { proofPlanSlug: 'verify-api-build', bundledPlatformPlan: 'pro', platformAccessDuration: 'ongoing' },
  { proofPlanSlug: 'verify-api-scale', bundledPlatformPlan: 'pro', platformAccessDuration: 'ongoing' },
  { proofPlanSlug: 'verify-api-production', bundledPlatformPlan: 'pro', platformAccessDuration: 'ongoing' },
  { proofPlanSlug: 'verify-api-enterprise', bundledPlatformPlan: 'premier', platformAccessDuration: 'contract' },
  { proofPlanSlug: 'invoiceproof-pilot', bundledPlatformPlan: 'pro', platformAccessDuration: 'pilot_90d' },
  { proofPlanSlug: 'invoiceproof-verify', bundledPlatformPlan: 'pro', platformAccessDuration: 'ongoing' },
  { proofPlanSlug: 'invoiceproof-protect', bundledPlatformPlan: 'pro', platformAccessDuration: 'ongoing' },
  { proofPlanSlug: 'invoiceproof-govern', bundledPlatformPlan: 'premier', platformAccessDuration: 'ongoing' },
  { proofPlanSlug: 'auditproof-pilot', bundledPlatformPlan: 'pro', platformAccessDuration: 'pilot_90d' },
  { proofPlanSlug: 'auditproof-eu-sprint', bundledPlatformPlan: 'premier', platformAccessDuration: 'sprint_90d' },
  { proofPlanSlug: 'auditproof-comply', bundledPlatformPlan: 'pro', platformAccessDuration: 'ongoing' },
  { proofPlanSlug: 'auditproof-govern', bundledPlatformPlan: 'pro', platformAccessDuration: 'ongoing' },
  { proofPlanSlug: 'auditproof-certify', bundledPlatformPlan: 'premier', platformAccessDuration: 'ongoing' },
  { proofPlanSlug: 'auditproof-enterprise', bundledPlatformPlan: 'premier', platformAccessDuration: 'contract' },
];

export interface ProofBillingPlanConfig {
  slug: string;
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
  { slug: 'verify-api-build', name: 'VerifyAPI Build', product: 'verify-api', priceCents: 9900, checkoutMode: 'subscription', monthlyLimit: 5000, stripePriceIdEnv: 'VERIFY_API_BUILD_MONTHLY_PRICE_ID' },
  { slug: 'verify-api-scale', name: 'VerifyAPI Scale', product: 'verify-api', priceCents: 49900, checkoutMode: 'subscription', monthlyLimit: 50000, stripePriceIdEnv: 'VERIFY_API_SCALE_MONTHLY_PRICE_ID', overageStripePriceIdEnv: 'VERIFY_API_SCALE_OVERAGE_PRICE_ID' },
  { slug: 'verify-api-production', name: 'VerifyAPI Production', product: 'verify-api', priceCents: 120000, checkoutMode: 'subscription', monthlyLimit: 250000, stripePriceIdEnv: 'VERIFY_API_PRODUCTION_MONTHLY_PRICE_ID', overageStripePriceIdEnv: 'VERIFY_API_PRODUCTION_OVERAGE_PRICE_ID' },
];

export function getProofBillingPlan(slug: string): ProofBillingPlanConfig | undefined {
  return proofBillingPlanConfigs.find((p) => p.slug === slug);
}

export function getProofBundleRule(proofPlanSlug: string): ProofPlatformBundleRule | undefined {
  return proofPlatformBundleMatrix.find((r) => r.proofPlanSlug === proofPlanSlug);
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

export function platformPlanRank(slug: string): number {
  if (slug === 'premier') return 2;
  if (slug === 'pro') return 1;
  return 0;
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
  const base = process.env.STRIPE_WEB_URL ?? process.env.WEB_URL ?? 'https://swarmsync.ai';
  if (product === 'verify-api') return `${base}/verify-api/welcome?plan=${planSlug}`;
  if (product === 'audit-proof') return `${base}/audit-proof/welcome?plan=${planSlug}`;
  return `${base}/invoice-proof/welcome?plan=${planSlug}`;
}

export function defaultProofCancelUrl(product: ProofProductSlug): string {
  const base = process.env.STRIPE_WEB_URL ?? process.env.WEB_URL ?? 'https://swarmsync.ai';
  return `${base}/${product}?checkout=cancel`;
}
