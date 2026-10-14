/**
 * Provenance, confidence cap, lifecycle, coverage, fingerprint and freshness.
 * Pure functions; no network, no database.
 */
import { describe, expect, it } from 'vitest';
import type { CheckResult, SoftwareTier } from '../software-delivery.types.js';
import {
  analyzeTrust,
  applyConfidenceCap,
  assessCriticalEvidence,
  computeEvidenceFingerprint,
  computeLifecycle,
  computeStaleAfter,
  evaluateFreshness,
  isObserved,
  notSubmittedReceipt,
  provenanceForCheck,
  summarizeCoverage,
  SELF_REPORTED_CONFIDENCE_CAP,
  type ReceiptValidation,
} from '../trust/index.js';

const AFTER = '9f8e7d6c5b4a39281706f5e4d3c2b1a098765432';
const OTHER_SHA = '0123456789abcdef0123456789abcdef01234567';
const NOW = new Date('2026-10-14T12:30:00.000Z');

function res(
  checkId: string,
  status: CheckResult['status'],
  extra: Partial<CheckResult> = {},
): CheckResult {
  return {
    checkId,
    checkName: checkId,
    tier: 'BASIC' as SoftwareTier,
    status,
    ...extra,
  };
}

function receipt(overrides: Partial<ReceiptValidation> = {}): ReceiptValidation {
  return { ...notSubmittedReceipt(), ...overrides };
}

const acceptedReceipt = receipt({
  submitted: true,
  receiptId: 'rcpt_0123456789abcdef',
  integrityOk: true,
  signatureTrusted: true,
  signingKeyId: 'kid_abc',
  bindingOk: true,
  fresh: true,
  accepted: true,
  testsObserved: true,
  observedTests: [
    { runId: 'r1', cmd: 'npm test', exitCode: 0, finishedAt: '2026-10-14T11:59:30Z', stdoutSha256: 'b'.repeat(64), summary: '12 passed' },
  ],
  status: 'PASS',
  headSha: AFTER,
});

const invalidReceipt = receipt({
  submitted: true,
  receiptId: 'rcpt_ffffffffffffffff',
  integrityOk: false,
  accepted: false,
  status: 'FAIL',
  findings: [{ code: 'HASH_MISMATCH', severity: 'FAIL', message: 'receipt_id mismatch' }],
});

/** Attach provenance the way the service does (via analyzeTrust). */
function analyze(
  results: CheckResult[],
  opts: {
    receipt?: ReceiptValidation;
    checkList?: string[];
    jobType?: string;
    aiReport?: string;
    deployPlatform?: string;
    deployUrl?: string;
    engine?: { status: string; confidence: number; summary: string; escalated: boolean };
    diffFiles?: string[];
    diffText?: string;
  } = {},
) {
  return analyzeTrust({
    dto: {
      repoOwner: 'acme',
      repoName: 'widgets',
      afterSha: AFTER,
      jobType: opts.jobType ?? 'BUG_FIX',
      aiReport: opts.aiReport,
      deployPlatform: opts.deployPlatform,
      deployUrl: opts.deployUrl,
    },
    checkList: opts.checkList ?? results.map((r) => r.checkId),
    results,
    diffText: opts.diffText ?? '+++ b/src/a.ts\n+const a = 1;',
    diffFiles: opts.diffFiles ?? ['src/a.ts'],
    receipt: opts.receipt ?? notSubmittedReceipt(),
    engine: opts.engine ?? { status: 'PASSED', confidence: 1, summary: 'all passed', escalated: false },
    now: NOW,
  });
}

// ---------------------------------------------------------------- provenance

describe('provenance rules', () => {
  it('marks provider API responses fetched by the engine as OBSERVED_BY_REMOTE_PROVIDER', () => {
    for (const id of ['B1', 'B2', 'B3', 'B7', 'S9', 'S2', 'DEP3', 'S10', 'DEP2', 'T11']) {
      expect(provenanceForCheck({ checkId: id }).provenance).toBe('OBSERVED_BY_REMOTE_PROVIDER');
    }
  });

  it('marks checks computed from the fetched diff or its own probes as OBSERVED_BY_CHAINVERIFY', () => {
    for (const id of ['S3', 'S12', 'T4', 'TEST1', 'AG2', 'B6', 'DEP4', 'S8']) {
      expect(provenanceForCheck({ checkId: id }).provenance).toBe('OBSERVED_BY_CHAINVERIFY');
    }
  });

  it('marks claim-vs-diff comparisons as DERIVED', () => {
    for (const id of ['B4', 'T10', 'T12', 'REV1']) {
      expect(provenanceForCheck({ checkId: id }).provenance).toBe('DERIVED');
    }
  });

  it('never treats customer-submitted Semgrep output as observed, even when T3 passes', () => {
    const p = provenanceForCheck({ checkId: 'T3' });
    expect(p.provenance).toBe('SELF_REPORTED');
    expect(isObserved(p.provenance)).toBe(false);
  });

  it('an executed local sandbox build is observed by ChainVerify', () => {
    expect(provenanceForCheck({ checkId: 'S2', evidence: { sandbox: true } }).provenance).toBe(
      'OBSERVED_BY_CHAINVERIFY',
    );
  });

  it('AG1 is OBSERVED_BY_AGENT_GATE only for a fully validated receipt', () => {
    expect(provenanceForCheck({ checkId: 'AG1' }, acceptedReceipt).provenance).toBe('OBSERVED_BY_AGENT_GATE');
    expect(provenanceForCheck({ checkId: 'AG1' }, invalidReceipt).provenance).toBe('SUBMITTED_BY_CUSTOMER');
    expect(
      provenanceForCheck({ checkId: 'AG1' }, receipt({ submitted: true, accepted: true, testsObserved: false })).provenance,
    ).toBe('SUBMITTED_BY_CUSTOMER');
  });

  it('records provenance and a recommended action on every result and counts only material results', () => {
    const t = analyze([res('B1', 'PASS'), res('T3', 'PASS'), res('S2', 'SKIP'), res('S3', 'FAIL', { detail: 'secret' })]);
    expect(t.results.every((r) => r.provenance && r.provenanceBasis && r.recommendedAction)).toBe(true);
    expect(t.provenanceCounts.OBSERVED_BY_REMOTE_PROVIDER).toBe(1);
    expect(t.provenanceCounts.SELF_REPORTED).toBe(1);
    expect(t.provenanceCounts.OBSERVED_BY_CHAINVERIFY).toBe(1);
    expect(t.provenanceCounts.OBSERVED_BY_AGENT_GATE).toBe(0);
  });
});

// ------------------------------------------------------------ confidence cap

describe('critical evidence and confidence cap', () => {
  it('caps confidence when tests are only claimed by the AI report, and says why', () => {
    const t = analyze([res('B1', 'PASS'), res('S2', 'SKIP'), res('S9', 'WARNING', { detail: 'no CI run' })], {
      aiReport: 'I fixed the rounding bug and all tests pass.',
      checkList: ['B1', 'S2', 'S9'],
    });
    expect(t.engineConfidence).toBe(1);
    expect(t.confidence).toBe(SELF_REPORTED_CONFIDENCE_CAP);
    expect(t.confidenceCapped).toBe(true);
    expect(t.confidenceCapReason).toMatch(/capped at 0\.6/);
    expect(t.confidenceCapReason).toMatch(/tests passed/);
    expect(t.confidenceCapReason).toMatch(/no CI result for this exact commit/);
    expect(t.status).toBe('NEEDS_REVIEW');
    expect(t.summary).not.toContain('Safe to release');
    expect(t.lifecycle.status).toBe('IMPLEMENTED');
  });

  it('does not cap when CI observed the tests', () => {
    const t = analyze([res('B1', 'PASS'), res('S2', 'PASS'), res('S9', 'PASS')], {
      aiReport: 'all tests pass',
      checkList: ['B1', 'S2', 'S9'],
    });
    expect(t.confidenceCapped).toBe(false);
    expect(t.confidenceCapReason).toBeNull();
    expect(t.confidence).toBe(1);
    expect(t.status).toBe('PASSED');
  });

  it('does not cap when a validated Agent Gate receipt observed the tests', () => {
    const t = analyze([res('B1', 'PASS'), res('S2', 'SKIP'), res('AG1', 'PASS')], {
      receipt: acceptedReceipt,
      checkList: ['B1', 'S2', 'AG1'],
    });
    expect(t.confidenceCapped).toBe(false);
    expect(t.confidence).toBe(1);
    expect(t.lifecycle.status).toBe('TESTED');
  });

  it('never raises confidence above the engine score', () => {
    const t = analyze([res('B1', 'PASS'), res('S2', 'SKIP')], {
      aiReport: 'tests passed',
      engine: { status: 'FAILED', confidence: 0.4, summary: 'x', escalated: false },
      checkList: ['B1', 'S2'],
    });
    expect(t.confidence).toBe(0.4);
    expect(t.confidenceCapped).toBe(false);
    expect(t.confidenceCapReason).toMatch(/capped at 0\.6/); // reason still stated
    expect(t.status).toBe('FAILED'); // status is never upgraded
  });

  it('applyConfidenceCap honours a configurable cap', () => {
    const gap = assessCriticalEvidence({
      checkList: ['S2'],
      results: [res('S2', 'SKIP')],
      jobType: 'BUG_FIX',
      afterSha: AFTER,
      receipt: notSubmittedReceipt(),
    });
    expect(applyConfidenceCap(0.95, gap, 0.5)).toMatchObject({ confidence: 0.5, applies: true, lowered: true });
    expect(applyConfidenceCap(0.3, gap, 0.5)).toMatchObject({ confidence: 0.3, applies: true, lowered: false });
  });

  it('treats deploy state as critical when a deploy platform is named but no provider confirmed a commit', () => {
    const t = analyze([res('B1', 'PASS'), res('S10', 'SKIP', { detail: 'No Render service ID or token provided' })], {
      deployPlatform: 'RENDER',
      deployUrl: 'https://app.example.com',
      checkList: ['B1', 'S10'],
    });
    expect(t.confidenceCapped).toBe(true);
    expect(t.confidenceCapReason).toMatch(/no deployment provider confirmed which commit is live/);
    expect(t.criticalEvidence.find((c) => c.category === 'DEPLOY_STATE')).toMatchObject({
      inScope: true,
      observed: false,
      selfReportedOnly: true,
    });
  });

  it('does not invent a cap when nothing critical was claimed or required', () => {
    const t = analyze([res('B1', 'PASS'), res('B2', 'PASS')], { checkList: ['B1', 'B2'] });
    expect(t.confidenceCapped).toBe(false);
    expect(t.confidenceCapReason).toBeNull();
    expect(t.status).toBe('PASSED');
    expect(t.confidence).toBe(1);
  });
});

describe('an invalid receipt never increases confidence or provenance', () => {
  const base = [res('B1', 'PASS'), res('S2', 'SKIP'), res('S9', 'WARNING')];

  it('yields a FAIL finding and zero OBSERVED_BY_AGENT_GATE', () => {
    const without = analyze(base, { aiReport: 'tests pass', checkList: ['B1', 'S2', 'S9', 'AG1'] });
    const withInvalid = analyze([...base, res('AG1', 'FAIL', { detail: 'hash mismatch' })], {
      aiReport: 'tests pass',
      receipt: invalidReceipt,
      checkList: ['B1', 'S2', 'S9', 'AG1'],
    });
    expect(withInvalid.confidence).toBeLessThanOrEqual(without.confidence);
    expect(withInvalid.provenanceCounts.OBSERVED_BY_AGENT_GATE).toBe(0);
    expect(withInvalid.results.find((r) => r.checkId === 'AG1')?.provenance).toBe('SUBMITTED_BY_CUSTOMER');
    expect(withInvalid.lifecycle.status).toBe('IMPLEMENTED');
    expect(withInvalid.lifecycle.flags.invalidReceipt).toBe(true);
    expect(withInvalid.confidenceCapped).toBe(true);
  });
});

// ------------------------------------------------------------------ lifecycle

describe('lifecycle mapping', () => {
  function lc(results: CheckResult[], r: ReceiptValidation = notSubmittedReceipt(), files = 1) {
    const t = analyze(results, { receipt: r, diffFiles: Array.from({ length: files }, (_, i) => `f${i}.ts`) });
    return t.lifecycle;
  }

  const deployMatch = res('DEP3', 'PASS', {
    evidence: { provider: 'RENDER', deployedSha: AFTER, expectedSha: AFTER, deploymentId: 'dep-1', state: 'live' },
  });
  const deployMismatch = res('DEP3', 'FAIL', {
    detail: 'Render deploy SHA does not match',
    evidence: { provider: 'RENDER', deployedSha: OTHER_SHA, expectedSha: AFTER, deploymentId: 'dep-1', state: 'live' },
  });

  it('CLAIMED when no work was observed', () => {
    const l = lc([res('B1', 'FAIL', { detail: 'empty diff' })]);
    expect(l.status).toBe('CLAIMED');
    expect(l.blocked.IMPLEMENTED).toMatch(/B1 is FAIL/);
  });

  it('IMPLEMENTED when work exists but nothing observed tests', () => {
    const l = lc([res('B1', 'PASS'), res('S2', 'SKIP'), res('S9', 'WARNING')]);
    expect(l.status).toBe('IMPLEMENTED');
    expect(l.blocked.TESTED).toMatch(/No observed test execution/);
  });

  it('TESTED from a validated receipt alone', () => {
    const l = lc([res('B1', 'PASS'), res('AG1', 'PASS')], acceptedReceipt);
    expect(l.status).toBe('TESTED');
    expect(l.blocked.INTEGRATED).toMatch(/Remote CI success/);
  });

  it('INTEGRATED from provider-observed CI success on the delivery commit', () => {
    const l = lc([res('B1', 'PASS'), res('S9', 'PASS')]);
    expect(l.status).toBe('INTEGRATED');
    expect(l.reached).toEqual(['CLAIMED', 'IMPLEMENTED', 'TESTED', 'INTEGRATED']);
  });

  it('a failing CI result blocks TESTED even when a receipt claims success', () => {
    const l = lc([res('B1', 'PASS'), res('S9', 'FAIL', { detail: 'CI run failed' }), res('AG1', 'PASS')], acceptedReceipt);
    expect(l.status).toBe('IMPLEMENTED');
    expect(l.blocked.TESTED).toMatch(/S9 failed/);
  });

  it('DEPLOYED requires the provider to report exactly the requested commit, healthy', () => {
    const l = lc([res('B1', 'PASS'), res('S9', 'PASS'), deployMatch, res('B6', 'PASS')]);
    expect(l.status).toBe('DEPLOYED');
    expect(l.deploy).toMatchObject({ shaMatch: true, deployedSha: AFTER, deploymentId: 'dep-1', healthy: true });
  });

  it('a successful deployment of a different SHA is not DEPLOYED and names both SHAs', () => {
    const l = lc([res('B1', 'PASS'), res('S9', 'PASS'), deployMismatch, res('B6', 'PASS')]);
    expect(l.status).toBe('INTEGRATED');
    expect(l.deploy.shaMatch).toBe(false);
    expect(l.blocked.DEPLOYED).toContain(OTHER_SHA);
    expect(l.blocked.DEPLOYED).toContain(AFTER);
  });

  it('a prefix-compatible deployed SHA counts as equal', () => {
    const short = res('DEP3', 'PASS', { evidence: { deployedSha: AFTER.slice(0, 10), expectedSha: AFTER } });
    expect(lc([res('B1', 'PASS'), res('S9', 'PASS'), short, res('DEP4', 'PASS')]).status).toBe('DEPLOYED');
  });

  it('an unhealthy deployment of the right commit is not DEPLOYED', () => {
    const l = lc([res('B1', 'PASS'), res('S9', 'PASS'), deployMatch, res('DEP4', 'FAIL', { detail: 'HTTP 503' })]);
    expect(l.status).toBe('INTEGRATED');
    expect(l.blocked.DEPLOYED).toMatch(/health check failed/);
  });

  it('VERIFIED needs a ChainVerify-observed user-visible check', () => {
    const base = [res('B1', 'PASS'), res('S9', 'PASS'), deployMatch, res('B6', 'PASS')];
    expect(lc(base).status).toBe('DEPLOYED');
    expect(lc([...base, res('S8', 'PASS')]).status).toBe('VERIFIED');
  });

  it('STALE and INVALID_RECEIPT are flags, not levels', () => {
    const l = lc([res('B1', 'PASS'), res('S9', 'PASS')], invalidReceipt);
    expect(l.status).toBe('INTEGRATED');
    expect(l.flags).toEqual({ stale: false, invalidReceipt: true });
  });

  it('computeLifecycle can be called directly with annotated results', () => {
    const results = [res('B1', 'PASS', { provenance: 'OBSERVED_BY_REMOTE_PROVIDER' })];
    expect(
      computeLifecycle({ results, afterSha: AFTER, receipt: notSubmittedReceipt(), fetchedDiffFileCount: 0 }).status,
    ).toBe('IMPLEMENTED');
  });
});

// ------------------------------------------------------------------- coverage

describe('coverage summary', () => {
  it('counts expected / executed / passed / failed / warned / skipped / unable with reasons', () => {
    const results = [
      res('B1', 'PASS'),
      res('S3', 'FAIL', { detail: 'secret' }),
      res('B3', 'WARNING', { detail: 'docs only' }),
      res('S2', 'SKIP', { detail: 'No CI signal could be retrieved', skipKind: 'UNABLE' }),
      res('T3', 'SKIP', { detail: 'declared but not enabled', skipKind: 'NOT_EVALUATED' }),
    ];
    const c = summarizeCoverage(['B1', 'S3', 'B3', 'S2', 'T3'], results);
    expect(c).toMatchObject({ expected: 5, executed: 3, passed: 1, failed: 1, warned: 1, skipped: 1, unable: 1 });
    expect(c.reasons).toEqual([
      { checkId: 'S2', checkName: 'S2', outcome: 'UNABLE', reason: 'No CI signal could be retrieved' },
      { checkId: 'T3', checkName: 'T3', outcome: 'SKIPPED', reason: 'declared but not enabled' },
    ]);
  });
});

// ------------------------------------------------------------------ freshness

describe('evidence fingerprint and freshness', () => {
  const items = [
    { kind: 'diff', provenance: 'OBSERVED_BY_REMOTE_PROVIDER' as const, digest: 'a'.repeat(64) },
    { kind: 'ci', provenance: 'OBSERVED_BY_REMOTE_PROVIDER' as const, digest: 'b'.repeat(64) },
  ];
  const fp = computeEvidenceFingerprint({ repoOwner: 'Acme', repoName: 'Widgets', afterSha: AFTER, items });

  it('is a stable sha256 independent of item order and repo casing', () => {
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
    expect(
      computeEvidenceFingerprint({
        repoOwner: 'acme',
        repoName: 'widgets',
        afterSha: AFTER.toUpperCase(),
        items: [...items].reverse(),
      }),
    ).toBe(fp);
  });

  it('changes when the commit, the repo or any evidence item changes', () => {
    const changed = (patch: Partial<Parameters<typeof computeEvidenceFingerprint>[0]>) =>
      computeEvidenceFingerprint({ repoOwner: 'acme', repoName: 'widgets', afterSha: AFTER, items, ...patch });
    expect(changed({ afterSha: OTHER_SHA })).not.toBe(fp);
    expect(changed({ repoName: 'gadgets' })).not.toBe(fp);
    expect(changed({ items: [{ ...items[0], digest: 'c'.repeat(64) }, items[1]] })).not.toBe(fp);
  });

  const stored = {
    headSha: AFTER,
    evidenceFingerprint: fp,
    staleAfter: new Date('2026-10-15T12:00:00.000Z'),
    deploySha: AFTER,
  };

  it('is CURRENT when HEAD, evidence, deploy SHA and age all still hold', () => {
    expect(
      evaluateFreshness({
        stored,
        liveHeadSha: AFTER.slice(0, 12),
        liveDeploySha: AFTER,
        evidenceFingerprint: fp,
        now: NOW,
      }),
    ).toEqual({ state: 'CURRENT', reasons: [] });
  });

  it('is STALE when HEAD changed', () => {
    const r = evaluateFreshness({ stored, liveHeadSha: OTHER_SHA, now: NOW });
    expect(r.state).toBe('STALE');
    expect(r.reasons.map((x) => x.code)).toEqual(['HEAD_CHANGED']);
  });

  it('is STALE when the evidence fingerprint changed', () => {
    const r = evaluateFreshness({ stored, evidenceFingerprint: 'd'.repeat(64), now: NOW });
    expect(r.state).toBe('STALE');
    expect(r.reasons.map((x) => x.code)).toEqual(['EVIDENCE_CHANGED']);
  });

  it('is STALE when the deployed SHA changed', () => {
    const r = evaluateFreshness({ stored, liveDeploySha: OTHER_SHA, now: NOW });
    expect(r.state).toBe('STALE');
    expect(r.reasons.map((x) => x.code)).toEqual(['DEPLOY_SHA_CHANGED']);
  });

  it('is STALE when the validity window expired', () => {
    const r = evaluateFreshness({ stored, now: new Date('2026-10-15T12:00:00.000Z') });
    expect(r.state).toBe('STALE');
    expect(r.reasons.map((x) => x.code)).toEqual(['AGE_EXPIRED']);
  });

  it('reports every reason at once', () => {
    const r = evaluateFreshness({
      stored,
      liveHeadSha: OTHER_SHA,
      liveDeploySha: OTHER_SHA,
      evidenceFingerprint: 'e'.repeat(64),
      now: new Date('2026-10-16T00:00:00.000Z'),
    });
    expect(r.reasons.map((x) => x.code).sort()).toEqual(
      ['AGE_EXPIRED', 'DEPLOY_SHA_CHANGED', 'EVIDENCE_CHANGED', 'HEAD_CHANGED'].sort(),
    );
  });

  it('falls back to the verified head when no deploy SHA was stored', () => {
    const r = evaluateFreshness({
      stored: { ...stored, deploySha: null },
      liveDeploySha: OTHER_SHA,
      now: NOW,
    });
    expect(r.reasons.map((x) => x.code)).toEqual(['DEPLOY_SHA_CHANGED']);
  });

  it('a legacy record with no binding cannot be shown as current', () => {
    const r = evaluateFreshness({ stored: {}, now: NOW });
    expect(r.state).toBe('STALE');
    expect(r.reasons.map((x) => x.code)).toEqual(['NO_FRESHNESS_BINDING']);
  });

  it('stale-after window defaults to 24 hours and is configurable', () => {
    expect(computeStaleAfter(NOW, 24).toISOString()).toBe('2026-10-15T12:30:00.000Z');
    expect(computeStaleAfter(NOW, 1).toISOString()).toBe('2026-10-14T13:30:00.000Z');
  });

  it('analyzeTrust binds a new verification to repo, HEAD, fingerprint and window', () => {
    const t = analyze([res('B1', 'PASS')], { checkList: ['B1'] });
    expect(t.headSha).toBe(AFTER);
    expect(t.evidenceFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(t.staleAfter.toISOString()).toBe('2026-10-15T12:30:00.000Z');
    expect(t.freshness).toEqual({ state: 'CURRENT', reasons: [] });
    const changedDiff = analyze([res('B1', 'PASS')], { checkList: ['B1'], diffText: '+++ b/x\n+const changed = 2;' });
    expect(changedDiff.evidenceFingerprint).not.toBe(t.evidenceFingerprint);
    expect(
      evaluateFreshness({
        stored: {
          headSha: t.headSha,
          evidenceFingerprint: t.evidenceFingerprint,
          staleAfter: t.staleAfter,
        },
        evidenceFingerprint: changedDiff.evidenceFingerprint,
        now: NOW,
      }).state,
    ).toBe('STALE');
  });

  it('isObserved distinguishes observed from claimed provenance', () => {
    expect(isObserved('OBSERVED_BY_AGENT_GATE')).toBe(true);
    expect(isObserved('OBSERVED_BY_CHAINVERIFY')).toBe(true);
    expect(isObserved('OBSERVED_BY_REMOTE_PROVIDER')).toBe(true);
    expect(isObserved('SELF_REPORTED')).toBe(false);
    expect(isObserved('SUBMITTED_BY_CUSTOMER')).toBe(false);
    expect(isObserved('DERIVED')).toBe(false);
  });
});
