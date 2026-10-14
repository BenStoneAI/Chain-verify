/**
 * Vendor Portal OTP step-up verification tests.
 *
 * Proves the BEC-prevention gate: bank/routing changes through the vendor portal
 * REQUIRE a valid, unexpired, unconsumed OTP sent to the vendor's trusted email,
 * backed by the `vendor_portal_otps` table (`VendorPortalOtp` model).
 *
 * The Prisma double is an in-memory store whose `updateMany` evaluates the WHERE
 * guard and applies the write in ONE synchronous step (like a single SQL UPDATE),
 * and whose reads/updates yield first so concurrent callers genuinely interleave.
 * That is what makes the Promise.all brute-force test a real proof of the
 * attempt cap instead of a mock that agrees with itself.
 */
import 'reflect-metadata';

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

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

import { Logger } from '@nestjs/common';

import { InvoiceProofController } from './invoice-proof.controller.js';
import { InvoiceProofService } from './invoice-proof.service.js';
import {
  VENDOR_PORTAL_OTP_EXPIRY_MS,
  VENDOR_PORTAL_OTP_MAX_ATTEMPTS,
  hashVendorPortalOtp,
} from './vendor-portal-otp.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_ID = 'org-test-1';
const ORG_SLUG = 'acme-corp';
const VENDOR_NAME = 'Carolina Alloy Supply';
const PORTAL_TOKEN_ID = 'pt-1';
const PORTAL_TOKEN = 'a'.repeat(48);
const TRUSTED_EMAIL = 'accounts@carolinaalloy.com';
const OTP_SECRET = 'unit-test-otp-secret-0123456789abcdef';
const GENERIC_REJECTION = 'Invalid or expired verification code.';

interface OtpRow {
  id: string;
  vendorPortalTokenId: string;
  vendorName: string;
  organizationId: string;
  codeHash: string;
  expiresAt: Date;
  attempts: number;
  consumedAt: Date | null;
  lockedAt: Date | null;
  createdAt: Date;
}

type Where = Record<string, unknown>;

/** Minimal Prisma `where` evaluator: equality, null, not, gt/gte/lt/lte and OR. */
function matches(row: Record<string, unknown>, where: Where): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return (cond as Where[]).some((alt) => matches(row, alt));
    const value = row[key];
    if (cond === null) return value === null || value === undefined;
    if (cond instanceof Date) return value instanceof Date && value.getTime() === cond.getTime();
    if (typeof cond === 'object') {
      const ops = cond as Record<string, unknown>;
      const num = (v: unknown) => (v instanceof Date ? v.getTime() : (v as number));
      if ('not' in ops && num(value) === num(ops.not)) return false;
      if ('gt' in ops && !(num(value) > num(ops.gt))) return false;
      if ('gte' in ops && !(num(value) >= num(ops.gte))) return false;
      if ('lt' in ops && !(num(value) < num(ops.lt))) return false;
      if ('lte' in ops && !(num(value) <= num(ops.lte))) return false;
      return true;
    }
    return value === cond;
  });
}

function makePrisma(overrides: { vendorContactEmail?: string | null } = {}) {
  const store: OtpRow[] = [];
  const updatedVendors: Array<Record<string, unknown>> = [];
  const createdVendors: Array<Record<string, unknown>> = [];
  const portal = {
    id: PORTAL_TOKEN_ID,
    organizationId: ORG_ID,
    vendorName: VENDOR_NAME,
    token: PORTAL_TOKEN,
    expiresAt: new Date(Date.now() + 86_400_000),
    verifiedEmail: null as string | null,
  };
  let seq = 0;
  const tick = () => Promise.resolve();

  const vendorPortalOtp = {
    create: vi.fn(async (args: { data: Partial<OtpRow> }) => {
      await tick();
      const row: OtpRow = {
        id: `otp-${++seq}`,
        attempts: 0,
        consumedAt: null,
        lockedAt: null,
        createdAt: new Date(),
        ...(args.data as Omit<OtpRow, 'id'>),
      };
      store.push(row);
      return { ...row };
    }),
    findFirst: vi.fn(async (args: { where: Where; orderBy?: { createdAt: 'asc' | 'desc' } }) => {
      await tick();
      const found = store.filter((r) => matches(r as never, args.where));
      found.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || Number(b.id.slice(4)) - Number(a.id.slice(4)));
      return found[0] ? { ...found[0] } : null;
    }),
    findMany: vi.fn(async (args: { where: Where }) => {
      await tick();
      return store.filter((r) => matches(r as never, args.where)).map((r) => ({ ...r }));
    }),
    // check + write happen in one synchronous step: the atomic UPDATE ... WHERE.
    updateMany: vi.fn(async (args: { where: Where; data: Record<string, unknown> }) => {
      await tick();
      let count = 0;
      for (const row of store) {
        if (!matches(row as never, args.where)) continue;
        count += 1;
        for (const [k, v] of Object.entries(args.data)) {
          if (v && typeof v === 'object' && 'increment' in (v as object)) {
            (row as unknown as Record<string, number>)[k] += (v as { increment: number }).increment;
          } else {
            (row as unknown as Record<string, unknown>)[k] = v;
          }
        }
      }
      return { count };
    }),
  };

  const prisma = {
    organization: {
      findUnique: vi.fn(async (args: { where: { slug?: string; id?: string } }) =>
        args.where.slug === ORG_SLUG || args.where.id === ORG_ID
          ? { id: ORG_ID, name: 'Acme Corp', slug: ORG_SLUG }
          : null,
      ),
    },
    vendorPortalToken: {
      findFirst: vi.fn(async (args: { where: { organizationId: string; token: string } }) =>
        args.where.token === PORTAL_TOKEN && args.where.organizationId === ORG_ID ? { ...portal } : null,
      ),
      update: vi.fn(),
      create: vi.fn(),
    },
    vendorPortalOtp,
    orgVendorMaster: {
      findFirst: vi.fn(async () => {
        const email = overrides.vendorContactEmail;
        if (email === undefined) {
          return { id: 'vm-1', contactEmail: TRUSTED_EMAIL, vendorName: VENDOR_NAME, bankRoutingNumber: '021000021' };
        }
        return { id: 'vm-1', contactEmail: email, vendorName: VENDOR_NAME };
      }),
      update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        updatedVendors.push(args.data);
        return { id: args.where.id, ...args.data };
      }),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        createdVendors.push(args.data);
        return { id: 'vm-new', ...args.data };
      }),
      findMany: vi.fn().mockResolvedValue([]),
    },
  };

  return { prisma, store, portal, updatedVendors, createdVendors };
}

function makeService(
  prisma: unknown,
  emailOverrides: Partial<{ sendVendorPortalOtp: Mock }> = {},
) {
  const sendOtp = emailOverrides.sendVendorPortalOtp ?? vi.fn().mockResolvedValue(undefined);
  const service = new InvoiceProofService(
    prisma as never,
    {} as never,
    { enrichFindings: vi.fn().mockResolvedValue([]) } as never,
    { sendVendorPortalOtp: sendOtp, sendInvoiceProofReviewAlert: vi.fn() } as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, sendOtp };
}

/** Issues a code through the real service and returns the delivered plaintext. */
async function issueCode(service: InvoiceProofService, sendOtp: Mock): Promise<string> {
  await service.requestVendorPortalOtp(ORG_SLUG, PORTAL_TOKEN);
  const calls = sendOtp.mock.calls;
  return calls[calls.length - 1][0].code as string;
}

function seedOtp(
  store: OtpRow[],
  code: string,
  overrides: Partial<OtpRow> = {},
): OtpRow {
  const row: OtpRow = {
    id: `seed-${store.length + 1}`,
    vendorPortalTokenId: PORTAL_TOKEN_ID,
    vendorName: VENDOR_NAME,
    organizationId: ORG_ID,
    codeHash: hashVendorPortalOtp(OTP_SECRET, PORTAL_TOKEN_ID, code),
    expiresAt: new Date(Date.now() + 5 * 60_000),
    attempts: 0,
    consumedAt: null,
    lockedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
  store.push(row);
  return row;
}

function wrongCodeFor(code: string): string {
  return code === '000000' ? '000001' : '000000';
}

const BANK = { bankRoutingNumber: '111000025', bankAccountLast4: '6789' };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Vendor Portal OTP — BEC prevention gate', () => {
  const logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

  beforeEach(() => {
    vi.stubEnv('VENDOR_PORTAL_OTP_SECRET', OTP_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    logSpy.mockClear();
    warnSpy.mockClear();
    errorSpy.mockClear();
  });

  const allLogLines = () =>
    [...logSpy.mock.calls, ...warnSpy.mock.calls, ...errorSpy.mock.calls].map((c) => String(c[0]));

  // -- missing code ---------------------------------------------------------

  it('REJECTS bank change when no OTP code is provided, and audits the block', async () => {
    const { prisma, updatedVendors } = makePrisma();
    const { service } = makeService(prisma);

    await expect(
      service.submitVendorPortalBankUpdate(ORG_SLUG, PORTAL_TOKEN, { bankRoutingNumber: '999999999' }),
    ).rejects.toThrow('one-time verification code is required');
    await expect(
      service.submitVendorPortalBankUpdate(ORG_SLUG, PORTAL_TOKEN, { bankRoutingNumber: '999999999', otpCode: '   ' }),
    ).rejects.toThrow('one-time verification code is required');

    expect(updatedVendors).toHaveLength(0);
    expect(allLogLines().some((l) => l.includes('VENDOR_PORTAL_BANK_CHANGE_BLOCKED'))).toBe(true);
  });

  // -- issue ----------------------------------------------------------------

  it('request-otp persists only an HMAC in vendor_portal_otps, emails the trusted address, and never touches verifiedEmail', async () => {
    const { prisma, store } = makePrisma();
    const { service, sendOtp } = makeService(prisma);

    const result = await service.requestVendorPortalOtp(ORG_SLUG, PORTAL_TOKEN);

    expect(store).toHaveLength(1);
    const row = store[0];
    const code = sendOtp.mock.calls[0][0].code as string;
    expect(code).toMatch(/^\d{6}$/);
    expect(sendOtp.mock.calls[0][0].to).toBe(TRUSTED_EMAIL);

    expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.codeHash).toBe(hashVendorPortalOtp(OTP_SECRET, PORTAL_TOKEN_ID, code));
    expect(row.attempts).toBe(0);
    expect(row.consumedAt).toBeNull();
    expect(row.lockedAt).toBeNull();
    expect(row.vendorPortalTokenId).toBe(PORTAL_TOKEN_ID);
    expect(row.organizationId).toBe(ORG_ID);
    const ttl = row.expiresAt.getTime() - Date.now();
    expect(ttl).toBeGreaterThan(VENDOR_PORTAL_OTP_EXPIRY_MS - 5_000);
    expect(ttl).toBeLessThanOrEqual(VENDOR_PORTAL_OTP_EXPIRY_MS);

    expect(prisma.vendorPortalToken.update).not.toHaveBeenCalled();

    // Existing response shape preserved; the code is not in it.
    expect(Object.keys(result)).toEqual(['message']);
    expect(result.message).toContain('one-time verification code');
    expect(JSON.stringify(result)).not.toContain(code);
    expect(allLogLines().some((l) => l.includes('VENDOR_PORTAL_OTP_REQUESTED'))).toBe(true);
  });

  it('the code hash is bound to the portal token id (a hash lifted from another token does not verify)', async () => {
    const { prisma, store, updatedVendors } = makePrisma();
    const { service } = makeService(prisma);
    seedOtp(store, '482917', {
      codeHash: hashVendorPortalOtp(OTP_SECRET, 'some-other-token', '482917'),
    });

    await expect(
      service.submitVendorPortalBankUpdate(ORG_SLUG, PORTAL_TOKEN, { ...BANK, otpCode: '482917' }),
    ).rejects.toThrow(GENERIC_REJECTION);
    expect(updatedVendors).toHaveLength(0);
  });

  // -- verify ---------------------------------------------------------------

  it('APPLIES the bank change with the correct code and marks the row consumed', async () => {
    const { prisma, store, updatedVendors } = makePrisma();
    const { service, sendOtp } = makeService(prisma);
    const code = await issueCode(service, sendOtp);

    const result = await service.submitVendorPortalBankUpdate(ORG_SLUG, PORTAL_TOKEN, { ...BANK, otpCode: code });

    expect(result).toBeDefined();
    expect(updatedVendors).toHaveLength(1);
    expect(updatedVendors[0]).toMatchObject({ bankRoutingNumber: '111000025', bankAccountLast4: '6789' });
    expect(store[0].consumedAt).toBeInstanceOf(Date);
    expect(allLogLines().some((l) => l.includes('VENDOR_PORTAL_OTP_VERIFIED'))).toBe(true);
    expect(allLogLines().some((l) => l.includes('VENDOR_PORTAL_BANK_CHANGE_ACCEPTED'))).toBe(true);
  });

  it('a wrong code increments attempts, is rejected with the generic message, and changes nothing', async () => {
    const { prisma, store, updatedVendors, createdVendors } = makePrisma();
    const { service, sendOtp } = makeService(prisma);
    const code = await issueCode(service, sendOtp);

    await expect(
      service.submitVendorPortalBankUpdate(ORG_SLUG, PORTAL_TOKEN, { ...BANK, otpCode: wrongCodeFor(code) }),
    ).rejects.toThrow(GENERIC_REJECTION);

    expect(store[0].attempts).toBe(1);
    expect(store[0].lockedAt).toBeNull();
    expect(store[0].consumedAt).toBeNull();
    expect(updatedVendors).toHaveLength(0);
    expect(createdVendors).toHaveLength(0);
    expect(allLogLines().some((l) => l.includes('VENDOR_PORTAL_OTP_FAILED'))).toBe(true);

    // The right code still works while attempts remain.
    await expect(
      service.submitVendorPortalBankUpdate(ORG_SLUG, PORTAL_TOKEN, { ...BANK, otpCode: code }),
    ).resolves.toBeDefined();
    expect(updatedVendors).toHaveLength(1);
  });

  it('locks after 5 failed attempts, audits the lock once, and then refuses even the correct code', async () => {
    const { prisma, store, updatedVendors } = makePrisma();
    const { service, sendOtp } = makeService(prisma);
    const code = await issueCode(service, sendOtp);

    for (let i = 1; i <= VENDOR_PORTAL_OTP_MAX_ATTEMPTS; i += 1) {
      await expect(
        service.submitVendorPortalBankUpdate(ORG_SLUG, PORTAL_TOKEN, { ...BANK, otpCode: wrongCodeFor(code) }),
      ).rejects.toThrow(GENERIC_REJECTION);
      expect(store[0].attempts).toBe(i);
      expect(store[0].lockedAt === null).toBe(i < VENDOR_PORTAL_OTP_MAX_ATTEMPTS);
    }

    // Correct code after the lock: same generic message, no write, counter frozen at the cap.
    await expect(
      service.submitVendorPortalBankUpdate(ORG_SLUG, PORTAL_TOKEN, { ...BANK, otpCode: code }),
    ).rejects.toThrow(GENERIC_REJECTION);
    expect(updatedVendors).toHaveLength(0);
    expect(store[0].attempts).toBe(VENDOR_PORTAL_OTP_MAX_ATTEMPTS);
    expect(store[0].consumedAt).toBeNull();
    expect(allLogLines().filter((l) => l.includes('VENDOR_PORTAL_OTP_LOCKED'))).toHaveLength(1);
  });

  it('concurrent brute-force guesses can never exceed the attempt cap', async () => {
    const { prisma, store, updatedVendors } = makePrisma();
    const { service, sendOtp } = makeService(prisma);
    const code = await issueCode(service, sendOtp);

    const guesses = Array.from({ length: 40 }, (_, i) => String(100_000 + i).padStart(6, '0')).filter((g) => g !== code);
    const results = await Promise.allSettled(
      guesses.map((g) => service.submitVendorPortalBankUpdate(ORG_SLUG, PORTAL_TOKEN, { ...BANK, otpCode: g })),
    );

    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    for (const r of results) {
      expect((r as PromiseRejectedResult).reason.message).toBe(GENERIC_REJECTION);
    }
    // The cap held under a genuinely interleaved race: exactly MAX comparisons were allowed.
    expect(store[0].attempts).toBe(VENDOR_PORTAL_OTP_MAX_ATTEMPTS);
    expect(store[0].lockedAt).toBeInstanceOf(Date);
    expect(allLogLines().filter((l) => l.includes('VENDOR_PORTAL_OTP_LOCKED'))).toHaveLength(1);

    // And the legitimate code is now dead too.
    await expect(
      service.submitVendorPortalBankUpdate(ORG_SLUG, PORTAL_TOKEN, { ...BANK, otpCode: code }),
    ).rejects.toThrow(GENERIC_REJECTION);
    expect(updatedVendors).toHaveLength(0);
  });

  it('concurrent replays of the correct code succeed exactly once', async () => {
    const { prisma, store, updatedVendors } = makePrisma();
    const { service, sendOtp } = makeService(prisma);
    const code = await issueCode(service, sendOtp);

    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        service.submitVendorPortalBankUpdate(ORG_SLUG, PORTAL_TOKEN, { ...BANK, otpCode: code }),
      ),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(updatedVendors).toHaveLength(1);
    expect(store[0].consumedAt).toBeInstanceOf(Date);
  });

  it('rejects an expired code with the generic message', async () => {
    const { prisma, store, updatedVendors } = makePrisma();
    const { service } = makeService(prisma);
    seedOtp(store, '123456', { expiresAt: new Date(Date.now() - 1_000) });

    await expect(
      service.submitVendorPortalBankUpdate(ORG_SLUG, PORTAL_TOKEN, { ...BANK, otpCode: '123456' }),
    ).rejects.toThrow(GENERIC_REJECTION);
    expect(updatedVendors).toHaveLength(0);
  });

  it('rejects replay of an already-consumed code', async () => {
    const { prisma, updatedVendors } = makePrisma();
    const { service, sendOtp } = makeService(prisma);
    const code = await issueCode(service, sendOtp);

    await service.submitVendorPortalBankUpdate(ORG_SLUG, PORTAL_TOKEN, { ...BANK, otpCode: code });
    expect(updatedVendors).toHaveLength(1);

    await expect(
      service.submitVendorPortalBankUpdate(ORG_SLUG, PORTAL_TOKEN, { bankRoutingNumber: '222000111', otpCode: code }),
    ).rejects.toThrow(GENERIC_REJECTION);
    expect(updatedVendors).toHaveLength(1);
  });

  it('issuing a new code invalidates the previous unconsumed code', async () => {
    const { prisma, store, updatedVendors } = makePrisma();
    const { service, sendOtp } = makeService(prisma);

    const first = await issueCode(service, sendOtp);
    let second = first;
    // 6-digit codes can collide; draw again until the two differ so the test is deterministic.
    for (let i = 0; i < 5 && second === first; i += 1) {
      second = await issueCode(service, sendOtp);
    }
    expect(second).not.toBe(first);

    const [oldRow] = store;
    expect(oldRow.expiresAt.getTime()).toBeLessThanOrEqual(Date.now());

    await expect(
      service.submitVendorPortalBankUpdate(ORG_SLUG, PORTAL_TOKEN, { ...BANK, otpCode: first }),
    ).rejects.toThrow(GENERIC_REJECTION);
    expect(updatedVendors).toHaveLength(0);

    await expect(
      service.submitVendorPortalBankUpdate(ORG_SLUG, PORTAL_TOKEN, { ...BANK, otpCode: second }),
    ).resolves.toBeDefined();
    expect(updatedVendors).toHaveLength(1);
  });

  it('refuses to issue a new code while the token is locked, so re-requesting cannot reset the cap', async () => {
    const { prisma, store } = makePrisma();
    const { service, sendOtp } = makeService(prisma);
    const code = await issueCode(service, sendOtp);

    for (let i = 0; i < VENDOR_PORTAL_OTP_MAX_ATTEMPTS; i += 1) {
      await service
        .submitVendorPortalBankUpdate(ORG_SLUG, PORTAL_TOKEN, { ...BANK, otpCode: wrongCodeFor(code) })
        .catch(() => undefined);
    }
    expect(store[0].lockedAt).toBeInstanceOf(Date);

    sendOtp.mockClear();
    await expect(service.requestVendorPortalOtp(ORG_SLUG, PORTAL_TOKEN)).rejects.toThrow('temporarily unavailable');
    expect(sendOtp).not.toHaveBeenCalled();
    expect(store).toHaveLength(1);
    expect(allLogLines().some((l) => l.includes('VENDOR_PORTAL_OTP_ISSUE_REFUSED'))).toBe(true);
  });

  it('counts failed attempts across re-issued codes (4 + 1 fresh code cannot stay under the radar)', async () => {
    const { prisma, store } = makePrisma();
    const { service, sendOtp } = makeService(prisma);
    const first = await issueCode(service, sendOtp);
    for (let i = 0; i < VENDOR_PORTAL_OTP_MAX_ATTEMPTS - 1; i += 1) {
      await service
        .submitVendorPortalBankUpdate(ORG_SLUG, PORTAL_TOKEN, { ...BANK, otpCode: wrongCodeFor(first) })
        .catch(() => undefined);
    }
    expect(store[0].attempts).toBe(VENDOR_PORTAL_OTP_MAX_ATTEMPTS - 1);
    expect(store[0].lockedAt).toBeNull();

    // 4 failures + 0 = under the cap: one re-issue is fine.
    await service.requestVendorPortalOtp(ORG_SLUG, PORTAL_TOKEN);
    expect(store).toHaveLength(2);

    // Push the cumulative total to the cap through the second code, then re-issue is refused.
    store[1].attempts = 1;
    await expect(service.requestVendorPortalOtp(ORG_SLUG, PORTAL_TOKEN)).rejects.toThrow('temporarily unavailable');
    expect(store).toHaveLength(2);
  });

  // -- secret handling ------------------------------------------------------

  it('fails closed in production when VENDOR_PORTAL_OTP_SECRET is unset (issue and verify)', async () => {
    vi.stubEnv('VENDOR_PORTAL_OTP_SECRET', '');
    vi.stubEnv('NODE_ENV', 'production');
    const { prisma, store, updatedVendors } = makePrisma();
    const { service, sendOtp } = makeService(prisma);
    seedOtp(store, '123456');

    await expect(service.requestVendorPortalOtp(ORG_SLUG, PORTAL_TOKEN)).rejects.toThrow('temporarily unavailable');
    await expect(
      service.submitVendorPortalBankUpdate(ORG_SLUG, PORTAL_TOKEN, { ...BANK, otpCode: '123456' }),
    ).rejects.toThrow('temporarily unavailable');

    expect(sendOtp).not.toHaveBeenCalled();
    expect(updatedVendors).toHaveLength(0);
    expect(store).toHaveLength(1); // only the seeded row; nothing created
    expect(store[0].attempts).toBe(0);
  });

  it('outside production an unset secret uses a random per-process key and still works', async () => {
    vi.stubEnv('VENDOR_PORTAL_OTP_SECRET', '');
    vi.stubEnv('NODE_ENV', 'test');
    const { prisma, updatedVendors } = makePrisma();
    const { service, sendOtp } = makeService(prisma);
    const code = await issueCode(service, sendOtp);

    await expect(
      service.submitVendorPortalBankUpdate(ORG_SLUG, PORTAL_TOKEN, { ...BANK, otpCode: code }),
    ).resolves.toBeDefined();
    expect(updatedVendors).toHaveLength(1);
  });

  // -- delivery / secrecy ---------------------------------------------------

  it('fails closed and invalidates the new code when delivery throws', async () => {
    const { prisma, store, updatedVendors } = makePrisma();
    const failingSend = vi.fn().mockRejectedValue(new Error('SMTP connection refused'));
    const { service } = makeService(prisma, { sendVendorPortalOtp: failingSend });

    await expect(service.requestVendorPortalOtp(ORG_SLUG, PORTAL_TOKEN)).rejects.toThrow('could not send');
    expect(failingSend).toHaveBeenCalledTimes(1);

    // The undelivered code is unusable even if someone guesses it.
    expect(store[0].expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
    const undelivered = failingSend.mock.calls[0][0].code as string;
    await expect(
      service.submitVendorPortalBankUpdate(ORG_SLUG, PORTAL_TOKEN, { ...BANK, otpCode: undelivered }),
    ).rejects.toThrow(GENERIC_REJECTION);
    expect(updatedVendors).toHaveLength(0);
  });

  it('never writes the plaintext code to logs, persisted rows, audit lines, or the response', async () => {
    const { prisma, store } = makePrisma();
    const { service, sendOtp } = makeService(prisma);
    const code = await issueCode(service, sendOtp);

    await service
      .submitVendorPortalBankUpdate(ORG_SLUG, PORTAL_TOKEN, { ...BANK, otpCode: wrongCodeFor(code) })
      .catch(() => undefined);
    await service.submitVendorPortalBankUpdate(ORG_SLUG, PORTAL_TOKEN, { ...BANK, otpCode: code });

    const everything = [
      allLogLines().join('\n'),
      JSON.stringify(store),
      JSON.stringify(prisma.vendorPortalOtp.create.mock.calls),
      JSON.stringify(prisma.vendorPortalOtp.updateMany.mock.calls),
    ].join('\n');
    expect(allLogLines().length).toBeGreaterThan(0);
    expect(everything).not.toContain(code);
    expect(everything).not.toContain(OTP_SECRET);
    expect(everything).not.toContain(PORTAL_TOKEN);
  });

  it('error messages for wrong, expired, consumed, locked and missing-row cases are identical', async () => {
    const { prisma, store } = makePrisma();
    const { service } = makeService(prisma);
    const messages: string[] = [];
    const attempt = async (otpCode: string) => {
      try {
        await service.submitVendorPortalBankUpdate(ORG_SLUG, PORTAL_TOKEN, { ...BANK, otpCode });
        messages.push('NO ERROR');
      } catch (e) {
        messages.push((e as Error).message);
      }
    };

    await attempt('123456'); // no row at all
    seedOtp(store, '123456', { expiresAt: new Date(Date.now() - 1) });
    await attempt('123456'); // expired
    store.length = 0;
    seedOtp(store, '123456', { consumedAt: new Date() });
    await attempt('123456'); // consumed
    store.length = 0;
    seedOtp(store, '123456', { attempts: 5, lockedAt: new Date() });
    await attempt('123456'); // locked
    store.length = 0;
    seedOtp(store, '123456');
    await attempt('654321'); // wrong

    expect(new Set(messages)).toEqual(new Set([GENERIC_REJECTION]));
    expect(messages).toHaveLength(5);
  });

  // -- vendor with no trusted email -----------------------------------------

  it('BLOCKS self-service bank change when the vendor has no contactEmail on file', async () => {
    for (const email of [null, '   ']) {
      const { prisma, store } = makePrisma({ vendorContactEmail: email });
      const { service, sendOtp } = makeService(prisma);

      await expect(service.requestVendorPortalOtp(ORG_SLUG, PORTAL_TOKEN)).rejects.toThrow(
        'No verified contact email is on file',
      );
      expect(sendOtp).not.toHaveBeenCalled();
      expect(store).toHaveLength(0);
    }
    expect(allLogLines().some((l) => l.includes('VENDOR_PORTAL_OTP_BLOCKED_NO_EMAIL'))).toBe(true);
  });

  // -- routes ----------------------------------------------------------------

  it('request-otp and verify routes carry a 5/min per-IP @Throttle on top of the global limiter', () => {
    const handlers = [
      InvoiceProofController.prototype.vendorPortalRequestOtp,
      InvoiceProofController.prototype.vendorPortalSubmit,
    ];
    for (const handler of handlers) {
      expect(Reflect.getMetadata('THROTTLER:LIMITpublic', handler)).toBe(5);
      expect(Reflect.getMetadata('THROTTLER:TTLpublic', handler)).toBe(60_000);
      // The global 'default' limiter must NOT be skipped for these routes.
      expect(Reflect.getMetadata('THROTTLER:SKIPdefault', handler)).not.toBe(true);
    }
  });
});
