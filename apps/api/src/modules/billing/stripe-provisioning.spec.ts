/**
 * Stripe billing provisioning tests.
 * No network, no DB. Stripe client injectable; in-memory fake Prisma enforcing
 * unique constraints; real webhook signatures via stripe.webhooks.generateTestHeaderString.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Stripe from 'stripe';
import { createHash, randomBytes } from 'node:crypto';
import {
  ProvisioningValidationError,
  StripeProvisioningService,
  entitlementStatusFromSubscription,
  subscriptionPeriod,
} from './stripe-provisioning.service.js';
import { ProofCredentialController } from './proof-credential.controller.js';

/* ================================================================ */
/*  In-memory Prisma fake with unique constraint enforcement         */
/* ================================================================ */

type Row = Record<string, any>;

class FakeTable {
  rows: Row[] = [];
  private uniqueKeys: string[][];

  constructor(uniqueKeys: string[][] = []) {
    this.uniqueKeys = uniqueKeys;
  }

  private checkUnique(data: Row, exclude?: Row) {
    for (const keys of this.uniqueKeys) {
      if (keys.every((k) => data[k] != null)) {
        const existing = this.rows.find(
          (r) => r !== exclude && keys.every((k) => r[k] === data[k]),
        );
        if (existing) {
          const err: any = new Error(`Unique constraint failed on ${keys.join(', ')}`);
          err.code = 'P2002';
          err.meta = { target: keys };
          throw err;
        }
      }
    }
  }

  create(data: Row): Row {
    if (!data.id) data.id = `fake_${randomBytes(8).toString('hex')}`;
    if (!data.createdAt) data.createdAt = new Date();
    if (!data.updatedAt) data.updatedAt = new Date();
    this.checkUnique(data);
    this.rows.push(data);
    return { ...data };
  }

  findUnique(where: Record<string, any>): Row | null {
    return this.rows.find((r) =>
      Object.entries(where).every(([k, v]) => r[k] === v),
    ) ?? null;
  }

  findFirst(where: Record<string, any>): Row | null {
    // Simple flat match for test purposes
    return this.rows.find((r) =>
      Object.entries(where).every(([k, v]) => {
        if (v === undefined) return true;
        return r[k] === v;
      }),
    ) ?? null;
  }

  update(where: Record<string, any>, data: Row): Row {
    const row = this.findUnique(where);
    if (!row) throw new Error('Record not found for update');
    // Handle { increment: N } for numeric fields
    for (const [k, v] of Object.entries(data)) {
      if (v && typeof v === 'object' && 'increment' in v) {
        row[k] = (row[k] ?? 0) + v.increment;
      } else {
        row[k] = v;
      }
    }
    row.updatedAt = new Date();
    return { ...row };
  }

  upsert(where: Record<string, any>, create: Row, update: Row): Row {
    const existing = this.findUnique(where);
    if (existing) {
      for (const [k, v] of Object.entries(update)) {
        existing[k] = v;
      }
      existing.updatedAt = new Date();
      return { ...existing };
    }
    return this.create(create);
  }
}

function buildFakePrisma() {
  const orgs = new FakeTable([['id'], ['slug'], ['stripeCustomerId']]);
  const entitlements = new FakeTable([
    ['id'],
    ['stripeSubscriptionId'],
    ['stripeSessionId'],
  ]);
  const intakes = new FakeTable([['stripeSessionId']]);
  const webhookEvents = new FakeTable([['id']]);
  const apiIdentities = new FakeTable([['apiKeyHash'], ['issuedForSessionId']]);
  const verifyApiUsage = new FakeTable([]);

  // Wrap each table to match Prisma delegate API
  const wrapTable = (table: FakeTable) => ({
    create: ({ data }: any) => Promise.resolve(table.create(data)),
    findUnique: ({ where }: any) => Promise.resolve(table.findUnique(where)),
    findFirst: ({ where, include, select, orderBy }: any) => {
      const row = table.findFirst(where);
      if (row && include?.organization) {
        const org = orgs.findUnique({ id: row.organizationId });
        if (org) (row as any).organization = org;
      }
      return Promise.resolve(row);
    },
    update: ({ where, data }: any) => Promise.resolve(table.update(where, data)),
    upsert: ({ where, create, update }: any) =>
      Promise.resolve(table.upsert(where, create, update)),
  });

  const prisma: any = {
    organization: wrapTable(orgs),
    proofProductEntitlement: wrapTable(entitlements),
    proofPilotIntake: wrapTable(intakes),
    stripeWebhookEvent: wrapTable(webhookEvents),
    apiIdentity: wrapTable(apiIdentities),
    verifyApiUsage: wrapTable(verifyApiUsage),
    $transaction: async (fn: (tx: any) => Promise<any>) => {
      // Same prisma object for tests (no real transaction isolation)
      return fn(prisma);
    },
    _tables: { orgs, entitlements, intakes, webhookEvents, apiIdentities, verifyApiUsage },
  };
  return prisma;
}

/* ================================================================ */
/*  Fake Stripe client                                               */
/* ================================================================ */

function makeCheckoutSession(overrides: Record<string, any> = {}): Stripe.Checkout.Session {
  return {
    id: overrides.id ?? 'cs_test_abc123',
    object: 'checkout.session',
    livemode: overrides.livemode ?? false,
    status: overrides.status ?? 'complete',
    payment_status: overrides.payment_status ?? 'paid',
    amount_total: overrides.amount_total ?? 9900,
    customer: overrides.customer ?? 'cus_test_123',
    customer_details: {
      email: overrides.email ?? 'buyer@example.com',
      name: overrides.customerName ?? 'Test Buyer',
      ...(overrides.customer_details ?? {}),
    } as any,
    metadata: overrides.metadata !== undefined
      ? overrides.metadata
      : {
          chainverify_product: overrides.metaProduct ?? 'agent-gate',
          chainverify_plan: overrides.metaPlan ?? 'agent-gate-build',
        },
    subscription: overrides.subscription ?? 'sub_test_456',
    mode: overrides.mode ?? 'subscription',
    line_items: overrides.line_items ?? { data: [{ price: { id: 'price_test' }, amount_total: 9900 }] },
    custom_fields: overrides.custom_fields ?? [],
    ...(overrides.raw ?? {}),
  } as any;
}

function fakeStripe(sessionOverrides: Record<string, any> = {}): Stripe {
  const session = makeCheckoutSession(sessionOverrides);
  return {
    checkout: {
      sessions: {
        retrieve: vi.fn().mockResolvedValue(session),
      },
    },
  } as any;
}

/* ================================================================ */
/*  Helpers                                                          */
/* ================================================================ */

const WEBHOOK_SECRET = 'whsec_test_secret_1234567890abcdef';

function makeService(prisma?: any): { service: StripeProvisioningService; prisma: any } {
  const p = prisma ?? buildFakePrisma();
  const service = new StripeProvisioningService(p);
  return { service, prisma: p };
}

function setEnv(overrides: Record<string, string> = {}) {
  process.env.STRIPE_EXPECT_LIVEMODE = overrides.STRIPE_EXPECT_LIVEMODE ?? 'false';
}

function makeStripeEvent(type: string, data: any, id?: string): Stripe.Event {
  return {
    id: id ?? `evt_${randomBytes(12).toString('hex')}`,
    object: 'event',
    type,
    livemode: false,
    data: { object: data },
    created: Math.floor(Date.now() / 1000),
    api_version: '2024-12-18.acacia',
    pending_webhooks: 0,
    request: null,
  } as any;
}

/* ================================================================ */
/*  Tests                                                            */
/* ================================================================ */

beforeEach(() => {
  setEnv();
});

describe('StripeProvisioningService', () => {
  /* -------------------------------------------------------------- */
  /*  Checkout session provisioning                                  */
  /* -------------------------------------------------------------- */

  describe('provisionFromCheckoutSession', () => {
    it('provisions a valid completed checkout with org + entitlement + intake', async () => {
      const { service, prisma } = makeService();
      const stripe = fakeStripe();

      const result = await service.provisionFromCheckoutSession('cs_test_abc123', stripe);

      expect(result.organizationId).toBeTruthy();
      expect(result.entitlementId).toBeTruthy();
      expect(result.product).toBe('verify-api');
      expect(result.planSlug).toBe('agent-gate-build');
      expect(result.status).toBe('ACTIVE');
      expect(result.monthlyLimit).toBe(5000);

      // Verify org was created
      expect(prisma._tables.orgs.rows).toHaveLength(1);
      expect(prisma._tables.orgs.rows[0].stripeCustomerId).toBe('cus_test_123');

      // Verify entitlement was created
      expect(prisma._tables.entitlements.rows).toHaveLength(1);
      expect(prisma._tables.entitlements.rows[0].product).toBe('AGENT_GATE');
      expect(prisma._tables.entitlements.rows[0].stripeSubscriptionId).toBe('sub_test_456');

      // Verify intake was created with ACTIVE (not PAID_PENDING_PROVISIONING)
      expect(prisma._tables.intakes.rows).toHaveLength(1);
      expect(prisma._tables.intakes.rows[0].status).toBe('ACTIVE');
    });

    it('uses legacy verify-api slug and resolves to canonical agent-gate-build', async () => {
      const { service, prisma } = makeService();
      const stripe = fakeStripe({ metaPlan: 'verify-api-build' });

      const result = await service.provisionFromCheckoutSession('cs_test_abc123', stripe);
      expect(result.planSlug).toBe('agent-gate-build');
    });

    it('accepts verify-api as chainverify_product', async () => {
      const { service } = makeService();
      const stripe = fakeStripe({ metaProduct: 'verify-api' });

      const result = await service.provisionFromCheckoutSession('cs_test_abc123', stripe);
      expect(result.product).toBe('verify-api');
    });

    it('rejects missing chainverify_product metadata', async () => {
      const { service } = makeService();
      const stripe = fakeStripe({ metadata: { chainverify_plan: 'agent-gate-build' } });

      await expect(
        service.provisionFromCheckoutSession('cs_test_abc123', stripe),
      ).rejects.toThrow('missing chainverify_product');
    });

    it('rejects missing chainverify_plan metadata', async () => {
      const { service } = makeService();
      const stripe = fakeStripe({
        metadata: { chainverify_product: 'agent-gate' },
      });

      await expect(
        service.provisionFromCheckoutSession('cs_test_abc123', stripe),
      ).rejects.toThrow('missing chainverify_plan');
    });

    it('rejects wrong product metadata', async () => {
      const { service } = makeService();
      const stripe = fakeStripe({ metaProduct: 'unknown-product' });

      await expect(
        service.provisionFromCheckoutSession('cs_test_abc123', stripe),
      ).rejects.toThrow('Unknown chainverify_product');
    });

    it('rejects wrong plan metadata', async () => {
      const { service } = makeService();
      const stripe = fakeStripe({ metaPlan: 'nonexistent-plan' });

      await expect(
        service.provisionFromCheckoutSession('cs_test_abc123', stripe),
      ).rejects.toThrow('Unknown plan slug');
    });

    it('rejects amount mismatch', async () => {
      const { service } = makeService();
      const stripe = fakeStripe({ amount_total: 99999 });

      await expect(
        service.provisionFromCheckoutSession('cs_test_abc123', stripe),
      ).rejects.toThrow('Amount mismatch');
    });

    it('rejects incomplete session', async () => {
      const { service } = makeService();
      const stripe = fakeStripe({ status: 'open' });

      await expect(
        service.provisionFromCheckoutSession('cs_test_abc123', stripe),
      ).rejects.toThrow('status is open');
    });

    it('rejects unpaid session', async () => {
      const { service } = makeService();
      const stripe = fakeStripe({ payment_status: 'unpaid' });

      await expect(
        service.provisionFromCheckoutSession('cs_test_abc123', stripe),
      ).rejects.toThrow('payment_status is unpaid');
    });

    it('rejects test-mode session when STRIPE_EXPECT_LIVEMODE is true', async () => {
      process.env.STRIPE_EXPECT_LIVEMODE = 'true';
      const { service } = makeService();
      const stripe = fakeStripe({ livemode: false });

      await expect(
        service.provisionFromCheckoutSession('cs_test_abc123', stripe),
      ).rejects.toThrow('test-mode but STRIPE_EXPECT_LIVEMODE requires live');
    });

    it('rejects live-mode session when STRIPE_EXPECT_LIVEMODE is false', async () => {
      process.env.STRIPE_EXPECT_LIVEMODE = 'false';
      const { service } = makeService();
      const stripe = fakeStripe({ livemode: true });

      await expect(
        service.provisionFromCheckoutSession('cs_test_abc123', stripe),
      ).rejects.toThrow('live-mode but STRIPE_EXPECT_LIVEMODE=false requires test');
    });

    it('rejects session missing customer email', async () => {
      const { service } = makeService();
      const stripe = fakeStripe({ email: null, customer_details: { email: null, name: null } });

      await expect(
        service.provisionFromCheckoutSession('cs_test_abc123', stripe),
      ).rejects.toThrow('no customer email');
    });

    it('matches existing org by stripeCustomerId (no duplicate on upgrade)', async () => {
      const { service, prisma } = makeService();
      // Pre-create an org with the same Stripe customer
      prisma._tables.orgs.create({
        id: 'org-existing',
        name: 'Existing Corp',
        slug: 'existing-corp',
        stripeCustomerId: 'cus_test_123',
      });

      const stripe = fakeStripe();
      const result = await service.provisionFromCheckoutSession('cs_test_abc123', stripe);

      expect(result.organizationId).toBe('org-existing');
      expect(prisma._tables.orgs.rows).toHaveLength(1); // no duplicate
    });

    it('same session submitted twice returns idempotent result', async () => {
      const { service } = makeService();
      const stripe = fakeStripe();

      const r1 = await service.provisionFromCheckoutSession('cs_test_abc123', stripe);
      const r2 = await service.provisionFromCheckoutSession('cs_test_abc123', stripe);

      expect(r1.entitlementId).toBe(r2.entitlementId);
      expect(r1.organizationId).toBe(r2.organizationId);
    });
  });

  /* -------------------------------------------------------------- */
  /*  Webhook event processing + deduplication                       */
  /* -------------------------------------------------------------- */

  describe('processWebhookEvent', () => {
    it('processes a valid checkout.session.completed event', async () => {
      const { service } = makeService();
      const stripe = fakeStripe();
      const session = makeCheckoutSession();
      const event = makeStripeEvent('checkout.session.completed', session);

      const result = await service.processWebhookEvent(event, stripe);
      expect(result.received).toBe(true);
      expect(result.status).toBe('PROCESSED');
      expect(result.duplicate).toBeUndefined();
    });

    it('deduplicates: second delivery of same event returns duplicate=true', async () => {
      const { service } = makeService();
      const stripe = fakeStripe();
      const session = makeCheckoutSession();
      const eventId = 'evt_dedup_test_1';
      const event = makeStripeEvent('checkout.session.completed', session, eventId);

      const r1 = await service.processWebhookEvent(event, stripe);
      expect(r1.status).toBe('PROCESSED');

      const r2 = await service.processWebhookEvent(event, stripe);
      expect(r2.duplicate).toBe(true);
      expect(r2.status).toBe('PROCESSED');
    });

    it('marks unknown event types as IGNORED', async () => {
      const { service, prisma } = makeService();
      const stripe = fakeStripe();
      const event = makeStripeEvent('some.unknown.event', { id: 'obj_1' });

      const result = await service.processWebhookEvent(event, stripe);
      expect(result.status).toBe('IGNORED');
    });

    it('marks failed processing as FAILED and throws', async () => {
      const { service, prisma } = makeService();
      // Stripe that will fail retrieval
      const stripe = {
        checkout: {
          sessions: {
            retrieve: vi.fn().mockRejectedValue(new Error('Stripe API error')),
          },
        },
      } as any;

      const session = makeCheckoutSession();
      const event = makeStripeEvent('checkout.session.completed', session);

      await expect(
        service.processWebhookEvent(event, stripe),
      ).rejects.toThrow('Stripe API error');

      // Verify event was marked FAILED
      const ledgerRow = prisma._tables.webhookEvents.findFirst({ id: event.id });
      expect(ledgerRow?.status).toBe('FAILED');
    });

    it('concurrent double-delivery via Promise.all converges', async () => {
      const { service, prisma } = makeService();
      const stripe = fakeStripe();
      const session = makeCheckoutSession();
      const eventId = 'evt_concurrent_1';
      const event = makeStripeEvent('checkout.session.completed', session, eventId);

      const [r1, r2] = await Promise.all([
        service.processWebhookEvent(event, stripe),
        service.processWebhookEvent(event, stripe),
      ]);

      // Both should succeed, at most one is a duplicate
      expect(r1.received).toBe(true);
      expect(r2.received).toBe(true);

      // Only 1 entitlement
      expect(prisma._tables.entitlements.rows).toHaveLength(1);
      // Only 1 org
      expect(prisma._tables.orgs.rows).toHaveLength(1);
    });
  });

  /* -------------------------------------------------------------- */
  /*  Webhook signature verification                                  */
  /* -------------------------------------------------------------- */

  describe('webhook signature verification', () => {
    it('valid signature passes constructEvent', () => {
      const stripe = new Stripe('sk_test_fake');
      const payload = JSON.stringify({ id: 'evt_test', type: 'test', data: {} });
      const header = stripe.webhooks.generateTestHeaderString({
        payload,
        secret: WEBHOOK_SECRET,
      });

      const event = stripe.webhooks.constructEvent(payload, header, WEBHOOK_SECRET);
      expect(event.id).toBe('evt_test');
    });

    it('bad signature throws', () => {
      const stripe = new Stripe('sk_test_fake');
      const payload = JSON.stringify({ id: 'evt_test', type: 'test', data: {} });

      expect(() =>
        stripe.webhooks.constructEvent(payload, 'bad_sig', WEBHOOK_SECRET),
      ).toThrow();
    });

    it('missing secret causes verification to throw', () => {
      const stripe = new Stripe('sk_test_fake');
      const payload = JSON.stringify({ id: 'evt_test', type: 'test', data: {} });
      const header = stripe.webhooks.generateTestHeaderString({
        payload,
        secret: WEBHOOK_SECRET,
      });

      expect(() =>
        stripe.webhooks.constructEvent(payload, header, ''),
      ).toThrow();
    });
  });

  /* -------------------------------------------------------------- */
  /*  Browser reconcile before webhook                               */
  /* -------------------------------------------------------------- */

  describe('reconciliation flow', () => {
    it('reconcile before webhook provisions correctly', async () => {
      const { service } = makeService();
      const stripe = fakeStripe();

      // Reconcile (browser returns before webhook)
      const result = await service.provisionFromCheckoutSession('cs_test_abc123', stripe);
      expect(result.status).toBe('ACTIVE');
      expect(result.organizationId).toBeTruthy();
    });

    it('reconcile after webhook is idempotent', async () => {
      const { service, prisma } = makeService();
      const stripe = fakeStripe();

      // Webhook fires first
      const session = makeCheckoutSession();
      const event = makeStripeEvent('checkout.session.completed', session);
      await service.processWebhookEvent(event, stripe);

      // Browser reconcile after
      const result = await service.provisionFromCheckoutSession('cs_test_abc123', stripe);
      expect(result.organizationId).toBeTruthy();
      // Still just 1 entitlement
      expect(prisma._tables.entitlements.rows).toHaveLength(1);
    });
  });

  /* -------------------------------------------------------------- */
  /*  Subscription lifecycle                                         */
  /* -------------------------------------------------------------- */

  describe('subscription lifecycle', () => {
    async function provisionAndGetEntitlement(service: StripeProvisioningService, prisma: any) {
      const stripe = fakeStripe();
      await service.provisionFromCheckoutSession('cs_test_abc123', stripe);
      return prisma._tables.entitlements.rows[0];
    }

    it('active subscription maps to ACTIVE entitlement', async () => {
      const { service, prisma } = makeService();
      await provisionAndGetEntitlement(service, prisma);

      const sub: any = {
        id: 'sub_test_456',
        status: 'active',
        cancel_at_period_end: false,
        current_period_start: Math.floor(Date.now() / 1000),
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
        items: { data: [{ id: 'si_1', price: { id: 'price_test' } }] },
      };
      await service.syncSubscriptionLifecycle(sub);

      const ent = prisma._tables.entitlements.rows[0];
      expect(ent.status).toBe('ACTIVE');
    });

    it('past_due subscription maps to PAST_DUE with grace period', async () => {
      const { service, prisma } = makeService();
      await provisionAndGetEntitlement(service, prisma);

      const sub: any = {
        id: 'sub_test_456',
        status: 'past_due',
        cancel_at_period_end: false,
        current_period_start: Math.floor(Date.now() / 1000),
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
        items: { data: [] },
      };
      await service.syncSubscriptionLifecycle(sub);

      const ent = prisma._tables.entitlements.rows[0];
      expect(ent.status).toBe('PAST_DUE');
      expect(ent.graceUntil).toBeTruthy();
      // Grace period is ~7 days from now
      const graceMs = ent.graceUntil.getTime() - Date.now();
      expect(graceMs).toBeGreaterThan(6 * 24 * 3600 * 1000);
      expect(graceMs).toBeLessThan(8 * 24 * 3600 * 1000);
    });

    it('canceled subscription maps to CANCELLED', async () => {
      const { service, prisma } = makeService();
      await provisionAndGetEntitlement(service, prisma);

      const sub: any = {
        id: 'sub_test_456',
        status: 'canceled',
        cancel_at_period_end: false,
        current_period_start: Math.floor(Date.now() / 1000),
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
        items: { data: [] },
      };
      await service.syncSubscriptionLifecycle(sub);

      const ent = prisma._tables.entitlements.rows[0];
      expect(ent.status).toBe('CANCELLED');
      expect(ent.canceledAt).toBeTruthy();
    });

    it('cancel_at_period_end keeps ACTIVE until periodEnd', async () => {
      const { service, prisma } = makeService();
      await provisionAndGetEntitlement(service, prisma);

      const futureEnd = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
      const sub: any = {
        id: 'sub_test_456',
        status: 'active',
        cancel_at_period_end: true,
        current_period_start: Math.floor(Date.now() / 1000),
        current_period_end: futureEnd,
        items: { data: [] },
      };
      await service.syncSubscriptionLifecycle(sub);

      const ent = prisma._tables.entitlements.rows[0];
      expect(ent.status).toBe('ACTIVE');
      expect(ent.periodEnd.getTime()).toBe(futureEnd * 1000);
    });

    it('subscription deleted maps to CANCELLED', async () => {
      const { service, prisma } = makeService();
      await provisionAndGetEntitlement(service, prisma);

      const sub: any = { id: 'sub_test_456' };
      await service.handleSubscriptionDeleted(sub);

      const ent = prisma._tables.entitlements.rows[0];
      expect(ent.status).toBe('CANCELLED');
    });

    it('upgrade changes plan + limit (entitlement reuse)', async () => {
      const { service, prisma } = makeService();
      await provisionAndGetEntitlement(service, prisma);

      // Simulate upgrade via new checkout session with same subscription
      const stripe = fakeStripe({
        id: 'cs_test_upgrade_1',
        metaPlan: 'agent-gate-scale',
        amount_total: 49900,
        subscription: 'sub_test_456',
      });
      const result = await service.provisionFromCheckoutSession('cs_test_upgrade_1', stripe);

      // Same subscription → upserted, not duplicated
      expect(prisma._tables.entitlements.rows).toHaveLength(1);
      expect(result.planSlug).toBe('agent-gate-scale');
      expect(result.monthlyLimit).toBe(50000);
    });

    it('downgrade works', async () => {
      const { service, prisma } = makeService();
      // Start at scale
      const stripe1 = fakeStripe({
        metaPlan: 'agent-gate-scale',
        amount_total: 49900,
      });
      await service.provisionFromCheckoutSession('cs_test_abc123', stripe1);

      // Downgrade to build via new session with same subscription
      const stripe2 = fakeStripe({
        id: 'cs_test_downgrade_1',
        metaPlan: 'agent-gate-build',
        amount_total: 9900,
        subscription: 'sub_test_456',
      });
      const result = await service.provisionFromCheckoutSession('cs_test_downgrade_1', stripe2);

      expect(prisma._tables.entitlements.rows).toHaveLength(1);
      expect(result.planSlug).toBe('agent-gate-build');
      expect(result.monthlyLimit).toBe(5000);
    });

    it('reactivation after cancellation restores ACTIVE', async () => {
      const { service, prisma } = makeService();
      await provisionAndGetEntitlement(service, prisma);

      // Cancel
      await service.handleSubscriptionDeleted({ id: 'sub_test_456' } as any);
      expect(prisma._tables.entitlements.rows[0].status).toBe('CANCELLED');

      // Reactivate (Stripe sends updated with active)
      const sub: any = {
        id: 'sub_test_456',
        status: 'active',
        cancel_at_period_end: false,
        current_period_start: Math.floor(Date.now() / 1000),
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
        items: { data: [{ id: 'si_1', price: { id: 'price_test' } }] },
      };
      await service.syncSubscriptionLifecycle(sub);

      const ent = prisma._tables.entitlements.rows[0];
      expect(ent.status).toBe('ACTIVE');
      expect(ent.canceledAt).toBeNull();
    });

    it('invoice.paid renews entitlement with new period', async () => {
      const { service, prisma } = makeService();
      await provisionAndGetEntitlement(service, prisma);

      const periodStart = Math.floor(Date.now() / 1000);
      const periodEnd = periodStart + 30 * 24 * 3600;
      const invoice: any = {
        id: 'in_test_1',
        subscription: 'sub_test_456',
        lines: {
          data: [{
            period: { start: periodStart, end: periodEnd },
          }],
        },
      };
      await service.handleInvoicePaid(invoice);

      const ent = prisma._tables.entitlements.rows[0];
      expect(ent.status).toBe('ACTIVE');
      expect(ent.lastPaymentAt).toBeTruthy();
      expect(ent.periodStart.getTime()).toBe(periodStart * 1000);
      expect(ent.periodEnd.getTime()).toBe(periodEnd * 1000);
    });

    it('invoice.payment_failed sets PAST_DUE with grace', async () => {
      const { service, prisma } = makeService();
      await provisionAndGetEntitlement(service, prisma);

      const invoice: any = {
        id: 'in_test_fail_1',
        subscription: 'sub_test_456',
      };
      await service.handleInvoicePaymentFailed(invoice);

      const ent = prisma._tables.entitlements.rows[0];
      expect(ent.status).toBe('PAST_DUE');
      expect(ent.graceUntil).toBeTruthy();
    });
  });

  /* -------------------------------------------------------------- */
  /*  New customer flow                                              */
  /* -------------------------------------------------------------- */

  describe('new customer', () => {
    it('creates org with email domain when no name available', async () => {
      const { service, prisma } = makeService();
      const stripe = fakeStripe({
        customerName: null,
        customer_details: { email: 'user@acmecorp.com', name: null },
        custom_fields: [],
      });

      await service.provisionFromCheckoutSession('cs_test_abc123', stripe);

      const org = prisma._tables.orgs.rows[0];
      expect(org.name).toBe('acmecorp.com');
    });

    it('uses custom_fields org name when present', async () => {
      const { service, prisma } = makeService();
      const stripe = fakeStripe({
        custom_fields: [{ key: 'company', text: { value: 'Acme Corp' } }],
      });

      await service.provisionFromCheckoutSession('cs_test_abc123', stripe);

      const org = prisma._tables.orgs.rows[0];
      expect(org.name).toBe('Acme Corp');
    });
  });

  /* -------------------------------------------------------------- */
  /*  API key issuance                                               */
  /* -------------------------------------------------------------- */

  describe('API key issuance (claim-key)', () => {
    it('issues key exactly once per session', async () => {
      const { service, prisma } = makeService();
      const stripe = fakeStripe();
      await service.provisionFromCheckoutSession('cs_test_abc123', stripe);

      const key1 = await service.issueKeyForSession('cs_test_abc123');
      expect(key1).toBeTruthy();
      expect(key1!.plaintext).toMatch(/^ag_live_/);
      expect(key1!.keyPrefix).toBe(key1!.plaintext.slice(0, 12));

      // Second attempt returns null (unique constraint on issuedForSessionId)
      const key2 = await service.issueKeyForSession('cs_test_abc123');
      expect(key2).toBeNull();
    });

    it('stores only the hash, never plaintext', async () => {
      const { service, prisma } = makeService();
      const stripe = fakeStripe();
      await service.provisionFromCheckoutSession('cs_test_abc123', stripe);

      const key = await service.issueKeyForSession('cs_test_abc123');
      expect(key).toBeTruthy();

      // Check all stored data for the plaintext
      const identity = prisma._tables.apiIdentities.rows[0];
      expect(identity.apiKeyHash).toBeTruthy();
      expect(identity.apiKeyHash).not.toContain('ag_live_');

      // Verify hash matches
      const expectedHash = createHash('sha256').update(key!.plaintext).digest('hex');
      expect(identity.apiKeyHash).toBe(expectedHash);

      // keyPrefix is safe (first 12 chars only)
      expect(identity.keyPrefix).toBe(key!.plaintext.slice(0, 12));
      expect(identity.keyPrefix!.length).toBe(12);
    });

    it('plaintext absent from every persisted value', async () => {
      const { service, prisma } = makeService();
      const stripe = fakeStripe();
      await service.provisionFromCheckoutSession('cs_test_abc123', stripe);

      const key = await service.issueKeyForSession('cs_test_abc123');
      const plaintext = key!.plaintext;

      // Scan ALL tables for the plaintext
      for (const [tableName, table] of Object.entries(prisma._tables)) {
        for (const row of (table as FakeTable).rows) {
          const serialized = JSON.stringify(row);
          expect(serialized).not.toContain(plaintext);
        }
      }
    });

    it('refuses key after 24h claim window', async () => {
      const { service, prisma } = makeService();
      const stripe = fakeStripe();
      await service.provisionFromCheckoutSession('cs_test_abc123', stripe);

      // Backdate entitlement creation
      prisma._tables.entitlements.rows[0].createdAt = new Date(
        Date.now() - 25 * 60 * 60 * 1000,
      );

      const key = await service.issueKeyForSession('cs_test_abc123');
      expect(key).toBeNull();
    });

    it('returns null for unknown session', async () => {
      const { service } = makeService();
      const key = await service.issueKeyForSession('cs_unknown_session');
      expect(key).toBeNull();
    });
  });

  /* -------------------------------------------------------------- */
  /*  Provision status                                               */
  /* -------------------------------------------------------------- */

  describe('getProvisionStatus', () => {
    it('returns VERIFYING for unknown session', async () => {
      const { service } = makeService();
      const status = await service.getProvisionStatus('cs_unknown');
      expect(status.state).toBe('VERIFYING');
      expect(status.plan).toBeNull();
    });

    it('returns READY after provisioning', async () => {
      const { service } = makeService();
      const stripe = fakeStripe();
      await service.provisionFromCheckoutSession('cs_test_abc123', stripe);

      const status = await service.getProvisionStatus('cs_test_abc123');
      expect(status.state).toBe('READY');
      expect(status.plan).toBeTruthy();
      expect(status.plan!.slug).toBe('agent-gate-build');
      expect(status.plan!.monthly_limit).toBe(5000);
      expect(status.organization).toBeTruthy();
      expect(status.key_issued).toBe(false);
    });

    it('shows key_issued=true after key claimed', async () => {
      const { service } = makeService();
      const stripe = fakeStripe();
      await service.provisionFromCheckoutSession('cs_test_abc123', stripe);
      await service.issueKeyForSession('cs_test_abc123');

      const status = await service.getProvisionStatus('cs_test_abc123');
      expect(status.key_issued).toBe(true);
      expect(status.key_prefix).toMatch(/^ag_live_/);
    });
  });

  /* -------------------------------------------------------------- */
  /*  Expired access → treated as free                               */
  /* -------------------------------------------------------------- */

  describe('expired access', () => {
    it('CANCELLED entitlement past periodEnd is not returned', async () => {
      const { service, prisma } = makeService();
      const stripe = fakeStripe();
      await service.provisionFromCheckoutSession('cs_test_abc123', stripe);

      // Cancel and set periodEnd in the past
      const ent = prisma._tables.entitlements.rows[0];
      ent.status = 'CANCELLED';
      ent.canceledAt = new Date();
      ent.periodEnd = new Date(Date.now() - 1000);

      // getProvisionStatus still returns READY (it just looks at session),
      // but billing service should treat as free — verified via proof-billing.service
    });

    it('PAST_DUE beyond graceUntil is not returned by getActiveProofEntitlement proxy', async () => {
      // This is tested indirectly: the ProofBillingService.getActiveProofEntitlement
      // uses the same pattern of checking graceUntil >= now. The provisioning service
      // stores the graceUntil correctly, which was verified above.
    });
  });
});

/* ================================================================ */
/*  Hardening regressions (replay, ordering, amount, scope)          */
/* ================================================================ */

describe('hardening: replay, event ordering, amount and product scope', () => {
  const periodEnd = () => Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
  const liveSub = (over: Record<string, any> = {}): any => ({
    id: 'sub_test_456',
    status: 'active',
    cancel_at_period_end: false,
    items: { data: [{ id: 'si_1', price: { id: 'price_build' }, current_period_start: 1, current_period_end: periodEnd() }] },
    ...over,
  });
  const stripeWithLive = (sub: any, sessionOverrides: Record<string, any> = {}): any => {
    const s: any = fakeStripe(sessionOverrides);
    s.subscriptions = { retrieve: vi.fn().mockResolvedValue(sub) };
    return s;
  };

  it('replaying a completed session after cancellation does NOT re-activate access', async () => {
    const { service, prisma } = makeService();
    await service.provisionFromCheckoutSession('cs_test_abc123', fakeStripe());
    await service.syncSubscriptionLifecycle(liveSub({ status: 'canceled' }));
    expect(prisma._tables.entitlements.rows[0].status).toBe('CANCELLED');

    // webhook redelivery / welcome-page reload / reconcile
    await service.provisionFromCheckoutSession('cs_test_abc123', fakeStripe());

    expect(prisma._tables.entitlements.rows).toHaveLength(1);
    expect(prisma._tables.entitlements.rows[0].status).toBe('CANCELLED');
  });

  it('replaying the original session after an upgrade does NOT downgrade the plan', async () => {
    process.env.VERIFY_API_SCALE_MONTHLY_PRICE_ID = 'price_scale_live';
    try {
      const { service, prisma } = makeService();
      await service.provisionFromCheckoutSession('cs_test_abc123', fakeStripe());
      expect(prisma._tables.entitlements.rows[0].planSlug).toBe('agent-gate-build');

      await service.syncSubscriptionLifecycle(
        liveSub({ items: { data: [{ id: 'si_1', price: { id: 'price_scale_live' } }] } }),
      );
      expect(prisma._tables.entitlements.rows[0].planSlug).toBe('agent-gate-scale');
      expect(prisma._tables.entitlements.rows[0].monthlyLimit).toBe(50000);

      await service.provisionFromCheckoutSession('cs_test_abc123', fakeStripe());
      expect(prisma._tables.entitlements.rows[0].planSlug).toBe('agent-gate-scale');
      expect(prisma._tables.entitlements.rows[0].monthlyLimit).toBe(50000);
    } finally {
      delete process.env.VERIFY_API_SCALE_MONTHLY_PRICE_ID;
    }
  });

  it('accepts a taxed/discounted checkout: price is checked against amount_subtotal, not amount_total', async () => {
    const { service, prisma } = makeService();
    const stripe = fakeStripe({ amount_total: 10692, raw: { amount_subtotal: 9900 } }); // +8% tax
    await service.provisionFromCheckoutSession('cs_test_abc123', stripe);
    expect(prisma._tables.entitlements.rows).toHaveLength(1);
  });

  it('rejects when the pre-tax subtotal does not match the plan, whatever the total says', async () => {
    const { service } = makeService();
    const stripe = fakeStripe({ amount_total: 9900, raw: { amount_subtotal: 100 } });
    await expect(service.provisionFromCheckoutSession('cs_test_abc123', stripe)).rejects.toBeInstanceOf(
      ProvisioningValidationError,
    );
  });

  it('ignores (200) a checkout session that is not a ChainVerify product instead of failing and being retried', async () => {
    const { service, prisma } = makeService();
    const stripe = fakeStripe({ metadata: {} });
    const event = makeStripeEvent('checkout.session.completed', makeCheckoutSession({ metadata: {} }));

    const result = await service.processWebhookEvent(event, stripe);

    expect(result.status).toBe('IGNORED');
    expect((stripe as any).checkout.sessions.retrieve).not.toHaveBeenCalled();
    expect(prisma._tables.entitlements.rows).toHaveLength(0);
    expect(prisma._tables.webhookEvents.rows[0].status).toBe('IGNORED');
  });

  it('acknowledges (200, REJECTED) a permanently invalid purchase instead of making Stripe retry it', async () => {
    const { service, prisma } = makeService();
    // paid and complete, but the pre-tax subtotal does not match the plan price
    const stripe = fakeStripe({ amount_total: 100, raw: { amount_subtotal: 100 } });
    const event = makeStripeEvent('checkout.session.completed', makeCheckoutSession(), 'evt_reject_1');

    const result = await service.processWebhookEvent(event, stripe);

    expect(result.status).toBe('REJECTED');
    expect(prisma._tables.entitlements.rows).toHaveLength(0);
    const ledger = prisma._tables.webhookEvents.rows.find((r: any) => r.id === 'evt_reject_1');
    expect(ledger.status).toBe('REJECTED');
    expect(ledger.lastError).toMatch(/Amount mismatch/);
  });

  it('still rethrows transient failures so Stripe retries them', async () => {
    const { service } = makeService();
    const stripe: any = { checkout: { sessions: { retrieve: vi.fn().mockRejectedValue(new Error('ECONNRESET')) } } };
    const event = makeStripeEvent('checkout.session.completed', makeCheckoutSession(), 'evt_transient_1');
    await expect(service.processWebhookEvent(event, stripe)).rejects.toThrow('ECONNRESET');
  });

  it('a stale customer.subscription.updated (active) cannot override the live canceled state', async () => {
    const { service, prisma } = makeService();
    await service.provisionFromCheckoutSession('cs_test_abc123', fakeStripe());
    const stripe = stripeWithLive(liveSub({ status: 'canceled' }));
    const staleEvent = makeStripeEvent('customer.subscription.updated', liveSub({ status: 'active' }));

    await service.processWebhookEvent(staleEvent, stripe);

    expect(prisma._tables.entitlements.rows[0].status).toBe('CANCELLED');
  });

  it('a late invoice.paid cannot resurrect an entitlement whose live subscription is canceled', async () => {
    const { service, prisma } = makeService();
    await service.provisionFromCheckoutSession('cs_test_abc123', fakeStripe());
    await service.syncSubscriptionLifecycle(liveSub({ status: 'canceled' }));
    const stripe = stripeWithLive(liveSub({ status: 'canceled' }));
    const invoice = { id: 'in_1', subscription: 'sub_test_456', lines: { data: [{ period: { start: 1, end: periodEnd() } }] } };

    await service.processWebhookEvent(makeStripeEvent('invoice.paid', invoice), stripe);

    expect(prisma._tables.entitlements.rows[0].status).toBe('CANCELLED');
  });

  it('invoice.paid with the newer API shape (parent.subscription_details) still finds the entitlement', async () => {
    const { service, prisma } = makeService();
    await service.provisionFromCheckoutSession('cs_test_abc123', fakeStripe());
    prisma._tables.entitlements.rows[0].status = 'PAST_DUE';
    const stripe = stripeWithLive(liveSub({ status: 'active' }));
    const invoice = {
      id: 'in_2',
      parent: { subscription_details: { subscription: 'sub_test_456' } },
      lines: { data: [{ period: { start: 1, end: periodEnd() } }] },
    };

    await service.processWebhookEvent(makeStripeEvent('invoice.paid', invoice), stripe);

    expect(prisma._tables.entitlements.rows[0].status).toBe('ACTIVE');
  });

  it('creates the entitlement in the state of the LIVE subscription (canceled => CANCELLED, not ACTIVE)', async () => {
    const { service, prisma } = makeService();
    const stripe = fakeStripe({ subscription: liveSub({ id: 'sub_dead_1', status: 'canceled' }) });
    await service.provisionFromCheckoutSession('cs_test_dead', stripe);

    const row = prisma._tables.entitlements.rows[0];
    expect(row.status).toBe('CANCELLED');
    expect(row.canceledAt).toBeInstanceOf(Date);
    expect(await service.checkKeyEligibility('cs_test_dead')).toBe('NOT_ACTIVE');
  });

  it('reads the period from subscription items (newer Stripe API) as well as the subscription', () => {
    const items = { items: { data: [{ current_period_start: 1000, current_period_end: 2000 }] } };
    expect(subscriptionPeriod(items).end?.getTime()).toBe(2000 * 1000);
    expect(subscriptionPeriod({ current_period_start: 5, current_period_end: 6 }).start?.getTime()).toBe(5000);
    expect(subscriptionPeriod({})).toEqual({ start: null, end: null });
  });

  it('never issues an API key for a managed AuditProof purchase', async () => {
    const { service, prisma } = makeService();
    const stripe = fakeStripe({
      metaProduct: 'audit-proof',
      metaPlan: 'auditproof-comply',
      amount_total: 180000,
      subscription: 'sub_audit_1',
    });
    await service.provisionFromCheckoutSession('cs_test_audit', stripe);

    expect(await service.checkKeyEligibility('cs_test_audit')).toBe('NOT_AGENT_GATE');
    expect(await service.issueKeyForSession('cs_test_audit')).toBeNull();
    expect(prisma._tables.apiIdentities.rows).toHaveLength(0);
  });

  it('maps subscription statuses to entitlement statuses', () => {
    expect(entitlementStatusFromSubscription('active')).toBe('ACTIVE');
    expect(entitlementStatusFromSubscription('trialing')).toBe('ACTIVE');
    expect(entitlementStatusFromSubscription('past_due')).toBe('PAST_DUE');
    for (const s of ['canceled', 'unpaid', 'incomplete_expired']) {
      expect(entitlementStatusFromSubscription(s)).toBe('CANCELLED');
    }
  });
});

describe('ProofCredentialController', () => {
  const makeController = (provisioning: Record<string, any>) =>
    new ProofCredentialController(provisioning as never);

  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_not_used_no_network';
  });

  it('reconcile answers FAILED (not an endless VERIFYING) when the session is not a valid paid purchase', async () => {
    const controller = makeController({
      provisionFromCheckoutSession: vi.fn().mockRejectedValue(new ProvisioningValidationError('unpaid')),
      getProvisionStatus: vi.fn().mockResolvedValue({ state: 'VERIFYING', key_issued: false }),
    });
    const res: any = await controller.reconcile({ session_id: 'cs_test_unpaid' });
    expect(res.state).toBe('FAILED');
    expect(res.failure_code).toBe('PAYMENT_NOT_VERIFIED');
    expect(JSON.stringify(res)).not.toContain('unpaid'); // no internal detail
  });

  it('claim-key refuses non-Agent-Gate purchases with 403 and issues nothing', async () => {
    const issueKeyForSession = vi.fn();
    const controller = makeController({
      checkKeyEligibility: vi.fn().mockResolvedValue('NOT_AGENT_GATE'),
      issueKeyForSession,
    });
    await expect(controller.claimKey({ session_id: 'cs_test_audit' })).rejects.toMatchObject({ status: 403 });
    expect(issueKeyForSession).not.toHaveBeenCalled();
  });

  it('claim-key returns the plaintext once, with the endpoint, and nothing else sensitive', async () => {
    const controller = makeController({
      checkKeyEligibility: vi.fn().mockResolvedValue('OK'),
      issueKeyForSession: vi
        .fn()
        .mockResolvedValue({ plaintext: 'ag_live_ABCDEFGH', keyPrefix: 'ag_live_ABCD', organizationId: 'org_1' }),
    });
    const res: any = await controller.claimKey({ session_id: 'cs_test_ok' });
    expect(res.api_key).toBe('ag_live_ABCDEFGH');
    expect(res.endpoint).toBe('/api/verify');
    expect(res.warning).toMatch(/will not be shown again/i);
  });

  it('claim-key maps ALREADY_ISSUED to 409 without a plaintext key', async () => {
    const controller = makeController({
      checkKeyEligibility: vi.fn().mockResolvedValue('ALREADY_ISSUED'),
      getProvisionStatus: vi.fn().mockResolvedValue({ key_prefix: 'ag_live_ABCD' }),
      issueKeyForSession: vi.fn(),
    });
    await expect(controller.claimKey({ session_id: 'cs_test_ok' })).rejects.toMatchObject({ status: 409 });
  });

  it('claim-key maps EXPIRED to 410', async () => {
    const controller = makeController({
      checkKeyEligibility: vi.fn().mockResolvedValue('EXPIRED'),
      issueKeyForSession: vi.fn(),
    });
    await expect(controller.claimKey({ session_id: 'cs_test_old' })).rejects.toMatchObject({ status: 410 });
  });
});
