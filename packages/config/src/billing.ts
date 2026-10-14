const freePlan = {
  slug: 'free',
  name: 'Free',
  priceCents: 0,
  seats: 0,
  agentLimit: 0,
  workflowLimit: 0,
  monthlyCredits: 0,
  takeRateBasisPoints: 1500, // 15% flat take rate
  features: [
    'Marketplace access',
    'AP2 protocol',
    'Unlimited agents',
    'API access',
  ],
};

export const billingPlanConfigs = [freePlan];

// Agent Gate usage plans (formerly VerifyAPI). The `agent-gate-*` slugs are
// canonical; the legacy `verify-api-*` slugs are kept as lookup aliases with
// identical limits so existing entitlements, usage rows and Stripe metadata
// that carry the old slug keep resolving to the same quota and retention.
// Metered overage is gated at runtime by VERIFY_API_METERED_OVERAGE_ENABLED
// (env var name intentionally unchanged).
export const verifyApiPlanConfigs = [
  { slug: 'free', name: 'Free', monthlyRuns: 500, retentionDays: 30, overageCents: null },
  { slug: 'agent-gate-build', name: 'Build', monthlyRuns: 5000, retentionDays: 90, overageCents: null },
  { slug: 'agent-gate-scale', name: 'Scale', monthlyRuns: 50000, retentionDays: 1095, overageCents: 1 },
  { slug: 'agent-gate-production', name: 'Production', monthlyRuns: 250000, retentionDays: 2555, overageCents: 0.8 },
  { slug: 'agent-gate-enterprise', name: 'Enterprise', monthlyRuns: null, retentionDays: null, overageCents: null },
  // Legacy aliases (same limits as the canonical entries above).
  { slug: 'verify-api-build', name: 'Build', monthlyRuns: 5000, retentionDays: 90, overageCents: null },
  { slug: 'verify-api-scale', name: 'Scale', monthlyRuns: 50000, retentionDays: 1095, overageCents: 1 },
  { slug: 'verify-api-production', name: 'Production', monthlyRuns: 250000, retentionDays: 2555, overageCents: 0.8 },
  { slug: 'verify-api-enterprise', name: 'Enterprise', monthlyRuns: null, retentionDays: null, overageCents: null },
] as const;

export const auditProofPlanConfigs = [
  { slug: 'auditproof-pilot', name: 'Pilot', monthlyRuns: 100, retentionMonths: 3 },
  { slug: 'auditproof-eu-sprint', name: 'EU AI Act Sprint', monthlyRuns: null, retentionMonths: 3 },
  { slug: 'auditproof-comply', name: 'Comply', monthlyRuns: 500, retentionMonths: 12 },
  { slug: 'auditproof-govern', name: 'Govern', monthlyRuns: 2000, retentionMonths: 36 },
  { slug: 'auditproof-certify', name: 'Certify', monthlyRuns: 10000, retentionMonths: 84 },
  { slug: 'auditproof-enterprise', name: 'Enterprise', monthlyRuns: null, retentionMonths: null },
] as const;

export const invoiceProofPlanConfigs = [
  { slug: 'invoiceproof-pilot', name: 'Pilot', monthlyInvoices: 100 },
  { slug: 'invoiceproof-verify', name: 'Verify', monthlyInvoices: 500 },
  { slug: 'invoiceproof-protect', name: 'Protect', monthlyInvoices: 2500 },
  { slug: 'invoiceproof-govern', name: 'Govern', monthlyInvoices: 10000 },
  // Mirrors agent-gate-enterprise / auditproof-enterprise: monthlyInvoices: null
  // is the canonical "no cap" value (see resolveProofQuota in
  // apps/api/src/modules/billing/proof-billing.service.ts).
  { slug: 'invoiceproof-enterprise', name: 'Enterprise', monthlyInvoices: null },
] as const;

/**
 * Sandbox credit (USD) granted to every new AGENT-type user at registration.
 *
 * Canonical single source of truth. The same value is:
 *   - Written to the User's Wallet.balance via a CREDIT transaction
 *     in `apps/api/src/modules/auth/auth.service.ts:creditSandboxRegistrationWallet`
 *   - Returned to clients as `sandboxCredits` in the register-agent response.
 *
 * The two MUST match — see QA bug "sandboxCredits advertised but never credited"
 * in qa-reports/autonomous-agent-user-flow-report.md.
 *
 * Do not hardcode this number elsewhere. Import from `@agent-market/config`.
 */
export const REGISTRATION_SANDBOX_CREDIT_USD = 50;
