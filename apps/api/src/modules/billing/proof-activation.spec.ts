/**
 * ProofActivationService: the in-browser activation endpoint used by the welcome pages.
 * Agent Gate goes through automated provisioning; managed pilots (AuditProof/InvoiceProof)
 * still create an intake. No network, no DB.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProofActivationService } from './proof-activation.service.js';

function session(overrides: Record<string, any> = {}) {
  return {
    id: 'cs_live_activation_1',
    livemode: true,
    status: 'complete',
    payment_status: 'paid',
    amount_total: 9900,
    customer: 'cus_1',
    mode: 'subscription',
    subscription: 'sub_1',
    customer_details: { email: 'buyer@example.com', name: 'Buyer Co' },
    metadata: { chainverify_product: 'agent-gate', chainverify_plan: 'agent-gate-build' },
    ...overrides,
  };
}

function build(sess: Record<string, any>, provisioning: Record<string, any> = {}) {
  const intakes: any[] = [];
  const prisma = {
    proofPilotIntake: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: 'intake_1', ...data };
        intakes.push(row);
        return row;
      }),
    },
  };
  const service = new ProofActivationService(prisma as never, provisioning as never);
  (service as any).stripe = { checkout: { sessions: { retrieve: vi.fn().mockResolvedValue(sess) } } };
  return { service, prisma, intakes };
}

const baseInput = {
  sessionId: 'cs_live_activation_1',
  companyName: 'Buyer Co',
  contactEmail: 'buyer@example.com',
};

describe('ProofActivationService', () => {
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_live_not_used_no_network';
    delete process.env.STRIPE_EXPECT_LIVEMODE;
  });

  it('Agent Gate: provisions automatically and never ends at PAID_PENDING_PROVISIONING', async () => {
    const provisioning = {
      provisionFromCheckoutSession: vi
        .fn()
        .mockResolvedValue({ entitlementId: 'ent_1', status: 'ACTIVE', organizationId: 'org_1' }),
    };
    const { service, intakes } = build(session(), provisioning);

    const result: any = await service.activate({ ...baseInput, product: 'verify-api', planSlug: 'agent-gate-build' });

    expect(result).toMatchObject({ ok: true, provisioned: true, status: 'ACTIVE' });
    expect(provisioning.provisionFromCheckoutSession).toHaveBeenCalledTimes(1);
    expect(intakes).toHaveLength(0);
  });

  it('Agent Gate fallback accepts the canonical agent-gate metadata value for the legacy product key', async () => {
    // provisioning fails transiently -> falls through to the intake path
    const provisioning = { provisionFromCheckoutSession: vi.fn().mockRejectedValue(new Error('db down')) };
    const { service, intakes } = build(session(), provisioning);

    const result: any = await service.activate({ ...baseInput, product: 'verify-api', planSlug: 'verify-api-build' });

    expect(result.ok).toBe(true);
    expect(intakes).toHaveLength(1);
    expect(intakes[0].product).toBe('verify-api');
    expect(intakes[0].planSlug).toBe('agent-gate-build');
  });

  it('managed AuditProof pilot still creates an intake (no automatic key)', async () => {
    const provisioning = { provisionFromCheckoutSession: vi.fn() };
    const { service, intakes } = build(
      session({
        amount_total: 250000,
        mode: 'payment',
        subscription: null,
        metadata: { chainverify_product: 'audit-proof', chainverify_plan: 'auditproof-pilot' },
      }),
      provisioning,
    );

    const result: any = await service.activate({ ...baseInput, product: 'audit-proof', planSlug: 'auditproof-pilot' });

    expect(result.ok).toBe(true);
    expect(provisioning.provisionFromCheckoutSession).not.toHaveBeenCalled();
    expect(intakes).toHaveLength(1);
    expect(intakes[0].product).toBe('audit-proof');
  });

  it('rejects a product that does not match the plan', async () => {
    const { service } = build(session(), { provisionFromCheckoutSession: vi.fn() });
    await expect(
      service.activate({ ...baseInput, product: 'audit-proof', planSlug: 'agent-gate-build' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('is unavailable (503) when Stripe is not configured', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const prisma = { proofPilotIntake: { findFirst: vi.fn(), create: vi.fn() } };
    const service = new ProofActivationService(prisma as never, {} as never);
    await expect(
      service.activate({ ...baseInput, product: 'verify-api', planSlug: 'agent-gate-build' }),
    ).rejects.toMatchObject({ status: 503 });
  });
});
