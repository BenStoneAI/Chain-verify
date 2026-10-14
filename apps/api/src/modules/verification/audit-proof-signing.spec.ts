import 'reflect-metadata';

import {
  generateKeyPairSync,
  verify as cryptoVerify,
  type KeyObject,
} from 'crypto';

import { ServiceUnavailableException } from '@nestjs/common';
import { ProofFinalDecision, ProofSubject } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@chain-verify/config', () => ({
  verifyApiPlanConfigs: [{ slug: 'free', monthlyRuns: 10, overageCents: null, retentionDays: 7 }],
  auditProofPlanConfigs: [],
}));

import {
  classifySigningError,
  presentProofSigning,
  resetAuditProofSigningWarnings,
  signProofChainHash,
} from './audit-proof-signing.js';
import { auditProofCreateOptions, evaluateProofFreshness } from './audit-proof-freshness.js';
import { ProofService } from './proof.service.js';
import { VerificationProduct } from './verification.service.js';

const KEY_ENV = 'PROOF_SIGNING_PRIVATE_KEY';
const REQUIRED_ENV = 'PROOF_SIGNING_REQUIRED';

/** A real Ed25519 key, PKCS8 DER, base64 - the exact format the service expects. */
function makeEd25519(): { b64: string; publicKey: KeyObject } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const der = privateKey.export({ format: 'der', type: 'pkcs8' });
  return { b64: Buffer.from(der).toString('base64'), publicKey };
}

function buildService() {
  const created = { id: 'prf_sign_1', createdAt: new Date('2026-10-14T00:00:00Z') };
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(undefined),
    proofRecord: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(created),
      update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        ...created,
        ...data,
      })),
    },
  };
  const prisma = {
    verificationRun: { findUnique: vi.fn().mockResolvedValue({ id: 'run_1', status: 'PASSED' }) },
    proofRecord: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    $transaction: vi.fn(async (arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (t: typeof tx) => unknown)(tx)
        : Promise.all(arg as Promise<unknown>[]),
    ),
  };
  return { service: new ProofService(prisma as never), tx, prisma };
}

function create(
  service: ProofService,
  options?: { evidenceFingerprint?: string; staleAfter?: Date },
) {
  return service.createProof(
    'org_1',
    'run_1',
    VerificationProduct.DOCUMENT_VERIFY,
    ProofSubject.DOCUMENT,
    'summary',
    [{ source: 'unit-test' }] as never,
    ProofFinalDecision.APPROVED,
    undefined,
    options,
  );
}

let savedKey: string | undefined;
let savedRequired: string | undefined;
let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  savedKey = process.env[KEY_ENV];
  savedRequired = process.env[REQUIRED_ENV];
  delete process.env[KEY_ENV];
  delete process.env[REQUIRED_ENV];
  resetAuditProofSigningWarnings();
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  if (savedKey === undefined) delete process.env[KEY_ENV];
  else process.env[KEY_ENV] = savedKey;
  if (savedRequired === undefined) delete process.env[REQUIRED_ENV];
  else process.env[REQUIRED_ENV] = savedRequired;
  vi.restoreAllMocks();
});

function allLogged(): string {
  return JSON.stringify([...warnSpy.mock.calls, ...errorSpy.mock.calls]);
}

describe('createProof signing: missing key -> UNSIGNED (explicit, logged once)', () => {
  it('persists signingStatus UNSIGNED with no signature and no error', async () => {
    const { service, tx } = buildService();
    const proof = await create(service);
    const data = tx.proofRecord.update.mock.calls[0][0].data;
    expect(data.signingStatus).toBe('UNSIGNED');
    expect(data.proof_signature).toBeNull();
    expect(data.signingError).toBeNull();
    expect(proof.signingStatus).toBe('UNSIGNED');
  });

  it('emits exactly one structured warning per process, however many proofs', async () => {
    const { service } = buildService();
    await create(service);
    await create(service);
    await create(service);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(warnSpy.mock.calls[0][0]));
    expect(payload).toMatchObject({ event: 'proof_signing_unsigned', status: 'UNSIGNED' });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('a blank key counts as absent', () => {
    process.env[KEY_ENV] = '   ';
    expect(signProofChainHash('ab'.repeat(32)).status).toBe('UNSIGNED');
  });
});

describe('createProof signing: invalid key -> SIGNING_FAILED, no key material anywhere', () => {
  const SECRET = 'TOPSECRETKEYMATERIAL0123456789abcdefTOPSECRET';

  it('records SIGNING_FAILED with only an error class, and leaks nothing', async () => {
    process.env[KEY_ENV] = Buffer.from(SECRET).toString('base64');
    const { service, tx } = buildService();
    const proof = await create(service);

    const data = tx.proofRecord.update.mock.calls[0][0].data;
    expect(data.signingStatus).toBe('SIGNING_FAILED');
    expect(data.proof_signature).toBeNull();
    expect(data.signingError).toMatch(/^KEY_UNUSABLE/);

    // Nothing persisted, returned or logged may contain the key (raw or base64).
    const b64 = Buffer.from(SECRET).toString('base64');
    const everything = JSON.stringify({ data, proof }) + allLogged();
    expect(everything).not.toContain(SECRET);
    expect(everything).not.toContain(b64);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(errorSpy.mock.calls[0][0]));
    expect(payload).toMatchObject({ event: 'proof_signing_failed', status: 'SIGNING_FAILED' });
    expect(payload.reason).toBe(data.signingError);
  });

  it('a well-formed key of the wrong algorithm is SIGNING_FAILED (KEY_NOT_ED25519)', () => {
    const { privateKey } = generateKeyPairSync('ed448');
    process.env[KEY_ENV] = Buffer.from(
      privateKey.export({ format: 'der', type: 'pkcs8' }),
    ).toString('base64');
    const r = signProofChainHash('cd'.repeat(32));
    expect(r).toEqual({ status: 'SIGNING_FAILED', signature: null, error: 'KEY_NOT_ED25519' });
  });

  it('classifySigningError discards the message and keeps only a whitelisted class', () => {
    const leaky = Object.assign(new Error(`bad key ${SECRET}`), { code: 'ERR_OSSL_UNSUPPORTED' });
    expect(classifySigningError(leaky)).toBe('KEY_UNUSABLE_ERR_OSSL_UNSUPPORTED');
    expect(classifySigningError(new TypeError(`has ${SECRET}`))).toBe('KEY_UNUSABLE_TypeError');
    // A hostile code / name that is not a plain identifier is dropped entirely.
    const hostile = Object.assign(new Error('x'), { code: SECRET.toLowerCase() + ' with spaces' });
    hostile.name = `Weird ${SECRET}`;
    const out = classifySigningError(hostile);
    expect(out).toBe('KEY_UNUSABLE');
    expect(out).not.toContain(SECRET);
    expect(classifySigningError('a string was thrown')).toBe('KEY_UNUSABLE');
  });
});

describe('PROOF_SIGNING_REQUIRED fails closed', () => {
  it('missing key + required: throws ServiceUnavailableException and opens no transaction', async () => {
    process.env[REQUIRED_ENV] = 'true';
    const { service, prisma, tx } = buildService();
    await expect(create(service)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.proofRecord.create).not.toHaveBeenCalled();
  });

  it('invalid key + required: throws, and never writes a proof row update', async () => {
    process.env[REQUIRED_ENV] = 'true';
    process.env[KEY_ENV] = Buffer.from('not-a-der-key').toString('base64');
    const { service, tx } = buildService();
    await expect(create(service)).rejects.toBeInstanceOf(ServiceUnavailableException);
    // The throw happens inside the transaction callback, so the DB rolls back the
    // row created for the chain hash; the update that would persist it never runs.
    expect(tx.proofRecord.update).not.toHaveBeenCalled();
    expect(allLogged()).not.toContain(Buffer.from('not-a-der-key').toString('base64'));
  });

  it('the error message carries no key material', async () => {
    process.env[REQUIRED_ENV] = '1';
    process.env[KEY_ENV] = 'c2VjcmV0LWtleS1tYXRlcmlhbC1sZWFr';
    const { service } = buildService();
    const err = await create(service).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect(String((err as Error).message)).not.toContain('c2VjcmV0');
    expect(String((err as Error).message)).toMatch(/SIGNING_FAILED/);
  });

  it('valid key + required: signs normally', async () => {
    process.env[REQUIRED_ENV] = 'true';
    process.env[KEY_ENV] = makeEd25519().b64;
    const { service } = buildService();
    const proof = await create(service);
    expect(proof.signingStatus).toBe('SIGNED');
  });

  it('required=false / unset leaves unsigned proofs permitted', async () => {
    process.env[REQUIRED_ENV] = 'false';
    const { service } = buildService();
    const proof = await create(service);
    expect(proof.signingStatus).toBe('UNSIGNED');
  });
});

describe('createProof signing: success', () => {
  it('stores SIGNED plus a real Ed25519 signature over the chain hash', async () => {
    const { b64, publicKey } = makeEd25519();
    process.env[KEY_ENV] = b64;
    const { service, tx } = buildService();
    const proof = await create(service);

    const data = tx.proofRecord.update.mock.calls[0][0].data;
    expect(data.signingStatus).toBe('SIGNED');
    expect(data.signingError).toBeNull();
    expect(typeof data.proof_signature).toBe('string');

    const ok = cryptoVerify(
      null,
      Buffer.from(String(data.chain_hash), 'hex'),
      publicKey,
      Buffer.from(String(data.proof_signature), 'base64'),
    );
    expect(ok).toBe(true);
    expect(proof.signingStatus).toBe('SIGNED');
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe('createProof options (evidence fingerprint / stale_after)', () => {
  it('persists both columns when supplied', async () => {
    const { service, tx } = buildService();
    const staleAfter = new Date('2026-11-13T12:00:00Z');
    await create(service, { evidenceFingerprint: 'f'.repeat(64), staleAfter });
    const data = tx.proofRecord.update.mock.calls[0][0].data;
    expect(data.evidenceFingerprint).toBe('f'.repeat(64));
    expect(data.staleAfter).toEqual(staleAfter);
  });

  it('existing 8-argument callers are unaffected (columns not written)', async () => {
    const { service, tx } = buildService();
    await create(service);
    const data = tx.proofRecord.update.mock.calls[0][0].data;
    expect('evidenceFingerprint' in data).toBe(false);
    expect('staleAfter' in data).toBe(false);
  });

  it('auditProofCreateOptions maps a report and drops unreadable values', () => {
    const when = '2026-11-13T12:00:00.000Z';
    expect(auditProofCreateOptions({ evidence_fingerprint: 'abc', stale_after: when })).toEqual({
      evidenceFingerprint: 'abc',
      staleAfter: new Date(when),
    });
    expect(auditProofCreateOptions({ evidence_fingerprint: '', stale_after: 'nope' })).toEqual({});
    expect(auditProofCreateOptions(undefined)).toEqual({});
  });
});

describe('an unsigned record is never presented as signed', () => {
  it('SIGNED with a stored signature is the only signed state', () => {
    expect(
      presentProofSigning({ signingStatus: 'SIGNED', proof_signature: 'c2ln', signingError: null }),
    ).toEqual({ signing_status: 'SIGNED', signed: true, signing_error: null });
  });

  it('UNSIGNED and SIGNING_FAILED are not signed', () => {
    expect(presentProofSigning({ signingStatus: 'UNSIGNED', proof_signature: null })).toEqual({
      signing_status: 'UNSIGNED',
      signed: false,
      signing_error: null,
    });
    expect(
      presentProofSigning({
        signingStatus: 'SIGNING_FAILED',
        signingError: 'KEY_UNUSABLE_TypeError',
        proof_signature: null,
      }),
    ).toEqual({
      signing_status: 'SIGNING_FAILED',
      signed: false,
      signing_error: 'KEY_UNUSABLE_TypeError',
    });
  });

  it('a SIGNED label without a stored signature is downgraded to UNSIGNED', () => {
    expect(presentProofSigning({ signingStatus: 'SIGNED', proof_signature: null })).toMatchObject({
      signing_status: 'UNSIGNED',
      signed: false,
    });
  });

  it('a legacy row (no status) is derived from its signature', () => {
    expect(presentProofSigning({ proof_signature: 'c2ln' }).signing_status).toBe('SIGNED');
    expect(presentProofSigning({ proof_signature: null }).signing_status).toBe('UNSIGNED');
  });

  it('listAnonymousProofSummaries exposes signing_status per proof', async () => {
    const { service, prisma } = buildService();
    const row = (id: string, signingStatus: string, sig: string | null) => ({
      id,
      verificationRunId: 'run_' + id,
      product: 'AUDIT_PROOF',
      subject: 'GOVERNANCE_POLICY',
      summary: 's',
      finalDecision: 'APPROVED',
      proofStatus: 'CREATED',
      chain_hash: 'h',
      proof_signature: sig,
      signingStatus,
      createdAt: new Date('2026-10-14T00:00:00Z'),
      verificationRun: {
        status: 'PASSED',
        riskLevel: 'LOW',
        confidence: 0.9,
        inputSummary: 'i',
        outputSummary: 'o',
        issuesFound: [],
      },
    });
    prisma.proofRecord.findMany.mockResolvedValue([
      row('a', 'SIGNED', 'c2ln'),
      row('b', 'UNSIGNED', null),
      row('c', 'SIGNING_FAILED', null),
    ]);
    prisma.proofRecord.count.mockResolvedValue(3);
    const res = await service.listAnonymousProofSummaries({});
    expect(res.data.map((d) => d.signing_status)).toEqual(['SIGNED', 'UNSIGNED', 'SIGNING_FAILED']);
    const select = prisma.proofRecord.findMany.mock.calls[0][0].select;
    expect(select.signingStatus).toBe(true);
  });
});

describe('proof freshness through ProofService', () => {
  it('is CURRENT inside the window with a matching fingerprint, STALE otherwise', async () => {
    const { service, prisma } = buildService();
    prisma.proofRecord.findUnique.mockResolvedValue({
      id: 'p1',
      orgId: 'org_1',
      evidenceFingerprint: 'a'.repeat(64),
      staleAfter: new Date('2026-11-13T12:00:00Z'),
    });
    const now = new Date('2026-10-14T12:00:00Z');
    expect((await service.getProofFreshness('org_1', 'p1', 'a'.repeat(64), now)).state).toBe('CURRENT');

    const changed = await service.getProofFreshness('org_1', 'p1', 'b'.repeat(64), now);
    expect(changed.state).toBe('STALE');
    expect(changed.reason_codes).toContain('fingerprint_changed');

    const expired = await service.getProofFreshness(
      'org_1',
      'p1',
      'a'.repeat(64),
      new Date('2026-12-01T00:00:00Z'),
    );
    expect(expired.reason_codes).toEqual(['age_expired']);
  });

  it('a pre-existing unsigned row with no binding is STALE, never CURRENT', () => {
    const r = evaluateProofFreshness(
      { evidenceFingerprint: null, staleAfter: null },
      undefined,
      new Date('2026-10-14T00:00:00Z'),
    );
    expect(r.state).toBe('STALE');
    expect(r.reason_codes).toEqual(['no_freshness_binding']);
  });
});
