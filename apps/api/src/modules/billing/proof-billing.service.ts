import {
  defaultProofCancelUrl,
  defaultProofSuccessUrl,
  getProofBillingPlan,
  getProofBundleRule,
  platformPlanRank,
  proofBillingPlanConfigs,
  resolveProofPlanLimits,
  resolveStripeOveragePriceIdForProofPlan,
  resolveStripePriceIdForProofPlan,
  type ProofProductSlug,
} from '@agent-market/config';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  PlatformGrantSource,
  Prisma,
  ProofEntitlementStatus,
  ProofProduct,
  ProofProductType,
} from '@prisma/client';
import Stripe from 'stripe';
import { randomBytes } from 'crypto';
import { hash } from 'argon2';
import * as Sentry from '@sentry/nestjs';

import { PrismaService } from '../database/prisma.service.js';

function runProductsForEntitlement(product: ProofProductType): ProofProduct[] {
  switch (product) {
    case ProofProductType.INVOICE_PROOF:
      return [ProofProduct.INVOICE_AUDIT, ProofProduct.DOCUMENT_VERIFY];
    case ProofProductType.AUDIT_PROOF:
      return [ProofProduct.COMPLIANCE_SCAN];
    case ProofProductType.VERIFY_API:
      return [
        ProofProduct.INVOICE_AUDIT,
        ProofProduct.COMPLIANCE_SCAN,
        ProofProduct.DOCUMENT_VERIFY,
        ProofProduct.IDENTITY_CHECK,
      ];
    default:
      return [];
  }
}

function toProofProductType(product: ProofProductSlug): ProofProductType {
  if (product === 'invoice-proof') return ProofProductType.INVOICE_PROOF;
  if (product === 'audit-proof') return ProofProductType.AUDIT_PROOF;
  return ProofProductType.VERIFY_API;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function allowedCheckoutHosts() {
  return new Set([
    'swarmsync.ai',
    'www.swarmsync.ai',
    'localhost',
    '127.0.0.1',
    ...[process.env.STRIPE_WEB_URL, process.env.WEB_URL]
      .map((value) => {
        if (!value) return null;
        try {
          return new URL(value).hostname;
        } catch {
          return null;
        }
      })
      .filter((value): value is string => Boolean(value)),
  ]);
}

function safeCheckoutUrl(candidate: string | undefined, fallback: string): string {
  if (!candidate) return fallback;
  try {
    const url = new URL(candidate);
    if (!['https:', 'http:'].includes(url.protocol)) return fallback;
    if (url.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
      return fallback;
    }
    if (!allowedCheckoutHosts().has(url.hostname)) return fallback;
    return candidate;
  } catch {
    return fallback;
  }
}

function meteredOverageEnabled(): boolean {
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(
    (process.env.VERIFY_API_METERED_OVERAGE_ENABLED ?? '').trim().toLowerCase(),
  );
}

function verifyApiMeteredOverageOrgIds(): Set<string> {
  return new Set(
    (process.env.VERIFY_API_METERED_OVERAGE_ORG_IDS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function meteredOverageEnabledForOrg(organizationId: string): boolean {
  return meteredOverageEnabled() && verifyApiMeteredOverageOrgIds().has(organizationId);
}

function stripeTimestamp(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

function truncateStripeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 1000);
}

function nextOverageRetryAt(attempts: number): Date {
  const delayMinutes = Math.min(15 * 2 ** Math.max(0, attempts - 1), 240);
  return new Date(Date.now() + delayMinutes * 60 * 1000);
}

function verifyApiOverageMeterEventName(): string {
  return (process.env.VERIFY_API_OVERAGE_METER_EVENT_NAME ?? 'verify_api_overage_run').trim();
}

@Injectable()
export class ProofBillingService {
  private readonly logger = new Logger(ProofBillingService.name);
  /** Live-mode Stripe client (STRIPE_SECRET_KEY). Used for all paid flows. */
  private readonly stripe: Stripe | null;
  /** Test-mode Stripe client (STRIPE_TEST_SECRET_KEY). Used for sandbox/free-trial flows. */
  private readonly stripeTest: Stripe | null;

  constructor(private readonly prisma: PrismaService) {
    const liveSecret = process.env.STRIPE_SECRET_KEY;
    const testSecret = process.env.STRIPE_TEST_SECRET_KEY;
    this.stripe = liveSecret ? new Stripe(liveSecret, { apiVersion: '2026-01-28.clover' }) : null;
    this.stripeTest = testSecret
      ? new Stripe(testSecret, { apiVersion: '2026-01-28.clover' })
      : null;
    if (!testSecret) {
      this.logger.warn(
        'STRIPE_TEST_SECRET_KEY is not set — sandbox/free-trial checkout is disabled. Set STRIPE_TEST_SECRET_KEY=sk_test_... to enable staging-safe checkout.',
      );
    }
  }

  /**
   * Returns the appropriate Stripe client for the requested flow.
   * Sandbox/free-trial flows use the test-mode key so no real card is charged.
   * Throws BadRequestException when isSandbox=true but STRIPE_TEST_SECRET_KEY is not set,
   * preventing silent fallback to the live key that would charge real cards.
   */
  private stripeFor(isSandbox: boolean): Stripe | null {
    if (isSandbox) {
      if (!this.stripeTest) {
        throw new BadRequestException(
          'Sandbox checkout is not available — STRIPE_TEST_SECRET_KEY is not configured. ' +
            'Set STRIPE_TEST_SECRET_KEY=sk_test_... to enable sandbox/free-trial flows.',
        );
      }
      return this.stripeTest;
    }
    return this.stripe;
  }

  findProofPlanBySlug(slug: string) {
    return getProofBillingPlan(slug);
  }

  findProofPlanByStripePriceId(priceId: string) {
    for (const plan of proofBillingPlanConfigs) {
      const liveId = resolveStripePriceIdForProofPlan(plan, false);
      const testId = resolveStripePriceIdForProofPlan(plan, true);
      if ((liveId && liveId === priceId) || (testId && testId === priceId)) return plan;
    }
    return undefined;
  }

  findProofPlanByStripeOveragePriceId(priceId: string) {
    for (const plan of proofBillingPlanConfigs) {
      const liveId = resolveStripeOveragePriceIdForProofPlan(plan, false);
      const testId = resolveStripeOveragePriceIdForProofPlan(plan, true);
      if ((liveId && liveId === priceId) || (testId && testId === priceId)) return plan;
    }
    return undefined;
  }

  async createProofCheckoutSession(params: {
    product: ProofProductSlug;
    planSlug: string;
    userId?: string;
    email?: string;
    successUrl?: string;
    cancelUrl?: string;
    organizationId?: string;
    /**
     * When true, the checkout session is created with the test-mode Stripe key
     * (STRIPE_TEST_SECRET_KEY) so no real card is charged.
     * Defaults to false. Should be true for free-tier / sandbox flows.
     */
    isSandbox?: boolean;
  }) {
    const plan = getProofBillingPlan(params.planSlug);
    if (!plan || plan.product !== params.product) {
      throw new NotFoundException('Proof plan not found for this product');
    }

    const isSandbox = params.isSandbox ?? false;
    const stripeClient = this.stripeFor(isSandbox);

    if (!stripeClient) {
      throw new BadRequestException('Stripe is not configured');
    }

    const organization = params.organizationId
      ? await this.prisma.organization.findUnique({ where: { id: params.organizationId } })
      : params.userId
        ? await this.resolveOrganizationForUser(params.userId)
        : null;

    const org =
      organization ??
      (await this.prisma.organization.create({
        data: {
          name: params.email ? `Proof — ${params.email}` : 'Proof Customer',
          slug: `proof-${randomBytes(6).toString('hex')}`,
        },
      }));

    if (params.userId) {
      await this.ensureMembership(params.userId, org.id);
    }

    let stripeCustomerId: string;
    try {
      stripeCustomerId = await this.ensureStripeCustomer(
        org.id,
        stripeClient,
        params.email,
        isSandbox,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`ensureStripeCustomer failed for org ${org.id}: ${msg}`);
      throw new BadRequestException(`Stripe customer setup failed: ${msg}`);
    }

    const stripePriceId = resolveStripePriceIdForProofPlan(plan, isSandbox);
    const defaultSuccess = `${defaultProofSuccessUrl(plan.product, plan.slug)}&session_id={CHECKOUT_SESSION_ID}`;
    const defaultCancel = defaultProofCancelUrl(plan.product);
    const success = safeCheckoutUrl(params.successUrl, defaultSuccess);
    const cancel = safeCheckoutUrl(params.cancelUrl, defaultCancel);

    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = stripePriceId
      ? [{ price: stripePriceId, quantity: 1 }]
      : [
          {
            price_data: {
              currency: 'usd',
              ...(plan.checkoutMode === 'subscription' ? { recurring: { interval: 'month' } } : {}),
              unit_amount: plan.priceCents,
              product_data: { name: plan.name },
            },
            quantity: 1,
          },
        ];
    const overagePriceId =
      plan.product === 'verify-api' &&
      plan.checkoutMode === 'subscription' &&
      meteredOverageEnabledForOrg(org.id)
        ? resolveStripeOveragePriceIdForProofPlan(plan, isSandbox)
        : undefined;
    if (overagePriceId) {
      lineItems.push({ price: overagePriceId });
    }

    const checkoutMetadata: Stripe.MetadataParam = {
      type: 'proof_product',
      product: plan.product,
      planSlug: plan.slug,
      organizationId: org.id,
      ...(params.userId ? { userId: params.userId } : {}),
      isPublicCheckout: params.userId ? 'false' : 'true',
      isSandbox: isSandbox ? 'true' : 'false',
      stripeMode: isSandbox ? 'test' : 'live',
      ...(overagePriceId ? { verifyApiOveragePriceId: overagePriceId } : {}),
    };

    const subscriptionMetadata: Stripe.MetadataParam = {
      type: 'proof_product',
      product: plan.product,
      planSlug: plan.slug,
      organizationId: org.id,
      ...(params.userId ? { userId: params.userId } : {}),
      isSandbox: isSandbox ? 'true' : 'false',
      stripeMode: isSandbox ? 'test' : 'live',
      ...(overagePriceId ? { verifyApiOveragePriceId: overagePriceId } : {}),
    };

    let session: Stripe.Checkout.Session;
    try {
      session = await stripeClient.checkout.sessions.create({
        mode: plan.checkoutMode === 'subscription' ? 'subscription' : 'payment',
        customer: stripeCustomerId,
        customer_email: stripeCustomerId ? undefined : params.email,
        success_url: success,
        cancel_url: cancel,
        line_items: lineItems,
        allow_promotion_codes: true,
        metadata: checkoutMetadata,
        ...(plan.checkoutMode === 'subscription'
          ? {
              subscription_data: {
                metadata: subscriptionMetadata,
              },
            }
          : {}),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Stripe checkout session creation failed for plan ${plan.slug}: ${msg}`);
      throw new BadRequestException(`Stripe checkout failed: ${msg}`);
    }

    // C-6: surface test mode flag so the frontend can show a TEST MODE banner
    const stripeKey = isSandbox
      ? (process.env.STRIPE_TEST_SECRET_KEY ?? '')
      : (process.env.STRIPE_SECRET_KEY ?? '');
    const isTestMode = stripeKey.startsWith('sk_test_');

    return {
      checkoutUrl: session.url,
      sessionId: session.id,
      organizationId: org.id,
      isTestMode,
    };
  }

  async handleProofProductCheckout(session: Stripe.Checkout.Session) {
    const planSlug = session.metadata?.planSlug;
    const organizationId = session.metadata?.organizationId;
    const product = session.metadata?.product as ProofProductSlug | undefined;

    if (!planSlug || !organizationId || !product) {
      this.logger.warn('Proof checkout missing metadata', { planSlug, organizationId, product });
      return;
    }

    const subscriptionId =
      typeof session.subscription === 'string'
        ? session.subscription
        : (session.subscription?.id ?? null);
    const meteredSubscriptionItemId =
      subscriptionId && product === 'verify-api' && meteredOverageEnabled()
        ? await this.findMeteredSubscriptionItemId(
            subscriptionId,
            planSlug,
            session.metadata?.isSandbox === 'true' || session.id.startsWith('cs_test_'),
          )
        : null;

    if (session.metadata?.isPublicCheckout === 'true' && session.customer_details?.email) {
      await this.ensureUserFromCheckoutEmail(session, organizationId);
    }

    await this.provisionProofProductEntitlement({
      organizationId,
      planSlug,
      product,
      stripeSubscriptionId: subscriptionId,
      stripeSessionId: session.id,
      stripeSubscriptionItemId: meteredSubscriptionItemId,
    });

    await this.provisionBundledPlatformAccess(organizationId, planSlug);
    this.logger.log(
      `Proof checkout fulfilled: session=${session.id} product=${product} plan=${planSlug} org=${organizationId} subscription=${subscriptionId ?? 'none'}`,
    );
  }

  async provisionProofProductEntitlement(params: {
    organizationId: string;
    planSlug: string;
    product: ProofProductSlug;
    stripeSubscriptionId?: string | null;
    stripeSessionId?: string | null;
    stripeSubscriptionItemId?: string | null;
  }) {
    // Idempotency guard: the same purchase can reach us twice — once from the
    // checkout.session.completed webhook (carries stripeSessionId, may or may
    // not yet carry a subscription id) and once from customer.subscription.created
    // (carries stripeSubscriptionId, never a session id) — sometimes only
    // hundreds of ms apart. Dedupe on whichever identifier the caller has for
    // the SAME org + product's currently ACTIVE entitlement, rather than only
    // matching stripeSessionId, so the subscription-only call finds the row
    // the session-only call already created (and vice versa).
    const dedupeConditions: Prisma.ProofProductEntitlementWhereInput[] = [];
    if (params.stripeSessionId) {
      dedupeConditions.push({ stripeSessionId: params.stripeSessionId });
    }
    if (params.stripeSubscriptionId) {
      dedupeConditions.push({ stripeSubscriptionId: params.stripeSubscriptionId });
    }

    if (dedupeConditions.length > 0) {
      const existing = await this.prisma.proofProductEntitlement.findFirst({
        where: {
          organizationId: params.organizationId,
          product: toProofProductType(params.product),
          status: ProofEntitlementStatus.ACTIVE,
          OR: dedupeConditions,
        },
        orderBy: { createdAt: 'desc' },
      });

      if (existing) {
        const enrichedData: Prisma.ProofProductEntitlementUpdateInput = {};
        if (params.stripeSessionId && existing.stripeSessionId !== params.stripeSessionId) {
          enrichedData.stripeSessionId = params.stripeSessionId;
        }
        if (
          params.stripeSubscriptionId &&
          existing.stripeSubscriptionId !== params.stripeSubscriptionId
        ) {
          enrichedData.stripeSubscriptionId = params.stripeSubscriptionId;
        }
        if (
          params.stripeSubscriptionItemId &&
          existing.stripeSubscriptionItemId !== params.stripeSubscriptionItemId
        ) {
          enrichedData.stripeSubscriptionItemId = params.stripeSubscriptionItemId;
        }
        if (params.planSlug && existing.planSlug !== params.planSlug) {
          enrichedData.planSlug = params.planSlug;
        }

        if (Object.keys(enrichedData).length > 0) {
          const updated = await this.prisma.proofProductEntitlement.update({
            where: { id: existing.id },
            data: enrichedData,
          });
          this.logger.debug(
            `Proof entitlement deduped and enriched: entitlement=${existing.id} product=${params.product} org=${params.organizationId} session=${params.stripeSessionId ?? 'none'} subscription=${params.stripeSubscriptionId ?? 'none'}`,
          );
          return updated;
        }

        this.logger.debug(
          `Proof entitlement already provisioned (deduped): entitlement=${existing.id} product=${params.product} org=${params.organizationId} session=${params.stripeSessionId ?? 'none'} subscription=${params.stripeSubscriptionId ?? 'none'}`,
        );
        return existing;
      }
    }

    const limits = resolveProofPlanLimits(params.planSlug);
    const now = new Date();
    const periodEnd = addMonths(now, 1);

    await this.prisma.proofProductEntitlement.updateMany({
      where: {
        organizationId: params.organizationId,
        product: toProofProductType(params.product),
        status: ProofEntitlementStatus.ACTIVE,
      },
      data: { status: ProofEntitlementStatus.CANCELLED },
    });

    const entitlement = await this.prisma.proofProductEntitlement.create({
      data: {
        organizationId: params.organizationId,
        product: toProofProductType(params.product),
        planSlug: params.planSlug,
        status: ProofEntitlementStatus.ACTIVE,
        monthlyLimit: limits.monthlyLimit,
        periodStart: now,
        periodEnd,
        stripeSubscriptionId: params.stripeSubscriptionId ?? undefined,
        stripeSessionId: params.stripeSessionId ?? undefined,
        stripeSubscriptionItemId: params.stripeSubscriptionItemId ?? undefined,
        meteredBillingEnabled:
          params.product === 'verify-api' &&
          meteredOverageEnabledForOrg(params.organizationId) &&
          Boolean(params.stripeSubscriptionItemId),
      },
    });
    this.logger.log(
      `Proof entitlement provisioned: entitlement=${entitlement.id} product=${params.product} plan=${params.planSlug} org=${params.organizationId} session=${params.stripeSessionId ?? 'none'} subscription=${params.stripeSubscriptionId ?? 'none'}`,
    );
    return entitlement;
  }

  async revokeProofProductEntitlement(params: {
    organizationId: string;
    product: ProofProductSlug;
  }) {
    const result = await this.prisma.proofProductEntitlement.updateMany({
      where: {
        organizationId: params.organizationId,
        product: toProofProductType(params.product),
        status: ProofEntitlementStatus.ACTIVE,
      },
      data: { status: ProofEntitlementStatus.CANCELLED },
    });
    if (result.count > 0) {
      this.logger.log(
        `Revoked ${result.count} ACTIVE entitlement(s) for org ${params.organizationId}, product ${params.product}`,
      );
    }
    return result;
  }

  async provisionBundledPlatformAccess(organizationId: string, proofPlanSlug: string) {
    const bundle = getProofBundleRule(proofPlanSlug);
    if (!bundle) return;

    const now = new Date();
    let expiresAt: Date | null = null;
    if (
      bundle.platformAccessDuration === 'pilot_90d' ||
      bundle.platformAccessDuration === 'sprint_90d'
    ) {
      expiresAt = addDays(now, 90);
    }

    const existing = await this.prisma.organizationPlatformGrant.findFirst({
      where: {
        organizationId,
        source: PlatformGrantSource.PROOF_PURCHASE,
        proofPlanSlug,
      },
      orderBy: { createdAt: 'desc' },
    });

    const currentSub = await this.prisma.organizationSubscription.findUnique({
      where: { organizationId },
    });

    const shouldUpgrade =
      !currentSub ||
      platformPlanRank(bundle.bundledPlatformPlan) > platformPlanRank(currentSub.planSlug);

    if (shouldUpgrade) {
      await this.applyPlatformPlan(organizationId, bundle.bundledPlatformPlan);
    }

    if (existing) {
      await this.prisma.organizationPlatformGrant.update({
        where: { id: existing.id },
        data: {
          planSlug: bundle.bundledPlatformPlan,
          expiresAt,
        },
      });
    } else {
      await this.prisma.organizationPlatformGrant.create({
        data: {
          organizationId,
          planSlug: bundle.bundledPlatformPlan,
          source: PlatformGrantSource.PROOF_PURCHASE,
          expiresAt,
          proofPlanSlug,
        },
      });
    }
  }

  async getActiveProofEntitlement(organizationId: string, product: ProofProductType) {
    return this.prisma.proofProductEntitlement.findFirst({
      where: {
        organizationId,
        product,
        status: ProofEntitlementStatus.ACTIVE,
        OR: [{ periodEnd: null }, { periodEnd: { gte: new Date() } }],
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listEntitlementsWithUsage(organizationId: string) {
    const entitlements = await this.prisma.proofProductEntitlement.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });

    // Data-integrity guard: ProofProductEntitlement has no DB-level unique
    // constraint on (organizationId, product) — only a non-unique
    // @@index([organizationId, product, status]) (see schema.prisma). A race
    // in the Stripe webhook handler, or a re-run of the findFirst+create
    // pattern in scripts/qa/grant-proof-entitlements.mjs, can leave more than
    // one ACTIVE row for the same product. Only one ACTIVE entitlement per
    // product should ever be "the" active one — this mirrors
    // getActiveProofEntitlement()'s own findFirst(orderBy: createdAt desc)
    // resolution above. Collapse to the most recent ACTIVE row per product
    // (entitlements is already ordered createdAt desc, so the first ACTIVE
    // row seen per product is the newest); every EXPIRED/CANCELLED row is
    // kept untouched so purchase history (console/purchases) stays intact.
    // Bug: duplicate ACTIVE rows were surfacing as duplicate nav links in
    // ConsoleSidebar's "My Proof Products" section.
    const seenActiveProducts = new Set<ProofProductType>();
    const deduped = entitlements.filter((e) => {
      if (e.status !== ProofEntitlementStatus.ACTIVE) {
        return true;
      }
      if (seenActiveProducts.has(e.product)) {
        return false;
      }
      seenActiveProducts.add(e.product);
      return true;
    });

    return Promise.all(
      deduped.map(async (e) => {
        const periodStart = e.periodStart;
        const periodEnd = e.periodEnd ?? addMonths(periodStart, 1);
        const used = await this.prisma.verificationRun.count({
          where: {
            orgId: organizationId,
            product: { in: runProductsForEntitlement(e.product) },
            createdAt: { gte: periodStart, lte: periodEnd },
          },
        });
        return {
          id: e.id,
          product: e.product,
          planSlug: e.planSlug,
          status: e.status,
          monthlyLimit: e.monthlyLimit,
          periodStart: e.periodStart.toISOString(),
          periodEnd: periodEnd.toISOString(),
          usedThisPeriod: used,
        };
      }),
    );
  }

  async resolveProofQuota(organizationId: string, product: ProofProductType) {
    const entitlement = await this.getActiveProofEntitlement(organizationId, product);
    // IMPORTANT: branch on whether an entitlement was found, not on whether its
    // monthlyLimit is non-null. `monthlyLimit: null` is a valid, intentional
    // "unlimited" value on plans like auditproof-eu-sprint/*-enterprise (see
    // packages/config/src/billing.ts). The old `entitlement?.monthlyLimit != null`
    // check treated "no entitlement" and "unlimited entitlement" identically,
    // silently downgrading unlimited customers to the 500/mo anonymous tier.
    if (entitlement) {
      return {
        planSlug: entitlement.planSlug,
        monthlyLimit: entitlement.monthlyLimit,
        source: 'entitlement' as const,
      };
    }

    return { planSlug: 'anonymous', monthlyLimit: 500, source: 'anonymous' as const };
  }

  async createVerifyApiOverageEvent(params: {
    organizationId: string;
    verificationRunId: string;
    planSlug: string;
    overageCents: number;
    proofId?: string | null;
  }) {
    if (!meteredOverageEnabledForOrg(params.organizationId)) return null;
    const entitlement = await this.getActiveProofEntitlement(
      params.organizationId,
      ProofProductType.VERIFY_API,
    );
    if (
      !entitlement?.meteredBillingEnabled ||
      !entitlement.stripeSubscriptionItemId ||
      entitlement.planSlug !== params.planSlug
    ) {
      return null;
    }

    try {
      return await this.prisma.proofUsageEvent.create({
        data: {
          organizationId: params.organizationId,
          product: 'verify-api',
          proofId: params.proofId ?? undefined,
          verificationRunId: params.verificationRunId,
          planSlug: params.planSlug,
          isOverage: true,
          quantity: 1,
          overageCents: params.overageCents,
          stripeReported: false,
          stripeReportAttempts: 0,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.prisma.proofUsageEvent.findFirst({
          where: {
            organizationId: params.organizationId,
            verificationRunId: params.verificationRunId,
            isOverage: true,
          },
        });
      }
      throw error;
    }
  }

  async isVerifyApiMeteredOverageReady(organizationId: string, planSlug: string) {
    const entitlement = await this.getActiveProofEntitlement(
      organizationId,
      ProofProductType.VERIFY_API,
    );
    return Boolean(
      meteredOverageEnabledForOrg(organizationId) &&
      entitlement?.planSlug === planSlug &&
      entitlement.meteredBillingEnabled &&
      entitlement.stripeSubscriptionItemId,
    );
  }

  async attachProofIdToUsageEvent(params: {
    organizationId: string;
    verificationRunId: string;
    proofId: string;
  }) {
    return this.prisma.proofUsageEvent.updateMany({
      where: {
        organizationId: params.organizationId,
        verificationRunId: params.verificationRunId,
        proofId: null,
      },
      data: { proofId: params.proofId },
    });
  }

  async reportUsageEventToStripe(eventId: string) {
    const event = await this.prisma.proofUsageEvent.findUnique({ where: { id: eventId } });
    if (!event || event.stripeReported || !event.isOverage || !event.verificationRunId) {
      return { reported: false, skipped: true };
    }
    if (!meteredOverageEnabledForOrg(event.organizationId)) {
      return { reported: false, skipped: true };
    }

    const entitlement = await this.prisma.proofProductEntitlement.findFirst({
      where: {
        organizationId: event.organizationId,
        product: ProofProductType.VERIFY_API,
        status: ProofEntitlementStatus.ACTIVE,
        stripeSubscriptionItemId: { not: null },
        meteredBillingEnabled: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!entitlement?.stripeSubscriptionItemId) {
      this.logger.warn(
        `Cannot report VerifyAPI overage ${event.id}: missing metered subscription item`,
      );
      return { reported: false, skipped: true };
    }
    const organization = await this.prisma.organization.findUnique({
      where: { id: event.organizationId },
      select: { stripeCustomerId: true },
    });

    const isSandboxEntitlement =
      entitlement.stripeSessionId?.startsWith('cs_test_') ||
      entitlement.stripeSubscriptionId?.startsWith('sub_test_');
    const stripeClient = isSandboxEntitlement ? this.stripeTest : this.stripe;
    if (!stripeClient) {
      this.logger.warn(`Cannot report VerifyAPI overage ${event.id}: Stripe is not configured`);
      return { reported: false, skipped: true };
    }
    const stripeCustomerId = await this.resolveStripeCustomerForUsageReport({
      entitlement,
      fallbackCustomerId: organization?.stripeCustomerId ?? null,
      stripeClient,
      preferSubscriptionCustomer: isSandboxEntitlement,
    });
    if (!stripeCustomerId) {
      this.logger.warn(`Cannot report VerifyAPI overage ${event.id}: missing Stripe customer`);
      return { reported: false, skipped: true };
    }

    const idempotencyKey = `overage:${event.organizationId}:${event.verificationRunId}`;
    const usageRecord = await stripeClient.billing.meterEvents.create(
      {
        event_name: verifyApiOverageMeterEventName(),
        identifier: idempotencyKey,
        timestamp: stripeTimestamp(event.createdAt),
        payload: {
          stripe_customer_id: stripeCustomerId,
          value: String(event.quantity),
        },
      },
      { idempotencyKey },
    );

    await this.prisma.proofUsageEvent.update({
      where: { id: event.id },
      data: {
        stripeReported: true,
        stripeUsageRecordId: usageRecord.identifier ?? idempotencyKey,
        lastStripeReportError: null,
        nextStripeReportAt: null,
      },
    });

    return { reported: true, skipped: false };
  }

  reportUsageEventToStripeBestEffort(eventId: string) {
    if (!meteredOverageEnabled()) return;
    this.reportUsageEventToStripe(eventId).catch((error) => {
      this.logger.warn(
        `Deferred VerifyAPI overage reporting failed for event ${eventId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }

  async getVerifyApiMeteredOverageRolloutStatus(organizationId: string) {
    const entitlement = await this.getActiveProofEntitlement(
      organizationId,
      ProofProductType.VERIFY_API,
    );
    const allowlisted = verifyApiMeteredOverageOrgIds().has(organizationId);
    return {
      organizationId,
      globalEnabled: meteredOverageEnabled(),
      allowlisted,
      effectiveEnabled: meteredOverageEnabledForOrg(organizationId),
      planSlug: entitlement?.planSlug ?? null,
      entitlementMeteredBillingEnabled: entitlement?.meteredBillingEnabled ?? false,
      hasMeteredSubscriptionItem: Boolean(entitlement?.stripeSubscriptionItemId),
      ready: await this.isVerifyApiMeteredOverageReady(organizationId, entitlement?.planSlug ?? ''),
    };
  }

  async disableVerifyApiMeteredOverageForOrg(organizationId: string) {
    const result = await this.prisma.proofProductEntitlement.updateMany({
      where: {
        organizationId,
        product: ProofProductType.VERIFY_API,
        meteredBillingEnabled: true,
      },
      data: { meteredBillingEnabled: false },
    });
    return { organizationId, disabled: result.count };
  }

  async reconcileUnreportedOverageEvents(
    params: {
      organizationId?: string;
      subscriptionId?: string;
      olderThanMs?: number;
      limit?: number;
      periodStart?: Date;
      periodEnd?: Date;
      drainAll?: boolean;
    } = {},
  ) {
    if (!meteredOverageEnabled()) {
      return { enabled: false, scanned: 0, reported: 0, failed: 0 };
    }
    const olderThan = new Date(Date.now() - (params.olderThanMs ?? 2 * 60 * 1000));
    let reported = 0;
    let failed = 0;
    let scanned = 0;
    const limit = params.limit ?? 100;
    for (;;) {
      const rows = await this.prisma.proofUsageEvent.findMany({
        where: {
          product: 'verify-api',
          isOverage: true,
          stripeReported: false,
          stripeReportAttempts: { lt: 5 },
          createdAt: {
            lt: olderThan,
            ...(params.periodStart ? { gte: params.periodStart } : {}),
            ...(params.periodEnd ? { lt: params.periodEnd } : {}),
          },
          OR: [{ nextStripeReportAt: null }, { nextStripeReportAt: { lte: new Date() } }],
          ...(params.organizationId ? { organizationId: params.organizationId } : {}),
        },
        orderBy: { createdAt: 'asc' },
        take: limit,
      });
      scanned += rows.length;
      if (rows.length === 0) break;
      let changed = 0;
      for (const row of rows) {
        if (params.subscriptionId) {
          const entitlement = await this.prisma.proofProductEntitlement.findFirst({
            where: {
              organizationId: row.organizationId,
              stripeSubscriptionId: params.subscriptionId,
              product: ProofProductType.VERIFY_API,
            },
          });
          if (!entitlement) continue;
        }
        try {
          const result = await this.reportUsageEventToStripe(row.id);
          if (result.reported) {
            reported += 1;
            changed += 1;
          }
        } catch (error) {
          failed += 1;
          changed += 1;
          const attempts = (row.stripeReportAttempts ?? 0) + 1;
          await this.prisma.proofUsageEvent.update({
            where: { id: row.id },
            data: {
              stripeReportAttempts: attempts,
              nextStripeReportAt: attempts >= 5 ? null : nextOverageRetryAt(attempts),
              lastStripeReportError: truncateStripeError(error),
            },
          });
          if (attempts >= 3) {
            Sentry.captureException(error, {
              tags: { feature: 'verify-api-metered-overage' },
              extra: {
                orgId: row.organizationId,
                verificationRunId: row.verificationRunId,
                proofUsageEventId: row.id,
                attempts,
              },
            });
          }
        }
      }
      if (!params.drainAll || rows.length < limit || changed === 0) break;
    }

    return { enabled: true, scanned, reported, failed };
  }

  async handleInvoiceCreated(invoice: Stripe.Invoice) {
    const subscriptionId = this.extractInvoiceSubscriptionId(invoice);
    if (!subscriptionId) return;
    const entitlement = await this.prisma.proofProductEntitlement.findFirst({
      where: {
        stripeSubscriptionId: subscriptionId,
        product: ProofProductType.VERIFY_API,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!entitlement) return;
    await this.reconcileUnreportedOverageEvents({
      organizationId: entitlement.organizationId,
      subscriptionId,
      olderThanMs: 0,
      limit: 1000,
      periodStart: this.extractInvoicePeriodStart(invoice),
      periodEnd: this.extractInvoicePeriodEnd(invoice),
      drainAll: true,
    });
  }

  async disableMeteredBillingForSubscription(subscriptionId: string | null | undefined) {
    if (!subscriptionId) return { count: 0 };
    return this.prisma.proofProductEntitlement.updateMany({
      where: {
        stripeSubscriptionId: subscriptionId,
        product: ProofProductType.VERIFY_API,
        meteredBillingEnabled: true,
      },
      data: { meteredBillingEnabled: false },
    });
  }

  async syncMeteredBillingFromSubscription(subscription: Stripe.Subscription) {
    const product = subscription.metadata?.product as ProofProductSlug | undefined;
    const planSlug = subscription.metadata?.planSlug;
    if (product !== 'verify-api' || !planSlug) return;
    const itemId = this.findMeteredItemInSubscription(subscription, planSlug);
    await this.prisma.proofProductEntitlement.updateMany({
      where: {
        stripeSubscriptionId: subscription.id,
        product: ProofProductType.VERIFY_API,
      },
      data: {
        stripeSubscriptionItemId: itemId,
        meteredBillingEnabled:
          meteredOverageEnabledForOrg(subscription.metadata?.organizationId ?? '') &&
          Boolean(itemId),
      },
    });
  }

  private async findMeteredSubscriptionItemId(
    subscriptionId: string,
    planSlug: string,
    isSandbox: boolean,
  ): Promise<string | null> {
    const stripeClient = this.stripeFor(isSandbox);
    if (!stripeClient) return null;
    try {
      const subscription = await stripeClient.subscriptions.retrieve(subscriptionId);
      return this.findMeteredItemInSubscription(subscription, planSlug);
    } catch (error) {
      this.logger.warn(
        `Unable to retrieve Stripe subscription ${subscriptionId} for metered item lookup: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  private findMeteredItemInSubscription(
    subscription: Stripe.Subscription,
    planSlug: string,
  ): string | null {
    const plan = getProofBillingPlan(planSlug);
    if (!plan) return null;
    const liveOveragePrice = resolveStripeOveragePriceIdForProofPlan(plan, false);
    const testOveragePrice = resolveStripeOveragePriceIdForProofPlan(plan, true);
    const item = subscription.items.data.find((subscriptionItem) => {
      const priceId = subscriptionItem.price?.id;
      return Boolean(
        priceId &&
        ((liveOveragePrice && priceId === liveOveragePrice) ||
          (testOveragePrice && priceId === testOveragePrice)),
      );
    });
    return item?.id ?? null;
  }

  private async resolveStripeCustomerForUsageReport(params: {
    entitlement: {
      stripeSubscriptionId?: string | null;
    };
    fallbackCustomerId?: string | null;
    stripeClient: Stripe;
    preferSubscriptionCustomer?: boolean;
  }): Promise<string | null> {
    const subscriptionCustomer = params.preferSubscriptionCustomer
      ? await this.resolveCustomerIdFromStripeSubscription(params.entitlement, params.stripeClient)
      : null;
    if (subscriptionCustomer) return subscriptionCustomer;
    if (params.fallbackCustomerId) return params.fallbackCustomerId;
    return this.resolveCustomerIdFromStripeSubscription(params.entitlement, params.stripeClient);
  }

  private async resolveCustomerIdFromStripeSubscription(
    entitlement: { stripeSubscriptionId?: string | null },
    stripeClient: Stripe,
  ): Promise<string | null> {
    if (!entitlement.stripeSubscriptionId) return null;
    try {
      const subscription = await stripeClient.subscriptions.retrieve(
        entitlement.stripeSubscriptionId,
      );
      const customer = subscription.customer;
      return typeof customer === 'string' ? customer : (customer?.id ?? null);
    } catch (error) {
      this.logger.warn(
        `Unable to retrieve Stripe subscription ${entitlement.stripeSubscriptionId} for customer lookup: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  private extractInvoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
    const invoiceWithSubscription = invoice as Stripe.Invoice & {
      subscription?: string | Stripe.Subscription | null;
      parent?: { subscription_details?: { subscription?: string | Stripe.Subscription | null } };
    };
    const ref =
      invoiceWithSubscription.subscription ??
      invoiceWithSubscription.parent?.subscription_details?.subscription ??
      null;
    return typeof ref === 'string' ? ref : (ref?.id ?? null);
  }

  private extractInvoicePeriodStart(invoice: Stripe.Invoice): Date | undefined {
    const start = invoice.lines?.data?.[0]?.period?.start;
    return typeof start === 'number' ? new Date(start * 1000) : undefined;
  }

  private extractInvoicePeriodEnd(invoice: Stripe.Invoice): Date | undefined {
    const end = invoice.lines?.data?.[0]?.period?.end;
    return typeof end === 'number' ? new Date(end * 1000) : undefined;
  }

  private async applyPlatformPlan(organizationId: string, planSlug: string) {
    const plan = await this.prisma.billingPlan.findUnique({ where: { slug: planSlug } });
    if (!plan) {
      this.logger.warn(`Bundled platform plan ${planSlug} not seeded`);
      return;
    }
    const now = new Date();
    const nextMonth = addMonths(now, 1);
    await this.prisma.organizationSubscription.upsert({
      where: { organizationId },
      update: {
        planSlug: plan.slug,
        status: 'ACTIVE',
        currentPeriodStart: now,
        currentPeriodEnd: nextMonth,
        creditAllowance: plan.monthlyCredits,
      },
      create: {
        organizationId,
        planSlug: plan.slug,
        status: 'ACTIVE',
        currentPeriodStart: now,
        currentPeriodEnd: nextMonth,
        creditAllowance: plan.monthlyCredits,
      },
    });
  }

  private async ensureStripeCustomer(
    organizationId: string,
    stripeClient: Stripe,
    email?: string,
    isSandbox = false,
  ) {
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId } });
    if (!org) throw new NotFoundException('Organization not found');
    // In sandbox mode the stripeClient is a test-mode client. Live customer IDs
    // (cus_...) are invisible to test mode and cause "No such customer" errors.
    // Skip the cached ID so Stripe creates a transient test customer from the email.
    if (!isSandbox && org.stripeCustomerId) return org.stripeCustomerId;

    const customer = await stripeClient.customers.create({
      email,
      metadata: { organizationId },
    });
    // Only persist live-mode customer IDs. Test-mode IDs must not overwrite the
    // production stripeCustomerId on the org record.
    if (!isSandbox) {
      await this.prisma.organization.update({
        where: { id: organizationId },
        data: { stripeCustomerId: customer.id },
      });
    }
    return customer.id;
  }

  private async resolveOrganizationForUser(userId: string) {
    const membership = await this.prisma.organizationMembership.findFirst({
      where: { userId },
      include: { organization: true },
      orderBy: { createdAt: 'asc' },
    });
    if (membership?.organization) return membership.organization;

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const slug = `user-${userId.slice(0, 8)}`;
    const org = await this.prisma.organization.upsert({
      where: { slug },
      update: {},
      create: { slug, name: user?.email ?? `Org ${slug}` },
    });
    await this.ensureMembership(userId, org.id);
    return org;
  }

  private async ensureMembership(userId: string, organizationId: string) {
    await this.prisma.organizationMembership.upsert({
      where: {
        userId_organizationId: { userId, organizationId },
      },
      update: {},
      create: {
        userId,
        organizationId,
        role: 'OWNER',
      },
    });
  }

  private async ensureUserFromCheckoutEmail(
    session: Stripe.Checkout.Session,
    organizationId: string,
  ) {
    const email = session.customer_details?.email?.trim().toLowerCase();
    if (!email) return;

    let user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      const randomPassword = randomBytes(12).toString('base64url');
      user = await this.prisma.user.create({
        data: {
          email,
          password: await hash(randomPassword),
          userType: 'HUMAN',
          displayName: email.split('@')[0] ?? 'Proof Customer',
          emailVerified: new Date(),
        },
      });
      this.logger.log(`Created proof checkout user ${user.id} for ${email}`);
    }

    await this.ensureMembership(user.id, organizationId);
  }
}
