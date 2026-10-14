import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  GoneException,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import Stripe from 'stripe';

import { Public } from '../auth/decorators/public.decorator.js';
import { ProvisioningValidationError, StripeProvisioningService } from './stripe-provisioning.service.js';

/**
 * Client-facing endpoints for the Agent Gate post-checkout flow:
 * - GET  /api/billing/proof/provision-status?session_id=  (DB-only, no Stripe)
 * - POST /api/billing/proof/reconcile { session_id }      (Stripe retrieve + provision)
 * - POST /api/billing/proof/claim-key { session_id }      (one-time API key issuance)
 */
@Controller('billing/proof')
export class ProofCredentialController {
  private readonly logger = new Logger(ProofCredentialController.name);

  constructor(private readonly provisioning: StripeProvisioningService) {}

  /**
   * GET /api/billing/proof/provision-status?session_id=cs_...
   * DB-only lookup — no Stripe call. Returns provisioning state for the welcome page.
   */
  @Get('provision-status')
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  async provisionStatus(@Query('session_id') sessionId?: string) {
    if (!sessionId || !sessionId.startsWith('cs_')) {
      throw new BadRequestException('A valid session_id starting with cs_ is required');
    }

    return this.provisioning.getProvisionStatus(sessionId);
  }

  /**
   * POST /api/billing/proof/reconcile { session_id }
   * Rate-limited. Retrieves the session from Stripe and idempotently provisions.
   * Recovery path when the webhook hasn't fired yet (browser return before webhook).
   */
  @Post('reconcile')
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  async reconcile(@Body() body: { session_id?: string }) {
    const sessionId = body?.session_id?.trim();
    if (!sessionId || !sessionId.startsWith('cs_')) {
      throw new BadRequestException('A valid session_id starting with cs_ is required');
    }

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      throw new ServiceUnavailableException('Stripe is not configured');
    }

    const stripe = new Stripe(stripeKey);

    try {
      await this.provisioning.provisionFromCheckoutSession(sessionId, stripe);
    } catch (err) {
      this.logger.warn(`Reconcile failed for ${sessionId.slice(0, 20)}: ${(err as Error).message}`);
      if (err instanceof ProvisioningValidationError) {
        // A permanent answer: this session is not a valid paid purchase. Let the
        // welcome page show "payment could not be verified" immediately instead
        // of polling until it times out. No internal detail is exposed.
        const status = await this.provisioning.getProvisionStatus(sessionId);
        return { ...status, state: 'FAILED' as const, failure_code: 'PAYMENT_NOT_VERIFIED' };
      }
      // Transient/unknown errors: generic state; the client may retry.
    }

    return this.provisioning.getProvisionStatus(sessionId);
  }

  /**
   * POST /api/billing/proof/claim-key { session_id }
   * Issues a one-time API key for a provisioned Agent Gate session.
   * Returns 409 if already issued. Returns 410 if claim window expired.
   */
  @Post('claim-key')
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  async claimKey(@Body() body: { session_id?: string }) {
    const sessionId = body?.session_id?.trim();
    if (!sessionId || !sessionId.startsWith('cs_')) {
      throw new BadRequestException('A valid session_id starting with cs_ is required');
    }

    const eligibility = await this.provisioning.checkKeyEligibility(sessionId);
    if (eligibility === 'ALREADY_ISSUED') {
      const existing = await this.provisioning.getProvisionStatus(sessionId);
      throw new ConflictException({
        already_issued: true,
        key_prefix: existing.key_prefix,
        message: 'API key was already issued for this session. Use your API key dashboard to rotate keys.',
      });
    }
    if (eligibility === 'NOT_FOUND') {
      throw new BadRequestException('Session is not yet provisioned. Try the reconcile endpoint first.');
    }
    if (eligibility === 'NOT_AGENT_GATE') {
      throw new ForbiddenException('API keys are issued for Agent Gate purchases only.');
    }
    if (eligibility === 'NOT_ACTIVE') {
      throw new ForbiddenException('This purchase does not currently have active access.');
    }
    if (eligibility === 'EXPIRED') {
      throw new GoneException(
        'The claim window for this session has expired (24h). Use your authenticated dashboard to generate a new key.',
      );
    }

    const result = await this.provisioning.issueKeyForSession(sessionId);
    if (!result) {
      // Either expired or race condition
      // Check if it was actually already issued (race)
      const recheckStatus = await this.provisioning.getProvisionStatus(sessionId);
      if (recheckStatus.key_issued) {
        throw new ConflictException({
          already_issued: true,
          key_prefix: recheckStatus.key_prefix,
          message: 'API key was already issued for this session.',
        });
      }
      throw new GoneException(
        'The claim window for this session has expired (24h). Use your authenticated dashboard to generate a new key.',
      );
    }

    return {
      api_key: result.plaintext,
      key_prefix: result.keyPrefix,
      endpoint: '/api/verify',
      organization_id: result.organizationId,
      warning: 'Copy this key now. It will not be shown again.',
    };
  }
}
