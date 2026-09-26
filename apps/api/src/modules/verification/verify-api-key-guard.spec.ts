/**
 * Regression test for C1: VerifyAPI key guard was broken because VerificationModule
 * did not import AuthModule, leaving ServiceAccountsService injected as null.
 *
 * The fix: Added AuthModule to VerificationModule imports so ServiceAccountsService
 * is resolved instead of being null.
 *
 * These tests fail if the guard reverts to its broken state (serviceAccounts === null
 * when an API key is supplied on a protected route).
 */

import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { ServiceAccountsService } from '../auth/service-accounts.service.js';

// Minimal mock of the Reflector — routes under test are NOT public.
function makeReflector(isPublic = false): Reflector {
  return {
    getAllAndOverride: jest.fn().mockReturnValue(isPublic),
  } as unknown as Reflector;
}

// Build an ExecutionContext with a fake request.
function makeContext(headers: Record<string, string> = {}): ExecutionContext {
  const request = { headers, user: undefined as unknown };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard — C1 regression: ServiceAccountsService null injection', () => {
  /**
   * Documents the broken state: when ServiceAccountsService is null (as it was
   * before AuthModule was added to VerificationModule), presenting an API key on
   * a protected route must throw UnauthorizedException — not silently pass or
   * fall through to JWT validation.
   */
  it('throws UnauthorizedException when serviceAccounts is null and an API key is supplied', async () => {
    // Simulate the broken state: @Optional() injects null
    const guard = new JwtAuthGuard(null, makeReflector(false));
    const ctx = makeContext({ 'x-api-key': 'sa_abc123' });

    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(ctx)).rejects.toThrow(
      'API key authentication is unavailable',
    );
  });

  /**
   * Proves the fix: when ServiceAccountsService IS provided (as happens once
   * AuthModule is imported by VerificationModule), a valid key returns true and
   * sets request.user.
   */
  it('returns true and sets request.user when serviceAccounts resolves a valid key', async () => {
    const mockUser = {
      id: 'service-account:sa-001',
      email: 'my-bot@service-account.agent-market',
      displayName: 'my-bot',
      kind: 'service_account' as const,
      serviceAccountId: 'sa-001',
      organizationId: 'org-xyz',
      scopes: ['verify:run'],
    };

    const mockServiceAccounts: Partial<ServiceAccountsService> = {
      validateApiKey: jest.fn().mockResolvedValue(mockUser),
    };

    const guard = new JwtAuthGuard(
      mockServiceAccounts as ServiceAccountsService,
      makeReflector(false),
    );

    const request = { headers: { 'x-api-key': 'sa_validkey' }, user: undefined as unknown };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;

    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(request.user).toEqual(mockUser);
    expect(mockServiceAccounts.validateApiKey).toHaveBeenCalledWith('sa_validkey');
  });

  /**
   * A valid-looking service account key that doesn't exist in the DB must
   * throw UnauthorizedException (not silently pass).
   */
  it('throws UnauthorizedException when validateApiKey returns null (key not found)', async () => {
    const mockServiceAccounts: Partial<ServiceAccountsService> = {
      validateApiKey: jest.fn().mockResolvedValue(null),
    };

    const guard = new JwtAuthGuard(
      mockServiceAccounts as ServiceAccountsService,
      makeReflector(false),
    );

    const ctx = makeContext({ 'x-api-key': 'sa_unknownkey' });

    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(ctx)).rejects.toThrow('Invalid API key');
  });
});
