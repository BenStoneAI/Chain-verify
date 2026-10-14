import { describe, expect, it } from 'vitest';

import { verifyApiPlanConfigs } from './billing.js';
import {
  canonicalProofPlanSlug,
  defaultProofCancelUrl,
  defaultProofSuccessUrl,
  getProofBillingPlan,
  proofBillingPlanConfigs,
  resolveProofPlanLimits,
} from './proof-billing.js';

const TIERS = ['build', 'scale', 'production'] as const;

describe('Agent Gate plan aliases', () => {
  it.each(TIERS)('resolves agent-gate-%s and verify-api-%s to the same plan object', (tier) => {
    const canonical = getProofBillingPlan(`agent-gate-${tier}`);
    const legacy = getProofBillingPlan(`verify-api-${tier}`);

    expect(canonical).toBeDefined();
    expect(legacy).toBeDefined();
    expect(legacy).toBe(canonical);
    expect(canonical?.slug).toBe(`agent-gate-${tier}`);
  });

  it.each(TIERS)('keeps price, limit, checkout mode and Stripe env identical for %s', (tier) => {
    const canonical = getProofBillingPlan(`agent-gate-${tier}`);
    const legacy = getProofBillingPlan(`verify-api-${tier}`);

    expect(legacy?.priceCents).toBe(canonical?.priceCents);
    expect(legacy?.monthlyLimit).toBe(canonical?.monthlyLimit);
    expect(legacy?.checkoutMode).toBe(canonical?.checkoutMode);
    expect(legacy?.stripePriceIdEnv).toBe(canonical?.stripePriceIdEnv);
    expect(legacy?.overageStripePriceIdEnv).toBe(canonical?.overageStripePriceIdEnv);
  });

  it('pins the published prices and monthly limits', () => {
    expect(getProofBillingPlan('agent-gate-build')).toMatchObject({ priceCents: 9900, monthlyLimit: 5000 });
    expect(getProofBillingPlan('agent-gate-scale')).toMatchObject({ priceCents: 49900, monthlyLimit: 50000 });
    expect(getProofBillingPlan('agent-gate-production')).toMatchObject({ priceCents: 120000, monthlyLimit: 250000 });
  });

  it('uses Agent Gate display names and keeps the internal product key', () => {
    for (const tier of TIERS) {
      const plan = getProofBillingPlan(`verify-api-${tier}`);
      expect(plan?.name).toBe(`Agent Gate ${tier[0].toUpperCase()}${tier.slice(1)}`);
      // The activation check compares against this key, so it must not change here.
      expect(plan?.product).toBe('verify-api');
    }
  });

  it('does not list a legacy slug as a separate plan', () => {
    const slugs = proofBillingPlanConfigs.map((p) => p.slug);
    expect(slugs).toEqual(expect.arrayContaining(['agent-gate-build', 'agent-gate-scale', 'agent-gate-production']));
    expect(slugs.filter((s) => s.startsWith('verify-api-'))).toEqual([]);
  });

  it('returns undefined for unknown slugs', () => {
    expect(getProofBillingPlan('verify-api-unknown')).toBeUndefined();
    expect(getProofBillingPlan('agent-gate-unknown')).toBeUndefined();
  });

  it('canonicalises aliases and leaves unknown slugs untouched', () => {
    expect(canonicalProofPlanSlug('verify-api-scale')).toBe('agent-gate-scale');
    expect(canonicalProofPlanSlug('agent-gate-scale')).toBe('agent-gate-scale');
    expect(canonicalProofPlanSlug('auditproof-pilot')).toBe('auditproof-pilot');
    expect(canonicalProofPlanSlug('something-else')).toBe('something-else');
  });

  it.each(TIERS)('resolves identical quotas for %s through resolveProofPlanLimits', (tier) => {
    const canonical = resolveProofPlanLimits(`agent-gate-${tier}`);
    const legacy = resolveProofPlanLimits(`verify-api-${tier}`);

    expect(legacy).toEqual(canonical);
    expect(canonical.product).toBe('verify-api');
    expect(canonical.monthlyLimit).not.toBeNull();
  });

  it('resolves enterprise aliases to the same unlimited quota', () => {
    expect(resolveProofPlanLimits('verify-api-enterprise')).toEqual(resolveProofPlanLimits('agent-gate-enterprise'));
    expect(resolveProofPlanLimits('agent-gate-enterprise')).toEqual({ monthlyLimit: null, product: 'verify-api' });
  });

  it('keeps usage-plan configs identical between canonical and legacy slugs', () => {
    for (const tier of [...TIERS, 'enterprise'] as const) {
      const canonical = verifyApiPlanConfigs.find((p) => p.slug === `agent-gate-${tier}`);
      const legacy = verifyApiPlanConfigs.find((p) => p.slug === `verify-api-${tier}`);
      expect(canonical).toBeDefined();
      const { slug: canonicalSlug, ...canonicalRest } = canonical!;
      const { slug: legacySlug, ...legacyRest } = legacy!;
      expect(canonicalSlug).not.toBe(legacySlug);
      expect(legacyRest).toEqual(canonicalRest);
    }
  });
});

describe('Agent Gate checkout URLs', () => {
  it('sends Agent Gate checkout returns to /agent-gate/welcome', () => {
    expect(defaultProofSuccessUrl('verify-api', 'agent-gate-build')).toMatch(/\/agent-gate\/welcome\?plan=agent-gate-build$/);
  });

  it('sends Agent Gate cancels back to /agent-gate', () => {
    expect(defaultProofCancelUrl('verify-api')).toMatch(/\/agent-gate\?checkout=cancel$/);
  });

  it('leaves the other products on their own routes', () => {
    expect(defaultProofSuccessUrl('audit-proof', 'auditproof-pilot')).toMatch(/\/audit-proof\/welcome\?plan=auditproof-pilot$/);
    expect(defaultProofSuccessUrl('invoice-proof', 'invoiceproof-pilot')).toMatch(/\/invoice-proof\/welcome\?plan=invoiceproof-pilot$/);
    expect(defaultProofCancelUrl('invoice-proof')).toMatch(/\/invoice-proof\?checkout=cancel$/);
  });
});
