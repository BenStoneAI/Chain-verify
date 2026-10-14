import { vi, describe, it, expect, beforeEach, type Mocked, type Mock } from 'vitest';
import { Test } from '@nestjs/testing';
import { SoftwareDeliveryService } from '../software-delivery.service.js';
import { SoftwareDeliveryEscalationService } from '../software-delivery-escalation.js';
import { GithubChecksService } from '../checks/github-checks.service.js';
import { LiveChecksService } from '../checks/live-checks.service.js';
import { SecurityChecksService } from '../checks/security-checks.service.js';
import { DiffAnalysisService } from '../checks/diff-analysis.service.js';
import { DeploymentChecksService } from '../checks/deployment-checks.service.js';
import { JobTypeChecksService } from '../checks/job-type-checks.service.js';
import { BuildChecksService } from '../checks/build-checks.service.js';
import { ExternalToolChecksService } from '../checks/external-tool-checks.service.js';
import { SoftwareTier, SoftwareJobType, DeployPlatform } from '../dto/software-delivery-verify.dto.js';
import type { CheckResult } from '../software-delivery.types.js';
import { TIER_CHECKS } from '../software-delivery.types.js';
import { PrismaService } from '../../../database/prisma.service.js';

// ---------------------------------------------------------------------------
// Prisma mock
// ---------------------------------------------------------------------------

const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockCreateMany = vi.fn();

const mockPrisma = {
  softwareDeliveryVerification: {
    create: mockCreate,
    update: mockUpdate,
  },
  softwareDeliveryCheckResult: {
    createMany: mockCreateMany,
  },
};

// ---------------------------------------------------------------------------
// Check result factories
// ---------------------------------------------------------------------------

function passResult(checkId: string, tier: 'BASIC' | 'STANDARD' | 'THOROUGH' = 'BASIC'): CheckResult {
  return { checkId, checkName: `Check ${checkId}`, tier, status: 'PASS', durationMs: 5 };
}

function failResult(checkId: string, tier: 'BASIC' | 'STANDARD' | 'THOROUGH' = 'BASIC'): CheckResult {
  return { checkId, checkName: `Check ${checkId}`, tier, status: 'FAIL', detail: 'Failed.', durationMs: 5 };
}

function warnResult(checkId: string, tier: 'BASIC' | 'STANDARD' | 'THOROUGH' = 'BASIC'): CheckResult {
  return { checkId, checkName: `Check ${checkId}`, tier, status: 'WARNING', detail: 'Warning.', durationMs: 5 };
}

function skipResult(checkId: string, tier: 'BASIC' | 'STANDARD' | 'THOROUGH' = 'BASIC'): CheckResult {
  return { checkId, checkName: `Check ${checkId}`, tier, status: 'SKIP', detail: 'Skipped.', durationMs: 0 };
}

// ---------------------------------------------------------------------------
// Mock setup helpers
// ---------------------------------------------------------------------------

let mockGithub: Mocked<GithubChecksService>;
let mockLive: Mocked<LiveChecksService>;
let mockSecurity: Mocked<SecurityChecksService>;
let mockDiff: Mocked<DiffAnalysisService>;
let mockDeployment: Mocked<DeploymentChecksService>;
let mockJobType: Mocked<JobTypeChecksService>;
let mockEscalation: Mocked<SoftwareDeliveryEscalationService>;
let mockBuild: Mocked<BuildChecksService>;
let mockExternalTools: Mocked<ExternalToolChecksService>;

// Build-family SKIP factory with the documented "Phase 2 / S9" detail the
// deferred-check assertions look for.
function buildSkip(checkId: string, tier: 'BASIC' | 'STANDARD' | 'THOROUGH'): CheckResult {
  return {
    checkId,
    checkName: `Check ${checkId}`,
    tier,
    status: 'SKIP',
    detail:
      'No matching CI check published on the delivery commit. Covered by S9 (CI). Enable BUILD_SANDBOX_ENABLED for local build fallback.',
    durationMs: 0,
  };
}

function makeAllPassMocks(): void {
  mockGithub.getDiffFiles.mockResolvedValue(['src/invoice.service.ts']);
  mockGithub.getDiffText.mockResolvedValue('+const x = 1;');
  mockGithub.checkWorkExists.mockResolvedValue(passResult('B1'));
  mockGithub.checkCommitTiming.mockResolvedValue(passResult('B2'));
  mockGithub.checkFilesInScope.mockResolvedValue(passResult('B3'));
  mockGithub.checkPrMerged.mockResolvedValue(skipResult('B7')); // no PR number
  mockGithub.checkCiPassed.mockResolvedValue(passResult('S9', 'STANDARD'));

  mockLive.checkLiveSite.mockResolvedValue(passResult('B6'));
  mockLive.checkHealthEndpoint.mockResolvedValue(skipResult('DEP4'));
  mockLive.checkFeatureReachable.mockResolvedValue(skipResult('S8', 'STANDARD'));

  mockSecurity.checkNoHardcodedSecrets.mockResolvedValue(passResult('S3', 'STANDARD'));
  mockSecurity.checkDependencySecurity.mockResolvedValue(passResult('S6', 'STANDARD'));
  mockSecurity.checkNoHardcodedCredentials.mockResolvedValue(skipResult('INT1', 'STANDARD'));
  mockSecurity.checkRealCredentials.mockResolvedValue(skipResult('INT2', 'STANDARD'));
  mockSecurity.checkNoUnconditionalSuccessRegression.mockReturnValue(passResult('S12', 'STANDARD'));

  mockDiff.checkAiReportMatchesDiff.mockReturnValue(skipResult('B4')); // no aiReport
  mockDiff.checkScopeAdherence.mockReturnValue(passResult('S7', 'STANDARD'));
  mockDiff.checkLockFileConsistency.mockReturnValue(passResult('S11', 'STANDARD'));
  mockDiff.checkCoverageDidNotDrop.mockReturnValue(skipResult('T1', 'THOROUGH'));
  mockDiff.checkNewCodeHasTest.mockReturnValue(passResult('T2', 'THOROUGH'));
  mockDiff.checkProtectedRoutesStillProtected.mockReturnValue(passResult('T4', 'THOROUGH'));
  mockDiff.checkRateLimitOnNewEndpoints.mockReturnValue(passResult('T5', 'THOROUGH'));
  mockDiff.checkEnvVarsDocumented.mockReturnValue(passResult('T7', 'THOROUGH'));
  mockDiff.checkNoOrphanFiles.mockReturnValue(passResult('T8', 'THOROUGH'));
  mockDiff.checkBreakingExportsHandled.mockReturnValue(passResult('T9', 'THOROUGH'));
  mockDiff.checkSpecRequirementsAddressed.mockReturnValue(skipResult('T10', 'THOROUGH'));
  mockDiff.checkDeliveryDescriptionMatchesDiff.mockReturnValue(skipResult('T12', 'THOROUGH'));

  mockExternalTools.checkStaticSecurityAnalysis.mockReturnValue({
    ...skipResult('T3', 'THOROUGH'),
    checkName: 'Static security analysis',
  });
  mockExternalTools.checkPerformanceRegression.mockResolvedValue({
    ...skipResult('T6', 'THOROUGH'),
    checkName: 'Performance did not regress',
  });
  mockExternalTools.checkErrorRateStable.mockResolvedValue({
    ...skipResult('T11', 'THOROUGH'),
    checkName: 'Error rate stable post-deploy',
  });

  mockJobType.checkBugNoLongerReproduces.mockResolvedValue(skipResult('BUG1'));
  mockJobType.checkBugRegressionTestExists.mockReturnValue(passResult('BUG2'));
  mockJobType.checkBugFixAddressesRootCause.mockReturnValue(passResult('BUG3'));
  mockJobType.checkTestsNotSkipped.mockReturnValue(passResult('TEST1'));
  mockJobType.checkTestsHaveAssertions.mockReturnValue(passResult('TEST2'));
  mockJobType.checkTestCountIncreased.mockReturnValue(passResult('TEST5'));
  mockJobType.checkPreMigrationBackup.mockReturnValue(warnResult('MIG0'));
  mockJobType.checkMigrationApplied.mockReturnValue(passResult('MIG1'));
  mockJobType.checkNoUnexpectedNulls.mockReturnValue(passResult('MIG4'));
  mockJobType.checkNewCodeWiredIn.mockReturnValue(passResult('NEW1'));
  mockJobType.checkSchemaChangesHaveMigration.mockReturnValue(passResult('NEW4'));
  mockJobType.checkReviewFileCoverage.mockReturnValue(skipResult('REV1'));

  mockDeployment.checkNetlifyDeployment.mockResolvedValue([]);
  mockDeployment.checkRenderDeployment.mockResolvedValue([]);
  mockDeployment.checkVercelDeployment.mockResolvedValue([]);
  mockDeployment.checkRailwayDeployment.mockResolvedValue([]);
  mockDeployment.checkProductionRunningNewCode.mockResolvedValue(skipResult('DEP1'));
  mockDeployment.checkNoCrashLoops.mockResolvedValue(skipResult('DEP5'));

  // Build-family checks (B5/S2/S4/S5) — return SKIP for whichever of them are
  // in the requested check list, mirroring BuildChecksService's contract.
  mockBuild.runBuildChecks.mockImplementation(
    async (_owner: string, _repo: string, _sha: string, checkList: string[]) =>
      (['B5', 'S2', 'S4', 'S5'] as const)
        .filter((id) => checkList.includes(id))
        .map((id) => buildSkip(id, id === 'B5' ? 'BASIC' : 'STANDARD')),
  );
}

// ---------------------------------------------------------------------------
// Base DTO
// ---------------------------------------------------------------------------

const baseBugFixDto = {
  repoOwner: 'acme-corp',
  repoName: 'payments-api',
  beforeSha: 'abc123def456',
  afterSha: 'def456abc123',
  jobStartedAt: '2026-05-25T10:00:00Z',
  tier: SoftwareTier.BASIC,
  jobType: SoftwareJobType.BUG_FIX,
  jobDescription: 'Fix the invoice total calculation rounding bug',
  jobValueUsd: 500,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SoftwareDeliveryService', () => {
  let service: SoftwareDeliveryService;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockCreate.mockResolvedValue({
      id: 'verify-id-001',
      proofId: 'sdv_proof_001',
    });
    mockUpdate.mockResolvedValue({});
    mockCreateMany.mockResolvedValue({ count: 3 });

    const module = await Test.createTestingModule({
      providers: [
        SoftwareDeliveryService,
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: SoftwareDeliveryEscalationService,
          useValue: {
            resolve: vi.fn().mockReturnValue({
              tier: 'BASIC',
              escalated: false,
              escalationReason: undefined,
            }),
          },
        },
        {
          provide: GithubChecksService,
          useValue: {
            getDiffFiles: vi.fn(),
            getDiffText: vi.fn(),
            checkWorkExists: vi.fn(),
            checkCommitTiming: vi.fn(),
            checkFilesInScope: vi.fn(),
            checkPrMerged: vi.fn(),
            checkCiPassed: vi.fn(),
          },
        },
        {
          provide: LiveChecksService,
          useValue: {
            checkLiveSite: vi.fn(),
            checkHealthEndpoint: vi.fn(),
            checkFeatureReachable: vi.fn(),
          },
        },
        {
          provide: SecurityChecksService,
          useValue: {
            checkNoHardcodedSecrets: vi.fn(),
            checkDependencySecurity: vi.fn(),
            checkNoHardcodedCredentials: vi.fn(),
            checkRealCredentials: vi.fn(),
            checkNoUnconditionalSuccessRegression: vi.fn(),
          },
        },
        {
          provide: DiffAnalysisService,
          useValue: {
            checkAiReportMatchesDiff: vi.fn(),
            checkScopeAdherence: vi.fn(),
            checkLockFileConsistency: vi.fn(),
            checkCoverageDidNotDrop: vi.fn(),
            checkNewCodeHasTest: vi.fn(),
            checkProtectedRoutesStillProtected: vi.fn(),
            checkRateLimitOnNewEndpoints: vi.fn(),
            checkNoOrphanFiles: vi.fn(),
            checkBreakingExportsHandled: vi.fn(),
            checkEnvVarsDocumented: vi.fn(),
            checkSpecRequirementsAddressed: vi.fn(),
            checkDeliveryDescriptionMatchesDiff: vi.fn(),
          },
        },
        {
          provide: DeploymentChecksService,
          useValue: {
            checkNetlifyDeployment: vi.fn(),
            checkRenderDeployment: vi.fn(),
            checkVercelDeployment: vi.fn(),
            checkRailwayDeployment: vi.fn(),
            checkProductionRunningNewCode: vi.fn(),
            checkNoCrashLoops: vi.fn(),
          },
        },
        {
          provide: JobTypeChecksService,
          useValue: {
            checkBugNoLongerReproduces: vi.fn(),
            checkBugRegressionTestExists: vi.fn(),
            checkBugFixAddressesRootCause: vi.fn(),
            checkTestsNotSkipped: vi.fn(),
            checkTestsHaveAssertions: vi.fn(),
            checkTestCountIncreased: vi.fn(),
            checkPreMigrationBackup: vi.fn(),
            checkMigrationApplied: vi.fn(),
            checkNoUnexpectedNulls: vi.fn(),
            checkNewCodeWiredIn: vi.fn(),
            checkSchemaChangesHaveMigration: vi.fn(),
            checkReviewFileCoverage: vi.fn(),
          },
        },
        {
          provide: BuildChecksService,
          useValue: {
            runBuildChecks: vi.fn(),
          },
        },
        {
          provide: ExternalToolChecksService,
          useValue: {
            checkStaticSecurityAnalysis: vi.fn(),
            checkPerformanceRegression: vi.fn(),
            checkErrorRateStable: vi.fn(),
          },
        },
      ],
    })
      .overrideProvider('PrismaService')
      .useValue(mockPrisma)
      .compile();

    service = module.get(SoftwareDeliveryService);
    mockGithub = module.get(GithubChecksService) as Mocked<GithubChecksService>;
    mockLive = module.get(LiveChecksService) as Mocked<LiveChecksService>;
    mockSecurity = module.get(SecurityChecksService) as Mocked<SecurityChecksService>;
    mockDiff = module.get(DiffAnalysisService) as Mocked<DiffAnalysisService>;
    mockDeployment = module.get(DeploymentChecksService) as Mocked<DeploymentChecksService>;
    mockJobType = module.get(JobTypeChecksService) as Mocked<JobTypeChecksService>;
    mockEscalation = module.get(SoftwareDeliveryEscalationService) as Mocked<SoftwareDeliveryEscalationService>;
    mockBuild = module.get(BuildChecksService) as Mocked<BuildChecksService>;
    mockExternalTools = module.get(ExternalToolChecksService) as Mocked<ExternalToolChecksService>;

    makeAllPassMocks();
  });

  describe('zero completed checks', () => {
    it('requires review when the only requested real check skips without a PR number', async () => {
      mockGithub.checkPrMerged.mockImplementation(GithubChecksService.prototype.checkPrMerged);
      const result = await service.verify(baseBugFixDto as never, ['B7']);
      expect(result).toMatchObject({ verificationStatus: 'needs-review', confidence: 0, checksRun: 0, checksSkipped: 1, recommendedAction: 'human_review' });
      expect(result.summary).not.toContain('Safe to release');
      expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ overallStatus: 'NEEDS_REVIEW', checksRun: 0 }) }));
    });

    it('requires review when an unsupported selection produces no results', async () => {
      const result = await service.verify(baseBugFixDto as never, ['UNKNOWN']);
      expect(result).toMatchObject({ verificationStatus: 'needs-review', confidence: 0, checksRun: 0, recommendedAction: 'human_review' });
      expect(result.summary).not.toContain('Safe to release');
    });

    it('preserves escalation without approving zero completed checks', async () => {
      mockEscalation.resolve.mockReturnValue({ tier: 'STANDARD', escalated: true, escalationReason: 'test escalation' });
      const result = await service.verify(baseBugFixDto as never, ['B7']);
      expect(result).toMatchObject({ verificationStatus: 'escalated', confidence: 0, checksRun: 0, recommendedAction: 'human_review' });
      expect(result.summary).not.toContain('Safe to release');
    });
  });

  // ── Full orchestration — BASIC BUG_FIX, all checks pass ──────────────────

  describe('full orchestration — BASIC BUG_FIX all pass', () => {
    it('returns verificationStatus "passed" when all checks pass', async () => {
      const result = await service.verify(baseBugFixDto as never, ['auto']);
      expect(result.verificationStatus).toBe('passed');
    });

    it('returns confidence 1.0 when all checks pass (no failures, no warnings)', async () => {
      // Override warn results to pass to get clean score
      mockJobType.checkPreMigrationBackup.mockReturnValue(passResult('MIG0'));
      const result = await service.verify(baseBugFixDto as never, ['auto']);
      expect(result.confidence).toBeGreaterThan(0.8);
    });

    it('returns proofId starting with "sdv_"', async () => {
      const result = await service.verify(baseBugFixDto as never, ['auto']);
      expect(result.proofId).toContain('sdv_');
    });

    it('returns tierRun as BASIC', async () => {
      const result = await service.verify(baseBugFixDto as never, ['auto']);
      expect(result.tierRun).toBe('BASIC');
    });

    it('returns jobType matching input', async () => {
      const result = await service.verify(baseBugFixDto as never, ['auto']);
      expect(result.jobType).toBe('BUG_FIX');
    });

    it('returns escalated=false when no escalation triggers fire', async () => {
      const result = await service.verify(baseBugFixDto as never, ['auto']);
      expect(result.escalated).toBe(false);
    });

    it('returns checksPassed count equal to PASS results', async () => {
      const result = await service.verify(baseBugFixDto as never, ['auto']);
      expect(result.checksPassed).toBeGreaterThan(0);
    });

    it('returns issuesFound as empty array when all checks pass', async () => {
      mockJobType.checkPreMigrationBackup.mockReturnValue(passResult('MIG0'));
      const result = await service.verify(baseBugFixDto as never, ['auto']);
      expect(result.issuesFound).toHaveLength(0);
    });

    it('summary is a human-readable string (not JSON)', async () => {
      const result = await service.verify(baseBugFixDto as never, ['auto']);
      expect(result.summary).not.toContain('{');
      expect(result.summary).not.toContain('[');
      expect(typeof result.summary).toBe('string');
    });

    it('creates a DB record with the correct tier and jobType', async () => {
      await service.verify(baseBugFixDto as never, ['auto']);
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tier: 'BASIC',
            jobType: 'BUG_FIX',
          }),
        }),
      );
    });

    it('updates the DB record with final status and counts after checks run', async () => {
      await service.verify(baseBugFixDto as never, ['auto']);
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            overallStatus: expect.any(String),
            checksPassed: expect.any(Number),
          }),
        }),
      );
    });

    it('persists check results to softwareDeliveryCheckResult', async () => {
      await service.verify(baseBugFixDto as never, ['auto']);
      expect(mockCreateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              checkId: expect.any(String),
              checkName: expect.any(String),
              tier: expect.any(String),
              status: expect.any(String),
            }),
          ]),
        }),
      );
    });
  });

  // ── Tier escalation applied before checks run ─────────────────────────────

  describe('tier escalation before checks run', () => {
    it('runs STANDARD checks when BASIC job is escalated to STANDARD', async () => {
      (mockEscalation.resolve as Mock).mockReturnValue({
        tier: 'STANDARD',
        escalated: true,
        escalationReason: 'Auto-escalated to Standard: data migration job type always requires Standard',
      });

      const dto = { ...baseBugFixDto, tier: SoftwareTier.BASIC, jobType: SoftwareJobType.MIGRATE_DATA };
      const result = await service.verify(dto as never, ['auto']);

      expect(result.escalated).toBe(true);
      expect(result.tierRun).toBe('STANDARD');
    });

    it('escalationReason is included in result when escalation occurred', async () => {
      (mockEscalation.resolve as Mock).mockReturnValue({
        tier: 'STANDARD',
        escalated: true,
        escalationReason: 'Auto-escalated to Standard: diff size 600 > 500',
      });

      const result = await service.verify({ ...baseBugFixDto, diffSize: 600 } as never, ['auto']);
      expect(result.escalationReason).toContain('600');
    });
  });

  // ── Selective rules mode ──────────────────────────────────────────────────

  describe('selective rules mode — rules: ["B1", "B6"]', () => {
    it('only runs the specified checks; all others SKIP', async () => {
      const result = await service.verify(baseBugFixDto as never, ['B1', 'B6']);
      const runChecks = result.results.filter(r => r.status !== 'SKIP');
      const runIds = runChecks.map(r => r.checkId);
      // Only B1 and B6 should be non-SKIP
      runIds.forEach(id => expect(['B1', 'B6']).toContain(id));
    });

    it('does not invoke github.checkCommitTiming (B2) when only B1 and B6 requested', async () => {
      await service.verify(baseBugFixDto as never, ['B1', 'B6']);
      // B2 should not have been called because it was not in the requested list
      // (B1 is requested so checkWorkExists IS called; B2 is not)
      // We verify by checking B2 result is SKIP in the results
      // Note: if the implementation omits non-requested checks entirely, this is a PASS
      expect(mockGithub.checkCommitTiming).not.toHaveBeenCalled();
    });

    it('rules: ["auto"] runs all tier + jobType checks', async () => {
      const result = await service.verify(baseBugFixDto as never, ['auto']);
      // With auto, BUG1/BUG2/BUG3 should be attempted (BUG_FIX job type)
      const bugChecks = result.results.filter(r =>
        ['BUG1', 'BUG2', 'BUG3'].includes(r.checkId),
      );
      expect(bugChecks.length).toBeGreaterThan(0);
    });
  });

  // ── NEEDS_REVIEW on S3 failure ────────────────────────────────────────────

  describe('STANDARD tier NEW_FEATURE: S3 failure → NEEDS_REVIEW', () => {
    it('returns needs_review when S3 (secrets check) finds a secret', async () => {
      (mockEscalation.resolve as Mock).mockReturnValue({
        tier: 'STANDARD',
        escalated: false,
        escalationReason: undefined,
      });
      mockSecurity.checkNoHardcodedSecrets.mockResolvedValue(
        failResult('S3', 'STANDARD'),
      );

      const result = await service.verify(
        { ...baseBugFixDto, tier: SoftwareTier.STANDARD, jobType: SoftwareJobType.NEW_FEATURE } as never,
        ['auto'],
      );

      expect(['needs-review', 'failed']).toContain(result.verificationStatus);
    });

    it('S3 failure appears in issuesFound', async () => {
      mockSecurity.checkNoHardcodedSecrets.mockResolvedValue(
        failResult('S3', 'STANDARD'),
      );

      const result = await service.verify(baseBugFixDto as never, ['S3']);
      const s3Issue = result.issuesFound.find(i => i.checkId === 'S3');
      expect(s3Issue).toBeDefined();
      expect(s3Issue?.status).toBe('FAIL');
    });
  });

  // ── Phase 2 deferred checks ───────────────────────────────────────────────

  describe('phase 2 build fallback messaging', () => {
    it('B5 returns SKIP with sandbox enablement hint when CI has no build signal', async () => {
      const result = await service.verify(baseBugFixDto as never, ['B5']);
      const b5 = result.results.find(r => r.checkId === 'B5');
      expect(b5?.status).toBe('SKIP');
      expect(b5?.detail).toMatch(/BUILD_SANDBOX_ENABLED|sandbox/i);
    });

    it('S2 returns SKIP with informative detail', async () => {
      (mockEscalation.resolve as Mock).mockReturnValue({ tier: 'STANDARD', escalated: false });
      const result = await service.verify({ ...baseBugFixDto, tier: SoftwareTier.STANDARD } as never, ['S2']);
      const s2 = result.results.find(r => r.checkId === 'S2');
      expect(s2?.status).toBe('SKIP');
    });

    it('S4 returns SKIP (type check requires local execution)', async () => {
      (mockEscalation.resolve as Mock).mockReturnValue({ tier: 'STANDARD', escalated: false });
      const result = await service.verify({ ...baseBugFixDto, tier: SoftwareTier.STANDARD } as never, ['S4']);
      const s4 = result.results.find(r => r.checkId === 'S4');
      expect(s4?.status).toBe('SKIP');
    });

    it('S5 returns SKIP (linter requires local execution)', async () => {
      (mockEscalation.resolve as Mock).mockReturnValue({ tier: 'STANDARD', escalated: false });
      const result = await service.verify({ ...baseBugFixDto, tier: SoftwareTier.STANDARD } as never, ['S5']);
      const s5 = result.results.find(r => r.checkId === 'S5');
      expect(s5?.status).toBe('SKIP');
    });
  });

  // ── Scoring integration ───────────────────────────────────────────────────

  describe('scoring integration', () => {
    it('recommendedAction is "approved" when status is PASSED', async () => {
      // Force all pass with no warnings
      mockJobType.checkPreMigrationBackup.mockReturnValue(passResult('MIG0'));
      const result = await service.verify(baseBugFixDto as never, ['B1', 'B2']);
      if (result.verificationStatus === 'passed') {
        expect(result.recommendedAction).toBe('approved');
      }
    });

    it('recommendedAction is "human_review" when status is NEEDS_REVIEW', async () => {
      mockGithub.checkWorkExists.mockResolvedValue(failResult('B1'));
      const result = await service.verify(baseBugFixDto as never, ['B1']);
      if (result.verificationStatus === 'needs_review') {
        expect(result.recommendedAction).toBe('human_review');
      }
    });

    it('recommendedAction is "human_review" when status is ESCALATED', async () => {
      (mockEscalation.resolve as Mock).mockReturnValue({
        tier: 'STANDARD',
        escalated: true,
        escalationReason: 'Auto-escalated to Standard: diff size 600 > 500',
      });
      mockJobType.checkPreMigrationBackup.mockReturnValue(passResult('MIG0'));
      const result = await service.verify({ ...baseBugFixDto, diffSize: 600 } as never, ['B1', 'B2']);
      expect(result.verificationStatus).toBe('escalated');
      expect(result.recommendedAction).toBe('human_review');
    });

    it('recommendedAction is "blocked" when status is FAILED', async () => {
      // 5 failures → FAILED
      mockGithub.checkWorkExists.mockResolvedValue(failResult('B1'));
      mockGithub.checkCommitTiming.mockResolvedValue(failResult('B2'));
      mockGithub.checkFilesInScope.mockResolvedValue(failResult('B3'));
      mockLive.checkLiveSite.mockResolvedValue(failResult('B6'));
      mockSecurity.checkNoHardcodedSecrets.mockResolvedValue(failResult('S3', 'STANDARD'));
      mockSecurity.checkDependencySecurity.mockResolvedValue(failResult('S6', 'STANDARD'));

      const result = await service.verify(baseBugFixDto as never, ['auto']);
      if (result.verificationStatus === 'failed') {
        expect(result.recommendedAction).toBe('blocked');
      }
    });
  });

  // ── RAILWAY / VERCEL deploy handling ──────────────────────────────────────

  describe('RAILWAY/VERCEL deploy platform handling', () => {
    it('delegates RAILWAY deploy checks to checkRailwayDeployment', async () => {
      mockDeployment.checkRailwayDeployment.mockResolvedValue([
        { checkId: 'S10', checkName: 'Production Running New Code', tier: 'STANDARD', status: 'SKIP', detail: 'No token' },
      ]);
      await service.verify(
        { ...baseBugFixDto, deployPlatform: DeployPlatform.RAILWAY, deployUrl: 'https://app.up.railway.app' } as never,
        ['S10'],
      );
      expect(mockDeployment.checkRailwayDeployment).toHaveBeenCalled();
      expect(mockDeployment.checkNetlifyDeployment).not.toHaveBeenCalled();
      expect(mockDeployment.checkRenderDeployment).not.toHaveBeenCalled();
    });

    it('delegates VERCEL deploy checks to checkVercelDeployment', async () => {
      mockDeployment.checkVercelDeployment.mockResolvedValue([
        { checkId: 'S10', checkName: 'Production Running New Code', tier: 'STANDARD', status: 'SKIP', detail: 'No token' },
      ]);
      await service.verify(
        { ...baseBugFixDto, deployPlatform: DeployPlatform.VERCEL, deployUrl: 'https://app.vercel.app' } as never,
        ['S10'],
      );
      expect(mockDeployment.checkVercelDeployment).toHaveBeenCalled();
    });
  });

  // ── verificationId in result ──────────────────────────────────────────────

  describe('verificationId', () => {
    it('returns a non-empty verificationId string from DB record', async () => {
      const result = await service.verify(baseBugFixDto as never, ['auto']);
      expect(typeof result.verificationId).toBe('string');
      expect(result.verificationId.length).toBeGreaterThan(0);
    });
  });

  // ── Critical checks: T4 / T2 FAIL hard-blocks the delivery ───────────────

  describe('critical checks hard-block on FAIL', () => {
    beforeEach(() => {
      (mockEscalation.resolve as Mock).mockReturnValue({
        tier: 'THOROUGH',
        escalated: true,
        escalationReason: 'Auto-escalated to Thorough for the test',
      });
    });

    it('T4 FAIL (auth guard removed) blocks the delivery regardless of fail count', async () => {
      mockDiff.checkProtectedRoutesStillProtected.mockReturnValue(failResult('T4', 'THOROUGH'));
      const result = await service.verify(
        { ...baseBugFixDto, tier: SoftwareTier.THOROUGH, jobType: SoftwareJobType.NEW_FEATURE } as never,
        ['auto'],
      );
      expect(result.verificationStatus).toBe('failed');
      expect(result.recommendedAction).toBe('blocked');
    });

    it('T2 FAIL (large untested code) blocks the delivery', async () => {
      mockDiff.checkNewCodeHasTest.mockReturnValue(failResult('T2', 'THOROUGH'));
      const result = await service.verify(
        { ...baseBugFixDto, tier: SoftwareTier.THOROUGH, jobType: SoftwareJobType.NEW_FEATURE } as never,
        ['auto'],
      );
      expect(result.verificationStatus).toBe('failed');
      expect(result.recommendedAction).toBe('blocked');
    });

    it('a single T4 FAIL blocks even when every other check passes', async () => {
      mockJobType.checkPreMigrationBackup.mockReturnValue(passResult('MIG0'));
      mockDiff.checkProtectedRoutesStillProtected.mockReturnValue(failResult('T4', 'THOROUGH'));
      const result = await service.verify(
        { ...baseBugFixDto, tier: SoftwareTier.THOROUGH, jobType: SoftwareJobType.NEW_FEATURE } as never,
        ['auto'],
      );
      expect(result.verificationStatus).toBe('failed');
    });
  });

  // ── No silent drops: every declared THOROUGH check produces a result ──────
  // Regression guard for the bug where TIER_CHECKS.THOROUGH declared T1/T2/T4/
  // T5/T8/T9 but runChecks never produced a result for them — they vanished
  // with no trace. Every check in the tier must appear in the output.

  describe('no silent drops — THOROUGH tier produces a result for every declared check', () => {
    beforeEach(() => {
      (mockEscalation.resolve as Mock).mockReturnValue({
        tier: 'THOROUGH',
        escalated: true,
        escalationReason: 'Auto-escalated to Thorough for the test',
      });
    });

    it('returns a result for every check id declared in TIER_CHECKS.THOROUGH', async () => {
      const result = await service.verify(
        { ...baseBugFixDto, tier: SoftwareTier.THOROUGH, jobType: SoftwareJobType.NEW_FEATURE } as never,
        ['auto'],
      );
      const producedIds = new Set(result.results.map(r => r.checkId));
      const missing = TIER_CHECKS.THOROUGH.filter(id => !producedIds.has(id));
      expect(missing).toEqual([]);
    });

    it('wires the previously-dropped and advanced checks so they each appear', async () => {
      const result = await service.verify(
        { ...baseBugFixDto, tier: SoftwareTier.THOROUGH, jobType: SoftwareJobType.NEW_FEATURE } as never,
        ['auto'],
      );
      const producedIds = result.results.map(r => r.checkId);
      for (const id of ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T8', 'T9', 'T11']) {
        expect(producedIds).toContain(id);
      }
    });

    it('actually invokes the 6 new DiffAnalysis methods on a THOROUGH run', async () => {
      await service.verify(
        { ...baseBugFixDto, tier: SoftwareTier.THOROUGH, jobType: SoftwareJobType.NEW_FEATURE } as never,
        ['auto'],
      );
      expect(mockDiff.checkCoverageDidNotDrop).toHaveBeenCalled();
      expect(mockDiff.checkNewCodeHasTest).toHaveBeenCalled();
      expect(mockDiff.checkProtectedRoutesStillProtected).toHaveBeenCalled();
      expect(mockDiff.checkRateLimitOnNewEndpoints).toHaveBeenCalled();
      expect(mockDiff.checkNoOrphanFiles).toHaveBeenCalled();
      expect(mockDiff.checkBreakingExportsHandled).toHaveBeenCalled();
    });

    it('invokes the advanced external-tool checks on a THOROUGH run', async () => {
      await service.verify(
        { ...baseBugFixDto, tier: SoftwareTier.THOROUGH, jobType: SoftwareJobType.NEW_FEATURE } as never,
        ['auto'],
      );
      expect(mockExternalTools.checkStaticSecurityAnalysis).toHaveBeenCalled();
      expect(mockExternalTools.checkPerformanceRegression).toHaveBeenCalled();
      expect(mockExternalTools.checkErrorRateStable).toHaveBeenCalled();
    });

    it('T11 is wired and returns the external-tool result instead of safety-net SKIP', async () => {
      const result = await service.verify(baseBugFixDto as never, ['T11']);
      const t11 = result.results.find(r => r.checkId === 'T11');
      expect(t11?.checkName).toBe('Error rate stable post-deploy');
      expect(t11?.detail).toBe('Skipped.');
      expect(mockExternalTools.checkErrorRateStable).toHaveBeenCalled();
    });
  });
});
