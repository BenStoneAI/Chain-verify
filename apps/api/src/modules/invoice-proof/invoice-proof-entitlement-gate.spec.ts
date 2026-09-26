/**
 * InvoiceProofService — checkScanGate entitlement fix (Part 4)
 *
 * Proves that an authenticated user whose membership org holds an ACTIVE
 * INVOICE_PROOF entitlement gets unlimited scans, while users without an
 * entitlement (or with no membership at all) are still free-scan-gated.
 * Anonymous callers remain IP/email-gated, unchanged.
 *
 * Note: invoice-proof-scan.runner.ts transitively imports @swarmsync/proof-core
 * which the Jest module mapper cannot resolve for sub-path imports. We mock it
 * here (same approach as invoice-proof.service.spec.ts) so the service can load.
 */

jest.mock('./invoice-proof-scan.runner.js', () => ({
  hashFingerprint: jest.fn((v: string) => Buffer.from(v).toString('hex').slice(0, 64)),
  parseInvoiceScanBody: jest.fn(() => ({
    rows: [],
    vendorMaster: [],
    vendorMasterExtended: [],
    poRegister: [],
    seededHistory: [],
  })),
  runInvoiceScan: jest.fn(() => ({
    findings: [],
    findingCount: 0,
    rowCount: 0,
    coverage_summary: {},
  })),
}));

import { InvoiceProofService } from './invoice-proof.service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal AuthenticatedUser (JWT never carries organizationId). */
function makeUser(id: string): Parameters<InvoiceProofService['checkScanGate']>[0] {
  return { id, email: 'user@test.com', displayName: 'Test', role: 'USER', kind: 'user' };
}

type PrismaStub = {
  organizationMembership: {
    findMany: jest.Mock;
  };
  proofProductEntitlement: {
    findFirst: jest.Mock;
  };
  proofFreeScan: {
    findFirst: jest.Mock;
    create: jest.Mock;
  };
};

/**
 * Factory for InvoiceProofService with a configurable Prisma stub.
 * Only the methods exercised by checkScanGate are required.
 */
function makeService(prismaOverrides: Partial<PrismaStub> = {}): {
  service: InvoiceProofService;
  prisma: PrismaStub;
} {
  const prisma: PrismaStub = {
    organizationMembership: {
      findMany: jest.fn().mockResolvedValue([]),
      ...((prismaOverrides.organizationMembership as object) ?? {}),
    },
    proofProductEntitlement: {
      findFirst: jest.fn().mockResolvedValue(null),
      ...((prismaOverrides.proofProductEntitlement as object) ?? {}),
    },
    proofFreeScan: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(undefined),
      ...((prismaOverrides.proofFreeScan as object) ?? {}),
    },
  };

  const service = new InvoiceProofService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  return { service, prisma };
}

// ---------------------------------------------------------------------------
// PART 4 — checkScanGate entitlement via membership org
// ---------------------------------------------------------------------------

describe('InvoiceProofService.checkScanGate — entitlement gate (Part 4)', () => {
  // -------------------------------------------------------------------------
  // Case 1: authed user whose membership org has an ACTIVE INVOICE_PROOF
  // entitlement → unlimited (allowed: true, recordFreeScan: false)
  // -------------------------------------------------------------------------
  it('authed user with entitled membership org → allowed, no free-scan consumed', async () => {
    const { service } = makeService({
      organizationMembership: {
        findMany: jest.fn().mockResolvedValue([{ organizationId: 'org-entitled' }]),
      },
      proofProductEntitlement: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'ent-1',
          organizationId: 'org-entitled',
          product: 'INVOICE_PROOF',
          status: 'ACTIVE',
        }),
      },
    });

    const user = makeUser('user-a');
    const result = await service.checkScanGate(user, '1.2.3.4');

    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.recordFreeScan).toBe(false);
      expect(result.organizationId).toBe('org-entitled');
    }
  });

  // Repeat call — same result (no free-scan consumed on second call either)
  it('entitled user calling twice → both calls return allowed without consuming a free scan', async () => {
    const entitlementFindFirst = jest.fn().mockResolvedValue({
      id: 'ent-1',
      organizationId: 'org-entitled',
      product: 'INVOICE_PROOF',
      status: 'ACTIVE',
    });
    const freeScanFindFirst = jest.fn().mockResolvedValue(null);

    const { service } = makeService({
      organizationMembership: {
        findMany: jest.fn().mockResolvedValue([{ organizationId: 'org-entitled' }]),
      },
      proofProductEntitlement: { findFirst: entitlementFindFirst },
      proofFreeScan: { findFirst: freeScanFindFirst, create: jest.fn() },
    });

    const user = makeUser('user-a');
    const first = await service.checkScanGate(user, '1.2.3.4');
    const second = await service.checkScanGate(user, '1.2.3.4');

    expect(first.allowed).toBe(true);
    if (first.allowed) expect(first.recordFreeScan).toBe(false);

    expect(second.allowed).toBe(true);
    if (second.allowed) expect(second.recordFreeScan).toBe(false);

    // The free-scan table is never consulted when the entitlement gate passes.
    expect(freeScanFindFirst).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Case 2: authed user with a membership org but NO active entitlement
  // → still free-scan-gated (allowed once, then 402 on second call)
  // -------------------------------------------------------------------------
  it('authed user with membership org but no entitlement → first scan allowed, second gets 402', async () => {
    // Simulate: no entitlement exists; first scan not yet recorded
    const freeScanStore: Array<{ userId: string }> = [];
    const freeScanFindFirst = jest.fn().mockImplementation(async (args: { where: { userId: string } }) => {
      return freeScanStore.find((r) => r.userId === args.where.userId) ?? null;
    });
    const freeScanCreate = jest.fn().mockImplementation(async (args: { data: { userId: string } }) => {
      freeScanStore.push({ userId: args.data.userId });
    });

    const { service } = makeService({
      organizationMembership: {
        findMany: jest.fn().mockResolvedValue([{ organizationId: 'org-no-ent' }]),
      },
      proofProductEntitlement: {
        // No entitlement for any org
        findFirst: jest.fn().mockResolvedValue(null),
      },
      proofFreeScan: { findFirst: freeScanFindFirst, create: freeScanCreate },
    });

    const user = makeUser('user-b');

    // First scan → allowed, recordFreeScan: true
    const first = await service.checkScanGate(user, '5.5.5.5');
    expect(first.allowed).toBe(true);
    if (first.allowed) {
      expect(first.recordFreeScan).toBe(true);
    }

    // Simulate recording the free scan (as the controller would)
    await service.recordFreeScan(user, '5.5.5.5');

    // Second scan → 402 (free scan already used)
    const second = await service.checkScanGate(user, '5.5.5.5');
    expect(second.allowed).toBe(false);
    if (!second.allowed) {
      expect(second.status).toBe(402);
    }
  });

  // -------------------------------------------------------------------------
  // Case 3: authed user with NO membership → still free-scan-gated
  // -------------------------------------------------------------------------
  it('authed user with no org membership → first scan allowed, second gets 402', async () => {
    const freeScanStore: Array<{ userId: string }> = [];
    const freeScanFindFirst = jest.fn().mockImplementation(async (args: { where: { userId: string } }) => {
      return freeScanStore.find((r) => r.userId === args.where.userId) ?? null;
    });
    const freeScanCreate = jest.fn().mockImplementation(async (args: { data: { userId: string } }) => {
      freeScanStore.push({ userId: args.data.userId });
    });

    const { service } = makeService({
      organizationMembership: {
        // No memberships
        findMany: jest.fn().mockResolvedValue([]),
      },
      proofProductEntitlement: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      proofFreeScan: { findFirst: freeScanFindFirst, create: freeScanCreate },
    });

    const user = makeUser('user-c');

    const first = await service.checkScanGate(user, '6.6.6.6');
    expect(first.allowed).toBe(true);
    if (first.allowed) {
      expect(first.recordFreeScan).toBe(true);
    }

    await service.recordFreeScan(user, '6.6.6.6');

    const second = await service.checkScanGate(user, '6.6.6.6');
    expect(second.allowed).toBe(false);
    if (!second.allowed) {
      expect(second.status).toBe(402);
    }
  });

  // -------------------------------------------------------------------------
  // Case 4: anonymous (no user) → IP gate unchanged
  // -------------------------------------------------------------------------
  it('anonymous caller — first scan allowed by IP gate, second denied (403)', async () => {
    const freeScanStore: Array<{ ipHash: string }> = [];
    const freeScanFindFirst = jest.fn().mockImplementation(async (args: { where: { ipHash?: string } }) => {
      if (args.where.ipHash) {
        return freeScanStore.find((r) => r.ipHash === args.where.ipHash) ?? null;
      }
      return null;
    });
    const freeScanCreate = jest.fn().mockImplementation(async (args: { data: { ipHash: string } }) => {
      freeScanStore.push({ ipHash: args.data.ipHash });
    });

    const { service } = makeService({
      proofFreeScan: { findFirst: freeScanFindFirst, create: freeScanCreate },
    });

    // First scan (no user)
    const first = await service.checkScanGate(null, '7.7.7.7');
    expect(first.allowed).toBe(true);
    if (first.allowed) {
      expect(first.recordFreeScan).toBe(true);
    }

    // Record the free scan for the IP
    await service.recordFreeScan(null, '7.7.7.7');

    // Second scan — blocked by IP gate
    const second = await service.checkScanGate(null, '7.7.7.7');
    expect(second.allowed).toBe(false);
    if (!second.allowed) {
      expect(second.status).toBe(403);
    }

    // organizationMembership should never have been queried for anonymous calls
    // (no user object exists to query against)
  });

  // -------------------------------------------------------------------------
  // Preferred-org selection: when a user has multiple memberships, the
  // entitled org is preferred over the earliest org
  // -------------------------------------------------------------------------
  it('prefers entitled org over earliest membership org when user has multiple memberships', async () => {
    const entitlementFindFirst = jest.fn().mockImplementation(
      async (args: { where: { organizationId: string } }) => {
        // Only 'org-second' has an entitlement
        if (args.where.organizationId === 'org-second') {
          return { id: 'ent-2', organizationId: 'org-second', product: 'INVOICE_PROOF', status: 'ACTIVE' };
        }
        return null;
      },
    );

    const { service } = makeService({
      organizationMembership: {
        // org-first was joined earlier (appears first in asc order)
        findMany: jest.fn().mockResolvedValue([
          { organizationId: 'org-first' },
          { organizationId: 'org-second' },
        ]),
      },
      proofProductEntitlement: { findFirst: entitlementFindFirst },
    });

    const user = makeUser('user-d');
    const result = await service.checkScanGate(user, '8.8.8.8');

    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.recordFreeScan).toBe(false);
      expect(result.organizationId).toBe('org-second');
    }
  });
});

// ---------------------------------------------------------------------------
// PART 5 — resolveOrgId is now async and membership-aware
// ---------------------------------------------------------------------------

describe('InvoiceProofService.resolveOrgId — async membership-aware resolution (Part 5)', () => {
  it('returns undefined when user is null', async () => {
    const { service } = makeService();
    const result = await service.resolveOrgId(null);
    expect(result).toBeUndefined();
  });

  it('returns entitled membership org for a user with an ACTIVE INVOICE_PROOF entitlement', async () => {
    const { service } = makeService({
      organizationMembership: {
        findMany: jest.fn().mockResolvedValue([{ organizationId: 'org-entitled' }]),
      },
      proofProductEntitlement: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'ent-1',
          organizationId: 'org-entitled',
          product: 'INVOICE_PROOF',
          status: 'ACTIVE',
        }),
      },
    });

    const user = makeUser('user-a');
    const result = await service.resolveOrgId(user);
    // Must match the entitled membership org, not user.id
    expect(result).toBe('org-entitled');
  });

  it('returns earliest membership org (fallback) when no entitlement exists', async () => {
    const { service } = makeService({
      organizationMembership: {
        findMany: jest.fn().mockResolvedValue([
          { organizationId: 'org-early' },
          { organizationId: 'org-late' },
        ]),
      },
      proofProductEntitlement: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    });

    const user = makeUser('user-b');
    const result = await service.resolveOrgId(user);
    // No entitlement → falls back to earliest membership org
    expect(result).toBe('org-early');
  });

  it('falls back to user.id when user has no org memberships', async () => {
    const { service } = makeService({
      organizationMembership: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      proofProductEntitlement: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    });

    const user = makeUser('user-no-org');
    const result = await service.resolveOrgId(user);
    // resolveEntitledOrgId returns undefined → fallback is user.id
    expect(result).toBe('user-no-org');
  });

  it('prefers entitled org over the earliest membership when multiple memberships exist', async () => {
    const { service } = makeService({
      organizationMembership: {
        findMany: jest.fn().mockResolvedValue([
          { organizationId: 'org-first' },
          { organizationId: 'org-entitled' },
        ]),
      },
      proofProductEntitlement: {
        findFirst: jest.fn().mockImplementation(
          async (args: { where: { organizationId: string } }) => {
            if (args.where.organizationId === 'org-entitled') {
              return {
                id: 'ent-2',
                organizationId: 'org-entitled',
                product: 'INVOICE_PROOF',
                status: 'ACTIVE',
              };
            }
            return null;
          },
        ),
      },
    });

    const user = makeUser('user-c');
    const result = await service.resolveOrgId(user);
    expect(result).toBe('org-entitled');
  });
});
