/**
 * Vendor Portal OTP step-up verification tests.
 *
 * Proves the BEC-prevention gate: bank/routing changes through the vendor portal
 * REQUIRE a valid, unexpired, unconsumed OTP sent to the vendor's trusted email.
 *
 * OTP state is stored inline on VendorPortalToken.verifiedEmail as an encoded
 * string `otp:<sha256Hash>:<expiryMs>:<attempts>` — there is no separate OTP
 * table in the standalone Chain Verify schema (see invoice-proof.service.ts's
 * requestVendorPortalOtp/submitVendorPortalBankUpdate: "keeps OTP state inside
 * the Chain Verify-owned schema without restoring the old SwarmSync OTP
 * table"). Audit trail entries are structured Logger.log lines
 * (logVendorPortalAudit), not database rows — there is no AuditLog model
 * either, so those assertions spy on the Nest Logger instead of a Prisma
 * table.
 *
 * Mock the scan runner to avoid @chain-verify/proof-core resolution issues (same
 * approach as the sibling invoice-proof.service.spec.ts).
 */

import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';

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

import { createHash } from 'crypto';
import { Logger } from '@nestjs/common';

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
  /** Pre-seeds the portal token's encoded OTP state (verifiedEmail column). */
  verifiedEmail?: string | null;
} = {}) {
  const updatedVendors: Array<Record<string, unknown>> = [];
  const createdVendors: Array<Record<string, unknown>> = [];

  // Mutable in-memory "row" so update() calls are reflected in the next
  // findFirst() — matches how the real service reads-modify-writes the
  // encoded OTP state onto this single column across two calls.
  const portal: Record<string, unknown> = {
    id: PORTAL_TOKEN_ID,
    organizationId: ORG_ID,
    vendorName: VENDOR_NAME,
    token: PORTAL_TOKEN,
    expiresAt: new Date(Date.now() + 86400000),
    verifiedEmail: overrides.verifiedEmail ?? null,
  };

  const prisma = {
    organization: {
      findUnique: vi.fn().mockImplementation(async (args: { where: { slug?: string; id?: string } }) => {
        if (args.where.slug === ORG_SLUG || args.where.id === ORG_ID) {
          return { id: ORG_ID, name: 'Acme Corp', slug: ORG_SLUG };
        }
        return null;
      }),
    },
    vendorPortalToken: {
      findFirst: vi.fn().mockImplementation(async (args: {
        where: { organizationId: string; token: string; expiresAt?: { gt: Date } };
      }) => {
        if (args.where.token === PORTAL_TOKEN && args.where.organizationId === ORG_ID) {
          return { ...portal };
        }
        return null;
      }),
      update: vi.fn().mockImplementation(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        Object.assign(portal, args.data);
        return { ...portal };
      }),
      create: vi.fn(),
    },
    orgVendorMaster: {
      findFirst: vi.fn().mockImplementation(async () => {
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
      update: vi.fn().mockImplementation(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        updatedVendors.push(args.data);
        return { id: args.where.id, ...args.data };
      }),
      create: vi.fn().mockImplementation(async (args: { data: Record<string, unknown> }) => {
        createdVendors.push(args.data);
        return { id: 'vm-new', ...args.data };
      }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    // Stubs for unused prisma delegates the service constructor may touch
    proofProductEntitlement: { findFirst: vi.fn().mockResolvedValue(null) },
    proofFreeScan: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn() },
    orgPoRegister: { findMany: vi.fn().mockResolvedValue([]) },
    orgInvoiceHistory: { findMany: vi.fn().mockResolvedValue([]), createMany: vi.fn() },
    orgInvoiceScanRun: { create: vi.fn().mockResolvedValue({ id: 'scan-1' }) },
    scanFindingApproval: { createMany: vi.fn() },
  };

  return { prisma, portal, updatedVendors, createdVendors };
}

function makeService(prisma: unknown, emailOverrides: Partial<{ sendVendorPortalOtp: Mock }> = {}) {
  const emailSendOtpSpy = emailOverrides.sendVendorPortalOtp ?? vi.fn().mockResolvedValue(undefined);
  const emailService = {
    sendVendorPortalOtp: emailSendOtpSpy,
    sendInvoiceProofReviewAlert: vi.fn().mockResolvedValue(undefined),
  };
  const intelligenceService = {
    enrichFindings: vi.fn().mockResolvedValue([]),
    reportConsortiumSignals: vi.fn().mockResolvedValue(undefined),
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

/** Parses the `otp:<hash>:<expiryMs>:<attempts>` encoding for assertions. */
function parseOtpState(verifiedEmail: unknown): { hash: string; expiryMs: number; attempts: number } | null {
  if (typeof verifiedEmail !== 'string' || !verifiedEmail.startsWith('otp:')) return null;
  const [, hash, expiryMs, attempts] = verifiedEmail.split(':');
  return { hash, expiryMs: Number(expiryMs), attempts: Number(attempts) };
}

// ---------------------------------------------------------------------------
// TESTS
// ---------------------------------------------------------------------------

describe('Vendor Portal OTP — BEC prevention gate', () => {
  const loggerSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

  afterEach(() => {
    loggerSpy.mockClear();
  });

  // ── Core gate: submit WITHOUT OTP must be REJECTED ──

  it('REJECTS bank change when no OTP code is provided', async () => {
    const { prisma } = makePrisma();
    const { service } = makeService(prisma);

    await expect(
      service.submitVendorPortalBankUpdate(ORG_SLUG, PORTAL_TOKEN, {
        bankRoutingNumber: '999999999',
      }),
    ).rejects.toThrow('one-time verification code is required');

    expect(loggerSpy.mock.calls.some((call) => String(call[0]).includes('VENDOR_PORTAL_BANK_CHANGE_BLOCKED'))).toBe(
      true,
    );
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

  it('request-otp stores an encoded OTP state on the portal token and emails the trusted address (code NOT in response)', async () => {
    const { prisma, portal } = makePrisma();
    const { service, emailSendOtpSpy } = makeService(prisma);

    const result = await service.requestVendorPortalOtp(ORG_SLUG, PORTAL_TOKEN);

    // OTP state written onto the portal token (no separate OTP table).
    const otpState = parseOtpState(portal.verifiedEmail);
    expect(otpState).not.toBeNull();
    expect(otpState?.hash).toHaveLength(64); // sha256 hex
    expect(otpState?.attempts).toBe(0);
    expect(otpState!.expiryMs).toBeGreaterThan(Date.now());

    // Email sent to TRUSTED address
    expect(emailSendOtpSpy).toHaveBeenCalledTimes(1);
    expect(emailSendOtpSpy.mock.calls[0][0].to).toBe(TRUSTED_EMAIL);
    expect(emailSendOtpSpy.mock.calls[0][0].code).toMatch(/^\d{6}$/);

    // Response does NOT leak the code
    expect(result).not.toHaveProperty('code');
    expect(result).not.toHaveProperty('otp');
    expect(JSON.stringify(result)).not.toMatch(/\d{6}/);
    expect(result.message).toContain('one-time verification code');

    expect(loggerSpy.mock.calls.some((call) => String(call[0]).includes('VENDOR_PORTAL_OTP_REQUESTED'))).toBe(true);
  });

  // ── Valid OTP → bank change APPLIED ──

  it('APPLIES bank change when a valid, unexpired, unconsumed OTP is provided', async () => {
    const code = '482917';
    const { prisma, portal, updatedVendors } = makePrisma({
      verifiedEmail: `otp:${hashCode(code)}:${Date.now() + 300_000}:0`,
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

    // OTP state consumed (cleared) so it cannot be replayed
    expect(portal.verifiedEmail).toBeNull();
    expect(prisma.vendorPortalToken.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: PORTAL_TOKEN_ID },
        data: { verifiedEmail: null },
      }),
    );

    expect(loggerSpy.mock.calls.some((call) => String(call[0]).includes('VENDOR_PORTAL_BANK_CHANGE_ACCEPTED'))).toBe(
      true,
    );
    expect(result).toBeDefined();
  });

  // ── Invalid OTP → BLOCKED ──

  it('BLOCKS bank change when OTP code is wrong', async () => {
    const { prisma } = makePrisma({
      verifiedEmail: `otp:${hashCode('123456')}:${Date.now() + 300_000}:0`,
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
      // Expiry timestamp already in the past.
      verifiedEmail: `otp:${hashCode('123456')}:${Date.now() - 1000}:0`,
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
    // Consumed OTPs clear verifiedEmail back to null.
    const { prisma } = makePrisma({ verifiedEmail: null });
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
    const { prisma, portal } = makePrisma({
      // 4 prior failures recorded; correct code is 123456, caller supplies a
      // wrong one for what will be the 5th (lockout) attempt.
      verifiedEmail: `otp:${hashCode('123456')}:${Date.now() + 300_000}:4`,
    });
    const { service } = makeService(prisma);

    await expect(
      service.submitVendorPortalBankUpdate(ORG_SLUG, PORTAL_TOKEN, {
        bankRoutingNumber: '999999999',
        otpCode: '999999', // wrong code, 5th attempt
      }),
    ).rejects.toThrow('Too many failed attempts');

    // Locking clears the encoded OTP state entirely so no further attempts
    // (correct or not) can succeed until a new code is requested.
    expect(portal.verifiedEmail).toBeNull();
  });

  // ── Blocked-without-OTP still logs an audit line ──

  it('logs a BANK_CHANGE_BLOCKED audit line when no OTP is provided', async () => {
    const { prisma } = makePrisma();
    const { service } = makeService(prisma);

    await expect(
      service.submitVendorPortalBankUpdate(ORG_SLUG, PORTAL_TOKEN, {
        bankRoutingNumber: '999999999',
      }),
    ).rejects.toThrow();

    expect(loggerSpy.mock.calls.some((call) => String(call[0]).includes('VENDOR_PORTAL_BANK_CHANGE_BLOCKED'))).toBe(
      true,
    );
  });

  // ── Email send failure → FAIL CLOSED ──

  it('BLOCKS OTP request when EmailService.sendVendorPortalOtp throws (fail closed)', async () => {
    const { prisma, portal } = makePrisma();
    const failingSend = vi.fn().mockRejectedValue(new Error('SMTP connection refused'));
    const { service } = makeService(prisma, { sendVendorPortalOtp: failingSend });

    await expect(
      service.requestVendorPortalOtp(ORG_SLUG, PORTAL_TOKEN),
    ).rejects.toThrow('SMTP connection refused');

    // The code was stored but never delivered — caller gets an error,
    // so they cannot proceed. This is fail-closed.
    expect(failingSend).toHaveBeenCalledTimes(1);
    expect(parseOtpState(portal.verifiedEmail)).not.toBeNull();
  });

  // ── Vendor with no trusted email → BLOCKED ──

  it('BLOCKS self-service bank change when vendor has no contactEmail on file', async () => {
    const { prisma } = makePrisma({ vendorContactEmail: null });
    const { service, emailSendOtpSpy } = makeService(prisma);

    await expect(
      service.requestVendorPortalOtp(ORG_SLUG, PORTAL_TOKEN),
    ).rejects.toThrow('No verified contact email is on file');

    // No email sent
    expect(emailSendOtpSpy).not.toHaveBeenCalled();

    expect(
      loggerSpy.mock.calls.some((call) => String(call[0]).includes('VENDOR_PORTAL_OTP_BLOCKED_NO_EMAIL')),
    ).toBe(true);
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
