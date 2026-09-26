/**
 * Vendor Portal OTP step-up verification tests.
 *
 * Proves the BEC-prevention gate: bank/routing changes through the vendor portal
 * REQUIRE a valid, unexpired, unconsumed OTP sent to the vendor's trusted email.
 *
 * Mock the scan runner to avoid @swarmsync/proof-core resolution issues (same
 * approach as the sibling invoice-proof.service.spec.ts).
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

import { createHash } from 'crypto';
import { InvoiceProofService } from './invoice-proof.service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ORG_ID = 'org-test-1';
const ORG_SLUG = 'acme-corp';
const VENDOR_NAME = 'Carolina Alloy Supply';
const PORTAL_TOKEN_ID = 'pt-1';
const PORTAL_TOKEN = 'a'.repeat(48);
const TRUSTED_EMAIL = 'accounts@carolinaalloy.com';

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

function makePrisma(overrides: {
  vendorContactEmail?: string | null;
  otpRows?: Array<Record<string, unknown>>;
} = {}) {
  const auditLogs: Array<Record<string, unknown>> = [];
  const createdOtps: Array<Record<string, unknown>> = [];
  const otpRows = overrides.otpRows ?? [];
  const updatedVendors: Array<Record<string, unknown>> = [];
  const createdVendors: Array<Record<string, unknown>> = [];

  const prisma = {
    organization: {
      findUnique: jest.fn().mockImplementation(async (args: { where: { slug?: string; id?: string } }) => {
        if (args.where.slug === ORG_SLUG || args.where.id === ORG_ID) {
          return { id: ORG_ID, name: 'Acme Corp', slug: ORG_SLUG };
        }
        return null;
      }),
    },
    vendorPortalToken: {
      findFirst: jest.fn().mockImplementation(async (args: {
        where: { organizationId: string; token: string; expiresAt?: { gt: Date } };
      }) => {
        if (args.where.token === PORTAL_TOKEN && args.where.organizationId === ORG_ID) {
          return {
            id: PORTAL_TOKEN_ID,
            organizationId: ORG_ID,
            vendorName: VENDOR_NAME,
            token: PORTAL_TOKEN,
            expiresAt: new Date(Date.now() + 86400000),
          };
        }
        return null;
      }),
      create: jest.fn(),
    },
    orgVendorMaster: {
      findFirst: jest.fn().mockImplementation(async () => {
        const email = overrides.vendorContactEmail;
        if (email === undefined) {
          // Default: vendor exists with trusted email
          return {
            id: 'vm-1',
            contactEmail: TRUSTED_EMAIL,
            vendorName: VENDOR_NAME,
            bankRoutingNumber: '021000021',
          };
        }
        if (email === null) {
          return { id: 'vm-1', contactEmail: null, vendorName: VENDOR_NAME };
        }
        return { id: 'vm-1', contactEmail: email, vendorName: VENDOR_NAME };
      }),
      update: jest.fn().mockImplementation(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        updatedVendors.push(args.data);
        return { id: args.where.id, ...args.data };
      }),
      create: jest.fn().mockImplementation(async (args: { data: Record<string, unknown> }) => {
        createdVendors.push(args.data);
        return { id: 'vm-new', ...args.data };
      }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    vendorPortalOtp: {
      create: jest.fn().mockImplementation(async (args: { data: Record<string, unknown> }) => {
        const otp = { id: `otp-${createdOtps.length + 1}`, attempts: 0, consumedAt: null, lockedAt: null, ...args.data };
        createdOtps.push(otp);
        return otp;
      }),
      findFirst: jest.fn().mockImplementation(async () => {
        return otpRows.length > 0 ? otpRows[otpRows.length - 1] : null;
      }),
      update: jest.fn().mockImplementation(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        const idx = otpRows.findIndex((o) => o.id === args.where.id);
        if (idx >= 0) {
          const updated = { ...otpRows[idx] };
          if (args.data.attempts && typeof args.data.attempts === 'object' && 'increment' in (args.data.attempts as Record<string, unknown>)) {
            updated.attempts = (updated.attempts as number) + ((args.data.attempts as { increment: number }).increment);
          } else if (args.data.attempts !== undefined) {
            updated.attempts = args.data.attempts;
          }
          if (args.data.consumedAt !== undefined) updated.consumedAt = args.data.consumedAt;
          if (args.data.lockedAt !== undefined) updated.lockedAt = args.data.lockedAt;
          otpRows[idx] = updated;
          return updated;
        }
        return { id: args.where.id, ...args.data };
      }),
    },
    auditLog: {
      create: jest.fn().mockImplementation(async (args: { data: Record<string, unknown> }) => {
        auditLogs.push(args.data);
        return args.data;
      }),
    },
    // Stubs for unused prisma delegates the service constructor may touch
    proofProductEntitlement: { findFirst: jest.fn().mockResolvedValue(null) },
    proofFreeScan: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
    orgPoRegister: { findMany: jest.fn().mockResolvedValue([]) },
    orgInvoiceHistory: { findMany: jest.fn().mockResolvedValue([]), createMany: jest.fn() },
    orgInvoiceScanRun: { create: jest.fn().mockResolvedValue({ id: 'scan-1' }) },
    scanFindingApproval: { createMany: jest.fn() },
  };

  return { prisma, auditLogs, createdOtps, updatedVendors, createdVendors, otpRows };
}

function makeService(prisma: unknown, emailOverrides: Partial<{ sendVendorPortalOtp: jest.Mock }> = {}) {
  const emailSendOtpSpy = emailOverrides.sendVendorPortalOtp ?? jest.fn().mockResolvedValue(undefined);
  const emailService = {
    sendVendorPortalOtp: emailSendOtpSpy,
    sendInvoiceProofReviewAlert: jest.fn().mockResolvedValue(undefined),
  };
  const intelligenceService = {
    enrichFindings: jest.fn().mockResolvedValue([]),
    reportConsortiumSignals: jest.fn().mockResolvedValue(undefined),
  };
  const service = new InvoiceProofService(
    prisma as never,
    {} as never,
    intelligenceService as never,
    emailService as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, emailSendOtpSpy };
}

// ---------------------------------------------------------------------------
// TESTS
// ---------------------------------------------------------------------------

describe('Vendor Portal OTP — BEC prevention gate', () => {
  // ── Core gate: submit WITHOUT OTP must be REJECTED ──

  it('REJECTS bank change when no OTP code is provided', async () => {
    const { prisma } = makePrisma();
    const { service } = makeService(prisma);

    await expect(
      service.submitVendorPortalBankUpdate(ORG_SLUG, PORTAL_TOKEN, {
        bankRoutingNumber: '999999999',
      }),
    ).rejects.toThrow('one-time verification code is required');
  });

  it('REJECTS bank change when otpCode is empty string', async () => {
    const { prisma } = makePrisma();
    const { service } = makeService(prisma);

    await expect(
      service.submitVendorPortalBankUpdate(ORG_SLUG, PORTAL_TOKEN, {
        bankRoutingNumber: '999999999',
        otpCode: '   ',
      }),
    ).rejects.toThrow('one-time verification code is required');
  });

  // ── Request OTP happy path ──

  it('request-otp creates an OTP record and emails the trusted address (code NOT in response)', async () => {
    const { prisma, createdOtps } = makePrisma();
    const { service, emailSendOtpSpy } = makeService(prisma);

    const result = await service.requestVendorPortalOtp(ORG_SLUG, PORTAL_TOKEN);

    // OTP created in DB
    expect(createdOtps).toHaveLength(1);
    expect(createdOtps[0].codeHash).toBeDefined();
    expect(createdOtps[0].vendorPortalTokenId).toBe(PORTAL_TOKEN_ID);

    // Email sent to TRUSTED address
    expect(emailSendOtpSpy).toHaveBeenCalledTimes(1);
    expect(emailSendOtpSpy.mock.calls[0][0].to).toBe(TRUSTED_EMAIL);
    expect(emailSendOtpSpy.mock.calls[0][0].code).toMatch(/^\d{6}$/);

    // Response does NOT leak the code
    expect(result).not.toHaveProperty('code');
    expect(result).not.toHaveProperty('otp');
    expect(JSON.stringify(result)).not.toMatch(/\d{6}/);
    expect(result.message).toContain('one-time verification code');
  });

  // ── Valid OTP → bank change APPLIED ──

  it('APPLIES bank change when a valid, unexpired, unconsumed OTP is provided', async () => {
    const code = '482917';
    const { prisma, updatedVendors } = makePrisma({
      otpRows: [
        {
          id: 'otp-valid',
          vendorPortalTokenId: PORTAL_TOKEN_ID,
          codeHash: hashCode(code),
          expiresAt: new Date(Date.now() + 300_000),
          attempts: 0,
          consumedAt: null,
          lockedAt: null,
        },
      ],
    });
    const { service } = makeService(prisma);

    const result = await service.submitVendorPortalBankUpdate(ORG_SLUG, PORTAL_TOKEN, {
      bankRoutingNumber: '111000025',
      bankAccountLast4: '6789',
      otpCode: code,
    });

    // Bank change applied
    expect(updatedVendors).toHaveLength(1);
    expect(updatedVendors[0]).toMatchObject({
      bankRoutingNumber: '111000025',
      bankAccountLast4: '6789',
    });

    // OTP marked consumed
    expect(prisma.vendorPortalOtp.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'otp-valid' },
        data: expect.objectContaining({ consumedAt: expect.any(Date) }),
      }),
    );

    expect(result).toBeDefined();
  });

  // ── Invalid OTP → BLOCKED ──

  it('BLOCKS bank change when OTP code is wrong', async () => {
    const { prisma } = makePrisma({
      otpRows: [
        {
          id: 'otp-1',
          vendorPortalTokenId: PORTAL_TOKEN_ID,
          codeHash: hashCode('123456'),
          expiresAt: new Date(Date.now() + 300_000),
          attempts: 0,
          consumedAt: null,
          lockedAt: null,
        },
      ],
    });
    const { service } = makeService(prisma);

    await expect(
      service.submitVendorPortalBankUpdate(ORG_SLUG, PORTAL_TOKEN, {
        bankRoutingNumber: '999999999',
        otpCode: '000000', // wrong code
      }),
    ).rejects.toThrow('Invalid verification code');

    // Vendor record NOT updated
    expect(prisma.orgVendorMaster.update).not.toHaveBeenCalled();
  });

  // ── Expired OTP → BLOCKED ──

  it('BLOCKS bank change when OTP is expired', async () => {
    const { prisma } = makePrisma({
      otpRows: [], // findFirst returns null because expired OTPs are filtered by expiresAt > now
    });
    const { service } = makeService(prisma);

    await expect(
      service.submitVendorPortalBankUpdate(ORG_SLUG, PORTAL_TOKEN, {
        bankRoutingNumber: '999999999',
        otpCode: '123456',
      }),
    ).rejects.toThrow('No valid verification code found');
  });

  // ── Reused (consumed) OTP → BLOCKED ──

  it('BLOCKS bank change when OTP was already consumed', async () => {
    const { prisma } = makePrisma({
      otpRows: [], // consumedAt is not null, so findFirst with consumedAt: null returns nothing
    });
    const { service } = makeService(prisma);

    await expect(
      service.submitVendorPortalBankUpdate(ORG_SLUG, PORTAL_TOKEN, {
        bankRoutingNumber: '999999999',
        otpCode: '123456',
      }),
    ).rejects.toThrow('No valid verification code found');
  });

  // ── Repeated failures → locked ──

  it('LOCKS OTP after 5 failed attempts and blocks further use', async () => {
    const code = '999999';
    const otpRow = {
      id: 'otp-lockout',
      vendorPortalTokenId: PORTAL_TOKEN_ID,
      codeHash: hashCode('123456'), // correct code is 123456
      expiresAt: new Date(Date.now() + 300_000),
      attempts: 4, // 4 prior failures, next will be the 5th
      consumedAt: null,
      lockedAt: null,
    };
    const { prisma, auditLogs } = makePrisma({ otpRows: [otpRow] });
    const { service } = makeService(prisma);

    await expect(
      service.submitVendorPortalBankUpdate(ORG_SLUG, PORTAL_TOKEN, {
        bankRoutingNumber: '999999999',
        otpCode: code, // wrong code, 5th attempt
      }),
    ).rejects.toThrow('Too many failed attempts');

    // Check audit logged the lockout
    const lockEvent = auditLogs.find((l) => l.event === 'VENDOR_PORTAL_OTP_FAILED');
    expect(lockEvent).toBeDefined();
    expect((lockEvent?.metadata as Record<string, unknown>)?.locked).toBe(true);
  });

  // ── Audit log rows ──

  it('creates audit log rows for OTP request, verify, and bank change', async () => {
    const code = '555123';
    // First, request OTP
    const { prisma: prisma1, auditLogs: logs1 } = makePrisma();
    const { service: svc1 } = makeService(prisma1);
    await svc1.requestVendorPortalOtp(ORG_SLUG, PORTAL_TOKEN);
    expect(logs1.some((l) => l.event === 'VENDOR_PORTAL_OTP_REQUESTED')).toBe(true);

    // Then, verify and apply
    const { prisma: prisma2, auditLogs: logs2 } = makePrisma({
      otpRows: [
        {
          id: 'otp-audit',
          vendorPortalTokenId: PORTAL_TOKEN_ID,
          codeHash: hashCode(code),
          expiresAt: new Date(Date.now() + 300_000),
          attempts: 0,
          consumedAt: null,
          lockedAt: null,
        },
      ],
    });
    const { service: svc2 } = makeService(prisma2);
    await svc2.submitVendorPortalBankUpdate(ORG_SLUG, PORTAL_TOKEN, {
      bankRoutingNumber: '021000021',
      otpCode: code,
    });

    expect(logs2.some((l) => l.event === 'VENDOR_PORTAL_OTP_VERIFIED')).toBe(true);
    expect(logs2.some((l) => l.event === 'VENDOR_PORTAL_BANK_CHANGE_ACCEPTED')).toBe(true);
  });

  it('creates BANK_CHANGE_BLOCKED audit log when no OTP provided', async () => {
    const { prisma, auditLogs } = makePrisma();
    const { service } = makeService(prisma);

    await expect(
      service.submitVendorPortalBankUpdate(ORG_SLUG, PORTAL_TOKEN, {
        bankRoutingNumber: '999999999',
      }),
    ).rejects.toThrow();

    expect(auditLogs.some((l) => l.event === 'VENDOR_PORTAL_BANK_CHANGE_BLOCKED')).toBe(true);
  });

  // ── Email send failure → FAIL CLOSED ──

  it('BLOCKS OTP request when EmailService.sendVendorPortalOtp throws (fail closed)', async () => {
    const { prisma } = makePrisma();
    const failingSend = jest.fn().mockRejectedValue(new Error('SMTP connection refused'));
    const { service } = makeService(prisma, { sendVendorPortalOtp: failingSend });

    await expect(
      service.requestVendorPortalOtp(ORG_SLUG, PORTAL_TOKEN),
    ).rejects.toThrow('SMTP connection refused');

    // The code was stored but never delivered — caller gets an error,
    // so they cannot proceed. This is fail-closed.
    expect(failingSend).toHaveBeenCalledTimes(1);
  });

  // ── Vendor with no trusted email → BLOCKED ──

  it('BLOCKS self-service bank change when vendor has no contactEmail on file', async () => {
    const { prisma, auditLogs } = makePrisma({ vendorContactEmail: null });
    const { service, emailSendOtpSpy } = makeService(prisma);

    await expect(
      service.requestVendorPortalOtp(ORG_SLUG, PORTAL_TOKEN),
    ).rejects.toThrow('No verified contact email is on file');

    // No email sent
    expect(emailSendOtpSpy).not.toHaveBeenCalled();

    // Audit logged
    expect(auditLogs.some((l) => l.event === 'VENDOR_PORTAL_OTP_BLOCKED_NO_EMAIL')).toBe(true);
  });

  it('BLOCKS self-service bank change when vendor contactEmail is empty string', async () => {
    const { prisma } = makePrisma({ vendorContactEmail: '   ' });
    const { service, emailSendOtpSpy } = makeService(prisma);

    await expect(
      service.requestVendorPortalOtp(ORG_SLUG, PORTAL_TOKEN),
    ).rejects.toThrow('No verified contact email is on file');

    expect(emailSendOtpSpy).not.toHaveBeenCalled();
  });
});
