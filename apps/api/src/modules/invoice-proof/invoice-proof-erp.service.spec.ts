/**
 * invoice-proof-erp.service.spec.ts
 *
 * Truth-labeling guard: asserts that pullProviderData (accessed via syncProvider) cannot
 * be presented as a successful real sync. All providers must return live=false and zero
 * import counts while real ERP API calls are not implemented.
 */

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ErpProvider } from '@prisma/client';

import { InvoiceProofErpService } from './invoice-proof-erp.service.js';

// ---------------------------------------------------------------------------
// Minimal Prisma mock — only the tables the service touches
// ---------------------------------------------------------------------------
function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    orgErpConnection: {
      upsert: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    orgVendorMaster: {
      count: jest.fn().mockResolvedValue(0),
    },
    orgPoRegister: {
      count: jest.fn().mockResolvedValue(0),
    },
    ...overrides,
  };
}

// Encrypt/decrypt helpers are used by the service for token storage.
// We mock the module so tests don't need a real encryption key in env.
jest.mock('../outbound-deployment/credential-crypto.js', () => ({
  encryptCredentials: jest.fn((v: unknown) => JSON.stringify(v)),
  decryptCredentials: jest.fn((v: string) => {
    try {
      return JSON.parse(v);
    } catch {
      return {};
    }
  }),
}));

// ---------------------------------------------------------------------------
// Helper: build a connection row that looks authorized (token exchanged)
// ---------------------------------------------------------------------------
function authorizedConnection(provider: ErpProvider) {
  return {
    id: 'conn-1',
    organizationId: 'org-1',
    provider,
    realmId: 'realm-123',
    encryptedTokens: JSON.stringify({
      access_token: 'tok_abc',
      refresh_token: 'rtok_abc',
      obtainedAt: new Date().toISOString(),
      // pending is NOT set — this simulates a completed OAuth callback
    }),
    lastSyncAt: null,
    lastSyncStatus: null,
    createdAt: new Date(),
  };
}

// ---------------------------------------------------------------------------
// SECTION 1 — pullProviderData always returns live=false
// ---------------------------------------------------------------------------

describe('InvoiceProofErpService — pullProviderData is a stub (truth-labeling)', () => {
  const providers: ErpProvider[] = [
    ErpProvider.QUICKBOOKS,
    ErpProvider.XERO,
    ErpProvider.SAGE,
    ErpProvider.NETSUITE,
    ErpProvider.BILLDOTCOM,
  ];

  for (const provider of providers) {
    it(`${provider}: syncProvider sets lastSyncStatus to SANDBOX_PENDING and returns live=false`, async () => {
      const prisma = makePrisma({
        orgErpConnection: {
          findUnique: jest.fn().mockResolvedValue(authorizedConnection(provider)),
          update: jest.fn().mockResolvedValue({}),
        },
        orgVendorMaster: { count: jest.fn().mockResolvedValue(0) },
        orgPoRegister: { count: jest.fn().mockResolvedValue(0) },
      });

      const service = new InvoiceProofErpService(prisma as never);
      const result = await service.syncProvider('org-1', provider);

      // Must NOT claim real data was imported
      expect(result.live).toBe(false);
      expect(result.vendors).toBe(0);
      expect(result.pos).toBe(0);
      expect(result.bills).toBe(0);
      expect(result.message).toMatch(/sandbox pending/i);

      // DB status must be honest — not 'OK' or 'CONNECTED' or 'SCHEDULED'
      const updateCall = (prisma.orgErpConnection.update as jest.Mock).mock.calls[0][0];
      expect(updateCall.data.lastSyncStatus).toBe('SANDBOX_PENDING');
    });
  }
});

// ---------------------------------------------------------------------------
// SECTION 2 — pending token (pre-callback) is handled without error
// ---------------------------------------------------------------------------

describe('InvoiceProofErpService — pending connection (pre-OAuth-callback)', () => {
  it('syncProvider with pending token still returns live=false and zero counts', async () => {
    const pendingConn = {
      ...authorizedConnection(ErpProvider.QUICKBOOKS),
      encryptedTokens: JSON.stringify({ state: 'abc', pkceVerifier: 'xyz', pending: true }),
    };

    const prisma = makePrisma({
      orgErpConnection: {
        findUnique: jest.fn().mockResolvedValue(pendingConn),
        update: jest.fn().mockResolvedValue({}),
      },
      orgVendorMaster: { count: jest.fn().mockResolvedValue(0) },
      orgPoRegister: { count: jest.fn().mockResolvedValue(0) },
    });

    const service = new InvoiceProofErpService(prisma as never);
    const result = await service.syncProvider('org-1', ErpProvider.QUICKBOOKS);

    expect(result.live).toBe(false);
    expect(result.vendors).toBe(0);
    expect(result.pos).toBe(0);
    expect(result.bills).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// SECTION 3 — startConnect returns authUrl=null for providers that cannot OAuth
// ---------------------------------------------------------------------------

describe('InvoiceProofErpService — startConnect for non-OAuth providers', () => {
  it('NetSuite startConnect returns authUrl null and an explanatory message', async () => {
    // NetSuite env vars are not set in test — we need to provide them or the service throws.
    // Provide dummy values so the guard passes.
    process.env.NETSUITE_CONSUMER_KEY = 'dummy-key';
    process.env.NETSUITE_CONSUMER_SECRET = 'dummy-secret';

    const prisma = makePrisma({
      orgErpConnection: {
        upsert: jest.fn().mockResolvedValue({}),
      },
    });

    const service = new InvoiceProofErpService(prisma as never);
    const result = await service.startConnect('org-1', 'netsuite');

    expect(result.authUrl).toBeNull();
    expect(result.message).toBeTruthy();

    delete process.env.NETSUITE_CONSUMER_KEY;
    delete process.env.NETSUITE_CONSUMER_SECRET;
  });

  it('Bill.com startConnect returns authUrl null and an explanatory message', async () => {
    process.env.BILLDOTCOM_APP_KEY = 'dummy-key';
    process.env.BILLDOTCOM_APP_SECRET = 'dummy-secret';

    const prisma = makePrisma({
      orgErpConnection: {
        upsert: jest.fn().mockResolvedValue({}),
      },
    });

    const service = new InvoiceProofErpService(prisma as never);
    const result = await service.startConnect('org-1', 'billdotcom');

    expect(result.authUrl).toBeNull();
    expect(result.message).toBeTruthy();

    delete process.env.BILLDOTCOM_APP_KEY;
    delete process.env.BILLDOTCOM_APP_SECRET;
  });
});

// ---------------------------------------------------------------------------
// SECTION 4 — connection not found throws NotFoundException
// ---------------------------------------------------------------------------

describe('InvoiceProofErpService — syncProvider with missing connection', () => {
  it('throws NotFoundException when connection does not exist', async () => {
    const prisma = makePrisma({
      orgErpConnection: {
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
    });

    const service = new InvoiceProofErpService(prisma as never);
    await expect(service.syncProvider('org-missing', ErpProvider.QUICKBOOKS)).rejects.toThrow(
      NotFoundException,
    );
  });
});

// ---------------------------------------------------------------------------
// SECTION 5 — normalizeProvider rejects unknown strings
// ---------------------------------------------------------------------------

describe('InvoiceProofErpService — normalizeProvider', () => {
  it('throws BadRequestException for an unknown provider string', () => {
    const service = new InvoiceProofErpService({} as never);
    expect(() => service.normalizeProvider('sap')).toThrow(BadRequestException);
  });

  it('normalises "bill.com" (with dot) to BILLDOTCOM', () => {
    const service = new InvoiceProofErpService({} as never);
    // "bill.com" → uppercase → "BILL.COM"; after replace(/-/g,'') still has dot.
    // The canonical input is 'billdotcom' or 'billcom'; dot is not handled — this test
    // confirms the current surface so regressions are caught.
    expect(() => service.normalizeProvider('bill.com')).toThrow(BadRequestException);
  });
});
