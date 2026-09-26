/**
 * Regression test for C6: Stripe proof checkout returned 500.
 *
 * Root cause: stripe.customers.create() and stripe.checkout.sessions.create()
 * errors were unhandled. NestJS caught the raw Stripe error and converted it
 * to a 500 Internal Server Error instead of a client-facing 400.
 *
 * Fix: Both Stripe calls are now wrapped in try/catch and rethrow as
 * BadRequestException so callers receive a 400 with an actionable message.
 *
 * These tests fail if the try/catch blocks are removed.
 */

// Mock @agent-market/config before any imports to prevent ESM parse failure.
// The config package ships pre-compiled ESM that ts-jest cannot process.
const mockProofPlans = [
  {
    slug: 'invoice-proof-starter',
    name: 'Invoice Proof Starter',
    product: 'invoice-proof',
    priceCents: 2900,
    checkoutMode: 'payment',
    monthlyLimit: 100,
    stripePriceIdEnv: 'INVOICE_PROOF_STARTER_PRICE_ID',
  },
  {
    slug: 'audit-proof-starter',
    name: 'Audit Proof Starter',
    product: 'audit-proof',
    priceCents: 4900,
    checkoutMode: 'payment',
    monthlyLimit: 50,
    stripePriceIdEnv: 'AUDIT_PROOF_STARTER_PRICE_ID',
  },
  {
    slug: 'verify-api-starter',
    name: 'Verify API Starter',
    product: 'verify-api',
    priceCents: 9900,
    checkoutMode: 'subscription',
    monthlyLimit: 1000,
    stripePriceIdEnv: 'VERIFY_API_STARTER_PRICE_ID',
  },
  {
    slug: 'invoiceproof-pilot',
    name: 'InvoiceProof Pilot',
    product: 'invoice-proof',
    priceCents: 75000,
    checkoutMode: 'payment',
    monthlyLimit: 100,
    stripePriceIdEnv: 'INVOICEPROOF_PILOT_PRICE_ID',
  },
  {
    slug: 'auditproof-pilot',
    name: 'AuditProof Pilot',
    product: 'audit-proof',
    priceCents: 250000,
    checkoutMode: 'payment',
    monthlyLimit: 100,
    stripePriceIdEnv: 'AUDITPROOF_PILOT_PRICE_ID',
  },
  {
    slug: 'verify-api-build',
    name: 'VerifyAPI Build',
    product: 'verify-api',
    priceCents: 9900,
    checkoutMode: 'subscription',
    monthlyLimit: 5000,
    stripePriceIdEnv: 'VERIFY_API_BUILD_MONTHLY_PRICE_ID',
  },
  {
    slug: 'verify-api-scale',
    name: 'VerifyAPI Scale',
    product: 'verify-api',
    priceCents: 49900,
    checkoutMode: 'subscription',
    monthlyLimit: 50000,
    stripePriceIdEnv: 'VERIFY_API_SCALE_MONTHLY_PRICE_ID',
    overageStripePriceIdEnv: 'VERIFY_API_SCALE_OVERAGE_PRICE_ID',
  },
];

jest.mock(
  '@agent-market/config',
  () => ({
    getProofBillingPlan: jest.fn((slug: string) =>
      mockProofPlans.find((plan) => plan.slug === slug),
    ),
    getProofBundleRule: jest.fn((slug: string) =>
      slug === 'verify-api-starter'
        ? {
            bundledPlatformPlan: 'pro',
            platformAccessDuration: 'pilot_90d',
          }
        : null,
    ),
    platformPlanRank: jest.fn((slug: string) => ({ free: 0, pro: 1, premium: 2 })[slug] ?? 0),
    proofBillingPlanConfigs: mockProofPlans,
    resolveProofPlanLimits: jest.fn((slug: string) => ({
      monthlyLimit:
        slug === 'verify-api-starter' ? 1000 : slug === 'audit-proof-starter' ? 50 : 100,
    })),
    resolveStripePriceIdForProofPlan: jest.fn(
      (plan: { stripePriceIdEnv?: string }, isSandbox = false) => {
        if (!plan.stripePriceIdEnv) return null;
        const key = isSandbox ? `${plan.stripePriceIdEnv}_TEST` : plan.stripePriceIdEnv;
        return process.env[key] || null;
      },
    ),
    resolveStripeOveragePriceIdForProofPlan: jest.fn(
      (plan: { overageStripePriceIdEnv?: string }, isSandbox = false) => {
        if (!plan.overageStripePriceIdEnv) return null;
        const key = isSandbox
          ? `${plan.overageStripePriceIdEnv}_TEST`
          : plan.overageStripePriceIdEnv;
        return process.env[key] || null;
      },
    ),
    defaultProofSuccessUrl: jest.fn(() => 'https://swarmsync.ai/success'),
    defaultProofCancelUrl: jest.fn(() => 'https://swarmsync.ai/cancel'),
  }),
  { virtual: false },
);

import { BadRequestException } from '@nestjs/common';
import { Prisma, ProofEntitlementStatus, ProofProduct, ProofProductType } from '@prisma/client';
import Stripe from 'stripe';

import { ProofBillingService } from './proof-billing.service.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function makeOrg(
  overrides: Partial<{
    id: string;
    name: string;
    slug: string;
    stripeCustomerId: string | null;
  }> = {},
) {
  return {
    id: 'org-test-001',
    name: 'Test Org',
    slug: 'test-org',
    stripeCustomerId: null,
    ...overrides,
  };
}

function makePrisma() {
  return {
    organization: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
    },
    organizationMembership: {
      findFirst: jest.fn(),
      upsert: jest.fn(),
    },
    proofProductEntitlement: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    proofUsageEvent: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    organizationPlatformGrant: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    organizationSubscription: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    billingPlan: { findUnique: jest.fn() },
    verificationRun: { count: jest.fn() },
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('ProofBillingService — C6 regression: Stripe errors returned 500', () => {
  let service: ProofBillingService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(() => {
    prisma = makePrisma();
    service = new ProofBillingService(prisma as never);
    // Replace the Stripe instance set in the constructor with null by default.
    (service as unknown as Record<string, unknown>)['stripe'] = null;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // C6-A: stripe.customers.create() throws inside ensureStripeCustomer.
  // The catch is in createProofCheckoutSession, so we test through it.
  // -------------------------------------------------------------------------

  describe('when stripe.customers.create() throws', () => {
    it('throws BadRequestException (not the raw Stripe error)', async () => {
      const stripeError = new Stripe.errors.StripeAPIError({
        message: 'No such customer',
        type: 'api_error',
      });

      const mockStripe = {
        customers: { create: jest.fn().mockRejectedValue(stripeError) },
        checkout: { sessions: { create: jest.fn() } },
      };
      (service as unknown as Record<string, unknown>)['stripe'] = mockStripe;

      // org has no stripeCustomerId → triggers stripe.customers.create
      const org = makeOrg({ stripeCustomerId: null });
      prisma.organization.findUnique
        .mockResolvedValueOnce(org) // createProofCheckoutSession: org lookup
        .mockResolvedValueOnce(org); // ensureStripeCustomer: org lookup
      prisma.organizationMembership.upsert.mockResolvedValue({});

      await expect(
        service.createProofCheckoutSession({
          product: 'invoice-proof',
          planSlug: 'invoice-proof-starter',
          organizationId: 'org-test-001',
          email: 'user@example.com',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('error message contains the Stripe error text, not a generic 500 string', async () => {
      const stripeError = new Stripe.errors.StripeAPIError({
        message: 'Your card was declined',
        type: 'api_error',
      });

      const mockStripe = {
        customers: { create: jest.fn().mockRejectedValue(stripeError) },
        checkout: { sessions: { create: jest.fn() } },
      };
      (service as unknown as Record<string, unknown>)['stripe'] = mockStripe;

      const org = makeOrg({ stripeCustomerId: null });
      prisma.organization.findUnique.mockResolvedValueOnce(org).mockResolvedValueOnce(org);
      prisma.organizationMembership.upsert.mockResolvedValue({});

      try {
        await service.createProofCheckoutSession({
          product: 'invoice-proof',
          planSlug: 'invoice-proof-starter',
          organizationId: 'org-test-001',
          email: 'user@example.com',
        });
        throw new Error('Expected BadRequestException but nothing was thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestException);
        const response = (err as BadRequestException).getResponse();
        const message =
          typeof response === 'string' ? response : (response as { message: string }).message;
        // Service wraps as "Stripe customer setup failed: <original message>"
        expect(message).toContain('Your card was declined');
      }
    });
  });

  // -------------------------------------------------------------------------
  // C6-B: stripe.checkout.sessions.create() throws → must become BadRequestException
  // -------------------------------------------------------------------------

  describe('when stripe.checkout.sessions.create() throws', () => {
    it('throws BadRequestException (not the raw Stripe error)', async () => {
      const stripeError = new Stripe.errors.StripeInvalidRequestError({
        message: 'No such price: price_fake',
        type: 'invalid_request_error',
        param: 'price',
      });

      // stripe.customers.create succeeds; sessions.create throws
      const mockStripe = {
        customers: { create: jest.fn().mockResolvedValue({ id: 'cus_mock001' }) },
        checkout: { sessions: { create: jest.fn().mockRejectedValue(stripeError) } },
      };
      (service as unknown as Record<string, unknown>)['stripe'] = mockStripe;

      const org = makeOrg({ stripeCustomerId: null });
      prisma.organization.findUnique.mockResolvedValueOnce(org).mockResolvedValueOnce(org);
      prisma.organization.update.mockResolvedValue({ ...org, stripeCustomerId: 'cus_mock001' });
      prisma.organizationMembership.upsert.mockResolvedValue({});

      await expect(
        service.createProofCheckoutSession({
          product: 'invoice-proof',
          planSlug: 'invoice-proof-starter',
          organizationId: 'org-test-001',
          email: 'test@example.com',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('does NOT bubble up as a raw StripeError (which would produce a 500)', async () => {
      const stripeError = new Stripe.errors.StripeAPIError({
        message: 'Connection error',
        type: 'api_error',
      });

      const mockStripe = {
        customers: { create: jest.fn().mockResolvedValue({ id: 'cus_mock' }) },
        checkout: { sessions: { create: jest.fn().mockRejectedValue(stripeError) } },
      };
      (service as unknown as Record<string, unknown>)['stripe'] = mockStripe;

      const org = makeOrg({ stripeCustomerId: null });
      prisma.organization.findUnique.mockResolvedValueOnce(org).mockResolvedValueOnce(org);
      prisma.organization.update.mockResolvedValue({ ...org, stripeCustomerId: 'cus_mock' });
      prisma.organizationMembership.upsert.mockResolvedValue({});

      try {
        await service.createProofCheckoutSession({
          product: 'invoice-proof',
          planSlug: 'invoice-proof-starter',
          organizationId: 'org-test-001',
        });
        throw new Error('Expected error but none was thrown');
      } catch (err) {
        // The error must NOT be a raw Stripe error — that's the bug
        expect(err).not.toBeInstanceOf(Stripe.errors.StripeError);
        expect(err).toBeInstanceOf(BadRequestException);
      }
    });
  });

  // -------------------------------------------------------------------------
  // C6-C: stripe is null (not configured) → immediate BadRequestException
  // -------------------------------------------------------------------------

  it('throws BadRequestException immediately when Stripe is not configured', async () => {
    // stripe is already null from beforeEach
    const org = makeOrg();
    prisma.organization.findUnique.mockResolvedValue(org);
    prisma.organizationMembership.upsert.mockResolvedValue({});

    await expect(
      service.createProofCheckoutSession({
        product: 'invoice-proof',
        planSlug: 'invoice-proof-starter',
        organizationId: 'org-test-001',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  // -------------------------------------------------------------------------
  // PRB-STRIPE-LIVE: sandbox/free-trial flows must use the test-mode Stripe key.
  //
  // Root cause: before this fix, ProofBillingService always used STRIPE_SECRET_KEY
  // (live mode) — any card entered on a free/sandbox CTA was charged real money.
  //
  // Fix: isSandbox:true routes to stripeTest (STRIPE_TEST_SECRET_KEY).
  //      isSandbox:false (default) routes to stripe (STRIPE_SECRET_KEY).
  //      The live key is NEVER overwritten.
  // -------------------------------------------------------------------------

  describe('PRB-STRIPE-LIVE: sandbox mode uses stripeTest, not stripe', () => {
    it('calls checkout.sessions.create on the TEST stripe client when isSandbox=true', async () => {
      const mockLiveStripe = {
        customers: { create: jest.fn().mockResolvedValue({ id: 'cus_live' }) },
        checkout: {
          sessions: {
            create: jest
              .fn()
              .mockResolvedValue({ id: 'cs_live_001', url: 'https://stripe.com/live' }),
          },
        },
      };
      const mockTestStripe = {
        customers: { create: jest.fn().mockResolvedValue({ id: 'cus_test' }) },
        checkout: {
          sessions: {
            create: jest
              .fn()
              .mockResolvedValue({ id: 'cs_test_001', url: 'https://stripe.com/test' }),
          },
        },
      };

      (service as unknown as Record<string, unknown>)['stripe'] = mockLiveStripe;
      (service as unknown as Record<string, unknown>)['stripeTest'] = mockTestStripe;

      const org = makeOrg({ stripeCustomerId: null });
      prisma.organization.findUnique
        .mockResolvedValueOnce(org) // createProofCheckoutSession: org lookup
        .mockResolvedValueOnce(org); // ensureStripeCustomer: org lookup
      prisma.organization.update.mockResolvedValue({ ...org, stripeCustomerId: 'cus_test' });
      prisma.organizationMembership.upsert.mockResolvedValue({});

      const result = await service.createProofCheckoutSession({
        product: 'invoice-proof',
        planSlug: 'invoice-proof-starter',
        organizationId: 'org-test-001',
        email: 'sandbox@example.com',
        isSandbox: true,
      });

      // Must have used the TEST client for both customer create and session create
      expect(mockTestStripe.customers.create).toHaveBeenCalledTimes(1);
      expect(mockTestStripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
      // Live client must NOT have been touched
      expect(mockLiveStripe.customers.create).not.toHaveBeenCalled();
      expect(mockLiveStripe.checkout.sessions.create).not.toHaveBeenCalled();
      // Returned URL must come from the test session
      expect(result.sessionId).toBe('cs_test_001');
    });

    it('calls checkout.sessions.create on the LIVE stripe client when isSandbox=false', async () => {
      const mockLiveStripe = {
        customers: { create: jest.fn().mockResolvedValue({ id: 'cus_live' }) },
        checkout: {
          sessions: {
            create: jest
              .fn()
              .mockResolvedValue({ id: 'cs_live_002', url: 'https://stripe.com/live' }),
          },
        },
      };
      const mockTestStripe = {
        customers: { create: jest.fn() },
        checkout: { sessions: { create: jest.fn() } },
      };

      (service as unknown as Record<string, unknown>)['stripe'] = mockLiveStripe;
      (service as unknown as Record<string, unknown>)['stripeTest'] = mockTestStripe;

      const org = makeOrg({ stripeCustomerId: null });
      prisma.organization.findUnique.mockResolvedValueOnce(org).mockResolvedValueOnce(org);
      prisma.organization.update.mockResolvedValue({ ...org, stripeCustomerId: 'cus_live' });
      prisma.organizationMembership.upsert.mockResolvedValue({});

      const result = await service.createProofCheckoutSession({
        product: 'invoice-proof',
        planSlug: 'invoice-proof-starter',
        organizationId: 'org-test-001',
        email: 'paid@example.com',
        isSandbox: false,
      });

      // Must have used the LIVE client
      expect(mockLiveStripe.customers.create).toHaveBeenCalledTimes(1);
      expect(mockLiveStripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
      // Test client must NOT have been touched
      expect(mockTestStripe.customers.create).not.toHaveBeenCalled();
      expect(mockTestStripe.checkout.sessions.create).not.toHaveBeenCalled();
      expect(result.sessionId).toBe('cs_live_002');
    });

    it('throws when isSandbox=true but stripeTest is null, preventing live-key fallback', async () => {
      const mockLiveStripe = {
        customers: { create: jest.fn().mockResolvedValue({ id: 'cus_live' }) },
        checkout: {
          sessions: {
            create: jest
              .fn()
              .mockResolvedValue({ id: 'cs_live_003', url: 'https://stripe.com/live' }),
          },
        },
      };

      (service as unknown as Record<string, unknown>)['stripe'] = mockLiveStripe;
      (service as unknown as Record<string, unknown>)['stripeTest'] = null;

      const org = makeOrg({ stripeCustomerId: null });
      prisma.organization.findUnique.mockResolvedValueOnce(org).mockResolvedValueOnce(org);
      prisma.organization.update.mockResolvedValue({ ...org, stripeCustomerId: 'cus_live' });
      prisma.organizationMembership.upsert.mockResolvedValue({});

      await expect(
        service.createProofCheckoutSession({
          product: 'invoice-proof',
          planSlug: 'invoice-proof-starter',
          organizationId: 'org-test-001',
          isSandbox: true,
        }),
      ).rejects.toThrow(BadRequestException);

      expect(mockLiveStripe.customers.create).not.toHaveBeenCalled();
      expect(mockLiveStripe.checkout.sessions.create).not.toHaveBeenCalled();
    });

    it.each([
      {
        product: 'invoice-proof' as const,
        planSlug: 'invoiceproof-pilot',
        priceEnv: 'INVOICEPROOF_PILOT_PRICE_ID_TEST',
        priceId: 'price_test_invoice_pilot',
        mode: 'payment',
      },
      {
        product: 'audit-proof' as const,
        planSlug: 'auditproof-pilot',
        priceEnv: 'AUDITPROOF_PILOT_PRICE_ID_TEST',
        priceId: 'price_test_audit_pilot',
        mode: 'payment',
      },
      {
        product: 'verify-api' as const,
        planSlug: 'verify-api-build',
        priceEnv: 'VERIFY_API_BUILD_MONTHLY_PRICE_ID_TEST',
        priceId: 'price_test_verify_build',
        mode: 'subscription',
      },
    ])(
      'creates a sandbox smoke checkout for $product / $planSlug with test price metadata',
      async ({ product, planSlug, priceEnv, priceId, mode }) => {
        process.env[priceEnv] = priceId;

        const mockLiveStripe = {
          customers: { create: jest.fn() },
          checkout: { sessions: { create: jest.fn() } },
        };
        const mockTestStripe = {
          customers: { create: jest.fn().mockResolvedValue({ id: 'cus_test_smoke' }) },
          checkout: {
            sessions: {
              create: jest.fn().mockResolvedValue({
                id: `cs_test_${planSlug.replaceAll('-', '_')}`,
                url: 'https://checkout.stripe.com/c/pay/cs_test_smoke',
              }),
            },
          },
        };

        (service as unknown as Record<string, unknown>)['stripe'] = mockLiveStripe;
        (service as unknown as Record<string, unknown>)['stripeTest'] = mockTestStripe;

        const org = makeOrg({ id: `org-${planSlug}`, stripeCustomerId: 'cus_live_saved' });
        prisma.organization.findUnique.mockResolvedValueOnce(org).mockResolvedValueOnce(org);
        prisma.organizationMembership.upsert.mockResolvedValue({});

        const result = await service.createProofCheckoutSession({
          product,
          planSlug,
          organizationId: org.id,
          userId: `user-${planSlug}`,
          email: `${planSlug}@example.test`,
          isSandbox: true,
        });

        expect(result.isTestMode).toBe(true);
        expect(result.sessionId).toMatch(/^cs_test_/);
        expect(mockLiveStripe.checkout.sessions.create).not.toHaveBeenCalled();
        expect(prisma.organization.update).not.toHaveBeenCalled();

        const sessionParams = mockTestStripe.checkout.sessions.create.mock.calls[0][0];
        expect(sessionParams).toEqual(
          expect.objectContaining({
            mode,
            customer: 'cus_test_smoke',
            metadata: expect.objectContaining({
              type: 'proof_product',
              product,
              planSlug,
              organizationId: org.id,
              isSandbox: 'true',
              stripeMode: 'test',
            }),
            line_items: [{ price: priceId, quantity: 1 }],
          }),
        );

        if (mode === 'subscription') {
          expect(sessionParams.subscription_data.metadata).toEqual(
            expect.objectContaining({
              type: 'proof_product',
              product,
              planSlug,
              organizationId: org.id,
              isSandbox: 'true',
              stripeMode: 'test',
            }),
          );
        }

        delete process.env[priceEnv];
      },
    );
  });
});

// ---------------------------------------------------------------------------
// H5: revokeProofProductEntitlement — cancellation must flip ACTIVE -> CANCELLED.
// War-audit finding: canceled/deleted subscriptions previously RE-PROVISIONED an
// ACTIVE entitlement. The revoke path must set ACTIVE entitlements to CANCELLED
// and create no new ACTIVE row.
// ---------------------------------------------------------------------------

describe('ProofBillingService.revokeProofProductEntitlement (H5)', () => {
  let service: ProofBillingService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(() => {
    prisma = makePrisma();
    service = new ProofBillingService(prisma as never);
    (service as unknown as Record<string, unknown>)['stripe'] = null;
  });

  afterEach(() => jest.clearAllMocks());

  it('flips ACTIVE entitlements for the org+product to CANCELLED (no create)', async () => {
    prisma.proofProductEntitlement.updateMany.mockResolvedValue({ count: 1 });

    await service.revokeProofProductEntitlement({
      organizationId: 'org-test-001',
      product: 'invoice-proof',
    });

    expect(prisma.proofProductEntitlement.updateMany).toHaveBeenCalledTimes(1);
    const call = prisma.proofProductEntitlement.updateMany.mock.calls[0][0];
    // Only ACTIVE rows for this org+product are targeted.
    expect(call.where.organizationId).toBe('org-test-001');
    expect(call.where.status).toBe('ACTIVE');
    // They are set to CANCELLED.
    expect(call.data.status).toBe('CANCELLED');
    // Revoke must never create a new entitlement.
    expect(prisma.proofProductEntitlement.create).not.toHaveBeenCalled();
  });

  it('is a no-op (count 0) when the org has no ACTIVE entitlement, without creating one', async () => {
    prisma.proofProductEntitlement.updateMany.mockResolvedValue({ count: 0 });

    const result = await service.revokeProofProductEntitlement({
      organizationId: 'org-none',
      product: 'audit-proof',
    });

    expect(result.count).toBe(0);
    expect(prisma.proofProductEntitlement.create).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// H4/H5 staging-safe proof billing harness.
//
// No live Stripe or database calls: mocked checkout metadata and Prisma writes
// prove product-aware entitlement provisioning, checkout -> entitlement,
// explicit platform bundle behavior, cancel -> revoke, and wrong-product
// isolation.
// ---------------------------------------------------------------------------

describe('ProofBillingService staging-safe entitlement harness (H4/H5)', () => {
  let service: ProofBillingService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(() => {
    prisma = makePrisma();
    service = new ProofBillingService(prisma as never);
    (service as unknown as Record<string, unknown>)['stripe'] = {
      customers: { create: jest.fn() },
      checkout: {
        sessions: {
          create: jest.fn().mockResolvedValue({
            id: 'cs_test_invoice_harness',
            url: 'https://checkout.stripe.test/invoice-harness',
          }),
        },
      },
    };
  });

  afterEach(() => jest.clearAllMocks());

  it('checkout metadata provisions an entitlement for the purchased product and org only', async () => {
    const org = makeOrg({ id: 'org-invoice', stripeCustomerId: 'cus_invoice' });
    prisma.organizationMembership.findFirst.mockResolvedValue({ organization: org });
    prisma.organization.findUnique.mockResolvedValue(org);
    prisma.proofProductEntitlement.updateMany.mockResolvedValue({ count: 0 });
    prisma.proofProductEntitlement.create.mockResolvedValue({ id: 'ent-invoice' });

    const checkout = await service.createProofCheckoutSession({
      product: 'invoice-proof',
      planSlug: 'invoice-proof-starter',
      userId: 'user-invoice',
      email: 'invoice@example.com',
    });

    expect(checkout.organizationId).toBe('org-invoice');
    const stripeClient = (service as unknown as Record<string, unknown>)['stripe'] as {
      checkout: { sessions: { create: { mock: { calls: unknown[][] } } } };
    };
    const metadata = stripeClient.checkout.sessions.create.mock.calls[0][0].metadata;
    expect(metadata).toEqual(
      expect.objectContaining({
        type: 'proof_product',
        product: 'invoice-proof',
        planSlug: 'invoice-proof-starter',
        organizationId: 'org-invoice',
        userId: 'user-invoice',
      }),
    );

    await service.handleProofProductCheckout({
      id: 'cs_test_invoice_harness',
      metadata,
      subscription: null,
      customer_details: { email: 'invoice@example.com' },
    } as unknown as Stripe.Checkout.Session);

    expect(prisma.proofProductEntitlement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: 'org-invoice',
          product: ProofProductType.INVOICE_PROOF,
          planSlug: 'invoice-proof-starter',
          status: ProofEntitlementStatus.ACTIVE,
          monthlyLimit: 100,
          stripeSessionId: 'cs_test_invoice_harness',
        }),
      }),
    );
    expect(prisma.organizationSubscription.upsert).not.toHaveBeenCalled();
  });

  it('mutates platform subscription only for an explicit proof bundle on the purchased org', async () => {
    prisma.billingPlan.findUnique.mockResolvedValue({ slug: 'pro', monthlyCredits: 1000 });
    prisma.organizationPlatformGrant.findFirst.mockResolvedValue(null);
    prisma.organizationSubscription.findUnique.mockResolvedValue({ planSlug: 'free' });

    await service.provisionBundledPlatformAccess('org-verify', 'verify-api-starter');

    expect(prisma.organizationSubscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'org-verify' },
        update: expect.objectContaining({ planSlug: 'pro' }),
        create: expect.objectContaining({ organizationId: 'org-verify', planSlug: 'pro' }),
      }),
    );
    expect(prisma.organizationPlatformGrant.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: 'org-verify',
          planSlug: 'pro',
          proofPlanSlug: 'verify-api-starter',
        }),
      }),
    );
  });

  it('wrong product does not unlock quota for another proof product', async () => {
    prisma.proofProductEntitlement.findFirst.mockImplementation(async ({ where }) => {
      if (where.product === ProofProductType.INVOICE_PROOF) {
        return {
          planSlug: 'invoice-proof-starter',
          monthlyLimit: 100,
        };
      }
      return null;
    });

    const invoiceQuota = await service.resolveProofQuota(
      'org-isolated',
      ProofProductType.INVOICE_PROOF,
    );
    const auditQuota = await service.resolveProofQuota(
      'org-isolated',
      ProofProductType.AUDIT_PROOF,
    );

    expect(invoiceQuota).toEqual(
      expect.objectContaining({ planSlug: 'invoice-proof-starter', source: 'entitlement' }),
    );
    expect(auditQuota).toEqual(
      expect.objectContaining({ planSlug: 'anonymous', source: 'anonymous' }),
    );
  });

  it('an active entitlement with monthlyLimit: null (unlimited plan) is NOT downgraded to the anonymous 500/mo tier', async () => {
    // Regression test: auditproof-eu-sprint and *-enterprise plans store
    // monthlyLimit: null on the entitlement row by design (see
    // packages/config/src/billing.ts) to mean "no cap". resolveProofQuota used
    // to check `entitlement?.monthlyLimit != null`, which is false both when
    // there is no entitlement AND when there is an unlimited entitlement -- so
    // real paying customers on an unlimited plan silently fell back to the
    // 500/month anonymous tier. The fix branches on entitlement existence.
    prisma.proofProductEntitlement.findFirst.mockResolvedValue({
      id: 'ent-unlimited',
      organizationId: 'org-unlimited',
      product: ProofProductType.AUDIT_PROOF,
      planSlug: 'auditproof-eu-sprint',
      status: ProofEntitlementStatus.ACTIVE,
      monthlyLimit: null,
    });

    const quota = await service.resolveProofQuota('org-unlimited', ProofProductType.AUDIT_PROOF);

    expect(quota.source).toBe('entitlement');
    expect(quota.planSlug).toBe('auditproof-eu-sprint');
    expect(quota.monthlyLimit).toBeNull();
    // Must NOT be the anonymous fallback values.
    expect(quota).not.toEqual(expect.objectContaining({ planSlug: 'anonymous' }));
    expect(quota.monthlyLimit).not.toBe(500);
  });

  it('does not create duplicate entitlements for the same Stripe checkout session', async () => {
    prisma.proofProductEntitlement.findFirst.mockResolvedValue({
      id: 'ent-existing',
      organizationId: 'org-invoice',
      product: ProofProductType.INVOICE_PROOF,
      planSlug: 'invoiceproof-pilot',
      status: ProofEntitlementStatus.ACTIVE,
      monthlyLimit: 100,
      stripeSessionId: 'cs_test_existing',
    });

    const result = await service.provisionProofProductEntitlement({
      organizationId: 'org-invoice',
      product: 'invoice-proof',
      planSlug: 'invoiceproof-pilot',
      stripeSessionId: 'cs_test_existing',
    });

    expect(result).toEqual(expect.objectContaining({ id: 'ent-existing' }));
    expect(prisma.proofProductEntitlement.updateMany).not.toHaveBeenCalled();
    expect(prisma.proofProductEntitlement.create).not.toHaveBeenCalled();
  });

  it('does not create a second entitlement when checkout.session.completed and customer.subscription.created race for the same subscription', async () => {
    // Regression for the live duplicate-row bug: checkout.session.completed fires
    // with stripeSessionId (+ subscription id if already attached), and
    // customer.subscription.created fires ~600ms later with ONLY
    // stripeSubscriptionId (no session id). The old code only deduped on
    // stripeSessionId, so the subscription-only call always created a second row.
    prisma.proofProductEntitlement.findFirst.mockResolvedValue({
      id: 'ent-existing-sub',
      organizationId: 'org-invoice',
      product: ProofProductType.INVOICE_PROOF,
      planSlug: 'invoiceproof-pilot',
      status: ProofEntitlementStatus.ACTIVE,
      monthlyLimit: 100,
      stripeSubscriptionId: 'sub_1UEYMOPQdMywmVkHEwEKct9j',
      stripeSessionId: 'cs_test_b1uT',
      stripeSubscriptionItemId: null,
    });

    const result = await service.provisionProofProductEntitlement({
      organizationId: 'org-invoice',
      product: 'invoice-proof',
      planSlug: 'invoiceproof-pilot',
      stripeSubscriptionId: 'sub_1UEYMOPQdMywmVkHEwEKct9j',
      // No stripeSessionId — this is the customer.subscription.created call.
    });

    expect(result).toEqual(expect.objectContaining({ id: 'ent-existing-sub' }));
    expect(prisma.proofProductEntitlement.updateMany).not.toHaveBeenCalled();
    expect(prisma.proofProductEntitlement.create).not.toHaveBeenCalled();
    expect(prisma.proofProductEntitlement.update).not.toHaveBeenCalled();
  });

  it('enriches the existing entitlement with a missing stripeSessionId instead of creating a duplicate', async () => {
    // Opposite ordering: subscription.created lands first (creates the row with
    // only stripeSubscriptionId), then checkout.session.completed arrives with
    // the stripeSessionId. The existing ACTIVE row for the same subscription
    // should be updated in place with the session id, not duplicated.
    prisma.proofProductEntitlement.findFirst.mockResolvedValue({
      id: 'ent-existing-sub-2',
      organizationId: 'org-invoice',
      product: ProofProductType.INVOICE_PROOF,
      planSlug: 'invoiceproof-pilot',
      status: ProofEntitlementStatus.ACTIVE,
      monthlyLimit: 100,
      stripeSubscriptionId: 'sub_1UEYMOPQdMywmVkHEwEKct9j',
      stripeSessionId: null,
      stripeSubscriptionItemId: null,
    });
    prisma.proofProductEntitlement.update.mockResolvedValue({
      id: 'ent-existing-sub-2',
      organizationId: 'org-invoice',
      product: ProofProductType.INVOICE_PROOF,
      planSlug: 'invoiceproof-pilot',
      status: ProofEntitlementStatus.ACTIVE,
      monthlyLimit: 100,
      stripeSubscriptionId: 'sub_1UEYMOPQdMywmVkHEwEKct9j',
      stripeSessionId: 'cs_test_b1uT',
      stripeSubscriptionItemId: null,
    });

    const result = await service.provisionProofProductEntitlement({
      organizationId: 'org-invoice',
      product: 'invoice-proof',
      planSlug: 'invoiceproof-pilot',
      stripeSubscriptionId: 'sub_1UEYMOPQdMywmVkHEwEKct9j',
      stripeSessionId: 'cs_test_b1uT',
    });

    expect(result).toEqual(
      expect.objectContaining({ id: 'ent-existing-sub-2', stripeSessionId: 'cs_test_b1uT' }),
    );
    expect(prisma.proofProductEntitlement.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ent-existing-sub-2' },
        data: expect.objectContaining({ stripeSessionId: 'cs_test_b1uT' }),
      }),
    );
    expect(prisma.proofProductEntitlement.create).not.toHaveBeenCalled();
    expect(prisma.proofProductEntitlement.updateMany).not.toHaveBeenCalled();
  });

  it('dashboard entitlement usage counts only products mapped to that entitlement', async () => {
    const periodStart = new Date('2026-06-01T00:00:00.000Z');
    const periodEnd = new Date('2026-07-01T00:00:00.000Z');
    prisma.proofProductEntitlement.findMany.mockResolvedValue([
      {
        id: 'ent-invoice',
        product: ProofProductType.INVOICE_PROOF,
        planSlug: 'invoice-proof-starter',
        status: ProofEntitlementStatus.ACTIVE,
        monthlyLimit: 100,
        periodStart,
        periodEnd,
      },
    ]);
    prisma.verificationRun.count.mockResolvedValue(7);

    const entitlements = await service.listEntitlementsWithUsage('org-dashboard');

    expect(prisma.verificationRun.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          orgId: 'org-dashboard',
          product: {
            in: [ProofProduct.INVOICE_AUDIT, ProofProduct.DOCUMENT_VERIFY],
          },
        }),
      }),
    );
    expect(entitlements[0]).toEqual(
      expect.objectContaining({
        id: 'ent-invoice',
        product: ProofProductType.INVOICE_PROOF,
        usedThisPeriod: 7,
      }),
    );
  });

  // Regression: prod had two ACTIVE ProofProductEntitlement rows per product
  // for one org (no DB-level unique constraint on organizationId+product —
  // see schema.prisma) which surfaced as every "My Proof Products" sidebar
  // link appearing twice. listEntitlementsWithUsage must collapse to the
  // newest ACTIVE row per product while still returning every non-ACTIVE
  // (EXPIRED/CANCELLED) row so purchase history is unaffected.
  it('collapses duplicate ACTIVE entitlements for the same product to the newest one', async () => {
    const periodStart = new Date('2026-06-01T00:00:00.000Z');
    prisma.proofProductEntitlement.findMany.mockResolvedValue([
      // findMany is ordered createdAt desc, so the newest duplicate comes first.
      {
        id: 'ent-invoice-new',
        product: ProofProductType.INVOICE_PROOF,
        planSlug: 'invoiceproof-protect-monthly',
        status: ProofEntitlementStatus.ACTIVE,
        monthlyLimit: 2500,
        periodStart,
        periodEnd: null,
        createdAt: new Date('2026-06-29T16:41:17.749Z'),
      },
      {
        id: 'ent-invoice-old-duplicate',
        product: ProofProductType.INVOICE_PROOF,
        planSlug: 'invoiceproof-pilot',
        status: ProofEntitlementStatus.ACTIVE,
        monthlyLimit: 100,
        periodStart,
        periodEnd: null,
        createdAt: new Date('2026-06-03T21:04:16.547Z'),
      },
      // A CANCELLED row for the same product must survive dedup — it's real
      // purchase history, not a duplicate of the current active entitlement.
      {
        id: 'ent-invoice-cancelled',
        product: ProofProductType.INVOICE_PROOF,
        planSlug: 'invoiceproof-pilot',
        status: ProofEntitlementStatus.CANCELLED,
        monthlyLimit: 100,
        periodStart,
        periodEnd: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);
    prisma.verificationRun.count.mockResolvedValue(0);

    const entitlements = await service.listEntitlementsWithUsage('org-with-duplicates');

    const ids = entitlements.map((e: { id: string }) => e.id);
    expect(ids).toEqual(['ent-invoice-new', 'ent-invoice-cancelled']);
    expect(ids).not.toContain('ent-invoice-old-duplicate');

    const activeInvoiceProofRows = entitlements.filter(
      (e: { product: ProofProductType; status: ProofEntitlementStatus }) =>
        e.product === ProofProductType.INVOICE_PROOF && e.status === ProofEntitlementStatus.ACTIVE,
    );
    expect(activeInvoiceProofRows).toHaveLength(1);
  });
});

describe('ProofBillingService VerifyAPI metered overage', () => {
  let service: ProofBillingService;
  let prisma: ReturnType<typeof makePrisma>;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      VERIFY_API_METERED_OVERAGE_ENABLED: 'true',
      VERIFY_API_METERED_OVERAGE_ORG_IDS: 'org-scale',
      VERIFY_API_SCALE_MONTHLY_PRICE_ID: 'price_live_verify_scale_base',
      VERIFY_API_SCALE_OVERAGE_PRICE_ID: 'price_live_verify_scale_overage',
      VERIFY_API_OVERAGE_METER_EVENT_NAME: 'verify_api_overage_run',
    };
    prisma = makePrisma();
    service = new ProofBillingService(prisma as never);
    (service as unknown as Record<string, unknown>)['stripe'] = null;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.clearAllMocks();
  });

  it('attaches the Scale overage price as a second subscription checkout item', async () => {
    const mockStripe = {
      customers: { create: jest.fn().mockResolvedValue({ id: 'cus_scale' }) },
      checkout: {
        sessions: {
          create: jest.fn().mockResolvedValue({
            id: 'cs_live_scale',
            url: 'https://checkout.stripe.test/scale',
          }),
        },
      },
    };
    (service as unknown as Record<string, unknown>)['stripe'] = mockStripe;

    const org = makeOrg({ id: 'org-scale' });
    prisma.organization.findUnique.mockResolvedValueOnce(org).mockResolvedValueOnce(org);
    prisma.organization.update.mockResolvedValue({ ...org, stripeCustomerId: 'cus_scale' });

    await service.createProofCheckoutSession({
      product: 'verify-api',
      planSlug: 'verify-api-scale',
      organizationId: 'org-scale',
    });

    const sessionParams = mockStripe.checkout.sessions.create.mock.calls[0][0];
    expect(sessionParams.line_items).toEqual([
      { price: 'price_live_verify_scale_base', quantity: 1 },
      { price: 'price_live_verify_scale_overage' },
    ]);
    expect(sessionParams.subscription_data.metadata.verifyApiOveragePriceId).toBe(
      'price_live_verify_scale_overage',
    );
  });

  it('keeps non-allowlisted organizations on hard-cap behavior when the global flag is on', async () => {
    prisma.proofProductEntitlement.findFirst.mockResolvedValue({
      planSlug: 'verify-api-scale',
      meteredBillingEnabled: true,
      stripeSubscriptionItemId: 'si_other',
    });

    await expect(
      service.isVerifyApiMeteredOverageReady('org-other', 'verify-api-scale'),
    ).resolves.toBe(false);
    await expect(
      service.createVerifyApiOverageEvent({
        organizationId: 'org-other',
        verificationRunId: 'run-other',
        planSlug: 'verify-api-scale',
        overageCents: 1,
      }),
    ).resolves.toBeNull();
    expect(prisma.proofUsageEvent.create).not.toHaveBeenCalled();
  });

  it('reports unreported overage usage with the planned idempotency key', async () => {
    const createdAt = new Date('2026-06-12T12:00:00.000Z');
    prisma.proofUsageEvent.findUnique.mockResolvedValue({
      id: 'usage-1',
      organizationId: 'org-scale',
      product: 'verify-api',
      proofId: null,
      verificationRunId: 'run-1',
      planSlug: 'verify-api-scale',
      isOverage: true,
      quantity: 1,
      overageCents: 1,
      stripeReported: false,
      stripeUsageRecordId: null,
      createdAt,
    });
    prisma.proofProductEntitlement.findFirst.mockResolvedValue({
      id: 'ent-scale',
      organizationId: 'org-scale',
      product: ProofProductType.VERIFY_API,
      planSlug: 'verify-api-scale',
      status: ProofEntitlementStatus.ACTIVE,
      stripeSubscriptionItemId: 'si_overage_scale',
      meteredBillingEnabled: true,
    });
    prisma.organization.findUnique.mockResolvedValue({ stripeCustomerId: 'cus_scale' });
    prisma.proofUsageEvent.update.mockResolvedValue({});

    const createMeterEvent = jest.fn().mockResolvedValue({
      identifier: 'overage:org-scale:run-1',
    });
    (service as unknown as Record<string, unknown>)['stripe'] = {
      billing: { meterEvents: { create: createMeterEvent } },
    };

    await expect(service.reportUsageEventToStripe('usage-1')).resolves.toEqual({
      reported: true,
      skipped: false,
    });

    expect(createMeterEvent).toHaveBeenCalledWith(
      {
        event_name: 'verify_api_overage_run',
        identifier: 'overage:org-scale:run-1',
        timestamp: 1781265600,
        payload: {
          stripe_customer_id: 'cus_scale',
          value: '1',
        },
      },
      { idempotencyKey: 'overage:org-scale:run-1' },
    );
    expect(prisma.proofUsageEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'usage-1' },
        data: expect.objectContaining({
          stripeReported: true,
          stripeUsageRecordId: 'overage:org-scale:run-1',
        }),
      }),
    );
  });

  it('uses the test-mode subscription customer when reporting sandbox overage usage', async () => {
    const createdAt = new Date('2026-06-12T12:00:00.000Z');
    prisma.proofUsageEvent.findUnique.mockResolvedValue({
      id: 'usage-sandbox',
      organizationId: 'org-scale',
      product: 'verify-api',
      proofId: null,
      verificationRunId: 'run-sandbox',
      planSlug: 'verify-api-scale',
      isOverage: true,
      quantity: 1,
      overageCents: 1,
      stripeReported: false,
      stripeUsageRecordId: null,
      createdAt,
    });
    prisma.proofProductEntitlement.findFirst.mockResolvedValue({
      id: 'ent-scale',
      organizationId: 'org-scale',
      product: ProofProductType.VERIFY_API,
      planSlug: 'verify-api-scale',
      status: ProofEntitlementStatus.ACTIVE,
      stripeSessionId: 'cs_test_scale',
      stripeSubscriptionId: 'sub_test_scale',
      stripeSubscriptionItemId: 'si_test_overage_scale',
      meteredBillingEnabled: true,
    });
    prisma.organization.findUnique.mockResolvedValue({
      stripeCustomerId: 'cus_live_should_not_be_used',
    });
    prisma.proofUsageEvent.update.mockResolvedValue({});

    const createMeterEvent = jest.fn().mockResolvedValue({
      identifier: 'overage:org-scale:run-sandbox',
    });
    const retrieveSubscription = jest.fn().mockResolvedValue({
      id: 'sub_test_scale',
      customer: 'cus_test_scale',
    });
    (service as unknown as Record<string, unknown>)['stripeTest'] = {
      subscriptions: { retrieve: retrieveSubscription },
      billing: { meterEvents: { create: createMeterEvent } },
    };

    await expect(service.reportUsageEventToStripe('usage-sandbox')).resolves.toEqual({
      reported: true,
      skipped: false,
    });

    expect(retrieveSubscription).toHaveBeenCalledWith('sub_test_scale');
    expect(createMeterEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: {
          stripe_customer_id: 'cus_test_scale',
          value: '1',
        },
      }),
      { idempotencyKey: 'overage:org-scale:run-sandbox' },
    );
  });

  it('reconciles unreported rows and disables metering on payment failure fallback', async () => {
    prisma.proofUsageEvent.findMany.mockResolvedValue([
      {
        id: 'usage-2',
        organizationId: 'org-scale',
        createdAt: new Date('2026-06-12T12:00:00.000Z'),
      },
    ]);
    prisma.proofUsageEvent.findUnique.mockResolvedValue({
      id: 'usage-2',
      organizationId: 'org-scale',
      product: 'verify-api',
      verificationRunId: 'run-2',
      planSlug: 'verify-api-scale',
      isOverage: true,
      quantity: 1,
      stripeReported: false,
      createdAt: new Date('2026-06-12T12:00:00.000Z'),
    });
    prisma.proofProductEntitlement.findFirst.mockResolvedValue({
      id: 'ent-scale',
      organizationId: 'org-scale',
      product: ProofProductType.VERIFY_API,
      stripeSubscriptionId: 'sub_scale',
      stripeSubscriptionItemId: 'si_scale',
      meteredBillingEnabled: true,
    });
    prisma.organization.findUnique.mockResolvedValue({ stripeCustomerId: 'cus_scale' });
    prisma.proofUsageEvent.update.mockResolvedValue({});
    (service as unknown as Record<string, unknown>)['stripe'] = {
      billing: {
        meterEvents: {
          create: jest.fn().mockResolvedValue({ identifier: 'overage:org-scale:run-2' }),
        },
      },
    };

    await expect(service.reconcileUnreportedOverageEvents({ olderThanMs: 0 })).resolves.toEqual({
      enabled: true,
      scanned: 1,
      reported: 1,
      failed: 0,
    });

    prisma.proofProductEntitlement.updateMany.mockResolvedValue({ count: 1 });
    await expect(service.disableMeteredBillingForSubscription('sub_scale')).resolves.toEqual({
      count: 1,
    });
    expect(prisma.proofProductEntitlement.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          stripeSubscriptionId: 'sub_scale',
          product: ProofProductType.VERIFY_API,
          meteredBillingEnabled: true,
        }),
        data: { meteredBillingEnabled: false },
      }),
    );
  });

  it('records retry attempts and exponential backoff when Stripe usage reporting fails', async () => {
    const stripeError = new Error('Stripe rate limit');
    prisma.proofUsageEvent.findMany.mockResolvedValue([
      {
        id: 'usage-retry',
        organizationId: 'org-scale',
        createdAt: new Date('2026-06-12T12:00:00.000Z'),
        stripeReportAttempts: 2,
      },
    ]);
    prisma.proofUsageEvent.findUnique.mockResolvedValue({
      id: 'usage-retry',
      organizationId: 'org-scale',
      product: 'verify-api',
      verificationRunId: 'run-retry',
      planSlug: 'verify-api-scale',
      isOverage: true,
      quantity: 1,
      stripeReported: false,
      createdAt: new Date('2026-06-12T12:00:00.000Z'),
    });
    prisma.proofProductEntitlement.findFirst.mockResolvedValue({
      id: 'ent-scale',
      organizationId: 'org-scale',
      product: ProofProductType.VERIFY_API,
      stripeSubscriptionId: 'sub_scale',
      stripeSubscriptionItemId: 'si_scale',
      meteredBillingEnabled: true,
    });
    prisma.organization.findUnique.mockResolvedValue({ stripeCustomerId: 'cus_scale' });
    (service as unknown as Record<string, unknown>)['stripe'] = {
      billing: { meterEvents: { create: jest.fn().mockRejectedValue(stripeError) } },
    };

    await expect(service.reconcileUnreportedOverageEvents({ olderThanMs: 0 })).resolves.toEqual({
      enabled: true,
      scanned: 1,
      reported: 0,
      failed: 1,
    });

    expect(prisma.proofUsageEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'usage-retry' },
        data: expect.objectContaining({
          stripeReportAttempts: 3,
          nextStripeReportAt: expect.any(Date),
          lastStripeReportError: 'Stripe rate limit',
        }),
      }),
    );
  });

  it('uses the installed Stripe meter-events SDK surface, not removed usage-record APIs', () => {
    const stripe = new Stripe('sk_test_sdk_shape', { apiVersion: '2026-01-28.clover' });

    expect(typeof stripe.billing.meterEvents.create).toBe('function');
    expect(
      (
        stripe.subscriptionItems as unknown as {
          createUsageRecord?: unknown;
        }
      ).createUsageRecord,
    ).toBeUndefined();
  });

  it('returns the existing overage event when the database dedupe index wins a race', async () => {
    const duplicate = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
    });
    prisma.proofProductEntitlement.findFirst.mockResolvedValue({
      id: 'ent-scale',
      organizationId: 'org-scale',
      product: ProofProductType.VERIFY_API,
      planSlug: 'verify-api-scale',
      status: ProofEntitlementStatus.ACTIVE,
      stripeSubscriptionItemId: 'si_scale',
      meteredBillingEnabled: true,
    });
    prisma.proofUsageEvent.create.mockRejectedValue(duplicate);
    prisma.proofUsageEvent.findFirst.mockResolvedValue({ id: 'usage-existing' });

    await expect(
      service.createVerifyApiOverageEvent({
        organizationId: 'org-scale',
        verificationRunId: 'run-race',
        planSlug: 'verify-api-scale',
        overageCents: 1,
      }),
    ).resolves.toEqual({ id: 'usage-existing' });

    expect(prisma.proofUsageEvent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: 'org-scale',
          verificationRunId: 'run-race',
          isOverage: true,
        }),
      }),
    );
  });

  it('drains all invoice-period overage rows during end-of-period sweep', async () => {
    prisma.proofProductEntitlement.findFirst.mockResolvedValue({
      id: 'ent-scale',
      organizationId: 'org-scale',
      product: ProofProductType.VERIFY_API,
      stripeSubscriptionId: 'sub_scale',
    });
    prisma.proofUsageEvent.findMany
      .mockResolvedValueOnce(
        Array.from({ length: 1000 }, (_, index) => ({
          id: `usage-${index + 1}`,
          organizationId: 'org-scale',
          createdAt: new Date('2026-06-12T00:00:00Z'),
        })),
      )
      .mockResolvedValueOnce([
        {
          id: 'usage-1001',
          organizationId: 'org-scale',
          createdAt: new Date('2026-06-12T00:01:00Z'),
        },
      ])
      .mockResolvedValueOnce([]);
    jest
      .spyOn(service, 'reportUsageEventToStripe')
      .mockResolvedValue({ reported: true, skipped: false });

    await service.handleInvoiceCreated({
      id: 'in_scale',
      lines: {
        data: [
          {
            period: {
              start: Math.floor(new Date('2026-06-01T00:00:00Z').getTime() / 1000),
              end: Math.floor(new Date('2026-07-01T00:00:00Z').getTime() / 1000),
            },
          },
        ],
      },
      parent: { subscription_details: { subscription: 'sub_scale' } },
    } as Stripe.Invoice);

    expect(prisma.proofUsageEvent.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.proofUsageEvent.findMany.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: expect.objectContaining({
            gte: new Date('2026-06-01T00:00:00Z'),
            lt: new Date('2026-07-01T00:00:00Z'),
          }),
        }),
        take: 1000,
      }),
    );
    expect(service.reportUsageEventToStripe).toHaveBeenCalledTimes(1001);
  });

  it('does not cap drain-all reconciliation at 100 pages', async () => {
    prisma.proofProductEntitlement.findFirst.mockResolvedValue({
      id: 'ent-scale',
      organizationId: 'org-scale',
      product: ProofProductType.VERIFY_API,
      stripeSubscriptionId: 'sub_scale',
    });
    for (let index = 0; index < 101; index += 1) {
      prisma.proofUsageEvent.findMany.mockResolvedValueOnce([
        {
          id: `usage-page-${index + 1}`,
          organizationId: 'org-scale',
          createdAt: new Date('2026-06-12T00:00:00Z'),
        },
      ]);
    }
    prisma.proofUsageEvent.findMany.mockResolvedValueOnce([]);
    jest
      .spyOn(service, 'reportUsageEventToStripe')
      .mockResolvedValue({ reported: true, skipped: false });

    await expect(
      service.reconcileUnreportedOverageEvents({
        organizationId: 'org-scale',
        subscriptionId: 'sub_scale',
        olderThanMs: 0,
        limit: 1,
        drainAll: true,
      }),
    ).resolves.toEqual({
      enabled: true,
      scanned: 101,
      reported: 101,
      failed: 0,
    });

    expect(prisma.proofUsageEvent.findMany).toHaveBeenCalledTimes(102);
    expect(service.reportUsageEventToStripe).toHaveBeenCalledTimes(101);
  });

  it('treats missing metered subscription items as not overage-ready', async () => {
    prisma.proofProductEntitlement.findFirst.mockResolvedValue({
      id: 'ent-scale',
      organizationId: 'org-scale',
      product: ProofProductType.VERIFY_API,
      planSlug: 'verify-api-scale',
      status: ProofEntitlementStatus.ACTIVE,
      stripeSubscriptionItemId: null,
      meteredBillingEnabled: false,
    });

    await expect(
      service.isVerifyApiMeteredOverageReady('org-scale', 'verify-api-scale'),
    ).resolves.toBe(false);

    prisma.proofProductEntitlement.findFirst.mockResolvedValue({
      id: 'ent-scale',
      organizationId: 'org-scale',
      product: ProofProductType.VERIFY_API,
      planSlug: 'verify-api-scale',
      status: ProofEntitlementStatus.ACTIVE,
      stripeSubscriptionItemId: 'si_scale',
      meteredBillingEnabled: true,
    });

    await expect(
      service.isVerifyApiMeteredOverageReady('org-scale', 'verify-api-scale'),
    ).resolves.toBe(true);
  });
});
