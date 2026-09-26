export interface ServiceConfig {
  nodeEnv: string;
  port: number;
  databaseUrl: string;
  redisUrl: string;
  stripeSecretKey: string;
}

export const loadServiceConfig = (): ServiceConfig => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number.parseInt(process.env.PORT ?? '4000', 10),
  databaseUrl: process.env.DATABASE_URL ?? '',
  redisUrl: process.env.REDIS_URL ?? '',
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? '',
});

export {
  auditProofPlanConfigs,
  billingPlanConfigs,
  invoiceProofPlanConfigs,
  REGISTRATION_SANDBOX_CREDIT_USD,
  verifyApiPlanConfigs,
} from './billing.js';

export {
  proofBillingPlanConfigs,
  proofPlatformBundleMatrix,
  getProofBillingPlan,
  getProofBundleRule,
  resolveProofPlanLimits,
  platformPlanRank,
  resolveStripeOveragePriceIdForProofPlan,
  resolveStripePriceIdForProofPlan,
  defaultProofSuccessUrl,
  defaultProofCancelUrl,
} from './proof-billing.js';

export type {
  ProofProductSlug,
  PlatformPlanSlug,
  PlatformAccessDuration,
  ProofBillingPlanConfig,
  ProofPlatformBundleRule,
} from './proof-billing.js';

// Export public stats configuration (Single Source of Truth)
export {
  publicStats,
  formatCurrency,
  formatPercentage,
  formatBasisPoints,
  formatNumber,
  calculateEarnings,
  calculateAffiliateCommission,
  calculateProBreakEven,
  validateStatsConfig,
} from './public-stats.js';

export type {
  PublicStats,
  AgentStats,
  MarketplaceStats,
  PricingTier,
  AffiliateConfig,
} from './public-stats.js';
