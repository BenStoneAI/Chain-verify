/**
 * Admin backend — guard auth and service mutation/audit-log coverage.
 *
 * Follows the repo's existing unit-test convention (see
 * invoice-proof-entitlement-gate.spec.ts): a minimal Prisma stub built with
 * vi.fn(), not a live database connection, so these run in plain `vitest run`
 * without any test-DB setup. The stub's `$transaction` implementation below
 * is what proves the "audit log written on every mutation" requirement: it
 * runs the callback against the same stub tx, so if a mutation forgot to
 * call recordAuditLog, the corresponding assertion on adminAuditLog.create
 * would fail.
 */
import { describe, expect, it, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';

import { AdminAuthGuard } from './admin-auth.guard.js';
import { AdminService } from './admin.service.js';

// ---------------------------------------------------------------------------
// Shared Prisma stub
// ---------------------------------------------------------------------------

function makePrismaStub() {
  const state = {
    adminIdentities: new Map<string, { id: string; apiKeyHash: string; active: boolean; lastUsedAt: Date | null }>(),
    organizations: new Map<string, { id: string; name: string; slug: string; createdAt: Date }>(),
    apiIdentities: new Map<string, { id: string; organizationId: string; label: string | null; apiKeyHash: string; active: boolean; lastUsedAt: Date | null; createdAt: Date }>(),
    auditLogs: [] as Array<{ id: string; adminIdentityId: string; action: string; reason: string; metadata: unknown; createdAt: Date }>,
  };

  let idCounter = 0;
  const nextId = (prefix: string) => `${prefix}-${++idCounter}`;

  const adminIdentity = {
    findFirst: vi.fn(async ({ where }: { where: { apiKeyHash: string; active: boolean } }) => {
      for (const row of state.adminIdentities.values()) {
        if (row.apiKeyHash === where.apiKeyHash && row.active === where.active) return row;
      }
      return null;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<{ lastUsedAt: Date }> }) => {
      const row = state.adminIdentities.get(where.id);
      if (!row) throw new Error('not found');
      Object.assign(row, data);
      return row;
    }),
  };

  const organization = {
    findMany: vi.fn(async () => Array.from(state.organizations.values())),
    findUnique: vi.fn(async ({ where }: { where: { id?: string; slug?: string } }) => {
      for (const row of state.organizations.values()) {
        if (where.id && row.id === where.id) return row;
        if (where.slug && row.slug === where.slug) return row;
      }
      return null;
    }),
    create: vi.fn(async ({ data }: { data: { name: string; slug: string } }) => {
      const row = { id: nextId('org'), name: data.name, slug: data.slug, createdAt: new Date() };
      state.organizations.set(row.id, row);
      return row;
    }),
    count: vi.fn(async () => state.organizations.size),
  };

  // Mirrors real Prisma: a `select` clause narrows the returned shape. This is
  // what proves listApiKeys/revokeApiKey never leak apiKeyHash — if the
  // service forgot to pass `select`, these tests would see the hash.
  function applySelect<T extends Record<string, unknown>>(row: T, select?: Record<string, boolean>): T {
    if (!select) return row;
    return Object.fromEntries(Object.entries(row).filter(([key]) => select[key])) as T;
  }

  const apiIdentity = {
    findUnique: vi.fn(
      async ({ where, select }: { where: { id: string }; select?: Record<string, boolean> }) => {
        const row = state.apiIdentities.get(where.id);
        return row ? applySelect(row, select) : null;
      },
    ),
    findMany: vi.fn(
      async ({
        where,
        select,
      }: {
        where: { organizationId: string };
        select?: Record<string, boolean>;
      }) => {
        const rows = Array.from(state.apiIdentities.values()).filter(
          (row) => row.organizationId === where.organizationId,
        );
        return rows.map((row) => applySelect(row, select));
      },
    ),
    count: vi.fn(async ({ where }: { where: { organizationId?: string; active?: boolean } }) =>
      Array.from(state.apiIdentities.values()).filter(
        (row) =>
          (where.organizationId === undefined || row.organizationId === where.organizationId) &&
          (where.active === undefined || row.active === where.active),
      ).length,
    ),
    create: vi.fn(async ({ data }: { data: { organizationId: string; label: string | null; apiKeyHash: string } }) => {
      const row = {
        id: nextId('key'),
        organizationId: data.organizationId,
        label: data.label,
        apiKeyHash: data.apiKeyHash,
        active: true,
        lastUsedAt: null,
        createdAt: new Date(),
      };
      state.apiIdentities.set(row.id, row);
      return row;
    }),
    update: vi.fn(
      async ({
        where,
        data,
        select,
      }: {
        where: { id: string };
        data: Partial<{ active: boolean }>;
        select?: Record<string, boolean>;
      }) => {
        const row = state.apiIdentities.get(where.id);
        if (!row) throw new Error('not found');
        Object.assign(row, data);
        return applySelect(row, select);
      },
    ),
  };

  const verificationRun = {
    count: vi.fn(async () => 0),
    findMany: vi.fn(async () => []),
    groupBy: vi.fn(async () => []),
  };

  const adminAuditLog = {
    create: vi.fn(async ({ data }: { data: { adminIdentityId: string; action: string; reason: string; metadata: unknown } }) => {
      const row = { id: nextId('audit'), createdAt: new Date(), ...data };
      state.auditLogs.push(row);
      return row;
    }),
    findMany: vi.fn(async () =>
      state.auditLogs
        .slice()
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((row) => ({ ...row, adminIdentity: { label: 'Test Admin' } })),
    ),
  };

  const prisma = {
    adminIdentity,
    organization,
    apiIdentity,
    verificationRun,
    adminAuditLog,
    // Mirrors the real $transaction(callback) overload: runs the callback
    // against this same stub, so writes inside it land in the same state map
    // and are visible to assertions afterward exactly as a real Postgres
    // transaction commit would be.
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
  };

  return { prisma, state, seedAdmin: (row: { id: string; apiKeyHash: string; active?: boolean }) => {
    state.adminIdentities.set(row.id, { active: true, lastUsedAt: null, ...row });
  } };
}

// ---------------------------------------------------------------------------
// AdminAuthGuard
// ---------------------------------------------------------------------------

function makeContext(headers: Record<string, string>) {
  const request: { headers: Record<string, string>; admin?: unknown } = { headers };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;
}

describe('AdminAuthGuard', () => {
  it('401s when x-admin-key header is missing', async () => {
    const { prisma } = makePrismaStub();
    const guard = new AdminAuthGuard(prisma as never);
    await expect(guard.canActivate(makeContext({}))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('401s when x-admin-key does not match any active AdminIdentity', async () => {
    const { prisma } = makePrismaStub();
    const guard = new AdminAuthGuard(prisma as never);
    await expect(
      guard.canActivate(makeContext({ 'x-admin-key': 'cv_admin_wrong' })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('401s when the matching key belongs to a revoked (inactive) AdminIdentity', async () => {
    const { prisma, seedAdmin } = makePrismaStub();
    const { createHash } = await import('node:crypto');
    const rawKey = 'cv_admin_revoked';
    // Same hash a valid key would have — only `active: false` distinguishes
    // it. Proves revocation actually locks the key out, not just a hash miss.
    seedAdmin({ id: 'admin-1', apiKeyHash: createHash('sha256').update(rawKey).digest('hex'), active: false });
    const guard = new AdminAuthGuard(prisma as never);
    await expect(
      guard.canActivate(makeContext({ 'x-admin-key': rawKey })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('attaches req.admin and updates lastUsedAt for a valid, active key', async () => {
    const { prisma, seedAdmin } = makePrismaStub();
    const { createHash } = await import('node:crypto');
    const rawKey = 'cv_admin_valid';
    seedAdmin({ id: 'admin-1', apiKeyHash: createHash('sha256').update(rawKey).digest('hex') });

    const guard = new AdminAuthGuard(prisma as never);
    const request: { headers: Record<string, string>; admin?: unknown } = { headers: { 'x-admin-key': rawKey } };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as never;

    const result = await guard.canActivate(context);
    expect(result).toBe(true);
    expect((request.admin as { id: string }).id).toBe('admin-1');
    expect(prisma.adminIdentity.update).toHaveBeenCalledWith({
      where: { id: 'admin-1' },
      data: { lastUsedAt: expect.any(Date) },
    });
  });
});

// ---------------------------------------------------------------------------
// AdminService — mutations always write an audit log entry
// ---------------------------------------------------------------------------

describe('AdminService — createApiKey (happy path)', () => {
  it('creates an ApiIdentity, returns the raw key exactly once, and writes a CREATE_API_KEY audit entry', async () => {
    const { prisma, state } = makePrismaStub();
    state.organizations.set('org-1', { id: 'org-1', name: 'Acme', slug: 'acme', createdAt: new Date() });
    const service = new AdminService(prisma as never);

    const result = await service.createApiKey('org-1', 'CI key', 'Provisioning CI access', 'admin-1');

    expect(result.apiKey).toMatch(/^cv_live_[0-9a-f]{64}$/);
    expect(result.organizationId).toBe('org-1');

    const stored = Array.from(state.apiIdentities.values());
    expect(stored).toHaveLength(1);
    expect(stored[0].apiKeyHash).not.toBe(result.apiKey); // never stored in plaintext

    expect(state.auditLogs).toHaveLength(1);
    expect(state.auditLogs[0]).toMatchObject({
      adminIdentityId: 'admin-1',
      action: 'CREATE_API_KEY',
      reason: 'Provisioning CI access',
    });
  });

  it('rejects an empty reason before any mutation happens', async () => {
    const { prisma, state } = makePrismaStub();
    state.organizations.set('org-1', { id: 'org-1', name: 'Acme', slug: 'acme', createdAt: new Date() });
    const service = new AdminService(prisma as never);

    await expect(service.createApiKey('org-1', 'CI key', '   ', 'admin-1')).rejects.toThrow(/reason/i);
    expect(state.apiIdentities.size).toBe(0);
    expect(state.auditLogs).toHaveLength(0);
  });

  it('404s for an unknown organizationId', async () => {
    const { prisma } = makePrismaStub();
    const service = new AdminService(prisma as never);
    await expect(service.createApiKey('missing-org', 'label', 'reason', 'admin-1')).rejects.toThrow();
  });
});

describe('AdminService — every mutation writes an audit log entry', () => {
  it('createOrganization writes a CREATE_ORG entry', async () => {
    const { prisma, state } = makePrismaStub();
    const service = new AdminService(prisma as never);

    const org = await service.createOrganization('New Co', 'new-co', 'Onboarding new customer', 'admin-1');

    expect(state.auditLogs).toHaveLength(1);
    expect(state.auditLogs[0]).toMatchObject({ action: 'CREATE_ORG', adminIdentityId: 'admin-1' });
    expect((state.auditLogs[0].metadata as { organizationId: string }).organizationId).toBe(org.id);
  });

  it('revokeApiKey writes a REVOKE_API_KEY entry and does not delete the row', async () => {
    const { prisma, state } = makePrismaStub();
    state.organizations.set('org-1', { id: 'org-1', name: 'Acme', slug: 'acme', createdAt: new Date() });
    const service = new AdminService(prisma as never);
    const created = await service.createApiKey('org-1', 'key', 'issue key', 'admin-1');

    const revoked = await service.revokeApiKey(created.id, 'Key compromised', 'admin-1');

    expect(revoked.active).toBe(false);
    expect(state.apiIdentities.has(created.id)).toBe(true); // never deleted
    expect(state.auditLogs.map((l) => l.action)).toEqual(['CREATE_API_KEY', 'REVOKE_API_KEY']);
  });

  it('revoking an already-revoked key is idempotent and does not write a duplicate audit entry', async () => {
    const { prisma, state } = makePrismaStub();
    state.organizations.set('org-1', { id: 'org-1', name: 'Acme', slug: 'acme', createdAt: new Date() });
    const service = new AdminService(prisma as never);
    const created = await service.createApiKey('org-1', 'key', 'issue key', 'admin-1');

    await service.revokeApiKey(created.id, 'first revoke', 'admin-1');
    const second = await service.revokeApiKey(created.id, 'second revoke attempt', 'admin-1');

    expect(state.auditLogs.filter((l) => l.action === 'REVOKE_API_KEY')).toHaveLength(1);
    expect(second).not.toHaveProperty('apiKeyHash'); // idempotent-return path must stay redacted too
  });

  it('revokeApiKey never returns apiKeyHash on the mutating path either', async () => {
    const { prisma, state } = makePrismaStub();
    state.organizations.set('org-1', { id: 'org-1', name: 'Acme', slug: 'acme', createdAt: new Date() });
    const service = new AdminService(prisma as never);
    const created = await service.createApiKey('org-1', 'key', 'issue key', 'admin-1');

    const revoked = await service.revokeApiKey(created.id, 'Key compromised', 'admin-1');

    expect(revoked).not.toHaveProperty('apiKeyHash');
  });

  it('listApiKeys never returns apiKeyHash', async () => {
    const { prisma, state } = makePrismaStub();
    state.organizations.set('org-1', { id: 'org-1', name: 'Acme', slug: 'acme', createdAt: new Date() });
    const service = new AdminService(prisma as never);
    await service.createApiKey('org-1', 'key', 'issue key', 'admin-1');

    const keys = await service.listApiKeys('org-1');
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toHaveProperty('apiKeyHash');
    expect(keys[0]).not.toHaveProperty('apiKey');
  });

  it('getOverview surfaces the most recent audit entries', async () => {
    const { prisma, state } = makePrismaStub();
    const service = new AdminService(prisma as never);
    await service.createOrganization('Co A', 'co-a', 'setup', 'admin-1');

    const overview = await service.getOverview();
    expect(overview.totalOrganizations).toBe(1);
    expect(overview.recentAuditLog).toHaveLength(1);
    expect(overview.recentAuditLog[0].action).toBe('CREATE_ORG');
  });
});
