import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  ProofProduct,
  ProofSourceType,
  ProofRunStatus,
  ProofRiskLevel,
  VerificationRun,
  ProofRecord,
} from '@prisma/client';

import { PrismaService } from '../database/prisma.service.js';

// ---------------------------------------------------------------------------
// Re-export Prisma enums under the domain names callers expect.
// ---------------------------------------------------------------------------

export { ProofProduct as VerificationProduct };
export { ProofSourceType as VerificationSourceType };
export { ProofRunStatus as VerificationStatus };
export { ProofRiskLevel as VerificationRiskLevel };

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

/**
 * Derive a risk level from an array of issue objects.
 *
 * Rules (evaluated in descending severity order):
 *  - Any issue with `severity === "critical"` → HIGH
 *  - Any issue with `severity === "warning"`  → MEDIUM
 *  - Everything else (or empty array)          → LOW
 */
export function riskLevelFromIssues(issues: Array<{ severity?: string; [key: string]: unknown }>): ProofRiskLevel {
  if (!issues || issues.length === 0) {
    return ProofRiskLevel.LOW;
  }

  const severities = new Set(issues.map((i) => (i.severity ?? '').toLowerCase()));

  if (severities.has('critical')) {
    return ProofRiskLevel.HIGH;
  }

  if (severities.has('warning')) {
    return ProofRiskLevel.MEDIUM;
  }

  return ProofRiskLevel.LOW;
}

/**
 * Compute an integer confidence percentage from a checks array and a passed count.
 *
 * @param checks   - All checks that were performed.
 * @param passed   - Number of checks that passed.
 * @returns Integer in [0, 100].
 */
export function confidenceFromChecks(checks: unknown[], passed: number): number {
  if (!checks || checks.length === 0) {
    return 0;
  }

  const ratio = Math.max(0, Math.min(passed, checks.length)) / checks.length;
  return Math.round(ratio * 100);
}

// ---------------------------------------------------------------------------
// Allowed forward state transitions
// Used to reject nonsensical status updates early (before hitting the DB).
// ---------------------------------------------------------------------------

const ALLOWED_TRANSITIONS: Record<ProofRunStatus, ProofRunStatus[]> = {
  [ProofRunStatus.QUEUED]: [
    ProofRunStatus.PROCESSING,
    ProofRunStatus.ERROR,
  ],
  [ProofRunStatus.PROCESSING]: [
    ProofRunStatus.PASSED,
    ProofRunStatus.FAILED,
    ProofRunStatus.NEEDS_REVIEW,
    ProofRunStatus.ERROR,
  ],
  [ProofRunStatus.PASSED]: [],
  [ProofRunStatus.FAILED]: [],
  [ProofRunStatus.NEEDS_REVIEW]: [
    ProofRunStatus.PASSED,
    ProofRunStatus.FAILED,
  ],
  [ProofRunStatus.ERROR]: [
    ProofRunStatus.QUEUED, // allow retry
  ],
};

// ---------------------------------------------------------------------------
// VerificationService
// ---------------------------------------------------------------------------

@Injectable()
export class VerificationService {
  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------------
  // queueVerification
  // -------------------------------------------------------------------------

  /**
   * Create a new VerificationRun in QUEUED state.
   *
   * The run is created synchronously and returned immediately.
   * Async processing (Trigger.dev task) is wired in a later task.
   *
   * @param orgId        - Organisation that owns this run.
   * @param product      - Which verification product to use.
   * @param sourceType   - How the source material was supplied.
   * @param inputSummary - Human-readable description of the input.
   * @returns The newly created VerificationRun.
   */
  async queueVerification(
    orgId: string,
    product: ProofProduct,
    sourceType: ProofSourceType,
    inputSummary: string,
  ): Promise<VerificationRun> {
    return this.prisma.verificationRun.create({
      data: {
        orgId,
        product,
        sourceType,
        inputSummary,
        status: ProofRunStatus.QUEUED,
        riskLevel: ProofRiskLevel.UNKNOWN,
      },
    });
  }

  // -------------------------------------------------------------------------
  // getVerificationRun
  // -------------------------------------------------------------------------

  /**
   * Fetch a single VerificationRun by ID, scoped to the requesting org.
   *
   * @param orgId - Must match the run's orgId (no cross-org access).
   * @param runId - Primary key of the run.
   * @returns The VerificationRun.
   * @throws NotFoundException when the run does not exist or belongs to a different org.
   */
  async getVerificationRun(orgId: string, runId: string): Promise<VerificationRun> {
    // orgId is included in the where clause — cross-org scope check is enforced here.
    const run = await this.prisma.verificationRun.findUnique({
      where: { id: runId, orgId },
    });

    if (!run) {
      throw new NotFoundException(`VerificationRun ${runId} not found`);
    }

    // L-3: defensive timeout fallback — if a job has been QUEUED for more than
    // 5 minutes the background worker did not pick it up. Transition it to FAILED
    // so the caller sees a clear error state instead of an indefinite spinner.
    // The real fix is to debug the worker; this ensures the UI never gets stuck.
    const QUEUED_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
    if (
      run.status === ProofRunStatus.QUEUED &&
      Date.now() - run.createdAt.getTime() > QUEUED_TIMEOUT_MS
    ) {
      const updated = await this.prisma.verificationRun.update({
        where: { id: runId },
        data: {
          status: ProofRunStatus.ERROR,
          outputSummary: 'Processing timeout — worker did not pick up this job. Please retry.',
          updatedAt: new Date(),
        },
      });
      return updated;
    }

    return run;
  }

  // -------------------------------------------------------------------------
  // listVerifications
  // -------------------------------------------------------------------------

  /**
   * Paginate VerificationRuns for an org with optional filters.
   *
   * Uses (orgId, createdAt) for ordering and (orgId, product, status) for
   * filtered queries — these indexes should exist on the Prisma model.
   *
   * @param orgId   - Scope all results to this org.
   * @param product - Optional product filter.
   * @param status  - Optional status filter.
   * @param limit   - Page size (default 20).
   * @param offset  - Page offset (default 0).
   * @returns `{ runs, total }` — current page plus total count.
   */
  async listVerifications(
    orgId: string,
    product?: ProofProduct,
    status?: ProofRunStatus,
    limit = 20,
    offset = 0,
  ): Promise<{ runs: VerificationRun[]; total: number }> {
    // Build the where clause; orgId is always present.
    const where: Prisma.VerificationRunWhereInput = {
      orgId,
      ...(product ? { product } : {}),
      ...(status ? { status } : {}),
    };

    const [runs, total] = await this.prisma.$transaction([
      this.prisma.verificationRun.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      this.prisma.verificationRun.count({ where }),
    ]);

    return { runs, total };
  }

  // -------------------------------------------------------------------------
  // listProofRecordsWithFilters
  // -------------------------------------------------------------------------

  /**
   * Paginate ProofRecords for an org using page-based (1-indexed) pagination.
   *
   * Returns the shape expected by GET /verifications/reports:
   *   `{ data: ProofRecord[], total: number, page: number }`
   *
   * @param orgId   - Scope all results to this org.
   * @param page    - 1-indexed page number (default 1).
   * @param limit   - Page size (default 10, max 100).
   * @param product - Optional product filter (ProofProduct enum string).
   * @param status  - Optional ProofRunStatus filter applied to the linked VerificationRun.
   *                  Filters by the run's status via a nested where clause.
   * @returns `{ data, total, page }`.
   */
  async listProofRecordsWithFilters(
    orgId: string,
    page = 1,
    limit = 10,
    product?: ProofProduct,
    status?: ProofRunStatus,
  ): Promise<{ data: ProofRecord[]; total: number; page: number }> {
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(Math.max(1, limit), 100);
    const skip = (safePage - 1) * safeLimit;

    const where: Prisma.ProofRecordWhereInput = {
      orgId,
      ...(product ? { product } : {}),
      ...(status ? { verificationRun: { status } } : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.proofRecord.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: safeLimit,
      }),
      this.prisma.proofRecord.count({ where }),
    ]);

    return { data, total, page: safePage };
  }

  // -------------------------------------------------------------------------
  // updateVerificationStatus
  // -------------------------------------------------------------------------

  /**
   * Update the status of a VerificationRun, with optional field updates.
   *
   * Validates the transition before writing to the DB to avoid nonsensical
   * state machines (e.g. PASSED → QUEUED).
   *
   * @param runId  - Primary key of the run.
   * @param orgId  - Scope check: must match the run's orgId.
   * @param status - Target status.
   * @param updates - Optional additional fields to write atomically.
   * @returns The updated VerificationRun.
   * @throws NotFoundException    when the run does not exist or belongs to a different org.
   * @throws BadRequestException  when the transition is not allowed.
   */
  async updateVerificationStatus(
    runId: string,
    orgId: string,
    status: ProofRunStatus,
    updates?: {
      riskLevel?: ProofRiskLevel;
      outputSummary?: string;
      confidence?: number;
      issuesFound?: Prisma.InputJsonValue;
      checksPerformed?: Prisma.InputJsonValue;
    },
  ): Promise<VerificationRun> {
    // Scope check: fetch with orgId in where clause.
    const run = await this.prisma.verificationRun.findUnique({
      where: { id: runId, orgId },
    });

    if (!run) {
      throw new NotFoundException(`VerificationRun ${runId} not found`);
    }

    const allowed = ALLOWED_TRANSITIONS[run.status as ProofRunStatus] ?? [];
    if (!allowed.includes(status)) {
      throw new BadRequestException(
        `Cannot transition VerificationRun from ${run.status} to ${status}`,
      );
    }

    return this.prisma.verificationRun.update({
      where: { id: runId },
      data: {
        status,
        ...(updates?.riskLevel !== undefined ? { riskLevel: updates.riskLevel } : {}),
        ...(updates?.outputSummary !== undefined ? { outputSummary: updates.outputSummary } : {}),
        ...(updates?.confidence !== undefined ? { confidence: updates.confidence } : {}),
        ...(updates?.issuesFound !== undefined
          ? { issuesFound: updates.issuesFound as Prisma.InputJsonValue }
          : {}),
        ...(updates?.checksPerformed !== undefined
          ? { checksPerformed: updates.checksPerformed as Prisma.InputJsonValue }
          : {}),
      },
    });
  }
}
