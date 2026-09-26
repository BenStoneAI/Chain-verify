import { ExecutionContext, Injectable, Optional } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { ServiceAccountsService } from '../auth/service-accounts.service.js';
import { authenticateSskKey, extractSskKey } from '../auth/ssk-api-key.util.js';
import { PrismaService } from '../database/prisma.service.js';

/**
 * Auth guard for the public VerifyAPI surface.
 *
 * Accepts, in priority order:
 *   1. A SwarmSync API key (`ssk_live_…`) via `Authorization: Bearer …` or `X-API-Key: …`
 *      — the documented server-to-server credential for external customers.
 *   2. Everything the standard JwtAuthGuard accepts (JWT bearer tokens, `sa_`
 *      service-account keys, public-route fallthrough).
 *
 * ssk_live_ keys are user-owned (SwarmScoreApiKey.userId). We authenticate the
 * owning user; the controller resolves the billing organization from membership
 * so paid entitlements apply and usage is attributed to the right org.
 */
@Injectable()
export class VerifyApiAuthGuard extends JwtAuthGuard {
  constructor(
    @Optional() serviceAccounts: ServiceAccountsService | null,
    reflector: Reflector,
    private readonly prismaService: PrismaService,
  ) {
    // Also hand the base guard the PrismaService it needs to validate
    // ssk_live_ keys itself — see jwt-auth.guard.ts. Every @Public() route
    // guarded by plain JwtAuthGuard now shares this exact fail-closed
    // ssk_live_ behavior, not just the VerifyAPI surface.
    super(serviceAccounts, reflector, prismaService);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const sskKey = extractSskKey(request);

    if (sskKey) {
      request.user = await authenticateSskKey(this.prismaService, sskKey);
      return true;
    }

    // No ssk_live_ key present — fall back to JWT / service-account handling.
    return super.canActivate(context);
  }
}
