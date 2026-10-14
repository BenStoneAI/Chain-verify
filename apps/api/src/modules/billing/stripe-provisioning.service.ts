import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, ProofEntitlementStatus, ProofProductType } from '@prisma/client';
import Stripe from 'stripe';
import { randomBytes } from 'node:crypto';

import {
  canonicalProofPlanSlug,
  getProofBillingPlan,
  proofBillingPlanConfigs,
  type ProofBillingPlanConfig,
} from '@chain-verify/config';
import { PrismaService } from '../database/prisma.service.js';
import { sha256Hex } from '../../common/utils/api-key-hash.js';
import { checkoutSubtotal, evaluateCheckoutPayment } from './zero-dollar-checkout.js';
import { OUTBOUND_EMAIL, type OutboundEmailPort } from '../adapters/ports.js';

/**
 * Thrown when a Checkout Session is not a valid, paid ChainVerify purchase.
 * Distinguishes "this payment cannot be verified" (a permanent answer the
 * welcome page should show immediately) from transient infrastructure errors.
 */
export class ProvisioningValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProvisioningValidationError';
  }
}

const GRACE_MS = 7 * 24 * 60 * 60 * 1000;

const WELCOME_WEB_BASE = 'https://www.chainverify.org';
const WELCOME_DOCS_URL = `${WELCOME_WEB_BASE}/agent-gate/docs`;
const DEFAULT_SUPPORT_EMAIL = 'proof@chainverify.org';

/** Public web route and customer-facing name per internal product key (mirrors the Stripe payment link paths). */
const WELCOME_PRODUCTS: Record<string, { route: string; name: string }> = {
  'verify-api': { route: '/agent-gate', name: 'Agent Gate' },
  'audit-proof': { route: '/audit-proof', name: 'AuditProof' },
  'invoice-proof': { route: '/invoice-proof', name: 'InvoiceProof' },
};

/** Welcome page URL a buyer lands on after checkout (same path and canonical slug as the Stripe success URL). */
export function buildWelcomeUrl(product: string, canonicalSlug: string, sessionId: string): string {
  const route = WELCOME_PRODUCTS[product]?.route ?? `/${product}`;
  return `${WELCOME_WEB_BASE}${route}/welcome?plan=${encodeURIComponent(canonicalSlug)}&session_id=${encodeURIComponent(sessionId)}`;
}

/** Map a Stripe subscription status onto the entitlement status it implies. */
export function entitlementStatusFromSubscription(status: string | undefined): ProofEntitlementStatus {
  switch (status) {
    case 'past_due':
      return ProofEntitlementStatus.PAST_DUE;
    case 'canceled':
    case 'unpaid':
    case 'incomplete_expired':
      return ProofEntitlementStatus.CANCELLED;
    default:
      return ProofEntitlementStatus.ACTIVE; // active | trialing | (paid checkout)
  }
}

/**
 * Current period of a subscription. Newer Stripe API versions moved
 * current_period_start/end from the subscription onto its items; support both.
 */
export function subscriptionPeriod(sub: any): { start: Date | null; end: Date | null } {
  const item = sub?.items?.data?.[0];
  const startRaw = sub?.current_period_start ?? item?.current_period_start;
  const endRaw = sub?.current_period_end ?? item?.current_period_end;
  return {
    start: typeof startRaw === 'number' ? new Date(startRaw * 1000) : null,
    end: typeof endRaw === 'number' ? new Date(endRaw * 1000) : null,
  };
}

/** Resolve an Agent Gate/other proof plan from a Stripe price id (via the plan's price env var). */
export function planForStripePriceId(priceId: string | undefined): ProofBillingPlanConfig | undefined {
  if (!priceId) return undefined;
  return proofBillingPlanConfigs.find(
    (p) => p.stripePriceIdEnv && process.env[p.stripePriceIdEnv] === priceId,
  );
}

/** Subscription id carried by an invoice (classic and 'basil+' API shapes). */
export function invoiceSubscriptionId(invoice: any): string | undefined {
  const direct = invoice?.subscription;
  if (typeof direct === 'string') return direct;
  if (direct?.id) return direct.id;
  const nested = invoice?.parent?.subscription_details?.subscription;
  if (typeof nested === 'string') return nested;
  if (nested?.id) return nested.id;
  return undefined;
}

function isAgentGateProduct(product: unknown): boolean {
  return product === ProofProductType.AGENT_GATE || product === ProofProductType.VERIFY_API;
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ProvisioningResult {
  organizationId: string;
  entitlementId: string;
  product: string;
  planSlug: string;
  status: string;
  monthlyLimit: number | null;
  keyIssued: boolean;
  keyPrefix?: string;
}

interface WebhookProcessResult {
  received: true;
  eventId: string;
  type: string;
  duplicate?: boolean;
  status: string;
}

/* ------------------------------------------------------------------ */
/*  Service                                                            */
/* ------------------------------------------------------------------ */

@Injectable()
export class StripeProvisioningService {
  private readonly logger = new Logger(StripeProvisioningService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(OUTBOUND_EMAIL) private readonly email: OutboundEmailPort,
  ) {}

  /* ================================================================ */
  /*  Webhook event orchestration                                      */
  /* ================================================================ */

  async processWebhookEvent(event: Stripe.Event, stripe: Stripe): Promise<WebhookProcessResult> {
    // 1. Dedupe: insert-first keyed by evt_ id
    const dedupeResult = await this.dedupeEvent(event);
    if (dedupeResult === 'ALREADY_PROCESSED') {
      return { received: true, eventId: event.id, type: event.type, duplicate: true, status: 'PROCESSED' };
    }

    // 2. Dispatch by type
    try {
      const status = await this.dispatchEvent(event, stripe);
      await this.markEventProcessed(event.id, status);
      return { received: true, eventId: event.id, type: event.type, status };
    } catch (err) {
      if (err instanceof ProvisioningValidationError) {
        // A permanent answer ("this session is not a valid paid purchase"): retrying
        // can never succeed, so record it for review and acknowledge the event
        // instead of making Stripe redeliver it for days.
        await this.markEventStatus(event.id, 'REJECTED', err.message);
        this.logger.warn(`Webhook ${event.id} (${event.type}) rejected: ${err.message}`);
        return { received: true, eventId: event.id, type: event.type, status: 'REJECTED' };
      }
      await this.markEventFailed(event.id, (err as Error).message?.slice(0, 500));
      throw err;
    }
  }

  /* ================================================================ */
  /*  Event deduplication (insert-first)                               */
  /* ================================================================ */

  private async dedupeEvent(event: Stripe.Event): Promise<'NEW' | 'RETRY' | 'ALREADY_PROCESSED'> {
    try {
      await this.prisma.stripeWebhookEvent.create({
        data: {
          id: event.id,
          type: event.type,
          livemode: event.livemode,
          objectId: (event.data.object as any)?.id ?? null,
          status: 'RECEIVED',
          attempts: 1,
          receivedAt: new Date(),
        },
      });
      return 'NEW';
    } catch (err) {
      if ((err as any)?.code === 'P2002') {
        // Unique violation — event already seen
        const existing = await this.prisma.stripeWebhookEvent.findUnique({ where: { id: event.id } });
        if (existing?.status === 'PROCESSED') return 'ALREADY_PROCESSED';
        // RECEIVED or FAILED — re-process, bump attempts
        await this.prisma.stripeWebhookEvent.update({
          where: { id: event.id },
          data: { attempts: { increment: 1 }, status: 'RECEIVED', receivedAt: new Date() },
        });
        return 'RETRY';
      }
      throw err;
    }
  }

  private async markEventProcessed(eventId: string, status: string) {
    await this.prisma.stripeWebhookEvent.update({
      where: { id: eventId },
      data: { status, processedAt: new Date() },
    });
  }

  private async markEventStatus(eventId: string, status: string, errorMsg: string) {
    await this.prisma.stripeWebhookEvent
      .update({
        where: { id: eventId },
        data: { status, lastError: errorMsg?.slice(0, 500), processedAt: new Date() },
      })
      .catch(() => {}); // best-effort
  }

  private async markEventFailed(eventId: string, errorMsg: string) {
    await this.prisma.stripeWebhookEvent.update({
      where: { id: eventId },
      data: { status: 'FAILED', lastError: errorMsg?.slice(0, 500) },
    }).catch(() => {}); // best-effort
  }

  /* ================================================================ */
  /*  Event dispatch                                                   */
  /* ================================================================ */

  private async dispatchEvent(event: Stripe.Event, stripe: Stripe): Promise<string> {
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const session = event.data.object as Stripe.Checkout.Session;
        // The Stripe account may carry unrelated purchases; sessions that are
        // not ChainVerify products are not ours to provision (and must not
        // fail, or Stripe would retry them for days).
        if (!session.metadata?.chainverify_product) return 'IGNORED';
        await this.provisionFromCheckoutSession(session.id, stripe);
        return 'PROCESSED';
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        // Events can arrive out of order; the live subscription is the truth.
        const fresh = await this.freshSubscription(stripe, sub);
        await this.syncSubscriptionLifecycle(fresh);
        return 'PROCESSED';
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        await this.handleSubscriptionDeleted(sub);
        return 'PROCESSED';
      }
      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice;
        await this.handleInvoicePaid(invoice);
        await this.reassertFromLiveSubscription(stripe, invoice);
        return 'PROCESSED';
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        await this.handleInvoicePaymentFailed(invoice);
        await this.reassertFromLiveSubscription(stripe, invoice);
        return 'PROCESSED';
      }
      default:
        return 'IGNORED';
    }
  }

  /** Retrieve the live subscription; fall back to the event payload if Stripe is unreachable. */
  private async freshSubscription(stripe: Stripe, sub: Stripe.Subscription): Promise<Stripe.Subscription> {
    try {
      return await stripe.subscriptions.retrieve(sub.id);
    } catch (err) {
      if ((err as any)?.code === 'resource_missing') return sub;
      throw err; // transient: let Stripe retry the event rather than apply stale state
    }
  }

  /**
   * Invoice events can be delivered after (or before) subscription events. After
   * applying an invoice, re-sync from the live subscription so a late
   * `invoice.paid` can never resurrect a cancelled entitlement.
   */
  private async reassertFromLiveSubscription(stripe: Stripe, invoice: Stripe.Invoice) {
    const subId = invoiceSubscriptionId(invoice);
    if (!subId) return;
    const tracked = await this.prisma.proofProductEntitlement.findUnique({
      where: { stripeSubscriptionId: subId },
    });
    if (!tracked) return;
    const live = await stripe.subscriptions.retrieve(subId);
    await this.syncSubscriptionLifecycle(live);
  }

  /* ================================================================ */
  /*  Core provisioning: checkout session → org + entitlement           */
  /* ================================================================ */

  async provisionFromCheckoutSession(
    sessionId: string,
    stripe: Stripe,
  ): Promise<ProvisioningResult> {
    // Retrieve with expansions
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['line_items.data.price', 'subscription'],
    });

    // --- Validation ---
    this.validateCheckoutSession(session);

    const plan = this.resolveAndValidatePlan(session);
    const customerId = typeof session.customer === 'string'
      ? session.customer
      : (session.customer as Stripe.Customer)?.id;
    const customerEmail = session.customer_details?.email?.toLowerCase() ?? '';
    const subscriptionId = typeof session.subscription === 'string'
      ? session.subscription
      : (session.subscription as Stripe.Subscription)?.id ?? null;

    if (!customerId) {
      throw new ProvisioningValidationError('Stripe session has no customer ID');
    }

    // Determine org name from custom fields, customer name, or email domain
    const orgName = this.resolveOrgName(session, customerEmail);

    // --- Atomic transaction: org + entitlement + intake ---
    let outcome: { result: ProvisioningResult; intakeCreated: boolean };
    try {
      outcome = await this.prisma.$transaction(async (tx) => {
        // 1. Find or create organization keyed by stripeCustomerId
        const org = await this.findOrCreateOrg(tx, customerId, orgName, customerEmail);

        // 2. Determine subscription period (works for both Stripe API shapes)
        const sub = typeof session.subscription === 'object' && session.subscription !== null
          ? session.subscription as any
          : null;
        const period = subscriptionPeriod(sub);
        const periodStart = period.start ?? new Date();
        const periodEnd = period.end;
        const subscriptionItemId = sub?.items?.data?.[0]?.id ?? null;
        // The entitlement reflects the LIVE subscription state, never "paid once => active".
        const initialStatus = entitlementStatusFromSubscription(sub?.status);

        // 3. Upsert entitlement
        const canonicalSlug = canonicalProofPlanSlug(plan.slug);
        const entitlementProduct = this.resolveProductEnum(plan);

        // Key for upsert: stripeSubscriptionId when subscription, stripeSessionId for one-time
        const entitlement = subscriptionId
          ? await this.upsertEntitlementBySubscription(tx, {
              organizationId: org.id,
              product: entitlementProduct,
              planSlug: canonicalSlug,
              monthlyLimit: plan.monthlyLimit,
              subscriptionId,
              sessionId,
              subscriptionItemId,
              meteredBillingEnabled: !!plan.overageStripePriceIdEnv,
              periodStart,
              periodEnd,
              lastPaymentAt: new Date(),
              status: initialStatus,
            })
          : await this.upsertEntitlementBySession(tx, {
              organizationId: org.id,
              product: entitlementProduct,
              planSlug: canonicalSlug,
              monthlyLimit: plan.monthlyLimit,
              sessionId,
              periodStart,
              periodEnd,
              lastPaymentAt: new Date(),
              status: initialStatus,
            });

        // 4. Upsert ProofPilotIntake for Agent Gate = ACTIVE; others = PAID
        const isAgentGate = plan.product === 'verify-api';
        // The intake is keyed by session: if it does not exist yet, this call is the
        // first provisioning of the purchase (replays find it and never re-send).
        const priorIntake = await tx.proofPilotIntake.findUnique({
          where: { stripeSessionId: sessionId },
          select: { id: true },
        });
        await this.upsertIntake(tx, {
          product: plan.product,
          planSlug: canonicalSlug,
          companyName: orgName,
          contactEmail: customerEmail,
          sessionId,
          status: isAgentGate ? 'ACTIVE' : 'PAID',
          organizationId: org.id,
          customerId,
          subscriptionId,
        });

        return {
          result: {
            organizationId: org.id,
            entitlementId: entitlement.id,
            product: plan.product,
            planSlug: canonicalSlug,
            status: entitlement.status,
            monthlyLimit: plan.monthlyLimit,
            keyIssued: false,
          },
          intakeCreated: !priorIntake,
        };
      });
    } catch (err) {
      // P2002 = unique constraint violation (race). Re-read and return existing.
      // The racing call that won the insert owns the welcome email.
      if ((err as any)?.code === 'P2002') {
        return this.recoverFromRace(sessionId, plan);
      }
      throw err;
    }

    // The transaction has committed. The welcome email is best effort and can
    // never fail provisioning (or the webhook that triggered it).
    if (outcome.intakeCreated) {
      await this.sendWelcomeEmailOnce({
        sessionId,
        to: session.customer_details?.email ?? customerEmail,
        orgName,
        plan,
        canonicalSlug: outcome.result.planSlug,
      });
    }
    return outcome.result;
  }

  /**
   * Sends the one-time purchase welcome email. The send is claimed atomically on
   * the intake row (welcomeEmailSentAt null -> now) so concurrent or repeated
   * provisioning of the same session sends at most once. A failed send releases
   * the claim. Never throws.
   */
  private async sendWelcomeEmailOnce(args: {
    sessionId: string;
    to: string;
    orgName: string;
    plan: ProofBillingPlanConfig;
    canonicalSlug: string;
  }): Promise<void> {
    const { sessionId, plan } = args;
    let claimed = false;
    try {
      const claim = await this.prisma.proofPilotIntake.updateMany({
        where: { stripeSessionId: sessionId, welcomeEmailSentAt: null },
        data: { welcomeEmailSentAt: new Date() },
      });
      if (claim.count !== 1) return;
      claimed = true;

      await this.email.sendPurchaseWelcome({
        to: args.to,
        orgName: args.orgName,
        productName: WELCOME_PRODUCTS[plan.product]?.name ?? plan.name,
        planName: plan.name,
        monthlyLimit: plan.monthlyLimit,
        welcomeUrl: buildWelcomeUrl(plan.product, args.canonicalSlug, sessionId),
        docsUrl: WELCOME_DOCS_URL,
        supportEmail: process.env.SUPPORT_EMAIL || DEFAULT_SUPPORT_EMAIL,
      });
    } catch (err) {
      this.logger.warn(
        `Purchase welcome email failed for session ${sessionId}: ${(err as Error)?.message ?? 'unknown error'}`,
      );
      if (claimed) {
        try {
          await this.prisma.proofPilotIntake.updateMany({
            where: { stripeSessionId: sessionId },
            data: { welcomeEmailSentAt: null },
          });
        } catch (releaseErr) {
          this.logger.warn(
            `Could not release welcome email claim for session ${sessionId}: ${(releaseErr as Error)?.message ?? 'unknown error'}`,
          );
        }
      }
    }
  }

  /* ================================================================ */
  /*  Session validation                                               */
  /* ================================================================ */

  private validateCheckoutSession(session: Stripe.Checkout.Session) {
    const expectLive = process.env.STRIPE_EXPECT_LIVEMODE !== 'false';
    if (expectLive && !session.livemode) {
      throw new ProvisioningValidationError('Session is test-mode but STRIPE_EXPECT_LIVEMODE requires live');
    }
    if (!expectLive && session.livemode) {
      throw new ProvisioningValidationError('Session is live-mode but STRIPE_EXPECT_LIVEMODE=false requires test');
    }
    if (session.status !== 'complete') {
      throw new ProvisioningValidationError(`Session status is ${session.status}, expected complete`);
    }
    const payment = evaluateCheckoutPayment(session);
    if (payment.ok === false) {
      throw new ProvisioningValidationError(payment.reason);
    }
    if (!session.customer_details?.email) {
      throw new ProvisioningValidationError('Session has no customer email');
    }
    if (!session.customer) {
      throw new ProvisioningValidationError('Session has no customer');
    }
  }

  private resolveAndValidatePlan(session: Stripe.Checkout.Session): ProofBillingPlanConfig {
    const metaProduct = session.metadata?.chainverify_product;
    const metaPlan = session.metadata?.chainverify_plan;

    if (!metaProduct) {
      throw new ProvisioningValidationError('Session metadata missing chainverify_product');
    }

    // Accept both 'agent-gate' and 'verify-api' as the Agent Gate product key
    const isAgentGate = metaProduct === 'agent-gate' || metaProduct === 'verify-api';
    if (!isAgentGate && metaProduct !== 'audit-proof' && metaProduct !== 'invoice-proof') {
      throw new ProvisioningValidationError(`Unknown chainverify_product: ${metaProduct}`);
    }

    if (!metaPlan) {
      throw new ProvisioningValidationError('Session metadata missing chainverify_plan');
    }

    const plan = getProofBillingPlan(metaPlan);
    if (!plan) {
      throw new ProvisioningValidationError(`Unknown plan slug: ${metaPlan}`);
    }

    // Verify product matches
    if (isAgentGate && plan.product !== 'verify-api') {
      throw new ProvisioningValidationError(
        `Plan ${metaPlan} product mismatch: expected verify-api, got ${plan.product}`,
      );
    }
    if (!isAgentGate && plan.product !== metaProduct) {
      throw new ProvisioningValidationError(
        `Plan ${metaPlan} product mismatch: expected ${metaProduct}, got ${plan.product}`,
      );
    }

    // Verify amount against the PRE-tax, PRE-discount subtotal: amount_total
    // legitimately differs from the list price when tax or a promo code applies.
    const amount = checkoutSubtotal(session) ?? session.amount_total;
    if (amount !== null && amount !== undefined && amount !== plan.priceCents) {
      throw new ProvisioningValidationError(`Amount mismatch: session ${amount} vs plan ${plan.priceCents}`);
    }

    // Verify subscription ID present for subscription plans
    if (plan.checkoutMode === 'subscription' && !session.subscription) {
      throw new ProvisioningValidationError('Subscription plan but no subscription ID in session');
    }

    return plan;
  }

  /* ================================================================ */
  /*  Organization resolution                                          */
  /* ================================================================ */

  private resolveOrgName(session: Stripe.Checkout.Session, email: string): string {
    // 1. Custom fields (org/company)
    const customFields = (session as any).custom_fields;
    if (Array.isArray(customFields)) {
      for (const f of customFields) {
        if ((f.key === 'organization' || f.key === 'company') && f.text?.value) {
          return f.text.value.trim();
        }
      }
    }
    // 2. Customer name
    if (session.customer_details?.name) {
      return session.customer_details.name;
    }
    // 3. Email domain
    const domain = email.split('@')[1];
    return domain || 'Organization';
  }

  private async findOrCreateOrg(
    tx: Prisma.TransactionClient,
    stripeCustomerId: string,
    name: string,
    _email: string,
  ) {
    // Match by stripeCustomerId (unique)
    const existing = await tx.organization.findUnique({ where: { stripeCustomerId } });
    if (existing) return existing;

    // Create with unique slug
    const baseSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
    const suffix = randomBytes(4).toString('hex');
    const slug = `${baseSlug || 'org'}-${suffix}`;

    return tx.organization.create({
      data: {
        name,
        slug,
        stripeCustomerId,
      },
    });
  }

  /* ================================================================ */
  /*  Entitlement upserts                                              */
  /* ================================================================ */

  private resolveProductEnum(plan: ProofBillingPlanConfig): ProofProductType {
    if (plan.product === 'verify-api') return ProofProductType.AGENT_GATE;
    if (plan.product === 'audit-proof') return ProofProductType.AUDIT_PROOF;
    return ProofProductType.INVOICE_PROOF;
  }

  private async upsertEntitlementBySubscription(
    tx: Prisma.TransactionClient,
    data: {
      organizationId: string;
      product: ProofProductType;
      planSlug: string;
      monthlyLimit: number | null;
      subscriptionId: string;
      sessionId: string;
      subscriptionItemId: string | null;
      meteredBillingEnabled: boolean;
      periodStart: Date;
      periodEnd: Date | null;
      lastPaymentAt: Date;
      status: ProofEntitlementStatus;
    },
  ) {
    // CREATE-ONLY. Replaying a completed Checkout Session (webhook redelivery,
    // welcome-page reload, reconcile after cancellation/upgrade) must never
    // modify an existing entitlement: status/plan/period belong to the
    // subscription lifecycle events, not to the original session.
    const existing = await tx.proofProductEntitlement.findUnique({
      where: { stripeSubscriptionId: data.subscriptionId },
    });
    if (existing) return existing;

    return tx.proofProductEntitlement.create({
      data: {
        organizationId: data.organizationId,
        product: data.product,
        planSlug: data.planSlug,
        status: data.status,
        monthlyLimit: data.monthlyLimit,
        stripeSubscriptionId: data.subscriptionId,
        stripeSessionId: data.sessionId,
        stripeSubscriptionItemId: data.subscriptionItemId,
        meteredBillingEnabled: data.meteredBillingEnabled,
        periodStart: data.periodStart,
        periodEnd: data.periodEnd,
        lastPaymentAt: data.lastPaymentAt,
        ...(data.status === ProofEntitlementStatus.PAST_DUE
          ? { graceUntil: new Date(Date.now() + GRACE_MS) }
          : {}),
        ...(data.status === ProofEntitlementStatus.CANCELLED ? { canceledAt: new Date() } : {}),
      },
    });
  }

  private async upsertEntitlementBySession(
    tx: Prisma.TransactionClient,
    data: {
      organizationId: string;
      product: ProofProductType;
      planSlug: string;
      monthlyLimit: number | null;
      sessionId: string;
      periodStart: Date;
      periodEnd: Date | null;
      lastPaymentAt: Date;
      status: ProofEntitlementStatus;
    },
  ) {
    // CREATE-ONLY (see upsertEntitlementBySubscription).
    const existing = await tx.proofProductEntitlement.findUnique({
      where: { stripeSessionId: data.sessionId },
    });
    if (existing) return existing;

    return tx.proofProductEntitlement.create({
      data: {
        organizationId: data.organizationId,
        product: data.product,
        planSlug: data.planSlug,
        status: data.status,
        monthlyLimit: data.monthlyLimit,
        stripeSessionId: data.sessionId,
        periodStart: data.periodStart,
        periodEnd: data.periodEnd,
        lastPaymentAt: data.lastPaymentAt,
      },
    });
  }

  /* ================================================================ */
  /*  ProofPilotIntake upsert                                          */
  /* ================================================================ */

  private async upsertIntake(
    tx: Prisma.TransactionClient,
    data: {
      product: string;
      planSlug: string;
      companyName: string;
      contactEmail: string;
      sessionId: string;
      status: string;
      organizationId: string;
      customerId: string;
      subscriptionId: string | null;
    },
  ) {
    return tx.proofPilotIntake.upsert({
      where: { stripeSessionId: data.sessionId },
      create: {
        product: data.product,
        planSlug: data.planSlug,
        companyName: data.companyName,
        contactEmail: data.contactEmail,
        stripeSessionId: data.sessionId,
        status: data.status,
        organizationId: data.organizationId,
        sourcePath: `/${data.product === 'verify-api' ? 'agent-gate' : data.product}/welcome`,
        rawPayload: {
          stripeCustomerId: data.customerId,
          stripeSubscriptionId: data.subscriptionId,
        },
      },
      update: {
        status: data.status,
        organizationId: data.organizationId,
      },
    });
  }

  /* ================================================================ */
  /*  Race recovery                                                    */
  /* ================================================================ */

  private async recoverFromRace(sessionId: string, plan: ProofBillingPlanConfig): Promise<ProvisioningResult> {
    const entitlement = await this.prisma.proofProductEntitlement.findFirst({
      where: { stripeSessionId: sessionId },
    });
    if (entitlement) {
      return {
        organizationId: entitlement.organizationId,
        entitlementId: entitlement.id,
        product: plan.product,
        planSlug: entitlement.planSlug,
        status: entitlement.status,
        monthlyLimit: entitlement.monthlyLimit,
        keyIssued: false,
      };
    }
    throw new Error('Race recovery failed: could not find entitlement after P2002');
  }

  /* ================================================================ */
  /*  Subscription lifecycle                                           */
  /* ================================================================ */

  async syncSubscriptionLifecycle(sub: Stripe.Subscription) {
    const entitlement = await this.prisma.proofProductEntitlement.findUnique({
      where: { stripeSubscriptionId: sub.id },
    });
    if (!entitlement) {
      // Subscription not tracked — could be non-proof subscription
      return;
    }

    const update: Prisma.ProofProductEntitlementUpdateInput = {};
    // Stripe ^20 property access via `as any` for renamed fields
    const subAny = sub as any;

    // Map Stripe subscription status to entitlement status
    const stripeStatus = sub.status;
    if (stripeStatus === 'active' || stripeStatus === 'trialing') {
      update.status = ProofEntitlementStatus.ACTIVE;
      update.canceledAt = null;
      update.graceUntil = null;
    } else if (stripeStatus === 'past_due') {
      update.status = ProofEntitlementStatus.PAST_DUE;
      if (!entitlement.graceUntil) {
        update.graceUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      }
    } else if (
      stripeStatus === 'canceled' ||
      stripeStatus === 'unpaid' ||
      stripeStatus === 'incomplete_expired'
    ) {
      update.status = ProofEntitlementStatus.CANCELLED;
      update.canceledAt = new Date();
    }

    // Period update (both Stripe API shapes)
    const period = subscriptionPeriod(subAny);
    if (period.start) update.periodStart = period.start;
    if (period.end) update.periodEnd = period.end;

    // cancel_at_period_end: stays ACTIVE until the period ends; the
    // customer.subscription.deleted event at period end performs the cancel.
    if (sub.cancel_at_period_end && (stripeStatus === 'active' || stripeStatus === 'trialing')) {
      update.status = ProofEntitlementStatus.ACTIVE;
    }

    // Plan/price change (upgrade, downgrade): map the live price to a plan.
    const item = sub.items?.data?.[0];
    if (item) {
      update.stripeSubscriptionItemId = item.id;
      const newPlan = planForStripePriceId(item.price?.id);
      if (newPlan) {
        const canonical = canonicalProofPlanSlug(newPlan.slug);
        if (canonical !== entitlement.planSlug) {
          update.planSlug = canonical;
          update.monthlyLimit = newPlan.monthlyLimit;
          update.meteredBillingEnabled = !!newPlan.overageStripePriceIdEnv;
        }
      }
    }

    await this.prisma.proofProductEntitlement.update({
      where: { id: entitlement.id },
      data: update,
    });
  }

  async handleSubscriptionDeleted(sub: Stripe.Subscription) {
    const entitlement = await this.prisma.proofProductEntitlement.findUnique({
      where: { stripeSubscriptionId: sub.id },
    });
    if (!entitlement) return;

    await this.prisma.proofProductEntitlement.update({
      where: { id: entitlement.id },
      data: {
        status: ProofEntitlementStatus.CANCELLED,
        canceledAt: new Date(),
      },
    });
  }

  async handleInvoicePaid(invoice: Stripe.Invoice) {
    const subId = invoiceSubscriptionId(invoice);
    if (!subId) return;

    const entitlement = await this.prisma.proofProductEntitlement.findUnique({
      where: { stripeSubscriptionId: subId },
    });
    if (!entitlement) return;

    const lineItem = invoice.lines?.data?.[0];
    const periodStart = lineItem?.period?.start
      ? new Date(lineItem.period.start * 1000)
      : undefined;
    const periodEnd = lineItem?.period?.end
      ? new Date(lineItem.period.end * 1000)
      : undefined;

    await this.prisma.proofProductEntitlement.update({
      where: { id: entitlement.id },
      data: {
        status: ProofEntitlementStatus.ACTIVE,
        lastPaymentAt: new Date(),
        ...(periodStart && { periodStart }),
        ...(periodEnd && { periodEnd }),
      },
    });
  }

  async handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
    const subId = invoiceSubscriptionId(invoice);
    if (!subId) return;

    const entitlement = await this.prisma.proofProductEntitlement.findUnique({
      where: { stripeSubscriptionId: subId },
    });
    if (!entitlement) return;

    await this.prisma.proofProductEntitlement.update({
      where: { id: entitlement.id },
      data: {
        status: ProofEntitlementStatus.PAST_DUE,
        graceUntil: entitlement.graceUntil ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
  }

  /* ================================================================ */
  /*  API key issuance for claim-key                                   */
  /* ================================================================ */

  /** Why a key can or cannot be issued for this session (drives precise HTTP codes). */
  async checkKeyEligibility(
    sessionId: string,
  ): Promise<'OK' | 'NOT_FOUND' | 'NOT_AGENT_GATE' | 'NOT_ACTIVE' | 'EXPIRED' | 'ALREADY_ISSUED'> {
    const issued = await this.prisma.apiIdentity.findFirst({
      where: { issuedForSessionId: sessionId },
      select: { id: true },
    });
    if (issued) return 'ALREADY_ISSUED';
    const entitlement = await this.prisma.proofProductEntitlement.findFirst({
      where: { stripeSessionId: sessionId },
    });
    if (!entitlement) return 'NOT_FOUND';
    if (!isAgentGateProduct(entitlement.product)) return 'NOT_AGENT_GATE';
    if (entitlement.status !== ProofEntitlementStatus.ACTIVE) return 'NOT_ACTIVE';
    if (Date.now() - entitlement.createdAt.getTime() > 24 * 60 * 60 * 1000) return 'EXPIRED';
    return 'OK';
  }

  async issueKeyForSession(
    sessionId: string,
  ): Promise<{ plaintext: string; keyPrefix: string; organizationId: string } | null> {
    // Find entitlement by session (Agent Gate only: managed pilots are onboarded, not keyed)
    const entitlement = await this.prisma.proofProductEntitlement.findFirst({
      where: { stripeSessionId: sessionId, status: ProofEntitlementStatus.ACTIVE },
    });
    if (!entitlement) return null;
    if (!isAgentGateProduct(entitlement.product)) return null;

    // Check claim window (24h)
    const maxAge = 24 * 60 * 60 * 1000;
    if (Date.now() - entitlement.createdAt.getTime() > maxAge) {
      return null;
    }

    // Generate key
    const rawKey = randomBytes(32).toString('base64url');
    const plaintext = `ag_live_${rawKey}`;
    const keyPrefix = plaintext.slice(0, 12);
    const apiKeyHash = sha256Hex(plaintext);

    try {
      await this.prisma.apiIdentity.create({
        data: {
          organizationId: entitlement.organizationId,
          label: `Agent Gate — session ${sessionId.slice(0, 12)}`,
          apiKeyHash,
          keyPrefix,
          issuedForSessionId: sessionId,
          active: true,
        },
      });
      return { plaintext, keyPrefix, organizationId: entitlement.organizationId };
    } catch (err) {
      if ((err as any)?.code === 'P2002') {
        // Already issued — return null to trigger 409
        return null;
      }
      throw err;
    }
  }

  /* ================================================================ */
  /*  Provision status (DB-only, no Stripe call)                       */
  /* ================================================================ */

  async getProvisionStatus(sessionId: string) {
    const entitlement = await this.prisma.proofProductEntitlement.findFirst({
      where: { stripeSessionId: sessionId },
      include: { organization: { select: { name: true } } },
    });

    if (!entitlement) {
      // Check if we have an intake record at least
      const intake = await this.prisma.proofPilotIntake.findFirst({
        where: { stripeSessionId: sessionId },
      });
      if (intake) {
        return {
          state: 'PROVISIONING' as const,
          plan: null,
          organization: null,
          subscription_state: null,
          endpoint: null,
          key_issued: false,
          key_prefix: null,
        };
      }
      return {
        state: 'VERIFYING' as const,
        plan: null,
        organization: null,
        subscription_state: null,
        endpoint: null,
        key_issued: false,
        key_prefix: null,
      };
    }

    const plan = getProofBillingPlan(entitlement.planSlug);
    const keyRecord = await this.prisma.apiIdentity.findFirst({
      where: { issuedForSessionId: sessionId },
      select: { keyPrefix: true },
    });

    return {
      state: 'READY' as const,
      plan: plan
        ? { slug: plan.slug, name: plan.name, monthly_limit: plan.monthlyLimit }
        : { slug: entitlement.planSlug, name: entitlement.planSlug, monthly_limit: entitlement.monthlyLimit },
      organization: { name: entitlement.organization.name },
      subscription_state: entitlement.status,
      product: isAgentGateProduct(entitlement.product) ? 'agent-gate' : String(entitlement.product).toLowerCase(),
      endpoint: '/api/verify',
      key_issued: !!keyRecord,
      key_prefix: keyRecord?.keyPrefix ?? null,
    };
  }
}
