import 'reflect-metadata';

import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@chain-verify/config', () => ({
  verifyApiPlanConfigs: [{ slug: 'free', monthlyRuns: 10, overageCents: null, retentionDays: 7 }],
}));

import { AdminAuthGuard } from '../admin/admin-auth.guard.js';
import { VerifyApiController } from './verify-api.controller.js';

const GUARDS_KEY = '__guards__';

function methodGuards(handler: unknown): unknown[] {
  return (Reflect.getMetadata(GUARDS_KEY, handler as object) as unknown[] | undefined) ?? [];
}

function contextWithHeaders(headers: Record<string, string>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

describe('pilot-intake operator endpoints are platform-admin only', () => {
  const proto = VerifyApiController.prototype as unknown as Record<string, unknown>;

  it.each(['listPilotIntakes', 'updatePilotIntakeStatus'])(
    '%s is guarded by AdminAuthGuard, not just a customer API key',
    (handlerName) => {
      expect(methodGuards(proto[handlerName])).toContain(AdminAuthGuard);
    },
  );

  it('rejects a request carrying only a customer API key (no x-admin-key)', async () => {
    const prisma = { adminIdentity: { findFirst: vi.fn(), update: vi.fn() } };
    const guard = new AdminAuthGuard(prisma as never);

    await expect(
      guard.canActivate(contextWithHeaders({ authorization: 'Bearer cv_live_customer_key' })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.adminIdentity.findFirst).not.toHaveBeenCalled();
  });

  it('rejects an unknown or revoked admin key', async () => {
    const prisma = { adminIdentity: { findFirst: vi.fn().mockResolvedValue(null), update: vi.fn() } };
    const guard = new AdminAuthGuard(prisma as never);

    await expect(
      guard.canActivate(contextWithHeaders({ 'x-admin-key': 'not-a-real-admin-key' })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.adminIdentity.update).not.toHaveBeenCalled();
  });
});
