/**
 * InvoiceProofService — checkScanGate entitlement fix (Part 4)
 *
 * Proves that an authenticated user carrying an explicit organizationId with
 * an ACTIVE INVOICE_PROOF entitlement gets unlimited scans, while users
 * without an entitlement (or without an organizationId at all) are still
 * free-scan-gated. Anonymous callers remain IP/email-gated, unchanged.
 *
 * Standalone-build note: resolveEntitledOrgId no longer resolves org
 * membership via a Prisma join (there is no OrganizationMembership model in
 * the Chain Verify schema — the shared auth/membership system was not
 * carried over, see EXTRACTION.md). It only honors an explicit
 * `user.organizationId`, which the current JWT strategy never sets (see the
 * doc comment on resolveEntitledOrgId in invoice-proof.service.ts: "currently
 * always undefined"). These tests exercise that real, current contract
 * directly rather than the removed membership-lookup behavior.
 *
 * Note: invoice-proof-scan.runner.ts transitively imports @chain-verify/proof-core
 * which the Jest module mapper cannot resolve for sub-path imports. We mock it
 * here (same approach as invoice-proof.service.spec.ts) so the service can load.
 */

import { describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('./invoice-proof-scan.runner.js', () => ({
  hashFingerprint: vi.fn((v: string) => Buffer.from(v).toString('hex').slice(0, 64)),
  parseInvoiceScanBody: vi.fn(() => ({
    rows: [],
    vendorMaster: [],
    vendorMasterExtended: [],
    poRegister: [],
    seededHistory: [],
  })),
  runInvoiceScan: vi.fn(() => ({
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

/** Build a minimal AuthenticatedUser. organizationId is optional and, per
 * the current JWT strategy, normally absent. */
function makeUser(id: string, organizationId?: string): Parameters<InvoiceProofService['checkScanGate']>[0] {
  return { id, email: 'user@test.com', organizationId };
}

type PrismaStub = {
  proofProductEntitlement: {
    findFirst: Mock;
  };
  proofFreeScan: {
    findFirst: Mock;
    create: Mock;
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
    proofProductEntitlement: {
      findFirst: vi.fn().mockResolvedValue(null),
      ...((prismaOverrides.proofProductEntitlement as object) ?? {}),
    },
    proofFreeScan: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(undefined),
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
// PART 4 — checkScanGate entitlement via an explicit organizationId
// ---------------------------------------------------------------------------

describe('InvoiceProofService.checkScanGate — entitlement gate (Part 4)', () => {
  // -------------------------------------------------------------------------
  // Case 1: authed user with an explicit organizationId that has an ACTIVE
  // INVOICE_PROOF entitlement → unlimited (allowed: true, recordFreeScan: false)
  // -------------------------------------------------------------------------
  it('authed user with an entitled organizationId → allowed, no free-scan consumed', async () => {
    const { service } = makeService({
      proofProductEntitlement: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'ent-1',
          organizationId: 'org-entitled',
          product: 'INVOICE_PROOF',
          status: 'ACTIVE',
        }),
      },
    });

    const user = makeUser('user-a', 'org-entitled');
    const result = await service.checkScanGate(user, '1.2.3.4');

    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.recordFreeScan).toBe(false);
      expect(result.organizationId).toBe('org-entitled');
    }
  });

  // Repeat call — same result (no free-scan consumed on second call either)
  it('entitled user calling twice → both calls return allowed without consuming a free scan', async () => {
    const entitlementFindFirst = vi.fn().mockResolvedValue({
      id: 'ent-1',
      organizationId: 'org-entitled',
      product: 'INVOICE_PROOF',
      status: 'ACTIVE',
    });
    const freeScanFindFirst = vi.fn().mockResolvedValue(null);

    const { service } = makeService({
      proofProductEntitlement: { findFirst: entitlementFindFirst },
      proofFreeScan: { findFirst: freeScanFindFirst, create: vi.fn() },
    });

    const user = makeUser('user-a', 'org-entitled');
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
  // Case 2: authed user with an organizationId but NO active entitlement
  // → still free-scan-gated (allowed once, then 402 on second call)
  // -------------------------------------------------------------------------
  it('authed user with organizationId but no entitlement → first scan allowed, second gets 402', async () => {
    const freeScanStore: Array<{ userId: string }> = [];
    const freeScanFindFirst = vi.fn().mockImplementation(async (args: { where: { userId: string } }) => {
      return freeScanStore.find((r) => r.userId === args.where.userId) ?? null;
    });
    const freeScanCreate = vi.fn().mockImplementation(async (args: { data: { userId: string } }) => {
      freeScanStore.push({ userId: args.data.userId });
    });

    const { service } = makeService({
      proofProductEntitlement: {
        // No entitlement for this org
        findFirst: vi.fn().mockResolvedValue(null),
      },
      proofFreeScan: { findFirst: freeScanFindFirst, create: freeScanCreate },
    });

    const user = makeUser('user-b', 'org-no-ent');

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
  // Case 3: authed user with NO organizationId → still free-scan-gated, and
  // the entitlement table is never even queried (there's nothing to resolve).
  // -------------------------------------------------------------------------
  it('authed user with no organizationId → first scan allowed, second gets 402, entitlement never queried', async () => {
    const freeScanStore: Array<{ userId: string }> = [];
    const freeScanFindFirst = vi.fn().mockImplementation(async (args: { where: { userId: string } }) => {
      return freeScanStore.find((r) => r.userId === args.where.userId) ?? null;
    });
    const freeScanCreate = vi.fn().mockImplementation(async (args: { data: { userId: string } }) => {
      freeScanStore.push({ userId: args.data.userId });
    });
    const entitlementFindFirst = vi.fn().mockResolvedValue(null);

    const { service } = makeService({
      proofProductEntitlement: { findFirst: entitlementFindFirst },
      proofFreeScan: { findFirst: freeScanFindFirst, create: freeScanCreate },
    });

    const user = makeUser('user-c');

    const first = await service.checkScanGate(user, '6.6.6.6');
    expect(first.allowed).toBe(true);
    if (first.allowed) {
      expect(first.recordFreeScan).toBe(true);
    }
    expect(entitlementFindFirst).not.toHaveBeenCalled();

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
    const freeScanFindFirst = vi.fn().mockImplementation(async (args: { where: { ipHash?: string } }) => {
      if (args.where.ipHash) {
        return freeScanStore.find((r) => r.ipHash === args.where.ipHash) ?? null;
      }
      return null;
    });
    const freeScanCreate = vi.fn().mockImplementation(async (args: { data: { ipHash: string } }) => {
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
  });
});

// ---------------------------------------------------------------------------
// PART 5 — resolveOrgId
// ---------------------------------------------------------------------------

describe('InvoiceProofService.resolveOrgId (Part 5)', () => {
  it('returns undefined when user is null', async () => {
    const { service } = makeService();
    const result = await service.resolveOrgId(null);
    expect(result).toBeUndefined();
  });

  it('returns the explicit user.organizationId when set', async () => {
    const { service } = makeService();
    const user = makeUser('user-a', 'org-explicit');
    const result = await service.resolveOrgId(user);
    expect(result).toBe('org-explicit');
  });

  it('falls back to user.id when user has no organizationId', async () => {
    const { service } = makeService();
    const user = makeUser('user-no-org');
    const result = await service.resolveOrgId(user);
    expect(result).toBe('user-no-org');
  });
});
