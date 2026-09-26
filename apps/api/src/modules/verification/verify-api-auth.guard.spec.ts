import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { SwarmScoreApiKeysService } from '../swarmscore-api/swarmscore-api-keys.service.js';
import { VerifyApiAuthGuard } from './verify-api-auth.guard.js';

function ctxWithHeaders(headers: Record<string, string>): ExecutionContext {
  const req: { headers: Record<string, string>; user?: unknown } = { headers };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function getReq(ctx: ExecutionContext): { user?: unknown } {
  return ctx.switchToHttp().getRequest();
}

describe('VerifyApiAuthGuard — ssk_live_ key auth', () => {
  const ACTIVE_KEY = 'ssk_live_active000000000000000000';

  function makePrisma(overrides: Record<string, unknown> = {}) {
    return {
      swarmScoreApiKey: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'key_1',
          userId: 'user_1',
          keyPrefix: 'ssk_live_acti',
          status: 'ACTIVE',
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user_1',
          email: 'dev@acme.com',
          displayName: 'Acme Dev',
          role: 'USER',
          userType: 'HUMAN',
        }),
      },
      ...overrides,
    };
  }

  function makeGuard(prisma: unknown) {
    return new VerifyApiAuthGuard(null, new Reflector(), prisma as never);
  }

  it('authenticates an ACTIVE ssk_live_ key via Authorization: Bearer and sets request.user', async () => {
    const prisma = makePrisma();
    const guard = makeGuard(prisma);
    const ctx = ctxWithHeaders({ authorization: `Bearer ${ACTIVE_KEY}` });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    const user = getReq(ctx).user as { id: string; kind: string };
    expect(user.id).toBe('user_1');
    expect(user.kind).toBe('service_account');
    expect(prisma.swarmScoreApiKey.update).toHaveBeenCalled(); // usage stamp
  });

  it('authenticates an ACTIVE ssk_live_ key via X-API-Key header', async () => {
    const prisma = makePrisma();
    const guard = makeGuard(prisma);
    const ctx = ctxWithHeaders({ 'x-api-key': ACTIVE_KEY });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect((getReq(ctx).user as { id: string }).id).toBe('user_1');
  });

  it('rejects a revoked key cleanly (401)', async () => {
    const prisma = makePrisma();
    prisma.swarmScoreApiKey.findUnique.mockResolvedValue({
      id: 'key_1',
      userId: 'user_1',
      keyPrefix: 'ssk_live_acti',
      status: 'REVOKED',
    });
    const guard = makeGuard(prisma);
    const ctx = ctxWithHeaders({ authorization: `Bearer ${ACTIVE_KEY}` });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an unknown/invalid key cleanly (401)', async () => {
    const prisma = makePrisma();
    prisma.swarmScoreApiKey.findUnique.mockResolvedValue(null);
    const guard = makeGuard(prisma);
    const ctx = ctxWithHeaders({ authorization: `Bearer ${ACTIVE_KEY}` });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('does not treat a JWT bearer token as an ssk key (delegates to JWT path)', async () => {
    const prisma = makePrisma();
    const guard = makeGuard(prisma);
    // A normal JWT (not ssk_live_) must not hit the SwarmScore key lookup.
    const ctx = ctxWithHeaders({ authorization: 'Bearer eyJhbGciOi.payload.sig' });
    // super.canActivate will run passport-jwt which, with no valid strategy in
    // this unit context, rejects — the key path must NOT have been consulted.
    await guard.canActivate(ctx).catch(() => undefined);
    expect(prisma.swarmScoreApiKey.findUnique).not.toHaveBeenCalled();
  });
});

describe('VerifyApiAuthGuard — sa_ service-account key fallback (POST /api/verify)', () => {
  // Bughound investigation (2026-07-08): confirms the documented fallback in the
  // class doc-comment ("Everything the standard JwtAuthGuard accepts … `sa_`
  // service-account keys") actually works end-to-end. This was previously
  // untested — verify-api-auth.guard.spec.ts only covered ssk_live_ keys plus one
  // test proving a JWT-shaped token skips the ssk lookup. Neither proved an sa_
  // key actually authenticates through the fallback on a NON-public route like
  // POST /api/verify.
  function makeReflector(isPublic = false): Reflector {
    return {
      getAllAndOverride: jest.fn().mockReturnValue(isPublic),
    } as unknown as Reflector;
  }

  function ctxWithHeadersAndReflector(headers: Record<string, string>): ExecutionContext {
    const req: { headers: Record<string, string>; user?: unknown } = { headers };
    return {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  }

  it('authenticates a valid ACTIVE sa_ service-account key on the non-public POST /api/verify guard chain', async () => {
    const mockUser = {
      id: 'service-account:sa-verify-001',
      email: 'ci-bot@service-account.agent-market',
      displayName: 'CI Bot',
      kind: 'service_account' as const,
      serviceAccountId: 'sa-verify-001',
      organizationId: 'org-abc',
      scopes: ['verify-api'],
    };
    const serviceAccounts = { validateApiKey: jest.fn().mockResolvedValue(mockUser) };
    const prisma = { swarmScoreApiKey: { findUnique: jest.fn() } };

    const guard = new VerifyApiAuthGuard(
      serviceAccounts as never,
      makeReflector(false),
      prisma as never,
    );
    const ctx = ctxWithHeadersAndReflector({ authorization: 'Bearer sa_realactivekey' });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(serviceAccounts.validateApiKey).toHaveBeenCalledWith('sa_realactivekey');
    // The ssk_live_ lookup must never be consulted for an sa_ key.
    expect(prisma.swarmScoreApiKey.findUnique).not.toHaveBeenCalled();
  });

  it('rejects an sa_ key with no matching ACTIVE ServiceAccount row with 401 "Invalid API key"', async () => {
    const serviceAccounts = { validateApiKey: jest.fn().mockResolvedValue(null) };
    const prisma = { swarmScoreApiKey: { findUnique: jest.fn() } };

    const guard = new VerifyApiAuthGuard(
      serviceAccounts as never,
      makeReflector(false),
      prisma as never,
    );
    const ctx = ctxWithHeadersAndReflector({ authorization: 'Bearer sa_unknownorrevoked' });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(guard.canActivate(ctx)).rejects.toThrow('Invalid API key');
  });
});

describe('VerifyApiAuthGuard — full round trip with SwarmScoreApiKeysService.create()', () => {
  // Regression proof for the dashboard "API Keys" page bug: the "VerifyAPI"
  // button called the Agent Market service-account endpoint and minted an
  // sa_... key, which this guard never accepts as a first-class VerifyAPI
  // credential (see the "sa_ service-account key fallback" suite above — that
  // path only exists because JwtAuthGuard.validateApiKey happens to also
  // accept sa_ keys, NOT because VerifyAPI's own key system produced them).
  //
  // The fix wires the dashboard's VerifyAPI button to
  // POST /v1/swarmscore/keys -> SwarmScoreApiKeysService.create(), which is
  // the ONLY function that mints ssk_live_ keys. This spec proves a key
  // produced by that real service authenticates end-to-end through this guard
  // — not a hand-rolled fixture string standing in for it.
  function buildKeysServiceWithFakePrisma() {
    const store = new Map<string, any>();
    let idCounter = 0;

    const prisma = {
      swarmScoreApiKey: {
        create: jest.fn(async ({ data }: any) => {
          idCounter += 1;
          const record = {
            id: `key-${idCounter}`,
            userId: data.userId,
            name: data.name,
            keyHash: data.keyHash,
            keyPrefix: data.keyPrefix,
            status: 'ACTIVE',
            callCount: 0,
            lastUsedAt: null,
            createdAt: new Date('2026-07-01T00:00:00.000Z'),
          };
          store.set(record.keyHash, record);
          return record;
        }),
        findUnique: jest.fn(async ({ where }: any) => store.get(where.keyHash) ?? null),
        findFirst: jest.fn(async ({ where }: any) =>
          [...store.values()].find((r) => r.id === where.id && r.userId === where.userId) ?? null,
        ),
        update: jest.fn(async ({ where, data }: any) => {
          const record = [...store.values()].find((r) => r.id === where.id);
          if (record) Object.assign(record, data);
          return record;
        }),
      },
      user: {
        findUnique: jest.fn(async ({ where }: any) =>
          where.id === 'user-1'
            ? {
                id: 'user-1',
                email: 'ben@example.com',
                displayName: 'Ben',
                role: 'USER',
                userType: 'HUMAN',
              }
            : null,
        ),
      },
    };

    const keysService = new SwarmScoreApiKeysService(prisma as any);
    return { prisma, keysService };
  }

  it('mints an ssk_live_ key via the real create() flow and authenticates it through VerifyApiAuthGuard', async () => {
    const { prisma, keysService } = buildKeysServiceWithFakePrisma();

    // Same call the fixed POST /v1/swarmscore/keys route makes.
    const created = await keysService.create('user-1', 'VerifyAPI Production Key');
    expect(created.api_key).toMatch(/^ssk_live_[0-9a-f]{64}$/);
    expect(created.api_key.startsWith('sa_')).toBe(false);

    const guard = new VerifyApiAuthGuard(null, new Reflector(), prisma as never);
    const ctx = ctxWithHeaders({ authorization: `Bearer ${created.api_key}` });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    const user = getReq(ctx).user as { id: string; kind: string };
    expect(user.id).toBe('user-1');
    expect(user.kind).toBe('service_account');
  });

  it('rejects the minted key after it is revoked via SwarmScoreApiKeysService.revoke()', async () => {
    const { prisma, keysService } = buildKeysServiceWithFakePrisma();
    const created = await keysService.create('user-1', 'VerifyAPI Key');
    await keysService.revoke('user-1', created.id);

    const guard = new VerifyApiAuthGuard(null, new Reflector(), prisma as never);
    const ctx = ctxWithHeaders({ authorization: `Bearer ${created.api_key}` });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
