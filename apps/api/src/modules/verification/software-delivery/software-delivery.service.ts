import { Injectable, Logger } from '@nestjs/common';
import {
  Prisma,
  SoftwareVerificationTier,
  SoftwareJobType as PrismaSoftwareJobType,
  SoftwareVerificationStatus,
  DeployPlatform as PrismaDeployPlatform,
  CheckResultStatus,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.js';
import type { SoftwareDeliveryVerifyDto } from './dto/software-delivery-verify.dto.js';
import type { CheckResult, SoftwareTier } from './software-delivery.types.js';
import { TIER_CHECKS, JOB_TYPE_CHECKS, CHECK_NAMES } from './software-delivery.types.js';
import { SoftwareDeliveryEscalationService } from './software-delivery-escalation.js';
import { GithubChecksService } from './checks/github-checks.service.js';
import { LiveChecksService } from './checks/live-checks.service.js';
import { SecurityChecksService } from './checks/security-checks.service.js';
import { DiffAnalysisService } from './checks/diff-analysis.service.js';
import { DeploymentChecksService } from './checks/deployment-checks.service.js';
import { JobTypeChecksService } from './checks/job-type-checks.service.js';
import { BuildChecksService } from './checks/build-checks.service.js';
import { ExternalToolChecksService } from './checks/external-tool-checks.service.js';

export interface SoftwareDeliveryVerifyResult {
  verificationId: string;
  proofId: string;
  verificationStatus: string;
  confidence: number;
  tierRun: SoftwareTier;
  jobType: string;
  escalated: boolean;
  escalationReason?: string;
  summary: string;
  checksPassed: number;
  checksFailed: number;
  checksWarning: number;
  checksSkipped: number;
  checksRun: number;
  issuesFound: Array<{ checkId: string; checkName: string; status: string; detail?: string }>;
  recommendedAction: string;
  results: Array<{
    checkId: string;
    checkName: string;
    status: string;
    detail?: string;
    durationMs?: number;
    evidence?: Record<string, unknown>;
  }>;
}

@Injectable()
export class SoftwareDeliveryService {
  private readonly logger = new Logger(SoftwareDeliveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly escalation: SoftwareDeliveryEscalationService,
    private readonly github: GithubChecksService,
    private readonly live: LiveChecksService,
    private readonly security: SecurityChecksService,
    private readonly diffAnalysis: DiffAnalysisService,
    private readonly deployment: DeploymentChecksService,
    private readonly jobType: JobTypeChecksService,
    private readonly build: BuildChecksService,
    private readonly externalTools: ExternalToolChecksService,
  ) {}

  async verify(
    dto: SoftwareDeliveryVerifyDto,
    requestedChecks: string[],
    options?: { organizationId?: string },
  ): Promise<SoftwareDeliveryVerifyResult> {
    const { tier, escalated, escalationReason } = this.escalation.resolve(dto);
    const checkList = this.buildCheckList(tier, dto.jobType, requestedChecks);

    const record = await this.prisma.softwareDeliveryVerification.create({
      data: {
        organizationId: options?.organizationId ?? null,
        tier: tier as SoftwareVerificationTier,
        jobType: dto.jobType as PrismaSoftwareJobType,
        repoOwner: dto.repoOwner,
        repoName: dto.repoName,
        beforeSha: dto.beforeSha,
        afterSha: dto.afterSha,
        jobStartedAt: new Date(dto.jobStartedAt),
        jobDescription: dto.jobDescription,
        aiReport: dto.aiReport,
        deployUrl: dto.deployUrl,
        deployPlatform: (dto.deployPlatform as PrismaDeployPlatform | undefined) ?? null,
        prNumber: dto.prNumber,
        diffSize: dto.diffSize,
        jobValueUsd: dto.jobValueUsd,
        overallStatus: SoftwareVerificationStatus.NEEDS_REVIEW,
        escalated,
        escalationReason,
      },
    });

    const jobStartedAt = new Date(dto.jobStartedAt);
    const [diffFiles, diffText] = await Promise.all([
      this.github.getDiffFiles(dto.repoOwner, dto.repoName, dto.beforeSha, dto.afterSha),
      this.github.getDiffText(dto.repoOwner, dto.repoName, dto.beforeSha, dto.afterSha),
    ]);

    const results = await this.runChecks(checkList, dto, diffFiles, diffText, jobStartedAt);
    const { status, confidence, summary } = this.score(results, escalated);

    const passed = results.filter(r => r.status === 'PASS').length;
    const failed = results.filter(r => r.status === 'FAIL').length;
    const warning = results.filter(r => r.status === 'WARNING').length;
    const skipped = results.filter(r => r.status === 'SKIP').length;
    const run = results.filter(r => r.status !== 'SKIP').length;

    await this.prisma.softwareDeliveryVerification.update({
      where: { id: record.id },
      data: {
        overallStatus: status as SoftwareVerificationStatus,
        checksRun: run,
        checksPassed: passed,
        checksFailed: failed,
        checksWarning: warning,
        checksSkipped: skipped,
        buyerSummary: summary,
      },
    });

    await this.prisma.softwareDeliveryCheckResult.createMany({
      data: results.map(r => ({
        verificationId: record.id,
        checkId: r.checkId,
        checkName: r.checkName,
        tier: r.tier as SoftwareVerificationTier,
        status: r.status as CheckResultStatus,
        detail: r.detail,
        evidence: (r.evidence as Prisma.InputJsonValue) ?? undefined,
        durationMs: r.durationMs,
      })),
    });

    const issues = results
      .filter(r => r.status === 'FAIL' || r.status === 'WARNING')
      .map(r => ({ checkId: r.checkId, checkName: r.checkName, status: r.status, detail: r.detail }));

    return {
      verificationId: record.id,
      proofId: record.proofId,
      verificationStatus: status.toLowerCase().replaceAll('_', '-'),
      confidence,
      tierRun: tier,
      jobType: dto.jobType,
      escalated,
      escalationReason,
      summary,
      checksPassed: passed,
      checksFailed: failed,
      checksWarning: warning,
      checksSkipped: skipped,
      checksRun: run,
      issuesFound: issues,
      recommendedAction: this.recommendedAction(status, failed, warning),
      results: results.map(r => ({
        checkId: r.checkId,
        checkName: r.checkName,
        status: r.status,
        detail: r.detail,
        durationMs: r.durationMs,
        evidence: r.evidence,
      })),
    };
  }

  private buildCheckList(tier: SoftwareTier, jobType: string, requested: string[]): string[] {
    const autoMode = requested.length === 0 || (requested.length === 1 && requested[0] === 'auto');
    if (!autoMode) return requested;
    const tierChecks = TIER_CHECKS[tier] ?? TIER_CHECKS['BASIC'];
    const jobChecks = JOB_TYPE_CHECKS[jobType] ?? [];
    return [...new Set([...tierChecks, ...jobChecks])];
  }

  private async runChecks(
    checkList: string[],
    dto: SoftwareDeliveryVerifyDto,
    diffFiles: string[],
    diffText: string,
    jobStartedAt: Date,
  ): Promise<CheckResult[]> {
    const results: CheckResult[] = [];
    const has = (id: string) => checkList.includes(id);

    // Group A — GitHub API checks (parallel)
    const groupA = await Promise.all([
      has('B1') ? this.github.checkWorkExists(dto.repoOwner, dto.repoName, dto.beforeSha, dto.afterSha) : null,
      has('B2') ? this.github.checkCommitTiming(dto.repoOwner, dto.repoName, dto.afterSha, jobStartedAt) : null,
      has('B3') ? this.github.checkFilesInScope(dto.repoOwner, dto.repoName, dto.beforeSha, dto.afterSha, dto.jobDescription) : null,
      has('B7') ? this.github.checkPrMerged(dto.repoOwner, dto.repoName, dto.prNumber, jobStartedAt) : null,
      has('S9') ? this.github.checkCiPassed(dto.repoOwner, dto.repoName, dto.afterSha, jobStartedAt) : null,
    ]);
    results.push(...groupA.filter((r): r is CheckResult => r !== null));

    // Group B — Live HTTP checks (parallel)
    const groupB = await Promise.all([
      has('B6') ? this.live.checkLiveSite(dto.deployUrl) : null,
      has('DEP4') ? this.live.checkHealthEndpoint(dto.deployUrl) : null,
      has('S8') ? this.live.checkFeatureReachable(dto.deployUrl, dto.jobDescription) : null,
    ]);
    results.push(...groupB.filter((r): r is CheckResult => r !== null));

    // Group C — Synchronous diff analysis (no external calls)
    if (has('B4')) results.push(this.diffAnalysis.checkAiReportMatchesDiff(dto.aiReport, diffFiles));
    if (has('S12')) results.push(this.security.checkNoUnconditionalSuccessRegression(diffText));
    if (has('S7')) results.push(this.diffAnalysis.checkScopeAdherence(diffFiles));
    if (has('S11')) results.push(this.diffAnalysis.checkLockFileConsistency(diffFiles));
    if (has('T1')) results.push(this.diffAnalysis.checkCoverageDidNotDrop(diffFiles, diffText));
    if (has('T2')) results.push(this.diffAnalysis.checkNewCodeHasTest(diffFiles, diffText));
    if (has('T3')) results.push(this.externalTools.checkStaticSecurityAnalysis(dto, diffFiles));
    if (has('T4')) results.push(this.diffAnalysis.checkProtectedRoutesStillProtected(diffFiles, diffText));
    if (has('T5')) results.push(this.diffAnalysis.checkRateLimitOnNewEndpoints(diffFiles, diffText));
    if (has('T6')) results.push(await this.externalTools.checkPerformanceRegression(dto));
    if (has('T7')) results.push(this.diffAnalysis.checkEnvVarsDocumented(diffText, diffFiles));
    if (has('T8')) results.push(this.diffAnalysis.checkNoOrphanFiles(diffFiles, diffText));
    if (has('T9')) results.push(this.diffAnalysis.checkBreakingExportsHandled(diffText));
    if (has('T10')) results.push(this.diffAnalysis.checkSpecRequirementsAddressed(dto.jobDescription, diffFiles));
    if (has('T11')) results.push(await this.externalTools.checkErrorRateStable(dto, jobStartedAt));
    if (has('T12')) results.push(this.diffAnalysis.checkDeliveryDescriptionMatchesDiff(dto.aiReport, diffFiles, diffText));

    // Group D — Security checks (parallel)
    const groupD = await Promise.all([
      has('S3') ? this.security.checkNoHardcodedSecrets(diffText) : null,
      has('S6') ? this.security.checkDependencySecurity(diffFiles, dto.repoOwner, dto.repoName, dto.beforeSha, dto.afterSha) : null,
      has('INT1') ? this.security.checkNoHardcodedCredentials(diffText) : null,
      has('INT2') ? this.security.checkRealCredentials(dto.deployUrl) : null,
    ]);
    results.push(...groupD.filter((r): r is CheckResult => r !== null));

    // B5/S2/S4/S5 — build / tests / typecheck / lint, derived from the repo's
    // own CI (GitHub Check-Runs + commit statuses) on the delivery commit.
    // Returns real PASS/FAIL when CI publishes a matching check, documented SKIP
    // otherwise. No local build sandbox required in Phase 1.
    if (has('B5') || has('S2') || has('S4') || has('S5')) {
      results.push(
        ...(await this.build.runBuildChecks(dto.repoOwner, dto.repoName, dto.afterSha, checkList)),
      );
    }

    // Deployment platform checks
    if (dto.deployPlatform && (has('S10') || has('DEP1') || has('DEP2') || has('DEP3') || has('DEP5'))) {
      const deployInput = {
        expectedSha: dto.afterSha,
        token: undefined as string | undefined,
        jobStartedAt,
        deployUrl: dto.deployUrl,
      };
      let platformResults: CheckResult[] = [];

      if (dto.deployPlatform === 'NETLIFY') {
        deployInput.token = dto.netlifyToken;
        platformResults = await this.deployment.checkNetlifyDeployment(dto.netlifySiteId, deployInput);
      } else if (dto.deployPlatform === 'RENDER') {
        deployInput.token = dto.renderToken;
        platformResults = await this.deployment.checkRenderDeployment(dto.renderServiceId, deployInput);
      } else if (dto.deployPlatform === 'VERCEL') {
        deployInput.token = dto.vercelToken;
        platformResults = await this.deployment.checkVercelDeployment(
          dto.vercelProjectId,
          dto.vercelTeamId,
          deployInput,
        );
      } else if (dto.deployPlatform === 'RAILWAY') {
        deployInput.token = dto.railwayToken;
        platformResults = await this.deployment.checkRailwayDeployment(dto.railwayServiceId, deployInput);
      } else {
        const platformName = String(dto.deployPlatform);
        const skipReason = `Automated ${platformName} deploy verification is not supported. Health (DEP4) and behavioural probes (DEP1) still run.`;
        const platformCheckIds: Array<[string, SoftwareTier]> = [
          ['S10', 'STANDARD'],
          ['DEP2', 'BASIC'],
          ['DEP3', 'BASIC'],
        ];
        platformResults = platformCheckIds
          .filter(([id]) => has(id))
          .map(([id, tier]) => ({
            checkId: id,
            checkName: CHECK_NAMES[id] ?? id,
            tier,
            status: 'SKIP' as const,
            detail: skipReason,
            evidence: { platform: platformName },
          }));
      }

      if (has('DEP1')) {
        platformResults.push(await this.deployment.checkProductionRunningNewCode(dto.deployUrl, dto.afterSha));
      }
      if (has('DEP5')) {
        platformResults.push(
          await this.deployment.checkNoCrashLoops(dto.renderServiceId, dto.deployPlatform, dto.renderToken, jobStartedAt),
        );
      }
      results.push(...platformResults.filter(r => has(r.checkId)));
    }

    await this.runJobTypeChecks(checkList, dto, diffFiles, diffText, jobStartedAt, results);

    // Safety net: any requested check that produced no result is surfaced as a
    // documented SKIP. This guarantees a check declared in a tier/job-type can
    // never silently vanish from the report — the failure mode where THOROUGH
    // promised checks but only ran a subset with no trace.
    const produced = new Set(results.map(r => r.checkId));
    for (const id of checkList) {
      if (!produced.has(id)) {
        results.push({
          checkId: id,
          checkName: CHECK_NAMES[id] ?? id,
          tier: this.tierForCheck(id),
          status: 'SKIP',
          detail: 'This check is defined for the requested tier/job type but is not enabled in this verification run. It was not evaluated.',
        });
      }
    }

    return results;
  }

  private tierForCheck(checkId: string): SoftwareTier {
    if ((TIER_CHECKS.BASIC as string[]).includes(checkId)) return 'BASIC';
    if ((TIER_CHECKS.STANDARD as string[]).includes(checkId)) return 'STANDARD';
    if ((TIER_CHECKS.THOROUGH as string[]).includes(checkId)) return 'THOROUGH';
    return 'BASIC';
  }

  private async runJobTypeChecks(
    checkList: string[],
    dto: SoftwareDeliveryVerifyDto,
    diffFiles: string[],
    diffText: string,
    jobStartedAt: Date,
    results: CheckResult[],
  ): Promise<void> {
    const has = (id: string) => checkList.includes(id);
    if (has('BUG1')) results.push(await this.jobType.checkBugNoLongerReproduces(dto.deployUrl));
    if (has('BUG2')) results.push(this.jobType.checkBugRegressionTestExists(diffFiles));
    if (has('BUG3')) results.push(this.jobType.checkBugFixAddressesRootCause(diffText));
    if (has('TEST1')) results.push(this.jobType.checkTestsNotSkipped(diffText));
    if (has('TEST2')) results.push(this.jobType.checkTestsHaveAssertions(diffText));
    if (has('TEST5')) results.push(this.jobType.checkTestCountIncreased(diffText));
    if (has('MIG0')) results.push(this.jobType.checkPreMigrationBackup(jobStartedAt));
    if (has('MIG1')) results.push(this.jobType.checkMigrationApplied(diffFiles));
    if (has('MIG4')) results.push(this.jobType.checkNoUnexpectedNulls(diffText));
    if (has('NEW1')) results.push(this.jobType.checkNewCodeWiredIn(diffFiles));
    if (has('NEW4')) results.push(this.jobType.checkSchemaChangesHaveMigration(diffFiles));
    if (has('REV1')) results.push(this.jobType.checkReviewFileCoverage(dto.aiReport, diffFiles));
  }

  // Any FAIL in a critical check hard-blocks delivery regardless of total fail count.
  // T4 (an auth guard was removed → possible auth bypass) and T2 (substantial new
  // code shipped with no test) are treated as critical: a FAIL on either blocks
  // the delivery rather than merely flagging it for review.
  private static readonly CRITICAL_CHECKS = new Set(['B1', 'S3', 'S6', 'S12', 'INT1', 'T2', 'T4']);

  private score(
    results: CheckResult[],
    escalated: boolean,
  ): { status: string; confidence: number; summary: string } {
    const failed = results.filter(r => r.status === 'FAIL').length;
    const warnings = results.filter(r => r.status === 'WARNING').length;
    const passed = results.filter(r => r.status === 'PASS').length;
    const total = results.filter(r => r.status !== 'SKIP').length;
    if (total === 0) {
      return {
        status: escalated ? 'ESCALATED' : 'NEEDS_REVIEW',
        confidence: 0,
        summary: 'No checks completed. Evidence is insufficient; human review is required.',
      };
    }
    const hasCriticalFail = results.some(
      r => r.status === 'FAIL' && SoftwareDeliveryService.CRITICAL_CHECKS.has(r.checkId),
    );
    const confidence = Math.max(0, Math.min(1, 1 - failed * 0.15 - warnings * 0.05));
    let status: string;
    if (hasCriticalFail) status = 'FAILED';
    else if (failed === 0 && warnings === 0) status = 'PASSED';
    else if (failed === 0 && warnings > 0) status = 'NEEDS_REVIEW';
    else if (failed <= 2 && confidence >= 0.6) status = 'NEEDS_REVIEW';
    else status = 'FAILED';
    if (escalated && status !== 'FAILED') {
      status = 'ESCALATED';
    }
    const summary =
      failed === 0 && warnings === 0
        ? `${passed} of ${total} checks passed. Safe to release.`
        : `${passed} of ${total} checks passed. ${failed} failed, ${warnings} warnings.`;
    return { status, confidence: Math.round(confidence * 100) / 100, summary };
  }

  private recommendedAction(status: string, failed: number, warning: number): string {
    if (status === 'FAILED') return 'blocked';
    if (status === 'ESCALATED' || status === 'NEEDS_REVIEW' || warning > 0) return 'human_review';
    return 'approved';
  }
}
