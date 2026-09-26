import { createHash, sign as cryptoSign, createPrivateKey } from 'crypto';

import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ProofProduct,
  ProofRunStatus,
  ProofStatus,
  ProofSubject,
  ProofFinalDecision,
  ProofRecord,
  VerificationRun,
} from '@prisma/client';

import { auditProofPlanConfigs, verifyApiPlanConfigs } from '@chain-verify/config';

import { PrismaService } from '../database/prisma.service.js';
import { VerificationProduct } from './verification.service.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAYS_PER_MONTH = 30;

// Retention status values stored in ProofRecord.retentionStatus (free-text column).
const RETENTION_STATUS_ACTIVE = 'ACTIVE';
const RETENTION_STATUS_ARCHIVED = 'ARCHIVED';
const RETENTION_STATUS_EXPIRED = 'EXPIRED';

/**
 * Resolve the retention window (in days) for a proof from the plan slug it was
 * created under.
 *
 * The plan family is keyed off the slug, since the ProofProduct enum
 * (INVOICE_AUDIT / IDENTITY_CHECK / DOCUMENT_VERIFY / COMPLIANCE_SCAN) does not
 * distinguish AuditProof from VerifyAPI:
 *   - `auditproof-*` slugs → AuditProof plans (retentionMonths × 30 days).
 *   - everything else      → VerifyAPI plans (retentionDays).
 *
 * Returns `null` when the resolved plan has unlimited / no retention
 * (e.g. Enterprise plans where retentionDays / retentionMonths is null).
 * When the slug cannot be resolved (anonymous proofs, missing slug) we fall
 * back to the free VerifyAPI plan's retention window — the most conservative
 * non-unlimited default.
 */
function resolveRetentionPolicyDays(planSlug: string | undefined): number | null {
  if (planSlug) {
    const auditPlan = auditProofPlanConfigs.find((p) => p.slug === planSlug);
    if (auditPlan) {
      return auditPlan.retentionMonths === null ? null : auditPlan.retentionMonths * DAYS_PER_MONTH;
    }

    const verifyPlan = verifyApiPlanConfigs.find((p) => p.slug === planSlug);
    if (verifyPlan) {
      return verifyPlan.retentionDays ?? null;
    }
  }

  // Unknown/missing slug → free VerifyAPI plan retention (anonymous default).
  return verifyApiPlanConfigs[0].retentionDays ?? null;
}

// Re-export Prisma enums under the names callers expect.
export { ProofStatus };
export { ProofSubject };
export { ProofFinalDecision };

// ---------------------------------------------------------------------------
// Allowed forward ProofStatus transitions
// ---------------------------------------------------------------------------

const ALLOWED_PROOF_TRANSITIONS: Record<ProofStatus, ProofStatus[]> = {
  [ProofStatus.CREATED]: [ProofStatus.EXPORTED, ProofStatus.ARCHIVED],
  [ProofStatus.EXPORTED]: [ProofStatus.ARCHIVED],
  [ProofStatus.ARCHIVED]: [],
};

const ANONYMOUS_ORG_ID = 'anonymous';

export interface PublicProofSummary {
  id: string;
  proof_id: string;
  verification_id: string;
  product: ProofProduct;
  subject: ProofSubject;
  summary: string;
  final_decision: ProofFinalDecision;
  proof_status: ProofStatus;
  chain_hash: string | null;
  created_at: Date;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  issuesFound: number;
  verification: {
    verification_status: ProofRunStatus;
    risk_level: string;
    confidence: number | null;
    input_summary: string;
    output_summary: string | null;
  } | null;
}

function stableJsonStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJsonStringify(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Minimal shape needed to evaluate retention expiry. Accepts a full ProofRecord
 * or any object carrying the two retention fields, so callers (e.g. the
 * verify-api controller on retrieval) can pass a partial select.
 */
export interface RetentionCheckable {
  retentionStatus: string | null;
  retentionExpiresAt: Date | null;
}

/**
 * Returns true when a proof is no longer retained:
 *   - its retentionStatus is EXPIRED or ARCHIVED, OR
 *   - it has a retentionExpiresAt in the past.
 *
 * Pure function (no DB access) so it is cheap to call on every retrieval.
 * Exported so the verify-api controller can gate proof reads.
 */
export function isRetentionExpired(proof: RetentionCheckable, now: Date = new Date()): boolean {
  if (
    proof.retentionStatus === RETENTION_STATUS_EXPIRED ||
    proof.retentionStatus === RETENTION_STATUS_ARCHIVED
  ) {
    return true;
  }
  return proof.retentionExpiresAt != null && proof.retentionExpiresAt.getTime() < now.getTime();
}

/**
 * Compute a SHA-256 hash over arbitrary proof content + evidence. Unlike a hash
 * over a proof id alone, this binds the digest to the actual delivered content,
 * so the resulting chain_hash is tamper-evident.
 *
 * Object inputs are serialised with a stable key ordering before hashing so the
 * digest is deterministic regardless of property insertion order.
 *
 * Exported for the software-delivery (SD) path: SD chain_hash should be derived
 * from content+evidence via this helper rather than sha256(proofId) alone.
 */
export function computeContentHash(input: unknown): string {
  const serialised = typeof input === 'string' ? input : stableJsonStringify(input);
  return createHash('sha256').update(serialised).digest('hex');
}

/**
 * The single canonical formula for a ProofRecord's org-scoped hash chain:
 *
 *   sha256(id | orgId | summary | stable_json(evidence) | prevChainHash)
 *
 * This is the ONE formula used to (a) mint a new record's chain_hash in
 * {@link ProofService.createProof}, (b) spot-check one record's self-
 * consistency in `GET /api/proof/:id/verify`, and (c) re-verify every record
 * visited while walking a full chain in {@link ProofService.walkProofChain}.
 * It used to be duplicated (byte-for-byte) between this file and
 * verify-api.controller.ts — that duplication is exactly the kind of thing
 * that lets a hash-chain implementation silently drift out of sync with
 * itself, so it now lives in exactly one place and every caller imports it.
 *
 * `prevChainHash` is normalised to '' when null/undefined so an explicit
 * `null` (as stored for a genesis record) and an omitted value hash
 * identically — matching the `prevChainHash || null` write in createProof().
 */
export function computeProofChainHash(input: {
  id: string;
  orgId: string;
  summary: string;
  evidence: unknown;
  prevChainHash: string | null | undefined;
}): string {
  return createHash('sha256')
    .update(
      [
        input.id,
        input.orgId,
        input.summary,
        stableJsonStringify(input.evidence),
        input.prevChainHash ?? '',
      ].join('|'),
    )
    .digest('hex');
}

// ---------------------------------------------------------------------------
// Chain-walk verification types
// ---------------------------------------------------------------------------

/**
 * Why a chain walk stopped early. Mirrors the two failure modes a hash chain
 * can exhibit:
 *   - SELF_HASH_MISMATCH: the record's own chain_hash does not recompute from
 *     its own stored id/orgId/summary/evidence/prev_chain_hash — its content
 *     (or its chain_hash field directly) was altered after creation.
 *   - PREV_HASH_MISMATCH: the record's chain_hash recomputes correctly in
 *     isolation, but the predecessor it names via prev_chain_hash does not
 *     have that value as its CURRENT chain_hash — i.e. the predecessor's
 *     content changed (and its own chain_hash was recomputed to hide that)
 *     after this record was created. This is the case the single-record
 *     `GET /api/proof/:id/verify` endpoint cannot see, because it never
 *     fetches the predecessor.
 *   - MISSING_PREDECESSOR: the record claims a predecessor (non-empty
 *     prev_chain_hash) but no earlier record exists in this org's chain at
 *     all — the referenced row is gone (rows are never hard-deleted by any
 *     code path today; this shape would indicate a real integrity problem,
 *     e.g. rows removed outside the application).
 */
export type ChainWalkBreakReason =
  | 'SELF_HASH_MISMATCH'
  | 'PREV_HASH_MISMATCH'
  | 'MISSING_PREDECESSOR';

export interface ChainWalkBreak {
  proofId: string;
  chainSeq: number;
  reason: ChainWalkBreakReason;
  detail: string;
}

export interface ChainWalkResult {
  orgId: string;
  /** The record the walk started from (either the resolved head, or the
   *  caller-supplied `startProofId`). */
  startProofId: string;
  startChainHash: string | null;
  recordsChecked: number;
  /** True once the walk reached a record with no predecessor (a genuine
   *  chain genesis) without finding a break. */
  reachedGenesis: boolean;
  /** True if the walk stopped at `maxRecords` before reaching genesis or a
   *  break — the checked prefix was clean, but the full chain was not
   *  walked in this call. */
  truncated: boolean;
  intact: boolean;
  brokenAt: ChainWalkBreak | null;
  checkedAt: string;
}

// ---------------------------------------------------------------------------
// ProofService
// ---------------------------------------------------------------------------

@Injectable()
export class ProofService {
  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------------
  // createProof
  // -------------------------------------------------------------------------

  /**
   * Create a ProofRecord tied to an existing VerificationRun.
   *
   * The linked VerificationRun must belong to the same org and must have
   * reached a terminal status (PASSED, FAILED, or NEEDS_REVIEW) before a
   * proof can be issued — an in-flight run does not yet have a final decision.
   *
   * @param orgId             - Organisation that owns this proof.
   * @param verificationRunId - ID of the linked VerificationRun.
   * @param product           - Verification product this proof covers.
   * @param subject           - Subject category of the proof.
   * @param summary           - Human-readable summary of findings.
   * @param evidence          - Array of evidence artefacts (screenshots, audit logs, etc.).
   * @param finalDecision     - The final decision recorded in this proof.
   * @param planSlug          - Optional plan slug the proof was created under, used to
   *                            resolve the retention window. When omitted (e.g. anonymous
   *                            proofs) the free/anonymous VerifyAPI retention window applies.
   * @returns The newly created ProofRecord.
   * @throws NotFoundException   if the VerificationRun is not found or belongs to a different org.
   * @throws BadRequestException if the run is still in a non-terminal state.
   */
  async createProof(
    orgId: string,
    verificationRunId: string,
    product: VerificationProduct,
    subject: ProofSubject,
    summary: string,
    evidence: Prisma.InputJsonValue,
    finalDecision: ProofFinalDecision,
    planSlug?: string,
  ): Promise<ProofRecord> {
    // Scope check: fetch run with orgId to prevent cross-org access.
    const run = await this.prisma.verificationRun.findUnique({
      where: { id: verificationRunId, orgId },
    });

    if (!run) {
      throw new NotFoundException(`VerificationRun ${verificationRunId} not found`);
    }

    const terminalStatuses: string[] = ['PASSED', 'FAILED', 'NEEDS_REVIEW'];

    if (!terminalStatuses.includes(run.status)) {
      throw new BadRequestException(
        `Cannot create a proof for a VerificationRun in status ${run.status}. ` +
          `Run must be in one of: ${terminalStatuses.join(', ')}`,
      );
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Serialize per-org proof creation to prevent concurrent chain fork.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orgId}))`;

        // Fetch the latest chain_hash for this org to use as prev_chain_hash.
        // Ordered by chainSeq (a Postgres sequence allocated atomically at
        // INSERT time), not createdAt: createdAt is Postgres now(), frozen at
        // transaction BEGIN, so it is not a reliable tie-breaker for "who
        // wrote last" under concurrent createProof() calls for the same org
        // — see the chainSeq doc comment on the ProofRecord model.
        const lastProof = await tx.proofRecord.findFirst({
          where: { orgId },
          orderBy: { chainSeq: 'desc' },
          select: { chain_hash: true },
        });
        const prevChainHash = lastProof?.chain_hash ?? '';

        // Create the record first to obtain its cuid.
        const created = await tx.proofRecord.create({
          data: {
            orgId,
            verificationRunId,
            product,
            subject,
            summary,
            evidence: evidence as Prisma.InputJsonValue,
            finalDecision,
            proofStatus: ProofStatus.CREATED,
          },
        });

        // Chain hash formula lives in one place — see computeProofChainHash.
        const chainHash = computeProofChainHash({
          id: created.id,
          orgId,
          summary,
          evidence,
          prevChainHash,
        });

        // Resolve retention window at creation time (atomic with the chain hash write).
        const retentionPolicyDays = resolveRetentionPolicyDays(planSlug);
        const retentionExpiresAt =
          retentionPolicyDays === null
            ? null
            : new Date(created.createdAt.getTime() + retentionPolicyDays * MS_PER_DAY);

        let proofSignature: string | null = null;
        const privKeyB64 = process.env['PROOF_SIGNING_PRIVATE_KEY'];
        if (privKeyB64) {
          try {
            const privKey = createPrivateKey({
              key: Buffer.from(privKeyB64, 'base64'),
              format: 'der',
              type: 'pkcs8',
            });
            proofSignature = cryptoSign(null, Buffer.from(chainHash, 'hex'), privKey).toString(
              'base64',
            );
          } catch (e: unknown) {
            // key misconfigured — skip signature, don't break proof creation
            console.warn('[ProofService] Ed25519 signing skipped — key misconfigured:', String(e));
          }
        }

        return tx.proofRecord.update({
          where: { id: created.id },
          data: {
            chain_hash: chainHash,
            prev_chain_hash: prevChainHash || null,
            proof_signature: proofSignature,
            retentionPolicyDays,
            retentionExpiresAt,
            retentionStatus: RETENTION_STATUS_ACTIVE,
          },
        });
      });
    } catch (err: unknown) {
      // Rethrow already-translated HTTP exceptions as-is (e.g. from nested service calls).
      if (err instanceof HttpException) throw err;

      // Detect Prisma connection-pool exhaustion (P2024) and advisory-lock
      // wait timeouts. Under the transaction-mode pooler (connection_limit=5)
      // these surface as ~30% HTTP 500s under concurrency. Map them to 429 so
      // callers receive a retryable signal instead of a fatal error.
      const msg = err instanceof Error ? err.message : String(err);
      const code =
        err instanceof Error && 'code' in err ? ((err as { code?: string }).code ?? '') : '';
      const isPoolError =
        // Prisma transaction-contention family under the transaction-mode pooler
        // (low connection_limit): P2024 = "Timed out fetching a connection",
        // P2028 = "Unable to start a transaction in the given time" (maxWait),
        // P2034 = write-conflict/deadlock. All are retryable contention, not fatal.
        ['P2024', 'P2028', 'P2034'].includes(code) ||
        /timed out fetching a connection/i.test(msg) ||
        /connection pool/i.test(msg) ||
        /unable to start a transaction/i.test(msg) ||
        /transaction api error/i.test(msg) ||
        /transaction (?:already closed|not found)/i.test(msg) ||
        /deadlock detected/i.test(msg) ||
        /lock.*timeout|timeout.*lock/i.test(msg);

      if (isPoolError) {
        throw new HttpException(
          'Verification is busy, please retry.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // enforceRetentionSweep
  // -------------------------------------------------------------------------

  /**
   * Archive all ACTIVE proofs whose retention window has elapsed.
   *
   * Soft-delete only: rows are marked retentionStatus='ARCHIVED' with
   * archivedAt=now. Evidence/content is NOT hard-deleted here — archival is a
   * status transition that gates retrieval (see {@link isRetentionExpired}).
   *
   * Idempotent and batched: each pass updates up to `batchSize` rows and loops
   * until no ACTIVE-expired rows remain (or the safety cap is hit). Backed by
   * the `(retention_status, retention_expires_at)` index.
   *
   * @param batchSize - Max rows updated per iteration (default 500).
   * @returns Count of archived rows plus a summary for logging.
   */
  async enforceRetentionSweep(
    batchSize = 500,
  ): Promise<{ archived: number; batches: number; summary: string }> {
    const now = new Date();
    let archived = 0;
    let batches = 0;
    // Safety cap so a misconfiguration can't loop unbounded.
    const maxBatches = 10_000;

    // updateMany has no LIMIT, so we page by selecting a bounded set of ids
    // and updating exactly those. Loop until a pass finds nothing.
    for (;;) {
      if (batches >= maxBatches) {
        break;
      }

      const expired = await this.prisma.proofRecord.findMany({
        where: {
          retentionStatus: RETENTION_STATUS_ACTIVE,
          retentionExpiresAt: { lt: now },
        },
        select: { id: true },
        take: batchSize,
      });

      if (expired.length === 0) {
        break;
      }

      const result = await this.prisma.proofRecord.updateMany({
        where: { id: { in: expired.map((p) => p.id) } },
        data: {
          retentionStatus: RETENTION_STATUS_ARCHIVED,
          archivedAt: now,
        },
      });

      archived += result.count;
      batches += 1;

      // Last page — stop without an extra empty query.
      if (expired.length < batchSize) {
        break;
      }
    }

    const summary = `Retention sweep archived ${archived} expired proof(s) in ${batches} batch(es) (cutoff ${now.toISOString()})`;
    return { archived, batches, summary };
  }

  // -------------------------------------------------------------------------
  // getProof
  // -------------------------------------------------------------------------

  /**
   * Fetch a single ProofRecord by ID, scoped to the requesting org.
   *
   * @param orgId   - Must match the proof's orgId (no cross-org access).
   * @param proofId - Primary key of the proof.
   * @returns The ProofRecord.
   * @throws NotFoundException when the proof does not exist or belongs to a different org.
   */
  async getProof(orgId: string, proofId: string): Promise<ProofRecord> {
    // orgId is included in where — cross-org scope check is enforced here.
    const proof = await this.prisma.proofRecord.findUnique({
      where: { id: proofId, orgId },
    });

    if (!proof) {
      throw new NotFoundException(`ProofRecord ${proofId} not found`);
    }

    return proof;
  }

  // -------------------------------------------------------------------------
  // listProofs
  // -------------------------------------------------------------------------

  /**
   * Paginate ProofRecords for an org with optional filters.
   *
   * @param orgId         - Scope all results to this org.
   * @param product       - Optional product filter.
   * @param proofStatus   - Optional proof status filter.
   * @param finalDecision - Optional final decision filter.
   * @param limit         - Page size (default 20).
   * @param offset        - Page offset (default 0).
   * @returns `{ proofs, total }` — current page plus total count.
   */
  async listProofs(
    orgId: string,
    product?: VerificationProduct,
    proofStatus?: ProofStatus,
    finalDecision?: ProofFinalDecision,
    limit = 20,
    offset = 0,
  ): Promise<{
    proofs: Array<
      Prisma.ProofRecordGetPayload<{
        include: { verificationRun: { select: { riskLevel: true; issuesFound: true } } };
      }>
    >;
    total: number;
  }> {
    // orgId is always present in the where clause — no cross-org leakage.
    const where: Prisma.ProofRecordWhereInput = {
      orgId,
      ...(product ? { product } : {}),
      ...(proofStatus ? { proofStatus } : {}),
      ...(finalDecision ? { finalDecision } : {}),
    };

    const [proofs, total] = await this.prisma.$transaction([
      this.prisma.proofRecord.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
        include: {
          verificationRun: { select: { riskLevel: true, issuesFound: true } },
        },
      }),
      this.prisma.proofRecord.count({ where }),
    ]);

    return { proofs, total };
  }

  async listAnonymousProofSummaries(params: {
    product?: VerificationProduct;
    status?: ProofRunStatus;
    limit?: number;
    offset?: number;
  }): Promise<{ data: PublicProofSummary[]; total: number; limit: number; offset: number }> {
    const limit = Math.min(Math.max(params.limit ?? 20, 1), 50);
    const offset = Math.max(params.offset ?? 0, 0);
    const where: Prisma.ProofRecordWhereInput = {
      orgId: ANONYMOUS_ORG_ID,
      ...(params.product ? { product: params.product } : {}),
      ...(params.status ? { verificationRun: { status: params.status } } : {}),
    };

    const [proofs, total] = await this.prisma.$transaction([
      this.prisma.proofRecord.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
        select: {
          id: true,
          verificationRunId: true,
          product: true,
          subject: true,
          summary: true,
          finalDecision: true,
          proofStatus: true,
          chain_hash: true,
          createdAt: true,
          verificationRun: {
            select: {
              status: true,
              riskLevel: true,
              confidence: true,
              inputSummary: true,
              outputSummary: true,
              issuesFound: true,
            },
          },
        },
      }),
      this.prisma.proofRecord.count({ where }),
    ]);

    return {
      data: proofs.map((proof) => ({
        id: proof.id,
        proof_id: proof.id,
        verification_id: proof.verificationRunId,
        product: proof.product,
        subject: proof.subject,
        summary: proof.summary,
        final_decision: proof.finalDecision,
        proof_status: proof.proofStatus,
        chain_hash: proof.chain_hash ?? null,
        created_at: proof.createdAt,
        riskLevel: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(proof.verificationRun.riskLevel)
          ? (proof.verificationRun.riskLevel as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL')
          : 'LOW',
        issuesFound: Array.isArray(proof.verificationRun.issuesFound)
          ? proof.verificationRun.issuesFound.length
          : 0,
        verification: proof.verificationRun
          ? {
              verification_status: proof.verificationRun.status,
              risk_level: proof.verificationRun.riskLevel.toLowerCase(),
              confidence: proof.verificationRun.confidence ?? null,
              input_summary: proof.verificationRun.inputSummary,
              output_summary: proof.verificationRun.outputSummary ?? null,
            }
          : null,
      })),
      total,
      limit,
      offset,
    };
  }

  // -------------------------------------------------------------------------
  // updateProofStatus
  // -------------------------------------------------------------------------

  /**
   * Transition a ProofRecord to a new status, with optional field updates.
   *
   * Validates the transition before writing (CREATED → EXPORTED → ARCHIVED;
   * no backward moves).
   *
   * @param proofId    - Primary key of the proof.
   * @param orgId      - Scope check: must match the proof's orgId.
   * @param proofStatus - Target status.
   * @param updates    - Optional additional fields to write atomically.
   * @returns The updated ProofRecord.
   * @throws NotFoundException   when the proof does not exist or belongs to a different org.
   * @throws BadRequestException when the transition is not allowed.
   */
  async updateProofStatus(
    proofId: string,
    orgId: string,
    proofStatus: ProofStatus,
    updates?: {
      evidence?: Prisma.InputJsonValue;
      timeline?: Prisma.InputJsonValue;
      exportUrls?: Prisma.InputJsonValue;
    },
  ): Promise<ProofRecord> {
    // Scope check: orgId is in the where clause.
    const proof = await this.prisma.proofRecord.findUnique({
      where: { id: proofId, orgId },
    });

    if (!proof) {
      throw new NotFoundException(`ProofRecord ${proofId} not found`);
    }

    const allowed = ALLOWED_PROOF_TRANSITIONS[proof.proofStatus as ProofStatus] ?? [];
    if (!allowed.includes(proofStatus)) {
      throw new BadRequestException(
        `Cannot transition ProofRecord from ${proof.proofStatus} to ${proofStatus}`,
      );
    }

    return this.prisma.proofRecord.update({
      where: { id: proofId },
      data: {
        proofStatus,
        ...(updates?.evidence !== undefined
          ? { evidence: updates.evidence as Prisma.InputJsonValue }
          : {}),
        ...(updates?.timeline !== undefined
          ? { timeline: updates.timeline as Prisma.InputJsonValue }
          : {}),
        ...(updates?.exportUrls !== undefined
          ? { exportUrls: updates.exportUrls as Prisma.InputJsonValue }
          : {}),
      },
    });
  }

  // -------------------------------------------------------------------------
  // getProofWithVerificationRun
  // -------------------------------------------------------------------------

  /**
   * Fetch a ProofRecord and its linked VerificationRun in a single query.
   *
   * Avoids the N+1 pattern when report generation needs both models.
   * Both are scoped to `orgId`; the include ensures Prisma joins them in
   * one round-trip.
   *
   * @param orgId   - Must match the proof's orgId (no cross-org access).
   * @param proofId - Primary key of the proof.
   * @returns `{ proof, verification }` — both models fully populated.
   * @throws NotFoundException when the proof does not exist or belongs to a different org.
   */
  async getProofWithVerificationRun(
    orgId: string,
    proofId: string,
  ): Promise<{ proof: ProofRecord | null; verification: VerificationRun | null }> {
    // Single query: orgId scope check is on the ProofRecord side.
    // The VerificationRun is joined via Prisma include — no second DB round-trip.
    const proof = await this.prisma.proofRecord.findUnique({
      where: { id: proofId, orgId },
      include: { verificationRun: true },
    });

    if (!proof) {
      throw new NotFoundException(`ProofRecord ${proofId} not found`);
    }

    const { verificationRun, ...proofWithoutJoin } = proof;

    return { proof: proofWithoutJoin, verification: verificationRun };
  }

  /**
   * Fetch a ProofRecord by ID without org scoping, for public-facing lookups.
   *
   * Proof IDs are globally unique CUIDs — an authenticated user looking up a
   * proof_id they received from POST /api/verify should always find it
   * regardless of which orgId the proof was created under (e.g. 'anonymous'
   * for demo runs vs a real org for authenticated runs).
   */
  async getProofWithVerificationRunUnscoped(
    proofId: string,
  ): Promise<{ proof: ProofRecord | null; verification: VerificationRun | null }> {
    const proof = await this.prisma.proofRecord.findUnique({
      where: { id: proofId },
      include: { verificationRun: true },
    });

    if (!proof) {
      throw new NotFoundException(`ProofRecord ${proofId} not found`);
    }

    const { verificationRun, ...proofWithoutJoin } = proof;

    return { proof: proofWithoutJoin, verification: verificationRun };
  }

  // -------------------------------------------------------------------------
  // walkProofChain
  // -------------------------------------------------------------------------

  /**
   * Walk an org's proof chain backward from its head (or from a given
   * record) and independently re-verify every link, not just one record.
   *
   * `GET /api/proof/:id/verify` only proves a single record is internally
   * self-consistent (its own chain_hash recomputes from its own stored
   * fields). It never re-fetches the predecessor a record names via
   * prev_chain_hash and confirms that predecessor's CURRENT chain_hash still
   * matches — so an attacker who edits an old record's content and
   * recomputes that record's own chain_hash to match (making it look
   * internally fine on its own) is invisible to the single-record check,
   * because nothing else in the chain was re-examined. This method closes
   * that gap by checking, at every visited record:
   *
   *   (a) SELF-CONSISTENCY — its chain_hash recomputes from its own stored
   *       id/orgId/summary/evidence/prev_chain_hash (same check `/verify`
   *       does), and
   *   (b) LINKAGE — its prev_chain_hash equals the chain_hash CURRENTLY
   *       stored on the record immediately before it (fetched fresh in this
   *       call, not trusted from the newer record's own claim).
   *
   * Ordering uses `chainSeq`, not `createdAt` — see the doc comment on
   * ProofRecord.chainSeq for why createdAt is not a safe tie-breaker here.
   *
   * Residual limitation (inherent to any bare hash chain, not fixable by a
   * smarter walk without external anchoring, which is out of scope here): if
   * an attacker with DB write access tampers with a record AND correctly
   * re-derives every chain_hash/prev_chain_hash from that point forward to
   * the current head, the resulting chain is internally self-consistent
   * end-to-end and no walk can distinguish it from a genuine history. This
   * method proves "nothing was changed without also being force-fit back
   * into a valid-looking chain" — it does not, and cannot by itself, prove
   * "this history was never rewritten." That stronger guarantee needs an
   * externally published/anchored checkpoint of the head hash, which the
   * work item this method was built for explicitly scopes out.
   *
   * Cursor-paginated (default 500 rows/page) so a 100k-record org's chain is
   * never loaded into memory in one query; `maxRecords` bounds the total work
   * done in a single call (default 50,000) and reports `truncated: true`
   * rather than continuing unbounded.
   *
   * @param orgId              - Organisation whose chain to walk.
   * @param options.startProofId - Walk backward from this record instead of
   *                                the org's current head. Must belong to `orgId`.
   * @param options.pageSize    - Rows fetched per DB round-trip (1-1000, default 500).
   * @param options.maxRecords  - Max records examined before stopping with
   *                                `truncated: true` (1-500,000, default 50,000).
   * @throws NotFoundException if `startProofId` is given but not found in `orgId`.
   */
  async walkProofChain(
    orgId: string,
    options: { startProofId?: string; pageSize?: number; maxRecords?: number } = {},
  ): Promise<ChainWalkResult> {
    const pageSize = Math.min(Math.max(options.pageSize ?? 500, 1), 1000);
    const maxRecords = Math.min(Math.max(options.maxRecords ?? 50_000, 1), 500_000);
    const checkedAt = new Date().toISOString();

    const start = options.startProofId
      ? await this.prisma.proofRecord.findFirst({
          where: { id: options.startProofId, orgId },
          select: { id: true, chainSeq: true, chain_hash: true },
        })
      : await this.prisma.proofRecord.findFirst({
          where: { orgId },
          orderBy: { chainSeq: 'desc' },
          select: { id: true, chainSeq: true, chain_hash: true },
        });

    if (options.startProofId && !start) {
      throw new NotFoundException(`ProofRecord ${options.startProofId} not found`);
    }

    if (!start) {
      // No proofs at all for this org — an empty chain is trivially intact.
      return {
        orgId,
        startProofId: options.startProofId ?? '',
        startChainHash: null,
        recordsChecked: 0,
        reachedGenesis: true,
        truncated: false,
        intact: true,
        brokenAt: null,
        checkedAt,
      };
    }

    let cursorSeq: number | null = start.chainSeq;
    let recordsChecked = 0;
    let reachedGenesis = false;
    let truncated = false;
    let brokenAt: ChainWalkBreak | null = null;
    // The claim made by the most-recently-processed (i.e. next-newer) record
    // about what its predecessor's chain_hash should be — checked against
    // the predecessor's ACTUAL current chain_hash the moment we reach it.
    let pendingClaim: { prevHash: string; fromId: string; fromSeq: number } | null = null;

    walk: while (cursorSeq !== null) {
      if (recordsChecked >= maxRecords) {
        truncated = true;
        break;
      }

      const take = Math.min(pageSize, maxRecords - recordsChecked);
      const batch = await this.prisma.proofRecord.findMany({
        where: { orgId, chainSeq: { lte: cursorSeq } },
        orderBy: { chainSeq: 'desc' },
        take,
        select: {
          id: true,
          orgId: true,
          summary: true,
          evidence: true,
          chain_hash: true,
          prev_chain_hash: true,
          chainSeq: true,
        },
      });

      if (batch.length === 0) {
        // Ran off the bottom of this org's data. If a newer record still
        // claimed a predecessor, that predecessor does not exist.
        if (pendingClaim) {
          brokenAt = {
            proofId: pendingClaim.fromId,
            chainSeq: pendingClaim.fromSeq,
            reason: 'MISSING_PREDECESSOR',
            detail:
              `Record ${pendingClaim.fromId} references a predecessor via prev_chain_hash, ` +
              `but no earlier record exists in org ${orgId}'s chain.`,
          };
        } else {
          reachedGenesis = true;
        }
        break;
      }

      for (const record of batch) {
        recordsChecked += 1;

        // (a) Self-consistency: this record's own chain_hash must recompute
        // from its own stored fields.
        const recomputedSelf = computeProofChainHash({
          id: record.id,
          orgId: record.orgId,
          summary: record.summary,
          evidence: record.evidence,
          prevChainHash: record.prev_chain_hash,
        });
        if (!record.chain_hash || record.chain_hash !== recomputedSelf) {
          brokenAt = {
            proofId: record.id,
            chainSeq: record.chainSeq,
            reason: 'SELF_HASH_MISMATCH',
            detail:
              `Recomputing chain_hash from record ${record.id}'s own stored ` +
              `id/orgId/summary/evidence/prev_chain_hash does not match its stored ` +
              `chain_hash — its content or its chain_hash field was altered after creation.`,
          };
          break walk;
        }

        // (b) Linkage: if a newer record claimed this record as its
        // predecessor, that claim must equal THIS record's actual, just-
        // verified chain_hash — not merely what the newer record says.
        if (pendingClaim && pendingClaim.prevHash !== record.chain_hash) {
          brokenAt = {
            proofId: pendingClaim.fromId,
            chainSeq: pendingClaim.fromSeq,
            reason: 'PREV_HASH_MISMATCH',
            detail:
              `Record ${pendingClaim.fromId}'s prev_chain_hash does not match the ` +
              `current chain_hash of its predecessor ${record.id}. Either ${record.id}'s ` +
              `content changed after ${pendingClaim.fromId} was created, or ` +
              `${pendingClaim.fromId}'s prev_chain_hash was tampered with.`,
          };
          break walk;
        }

        if (!record.prev_chain_hash) {
          // Genuine chain genesis — nothing earlier to check against.
          reachedGenesis = true;
          pendingClaim = null;
          break walk;
        }

        pendingClaim = { prevHash: record.prev_chain_hash, fromId: record.id, fromSeq: record.chainSeq };

        if (recordsChecked >= maxRecords) {
          truncated = true;
          break walk;
        }
      }

      const last = batch[batch.length - 1];
      if (batch.length < take) {
        // Fewer rows than requested — this was the last page of data for the org.
        if (pendingClaim) {
          brokenAt = {
            proofId: pendingClaim.fromId,
            chainSeq: pendingClaim.fromSeq,
            reason: 'MISSING_PREDECESSOR',
            detail:
              `Record ${pendingClaim.fromId} references a predecessor via prev_chain_hash, ` +
              `but no earlier record exists in org ${orgId}'s chain.`,
          };
        } else {
          reachedGenesis = true;
        }
        break;
      }
      cursorSeq = last.chainSeq - 1;
    }

    return {
      orgId,
      startProofId: start.id,
      startChainHash: start.chain_hash ?? null,
      recordsChecked,
      reachedGenesis,
      truncated,
      intact: brokenAt === null,
      brokenAt,
      checkedAt,
    };
  }
}
