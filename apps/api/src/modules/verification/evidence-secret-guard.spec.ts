import 'reflect-metadata';

import { ProofFinalDecision, ProofSubject } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@chain-verify/config', () => ({
  verifyApiPlanConfigs: [{ slug: 'free', monthlyRuns: 10, overageCents: null, retentionDays: 7 }],
  auditProofPlanConfigs: [],
}));

import {
  REDACTION_MARKER,
  isCredentialKeyName,
  redactCredentialsFromEvidence,
} from './evidence-secret-guard.js';
import { ProofService, computeProofChainHash } from './proof.service.js';
import { VerificationProduct } from './verification.service.js';

describe('isCredentialKeyName', () => {
  it.each([
    'netlifyToken',
    'renderToken',
    'vercelToken',
    'railwayToken',
    'sentryAuthToken',
    'api_key',
    'apiKey',
    'x-api-key',
    'Authorization',
    'clientSecret',
    'client_secret',
    'privateKey',
    'PROOF_SIGNING_PRIVATE_KEY',
    'accessKey',
    'password',
    'credentials',
    'bearer_token',
  ])('flags credential key %s', (key) => {
    expect(isCredentialKeyName(key)).toBe(true);
  });

  it.each([
    'authorization_level', // real business field present in 957 SwarmSync proofs
    'token_count',
    'max_tokens',
    'input_tokens',
    'password_policy',
    'secretary',
    'key',
    'delivery_statement',
    'chain_hash',
  ])('does not flag business field %s', (key) => {
    expect(isCredentialKeyName(key)).toBe(false);
  });
});

describe('redactCredentialsFromEvidence', () => {
  it('removes credentials at any depth, keeps business fields, never mutates the input', () => {
    const input = [
      {
        submitted_output: {
          delivery_statement: 'shipped',
          authorization_level: 'L2',
          netlifyToken: 'nfp_THIS_MUST_NOT_SURVIVE',
          nested: { deep: [{ sentryAuthToken: 'sntrys_ALSO_SECRET' }] },
        },
      },
    ];
    const snapshot = JSON.stringify(input);

    const { evidence, redactions } = redactCredentialsFromEvidence(input);

    expect(JSON.stringify(input)).toBe(snapshot);
    const text = JSON.stringify(evidence);
    expect(text).not.toContain('nfp_THIS_MUST_NOT_SURVIVE');
    expect(text).not.toContain('sntrys_ALSO_SECRET');
    expect(evidence[0]!.submitted_output.authorization_level).toBe('L2');
    expect(evidence[0]!.submitted_output.delivery_statement).toBe('shipped');
    expect(evidence[0]!.submitted_output.netlifyToken).toBe(REDACTION_MARKER);
    expect(redactions.map((r) => r.keyName).sort()).toEqual(['netlifyToken', 'sentryAuthToken']);
    expect(redactions.every((r) => !JSON.stringify(r).includes('THIS_MUST_NOT_SURVIVE'))).toBe(true);
  });

  it('removes credential-shaped values hidden in free text', () => {
    const { evidence, redactions } = redactCredentialsFromEvidence({
      log: 'curl -H "Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789" and sk_live_abcdefghijklmnop',
      key: 'ag_live_0123456789abcdef0123',
    });
    const text = JSON.stringify(evidence);
    expect(text).not.toContain('abcdefghijklmnopqrstuvwxyz0123456789');
    expect(text).not.toContain('sk_live_abcdefghijklmnop');
    expect(text).not.toContain('ag_live_0123456789abcdef0123');
    expect(redactions.length).toBe(2);
  });

  it('leaves clean evidence structurally identical', () => {
    const clean = [{ source: 'x', checks: [{ id: 'B1', status: 'PASS' }], n: 3, ok: true, none: null }];
    const { evidence, redactions } = redactCredentialsFromEvidence(clean);
    expect(redactions).toEqual([]);
    expect(evidence).toEqual(clean);
  });
});

describe('ProofService.createProof secret-safety boundary', () => {
  function buildService() {
    const created = { id: 'prf_test_1', createdAt: new Date('2026-10-14T00:00:00Z') };
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
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    return { service: new ProofService(prisma as never), tx };
  }

  it('never persists or hashes a submitted deploy token, and records that it was removed', async () => {
    const { service, tx } = buildService();
    const evidence = [
      {
        source: 'software_delivery_document',
        submitted_output: {
          delivery_statement: 'released v2',
          authorization_level: 'L2',
          netlifyToken: 'nfp_PERSISTED_SECRET_VALUE',
        },
      },
    ];

    const record = await service.createProof(
      'org_1',
      'run_1',
      VerificationProduct.DOCUMENT_VERIFY,
      ProofSubject.DOCUMENT,
      'summary',
      evidence as never,
      ProofFinalDecision.APPROVED,
    );

    const stored = tx.proofRecord.create.mock.calls[0]![0].data.evidence as Array<Record<string, any>>;
    const storedText = JSON.stringify(stored);
    expect(storedText).not.toContain('nfp_PERSISTED_SECRET_VALUE');
    expect(stored[0]!.submitted_output.authorization_level).toBe('L2');
    expect(stored[0]!.submitted_output.netlifyToken).toBe(REDACTION_MARKER);

    const notice = stored.find((e) => e.source === 'secret_safety_boundary');
    expect(notice?.redaction_count).toBe(1);
    expect(JSON.stringify(notice)).not.toContain('nfp_PERSISTED_SECRET_VALUE');

    // The chain hash must be computed over exactly what was stored (the redacted form).
    expect(record.chain_hash).toBe(
      computeProofChainHash({
        id: 'prf_test_1',
        orgId: 'org_1',
        summary: 'summary',
        evidence: stored,
        prevChainHash: '',
      }),
    );
  });

  it('leaves clean evidence untouched (no notice appended)', async () => {
    const { service, tx } = buildService();
    const evidence = [{ source: 'x', issues_found: [] }];
    await service.createProof(
      'org_1',
      'run_1',
      VerificationProduct.DOCUMENT_VERIFY,
      ProofSubject.DOCUMENT,
      'summary',
      evidence as never,
      ProofFinalDecision.APPROVED,
    );
    expect(tx.proofRecord.create.mock.calls[0]![0].data.evidence).toEqual(evidence);
  });
});
