import {
  BadRequestException,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import Stripe from 'stripe';

import { Public } from '../auth/decorators/public.decorator.js';
import { StripeProvisioningService } from './stripe-provisioning.service.js';

/**
 * Stripe webhook ingestion endpoint.
 *
 * Security: verifies every payload with `stripe.webhooks.constructEvent`
 * using `STRIPE_WEBHOOK_SECRET`. A missing secret causes a 503 (fail closed).
 * Bad/missing signatures return 400. Rate-limiting is skipped because Stripe
 * retries on non-2xx and would hit the limit during incident recovery.
 */
@Controller('billing/stripe')
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);

  constructor(private readonly provisioning: StripeProvisioningService) {}

  @Post('webhook')
  @Public()
  @SkipThrottle({ default: true, strict: true })
  @HttpCode(HttpStatus.OK)
  async handleWebhook(@Req() req: Request, @Res() res: Response) {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      this.logger.error('STRIPE_WEBHOOK_SECRET is not configured — rejecting webhook');
      return res.status(HttpStatus.SERVICE_UNAVAILABLE).json({ error: 'Webhook verification is not configured' });
    }

    const signature = req.headers['stripe-signature'];
    if (!signature) {
      return res.status(HttpStatus.BAD_REQUEST).json({ error: 'Missing stripe-signature header' });
    }

    const rawBody = (req as any).rawBody as Buffer | undefined;
    if (!rawBody) {
      return res.status(HttpStatus.BAD_REQUEST).json({ error: 'Raw body not available' });
    }

    // Construct the Stripe client lazily — it only needs the secret key for
    // server-side session retrieval during provisioning.
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      return res.status(HttpStatus.SERVICE_UNAVAILABLE).json({ error: 'Stripe is not configured' });
    }
    const stripe = new Stripe(stripeSecretKey);

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (err) {
      this.logger.warn(`Webhook signature verification failed: ${(err as Error).message}`);
      return res.status(HttpStatus.BAD_REQUEST).json({ error: 'Webhook signature verification failed' });
    }

    try {
      const result = await this.provisioning.processWebhookEvent(event, stripe);
      return res.status(HttpStatus.OK).json(result);
    } catch (err) {
      // Processing error: return 500 so Stripe retries.
      this.logger.error(`Webhook processing error for ${event.id}: ${(err as Error).message}`);
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: 'Webhook processing failed' });
    }
  }
}
