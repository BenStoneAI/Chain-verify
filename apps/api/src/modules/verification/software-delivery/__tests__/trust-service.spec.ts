/**
 * SoftwareDeliveryService with the Agent Gate trust layer wired in.
 *
 * Real check services are used where the behaviour under test lives
 * (deployment SHA equality); GitHub/CI/live probes are stubbed. HTTP is mocked
 * (vi.mock('axios')) and Prisma is a recording stub: no network, no database.
 */
import { generateKeyPairSync, sign as cryptoSign, type KeyObject } from 'node:crypto';
import { beforeEach, describe, expect, it, vi, type Mocked } from 'vitest';
import axios from 'axios';
import { SoftwareDeliveryService } from '../software-delivery.service.js';
import { SoftwareDeliveryEscalationService } from '../software-delivery-escalation.js';
import { DeploymentChecksService } from '../checks/deployment-checks.service.js';
import type { CheckResult } from '../software-delivery.types.js';
import {
  StaticReceiptTrustStore,
  canonicalJsonBytes,
  computeReceiptId,
  keyIdForPublicKey,
  receiptBody,
} from '../trust/index.js';

vi.mock('axios');
const mockedAxios = axios as Mocked<typeof axios>;

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
}));

// ------------------------------------------------------------------ fixtures

const OWNER = 'acme';
const NAME = 'widgets';
const AFTER = '9f8e7d6c5b4a39281706f5e4d3c2b1a098765432';
const OTHER = '0123456789abcdef0123456789abcdef01234567';
const TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const DIRTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const NOW = new Date('2026-10-14T12:30:00.000Z');

type Obj = Record<string, unknown>;

interface TestKey {
  privateKey: KeyObject;
  publicKeyHex: string;
  kid: string;
}

function makeKey(): TestKey {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const spki = publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
  const raw = spki.subarray(spki.length - 32);
  return { privateKey, publicKeyHex: raw.toString('hex'), kid: keyIdForPublicKey(raw) };
}

function receiptBodyFor(overrides: Obj = {}): Obj {
  return {
    receipt_version: '0.1',
    created_at: '2026-10-14T12:00:00.000000Z',
    gate: { tool: 'agentgate', version: '0.1.0', host: 'dev', signing_key_id: null },
    repo: {
      remote: `https://github.com/${OWNER}/${NAME}.git`,
      root: '/work/widgets',
      branch: 'main',
      base_sha: '1'.repeat(40),
      head_sha: AFTER,
      tree_sha: TREE,
      dirty_hash: DIRTY,
      tree_clean: true,
      pushed: true,
    },
    changed_files: ['src/invoice.ts'],
    tests: {
      required: ['npm test'],
      runs: [
        {
          run_id: 'run_1',
          cmd: 'npm test',
          started_at: '2026-10-14T11:59:00.000000Z',
          finished_at: '2026-10-14T11:59:30.000000Z',
          exit_code: 0,
          tree_sha: TREE,
          dirty_hash: DIRTY,
          stdout_sha256: 'b'.repeat(64),
          summary: '12 passed',
          recorded_by: 'gate',
          suspicious: false,
          suspicion_reasons: [],
        },
      ],
    },
    status: { computed: 'TESTED', reasons: {} },
    ...overrides,
  };
}

function seal(body: Obj, key: TestKey | null): Obj {
  const out: Obj = { ...receiptBody(body) };
  out['receipt_id'] = computeReceiptId(out);
  if (key) {
    const sig = cryptoSign(null, canonicalJsonBytes(receiptBody(out)), key.privateKey);
    out['signature'] = { alg: 'ed25519', kid: key.kid, sig: sig.toString('base64') };
  }
  return out;
}

const pass = (id: string, extra: Partial<CheckResult> = {}): CheckResult => ({
  checkId: id,
  checkName: id,
  tier: 'BASIC',
  status: 'PASS',
  ...extra,
});
const warn = (id: string, detail = 'warning'): CheckResult => ({
  checkId: id,
  checkName: id,
  tier: 'STANDARD',
  status: 'WARNING',
  detail,
});
const skip = (id: string): CheckResult => ({
  checkId: id,
  checkName: id,
  tier: 'STANDARD',
  status: 'SKIP',
  detail: 'no evidence',
});

interface Scenario {
  diffText?: string;
  diffFiles?: string[];
  s9?: CheckResult;
  s2?: CheckResult;
  b6?: CheckResult;
  s8?: CheckResult;
  dep4?: CheckResult;
}

function build(s: Scenario = {}) {
  const create = vi.fn().mockResolvedValue({ id: 'ver-1', proofId: 'sdv_1' });
  const update = vi.fn().mockResolvedValue({});
  const createMany = vi.fn().mockResolvedValue({ count: 1 });
  const prisma = {
    softwareDeliveryVerification: { create, update },
    softwareDeliveryCheckResult: { createMany },
  };
  const github = {
    getDiffFiles: vi.fn().mockResolvedValue(s.diffFiles ?? ['src/invoice.ts']),
    getDiffText: vi.fn().mockResolvedValue(s.diffText ?? '+++ b/src/invoice.ts\n+export const total = 1;'),
    checkWorkExists: vi.fn().mockResolvedValue(pass('B1')),
    checkCommitTiming: vi.fn().mockResolvedValue(pass('B2')),
    checkFilesInScope: vi.fn().mockResolvedValue(pass('B3')),
    checkPrMerged: vi.fn().mockResolvedValue(skip('B7')),
    checkCiPassed: vi.fn().mockResolvedValue(s.s9 ?? warn('S9', 'No CI workflow run found')),
  };
  const live = {
    checkLiveSite: vi.fn().mockResolvedValue(s.b6 ?? pass('B6')),
    checkHealthEndpoint: vi.fn().mockResolvedValue(s.dep4 ?? skip('DEP4')),
    checkFeatureReachable: vi.fn().mockResolvedValue(s.s8 ?? skip('S8')),
  };
  const buildStub = {
    runBuildChecks: vi.fn(async (_o: string, _r: string, _s: string, list: string[]) =>
      ['B5', 'S2', 'S4', 'S5']
        .filter((id) => list.includes(id))
        .map((id) => (id === 'S2' && s.s2 ? s.s2 : skip(id))),
    ),
  };
  const noop = {};
  const service = new SoftwareDeliveryService(
    prisma as never,
    new SoftwareDeliveryEscalationService(),
    github as never,
    live as never,
    noop as never,
    noop as never,
    new DeploymentChecksService(),
    noop as never,
    buildStub as never,
    noop as never,
  );
  return { service, create, update, createMany, github };
}

function dto(overrides: Obj = {}): never {
  return {
    repoOwner: OWNER,
    repoName: NAME,
    beforeSha: '1'.repeat(40),
    afterSha: AFTER,
    jobStartedAt: '2026-10-14T10:00:00Z',
    tier: 'BASIC',
    jobType: 'BUG_FIX',
    jobDescription: 'Fix invoice rounding',
    ...overrides,
  } as never;
}

const trusted = makeKey();
const trustStore = new StaticReceiptTrustStore([trusted.publicKeyHex]);

function lastUpdate(update: ReturnType<typeof vi.fn>): Obj {
  const call = update.mock.calls[update.mock.calls.length - 1][0] as { data: Obj };
  return call.data;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// --------------------------------------------------------------------- tests

describe('SoftwareDeliveryService trust layer', () => {
  it('AgentGate-observed test evidence reaches TESTED, is not capped, and is persisted', async () => {
    const { service, update, createMany } = build();
    const result = await service.verify(
      dto({ aiReport: 'Fixed rounding; all tests pass.', agentGateReceipt: seal(receiptBodyFor(), trusted) }),
      ['B1', 'S2', 'AG1', 'AG2'],
      { now: NOW, receiptTrustStore: trustStore },
    );

    const ag1 = result.results.find((r) => r.checkId === 'AG1');
    expect(ag1?.status).toBe('PASS');
    expect(ag1?.provenance).toBe('OBSERVED_BY_AGENT_GATE');
    expect(result.lifecycleStatus).toBe('TESTED');
    expect(result.confidenceCapped).toBe(false);
    expect(result.confidence).toBe(1);
    expect(result.verificationStatus).toBe('passed');
    expect(result.receipt).toMatchObject({ accepted: true, testsObserved: true, signatureTrusted: true });
    expect((result.provenanceSummary['counts'] as Obj)['OBSERVED_BY_AGENT_GATE']).toBe(1);

    const data = lastUpdate(update);
    expect(data).toMatchObject({
      headSha: AFTER,
      lifecycleStatus: 'TESTED',
      confidenceCapReason: null,
      receiptId: expect.stringMatching(/^rcpt_[0-9a-f]{16}$/),
      evidenceFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect((data['staleAfter'] as Date).toISOString()).toBe('2026-10-15T12:30:00.000Z');
    expect((data['provenanceSummary'] as Obj)['version']).toBe(1);

    // every persisted check row carries evidence._provenance
    const rows = (createMany.mock.calls[0][0] as { data: Array<{ checkId: string; evidence: Obj }> }).data;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.evidence['_provenance']).toMatchObject({ provenance: expect.any(String) });
    }
    expect(rows.find((r) => r.checkId === 'AG1')?.evidence['_provenance']).toMatchObject({
      provenance: 'OBSERVED_BY_AGENT_GATE',
    });
  });

  it('self-reported test evidence is capped, downgraded to review, and explained', async () => {
    const { service, update } = build({ s9: warn('S9', 'No CI workflow run found for this commit') });
    const result = await service.verify(
      dto({ aiReport: 'Fixed the rounding bug. All tests pass and the build is green.' }),
      ['B1', 'S2', 'S9', 'AG1', 'AG2'],
      { now: NOW, receiptTrustStore: trustStore },
    );
    expect(result.engineConfidence).toBeGreaterThan(0.6);
    expect(result.confidence).toBe(0.6);
    expect(result.confidenceCapped).toBe(true);
    expect(result.confidenceCapReason).toMatch(/capped at 0\.6/);
    expect(result.confidenceCapReason).toMatch(/tests passed/);
    expect(result.verificationStatus).not.toBe('passed');
    expect(result.recommendedAction).toBe('human_review');
    expect(result.lifecycleStatus).toBe('IMPLEMENTED');
    expect(result.lifecycle.blocked.TESTED).toMatch(/No observed test execution/);
    expect(lastUpdate(update)['confidenceCapReason']).toBe(result.confidenceCapReason);
  });

  it('CI success observed by the provider lifts the cap and reaches INTEGRATED', async () => {
    const { service } = build({ s9: pass('S9', { tier: 'STANDARD', evidence: { runId: 7, conclusion: 'success' } }) });
    const result = await service.verify(dto({ aiReport: 'All tests pass.' }), ['B1', 'S2', 'S9', 'AG1'], {
      now: NOW,
      receiptTrustStore: trustStore,
    });
    expect(result.confidenceCapped).toBe(false);
    expect(result.lifecycleStatus).toBe('INTEGRATED');
  });

  it('a tampered receipt does not raise confidence and flags the receipt invalid', async () => {
    const forged = JSON.parse(JSON.stringify(seal(receiptBodyFor(), trusted))) as Obj;
    ((forged['tests'] as Obj)['runs'] as Obj[])[0]['summary'] = '999 passed';

    const run = (agentGateReceipt?: Obj) =>
      build({ s9: warn('S9', 'No CI workflow run found') }).service.verify(
        dto({ aiReport: 'All tests pass.', agentGateReceipt }),
        ['B1', 'S2', 'S9', 'AG1'],
        { now: NOW, receiptTrustStore: trustStore },
      );
    const none = await run(undefined);
    const bad = await run(forged);

    const ag1 = bad.results.find((r) => r.checkId === 'AG1');
    expect(ag1?.status).toBe('FAIL');
    expect(ag1?.detail).toContain('HASH_MISMATCH');
    expect(bad.confidence).toBeLessThanOrEqual(none.confidence);
    expect((bad.provenanceSummary['counts'] as Obj)['OBSERVED_BY_AGENT_GATE']).toBe(0);
    expect(bad.lifecycleStatus).toBe('IMPLEMENTED');
    expect(bad.lifecycle.flags.invalidReceipt).toBe(true);
    expect(bad.receipt.accepted).toBe(false);
  });

  it('a receipt for a different commit is not evidence for this one', async () => {
    const wrongHead = seal(receiptBodyFor({ repo: { ...(receiptBodyFor()['repo'] as Obj), head_sha: OTHER } }), trusted);
    const { service } = build();
    const result = await service.verify(dto({ agentGateReceipt: wrongHead }), ['B1', 'AG1'], {
      now: NOW,
      receiptTrustStore: trustStore,
    });
    const ag1 = result.results.find((r) => r.checkId === 'AG1');
    expect(ag1?.status).toBe('FAIL');
    expect(ag1?.detail).toContain('HEAD_MISMATCH');
    expect(result.lifecycleStatus).toBe('IMPLEMENTED');
  });

  it('does not validate (or trust) a receipt when AG1 is not part of the run', async () => {
    const { service } = build();
    const result = await service.verify(dto({ agentGateReceipt: seal(receiptBodyFor(), trusted) }), ['B1'], {
      now: NOW,
      receiptTrustStore: trustStore,
    });
    expect(result.receipt.submitted).toBe(false);
    expect(result.lifecycleStatus).toBe('IMPLEMENTED');
  });

  it('reports AG1 as a SKIP (unable) when no receipt is supplied, leaving the CI path untouched', async () => {
    const { service } = build();
    const result = await service.verify(dto(), ['B1', 'AG1', 'AG2'], { now: NOW, receiptTrustStore: trustStore });
    const ag1 = result.results.find((r) => r.checkId === 'AG1');
    expect(ag1?.status).toBe('SKIP');
    expect(result.receipt.submitted).toBe(false);
    expect(result.coverage).toMatchObject({ expected: 3, executed: 2, passed: 2, unable: 1, skipped: 0 });
    expect(result.coverage.reasons[0]).toMatchObject({ checkId: 'AG1', outcome: 'UNABLE' });
    expect(result.confidenceCapped).toBe(false);
  });

  it('flags suppression added to a CI workflow and in submitted receipt commands', async () => {
    const diffText = [
      '+++ b/.github/workflows/ci.yml',
      '@@ -1 +1,2 @@',
      '+      - run: npm test || true',
      '+++ b/package.json',
      '+    "test": "jest --passWithNoTests"',
    ].join('\n');
    const { service } = build({ diffText });
    const result = await service.verify(dto(), ['B1', 'AG2'], { now: NOW, receiptTrustStore: trustStore });
    const ag2 = result.results.find((r) => r.checkId === 'AG2');
    expect(ag2?.status).toBe('FAIL');
    expect(ag2?.detail).toContain('|| true');
    expect(ag2?.detail).toContain('--passWithNoTests');
    expect(result.issuesFound.map((i) => i.checkId)).toContain('AG2');
    expect(result.verificationStatus).not.toBe('passed');
  });

  it('keeps the PostgreSQL SKIP LOCKED exemption end to end', async () => {
    const diffText = '+++ b/src/queue.ts\n+const q = "SELECT * FROM jobs FOR UPDATE SKIP LOCKED";';
    const { service } = build({ diffText });
    const result = await service.verify(dto(), ['B1', 'AG2'], { now: NOW, receiptTrustStore: trustStore });
    expect(result.results.find((r) => r.checkId === 'AG2')?.status).toBe('PASS');
  });

  it('honours AGENT_GATE_EVIDENCE_MAX_AGE_HOURS for the validity window', async () => {
    const previous = process.env['AGENT_GATE_EVIDENCE_MAX_AGE_HOURS'];
    process.env['AGENT_GATE_EVIDENCE_MAX_AGE_HOURS'] = '2';
    try {
      const { service } = build();
      const result = await service.verify(dto(), ['B1'], { now: NOW, receiptTrustStore: trustStore });
      expect(result.staleAfter).toBe('2026-10-14T14:30:00.000Z');
      expect(result.freshness.state).toBe('CURRENT');
    } finally {
      if (previous === undefined) delete process.env['AGENT_GATE_EVIDENCE_MAX_AGE_HOURS'];
      else process.env['AGENT_GATE_EVIDENCE_MAX_AGE_HOURS'] = previous;
    }
  });
});

describe('deployment SHA equality (real DeploymentChecksService, mocked provider API)', () => {
  const RENDER = {
    deployPlatform: 'RENDER',
    renderServiceId: 'srv-1',
    renderToken: 'render-test-token',
    deployUrl: 'https://widgets.example.com',
  };

  function renderDeploys(sha: string) {
    mockedAxios.get.mockImplementation((url: string) => {
      if (url.includes('api.render.com')) {
        return Promise.resolve({
          data: [{ deploy: { id: 'dep-9', status: 'live', commit: { id: sha }, createdAt: '2026-10-14T11:00:00Z' } }],
        });
      }
      return Promise.resolve({ status: 200, data: '' });
    });
  }

  const ciPass = pass('S9', { tier: 'STANDARD', evidence: { runId: 11, conclusion: 'success' } });

  it('deployed SHA equal to afterSha: DEP3 passes with both SHAs recorded and lifecycle reaches DEPLOYED', async () => {
    renderDeploys(AFTER);
    const { service } = build({ s9: ciPass });
    const result = await service.verify(dto(RENDER), ['B1', 'S9', 'B6', 'S10', 'DEP3'], {
      now: NOW,
      receiptTrustStore: trustStore,
    });
    const dep3 = result.results.find((r) => r.checkId === 'DEP3');
    expect(dep3?.status).toBe('PASS');
    expect(dep3?.provenance).toBe('OBSERVED_BY_REMOTE_PROVIDER');
    expect(dep3?.evidence).toMatchObject({
      provider: 'RENDER',
      deployedSha: AFTER,
      expectedSha: AFTER,
      shaMatch: true,
      deploymentId: 'dep-9',
      state: 'live',
    });
    expect(result.lifecycleStatus).toBe('DEPLOYED');
    expect(result.lifecycle.deploy).toMatchObject({ shaMatch: true, healthy: true, deploymentId: 'dep-9' });
    expect(result.confidenceCapped).toBe(false);
  });

  it('a successful deployment of a different SHA is a FAIL naming the exact SHAs, and is not DEPLOYED', async () => {
    renderDeploys(OTHER);
    const { service } = build({ s9: ciPass });
    const result = await service.verify(dto(RENDER), ['B1', 'S9', 'B6', 'S10', 'DEP3'], {
      now: NOW,
      receiptTrustStore: trustStore,
    });
    const dep3 = result.results.find((r) => r.checkId === 'DEP3');
    expect(dep3?.status).toBe('FAIL');
    expect(dep3?.detail).toContain(OTHER);
    expect(dep3?.detail).toContain(AFTER);
    const s10 = result.results.find((r) => r.checkId === 'S10');
    expect(s10?.status).toBe('FAIL');
    expect(s10?.detail).toContain(OTHER);
    expect(s10?.detail).toContain(AFTER);
    expect(result.lifecycleStatus).toBe('INTEGRATED');
    expect(result.lifecycle.blocked.DEPLOYED).toContain(OTHER);
    expect(result.verificationStatus).not.toBe('passed');
  });

  it('a deployment that shares only an 8-character prefix with afterSha is a FAIL (prefix compare is not truncated)', async () => {
    const expected = `abcd1234ee${'0'.repeat(30)}`;
    const deployed = `abcd1234ff${'0'.repeat(30)}`;
    renderDeploys(deployed);
    const { service } = build({ s9: ciPass });
    const result = await service.verify(dto({ ...RENDER, afterSha: expected }), ['B1', 'S9', 'S10', 'DEP3'], {
      now: NOW,
      receiptTrustStore: trustStore,
    });
    expect(result.results.find((r) => r.checkId === 'DEP3')?.status).toBe('FAIL');
    expect(result.results.find((r) => r.checkId === 'S10')?.status).toBe('FAIL');
  });

  it('a short, prefix-compatible provider SHA still matches', async () => {
    renderDeploys(AFTER.slice(0, 12));
    const { service } = build({ s9: ciPass });
    const result = await service.verify(dto(RENDER), ['B1', 'S9', 'S10', 'DEP3'], {
      now: NOW,
      receiptTrustStore: trustStore,
    });
    expect(result.results.find((r) => r.checkId === 'DEP3')?.status).toBe('PASS');
  });

  it('the deploy-platform claim without provider evidence is capped, not trusted', async () => {
    mockedAxios.get.mockRejectedValue(new Error('network down'));
    const { service } = build({ s9: ciPass });
    const result = await service.verify(dto(RENDER), ['B1', 'S9', 'S10', 'DEP3'], {
      now: NOW,
      receiptTrustStore: trustStore,
    });
    expect(result.confidenceCapped).toBe(true);
    expect(result.confidenceCapReason).toMatch(/no deployment provider confirmed which commit is live/);
    expect(result.lifecycleStatus).toBe('INTEGRATED');
  });
});
