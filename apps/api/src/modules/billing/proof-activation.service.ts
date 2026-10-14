import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { getProofBillingPlan } from '@chain-verify/config';
import Stripe from 'stripe';

import { PrismaService } from '../database/prisma.service.js';

type ActivationInput = {
  product: 'verify-api' | 'audit-proof' | 'invoice-proof';
  planSlug: string;
  sessionId: string;
  companyName: string;
  contactName?: string;
  contactEmail: string;
};

@Injectable()
export class ProofActivationService {
  private readonly stripe: Stripe | null;

  constructor(private readonly prisma: PrismaService) {
    this.stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
  }

  async activate(input: ActivationInput) {
    if (!this.stripe) {
      throw new ServiceUnavailableException('Stripe verification is not configured');
    }

    const companyName = input.companyName?.trim();
    const contactName = input.contactName?.trim() || null;
    const contactEmail = input.contactEmail?.trim().toLowerCase();
    const sessionId = input.sessionId?.trim();
    const planSlug = input.planSlug?.trim();
    const product = input.product;

    if (!companyName || companyName.length > 200) {
      throw new BadRequestException('A valid company name is required');
    }
    if (!contactEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
      throw new BadRequestException('A valid contact email is required');
    }
    if (!sessionId || !sessionId.startsWith('cs_')) {
      throw new BadRequestException('A valid Stripe Checkout Session is required');
    }

    const plan = getProofBillingPlan(planSlug);
    if (!plan || plan.product !== product) {
      throw new BadRequestException('The requested product/plan combination is not valid');
    }

    const existing = await this.prisma.proofPilotIntake.findFirst({
      where: { stripeSessionId: sessionId },
      select: { id: true, status: true, contactEmail: true, companyName: true },
    });
    if (existing) {
      return {
        ok: true,
        activationId: existing.id,
        status: existing.status,
        alreadySubmitted: true,
      };
    }

    let session: Stripe.Checkout.Session;
    try {
      session = await this.stripe.checkout.sessions.retrieve(sessionId, {
        expand: ['line_items.data.price'],
      });
    } catch {
      throw new BadRequestException('Stripe could not verify this checkout session');
    }

    if (!session.livemode) {
      throw new BadRequestException('This activation requires a live Stripe checkout');
    }
    if (session.status !== 'complete') {
      throw new BadRequestException('Stripe checkout is not complete');
    }
    if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') {
      throw new BadRequestException('Stripe does not show this checkout as paid');
    }

    const stripeEmail = session.customer_details?.email?.trim().toLowerCase();
    if (!stripeEmail || stripeEmail !== contactEmail) {
      throw new BadRequestException('Use the same email address that was entered during Stripe checkout');
    }

    const metadataPlan = session.metadata?.chainverify_plan;
    const metadataProduct = session.metadata?.chainverify_product;
    if (metadataPlan && metadataPlan !== planSlug) {
      throw new BadRequestException('Checkout plan does not match the requested activation');
    }
    if (metadataProduct && metadataProduct !== product) {
      throw new BadRequestException('Checkout product does not match the requested activation');
    }

    const lineAmount = session.amount_total ?? session.line_items?.data?.[0]?.amount_total ?? null;
    if (lineAmount !== null && lineAmount !== plan.priceCents) {
      throw new BadRequestException('Checkout amount does not match the requested plan');
    }

    const intake = await this.prisma.proofPilotIntake.create({
      data: {
        product,
        planSlug,
        companyName,
        contactName,
        contactEmail,
        stripeSessionId: sessionId,
        status: 'PAID_PENDING_PROVISIONING',
        sourcePath: '/' + product + '/welcome',
        rawPayload: {
          stripePaymentStatus: session.payment_status,
          stripeMode: session.mode,
          stripeCustomerId:
            typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null,
          stripeSubscriptionId:
            typeof session.subscription === 'string' ? session.subscription : session.subscription?.id ?? null,
        },
      },
      select: { id: true, status: true },
    });

    return {
      ok: true,
      activationId: intake.id,
      status: intake.status,
      alreadySubmitted: false,
    };
  }
}
