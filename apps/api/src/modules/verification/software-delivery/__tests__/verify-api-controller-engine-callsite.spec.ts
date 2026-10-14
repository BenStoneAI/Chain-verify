/**
 * Call-site contract for the git-based software_delivery path of
 * VerifyApiController: the controller must hand the REAL engine
 * (SoftwareDeliveryService.verify(dto, requestedChecks, { organizationId }))
 * the validated DTO, claim monthly quota through VerifyApiUsageService, and
 * return the rich engine result plus the legacy keys older consumers read.
 *
 * Every collaborator is an in-memory stub: no database, no network.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VerifyApiController, verifyApiRuleTestHooks } from '../../verify-api.controller.js';
import type { SoftwareDeliveryVerifyResult } from '../software-delivery.service.js';

const SD_OUTPUT = {
  repoOwner: 'acme',
  repoName: 'api',
  beforeSha: 'abc123',
  afterSha: 'def456',
  jobStartedAt: '2026-01-01T00:00:00.000Z',
  tier: 'BASIC',
  jobType: 'DEPLOY_UPDATE',
};

const DEMO_OUTPUT = {
  repoOwner: 'benstoneai',
  repoName: 'chainverify-investor-demo',
  beforeSha: 'aff74f1595a6d35ec966034e9ce9ca6962ca88e2',
  afterSha: 'd47985078ed3b3352090ecc43410b5d2d6f1463f',
  jobStartedAt: '2026-07-28T00:00:00.000Z',
  tier: 'BASIC',
  jobType: 'NEW_FEATURE',
};

function engineResult(overrides: Partial<SoftwareDeliveryVerifyResult> = {}): SoftwareDeliveryVerifyResult {
  return {
    verificationId: 'ver_001',
    proofId: 'sdv_proof_001',
    verificationStatus: 'passed',
    confidence: 0.95,
    tierRun: 'BASIC',
    jobType: 'DEPLOY_UPDATE',
    escalated: false,
    escalationReason: undefined,
    summary: '3 of 3 checks passed. Safe to release.',
    checksPassed: 3,
    checksFailed: 0,
    checksWarning: 0,
    checksSkipped: 1,
    checksRun: 3,
    issuesFound: [],
    recommendedAction: 'approved',
    results: [
      { checkId: 'B1', checkName: 'Work exists in the repo', status: 'PASS', detail: '2 files changed', durationMs: 12, evidence: { filesChanged: 2 } },
      { checkId: 'B3', checkName: 'Correct files were touched', status: 'PASS', durationMs: 9 },
      { checkId: 'S12', checkName: 'No unconditional-success regression', status: 'PASS', durationMs: 1 },
      { checkId: 'B6', checkName: 'Live site still opens', status: 'SKIP', detail: 'No deployUrl supplied.' },
    ],
    ...overrides,
  };
}

function makeController(result: SoftwareDeliveryVerifyResult) {
  const verify = vi.fn().mockResolvedValue(result);
  const reserve = vi.fn().mockResolvedValue(1);
  const proofBilling = {
    resolveProofQuota: vi.fn().mockResolvedValue({ source: 'free', monthlyLimit: null, planSlug: 'free' }),
    getActiveProofEntitlement: vi.fn().mockResolvedValue(null),
  };
  const prisma = {
    organizationMembership: { findMany: vi.fn().mockResolvedValue([]) },
    organizationSubscription: { findUnique: vi.fn().mockResolvedValue(null) },
  };
  const controller = new VerifyApiController(
    {} as never, // verificationService
    {} as never, // proofService
    prisma as never,
    proofBilling as never,
    {} as never, // proofClaim
    {} as never, // aiAnalysis
    { verify } as never, // softwareDelivery
    { reserve, getMonthlyCount: vi.fn() } as never, // verifyApiUsage
  );
  return { controller, verify, reserve };
}

describe('VerifyApiController -> SoftwareDeliveryService call-site', () => {
  beforeEach(() => {
    verifyApiRuleTestHooks.demoIpCounters.clear();
  });

  it('passes dto, requested checks and organizationId to the engine and claims quota first', async () => {
    const { controller, verify, reserve } = makeController(engineResult());
    const user = { id: 'user_001', organizationId: 'org_001' } as never;

    await controller.verify({ source_type: 'software_delivery', output: SD_OUTPUT, rules: ['B1', 'S12'] }, user);

    expect(reserve).toHaveBeenCalledTimes(1);
    expect(reserve).toHaveBeenCalledWith('org_001', 'software-delivery', expect.any(Number));
    expect(verify).toHaveBeenCalledTimes(1);
    const [dto, requested, options] = verify.mock.calls[0];
    expect(dto).toMatchObject({ repoOwner: 'acme', repoName: 'api', afterSha: 'def456', jobType: 'DEPLOY_UPDATE' });
    expect(requested).toEqual(['B1', 'S12']);
    expect(options).toEqual({ organizationId: 'org_001' });
    expect(reserve.mock.invocationCallOrder[0]).toBeLessThan(verify.mock.invocationCallOrder[0]);
  });

  it('defaults to auto-expansion for an authenticated caller that sent no rules', async () => {
    const { controller, verify } = makeController(engineResult());
    const res = (await controller.verify(
      { source_type: 'software_delivery', output: SD_OUTPUT },
      { id: 'user_001', organizationId: 'org_001' } as never,
    )) as Record<string, unknown>;
    expect(verify.mock.calls[0][1]).toEqual(['auto']);
    expect(res.checks_requested).toEqual(['auto']);
  });

  it('returns the rich engine result in snake_case and camelCase plus every legacy key', async () => {
    const { controller } = makeController(engineResult());
    const res = (await controller.verify(
      { source_type: 'software_delivery', output: SD_OUTPUT },
      { id: 'user_001', organizationId: 'org_001' } as never,
    )) as Record<string, unknown>;

    expect(res).toMatchObject({
      verification_status: 'passed',
      verification_id: 'ver_001',
      proof_id: 'sdv_proof_001',
      confidence: 0.95,
      tier_run: 'BASIC',
      job_type: 'DEPLOY_UPDATE',
      escalated: false,
      escalation_reason: null,
      summary: '3 of 3 checks passed. Safe to release.',
      checks_passed: 3,
      checks_failed: 0,
      checks_warning: 0,
      checks_skipped: 1,
      checks_run: 3,
      recommended_action: 'approved',
      verificationId: 'ver_001',
      proofId: 'sdv_proof_001',
      verificationStatus: 'passed',
      tierRun: 'BASIC',
      jobType: 'DEPLOY_UPDATE',
      checksPassed: 3,
      checksRun: 3,
      recommendedAction: 'approved',
      // legacy
      accepted: true,
      input_received: true,
    });
    expect(res.chain_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(res.risk_level).toBe('low');

    const results = res.results as Array<Record<string, unknown>>;
    expect(results).toHaveLength(4);
    expect(results[0]).toMatchObject({
      check_id: 'B1',
      checkId: 'B1',
      check_name: 'Work exists in the repo',
      checkName: 'Work exists in the repo',
      status: 'PASS',
      detail: '2 files changed',
      duration_ms: 12,
      durationMs: 12,
      evidence: { filesChanged: 2 },
    });
  });

  it('derives evidence_gaps from SKIP results and never accepts an escalated run', async () => {
    const { controller } = makeController(
      engineResult({ verificationStatus: 'escalated', escalated: true, escalationReason: 'Auto-escalated to Standard: large diff' }),
    );
    const res = (await controller.verify(
      { source_type: 'software_delivery', output: SD_OUTPUT },
      { id: 'user_001', organizationId: 'org_001' } as never,
    )) as Record<string, unknown>;

    expect(res.accepted).toBe(false);
    expect(res.escalated).toBe(true);
    expect(res.escalation_reason).toBe('Auto-escalated to Standard: large diff');
    expect(res.evidence_gaps).toEqual(['B6 (Live site still opens): No deployUrl supplied.']);
  });

  it('does not accept needs-review or failed runs and surfaces issues_found', async () => {
    const failed = engineResult({
      verificationStatus: 'failed',
      confidence: 0.7,
      checksPassed: 2,
      checksFailed: 1,
      issuesFound: [{ checkId: 'S3', checkName: 'No hardcoded secrets', status: 'FAIL', detail: 'AWS key in diff' }],
      recommendedAction: 'blocked',
    });
    const { controller } = makeController(failed);
    const res = (await controller.verify(
      { source_type: 'software_delivery', output: SD_OUTPUT },
      { id: 'user_001', organizationId: 'org_001' } as never,
    )) as Record<string, unknown>;

    expect(res.accepted).toBe(false);
    expect(res.recommended_action).toBe('blocked');
    expect(res.risk_level).toBe('medium');
    expect(res.issues_found).toEqual([
      { check_id: 'S3', check_name: 'No hardcoded secrets', status: 'FAIL', detail: 'AWS key in diff', checkId: 'S3', checkName: 'No hardcoded secrets' },
    ]);
    expect(res.findings).toEqual([{ rule: 'S3', severity: 'critical', message: 'AWS key in diff' }]);
  });

  it('anonymous demo callers run only the fixed read-only check set under the anonymous org', async () => {
    const { controller, verify } = makeController(engineResult());
    const req = { headers: {}, ip: '203.0.113.77' } as never;

    const res = (await controller.verifyDemo(
      { source_type: 'software_delivery', output: DEMO_OUTPUT, rules: ['auto', 'B1'] },
      req,
    )) as Record<string, unknown>;

    expect(verify).toHaveBeenCalledTimes(1);
    expect(verify.mock.calls[0][1]).toEqual(['B1', 'B3', 'B4', 'B7', 'S12']);
    expect(verify.mock.calls[0][2]).toEqual({ organizationId: 'anonymous' });
    expect(res.checks_requested).toEqual(['B1', 'B3', 'B4', 'B7', 'S12']);
    expect(res.verification_status).toBe('passed');
  });

  it('serves a repeat anonymous demo request from cache without calling the engine again', async () => {
    const { controller, verify, reserve } = makeController(engineResult());
    const req = { headers: {}, ip: '203.0.113.78' } as never;
    // distinct commit pair so the process-wide demo cache is not pre-warmed by another test
    const body = {
      source_type: 'software_delivery',
      output: { ...DEMO_OUTPUT, afterSha: 'c0ffee0000000000000000000000000000000aa' },
    };

    await controller.verifyDemo(body, req);
    await controller.verifyDemo(body, req);

    expect(verify).toHaveBeenCalledTimes(1);
    expect(reserve).toHaveBeenCalledTimes(1);
  });
});
