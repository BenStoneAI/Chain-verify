import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  InvoiceScanRiskLevel,
  OrgDataSource,
  OrgPoStatus,
  OrgVendorStatus,
  ProofEntitlementStatus,
  ProofFinalDecision,
  ProofProductType,
  ProofRiskLevel,
  ProofRunStatus,
  ProofSourceType,
  ProofSubject,
  ProofProduct as VerificationProofProduct,
  ScanApprovalStatus,
  type Prisma,
} from '@prisma/client';
import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'crypto';

import { PrismaService } from '../database/prisma.service.js';
import { BROWSER_INTAKE, OUTBOUND_EMAIL, type BrowserIntakePort, type OutboundEmailPort } from '../adapters/ports.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { ProofService } from '../verification/proof.service.js';
import { VerificationService } from '../verification/verification.service.js';
import {
  hashFingerprint,
  parseInvoiceScanBody,
  runInvoiceScan,
  type InvoiceScanRequestBody,
} from './invoice-proof-scan.runner.js';
import { InvoiceProofErpService } from './invoice-proof-erp.service.js';
import { InvoiceProofIntelligenceService } from './invoice-proof-intelligence.service.js';
import { InvoicePdfService } from './invoice-pdf.service.js';
import { extractInvoiceFieldsFromText, type ExtractedInvoiceFields } from '@swarmsync/proof-core/invoice-pdf-extract.js';
import { assertSsrfSafeWithDns } from '../../common/utils/ssrf-guard.js';

import {
  combineUrlHtmlText,
  extractTextFromAriaSnapshot,
  isPdfContentType,
} from './invoice-url-intake.js';

const FREE_SCAN_PRODUCT = 'invoice-proof';
const UPGRADE_URL = process.env.INVOICEPROOF_UPGRADE_URL ?? 'https://swarmsync.ai/invoice-proof#pricing';
const REGISTER_URL =
  process.env.SWARMSYNC_REGISTER_URL ?? 'https://swarmsync.ai/register?callbackUrl=/invoice-proof';

// Sentinel org used for un-authenticated scans, matching the convention
// already used by VerifyAPI's anonymous/demo runs (see ANONYMOUS_ORG_ID in
// verify-api.controller.ts / proof.service.ts / verification.controller.ts) —
// VerificationRun.orgId and ProofRecord.orgId are non-nullable, so an
// anonymous scan still needs a stable org bucket to chain-hash into.
const ANONYMOUS_ORG_ID = 'anonymous';

/**
 * Minimum PDF-extraction confidence (0-1, from `extractInvoiceFieldsFromText`)
 * required to persist a PDF-derived invoice into the per-org scan history
 * (OrgInvoiceHistory). That history feeds cross-submission vendor-based
 * duplicate detection and BEC (bank-change) detection on every future scan for
 * the org, so a row only belongs there if the vendor identity is trustworthy.
 *
 * `extractInvoiceFieldsFromText` only ever produces an 'OK' result at exactly
 * one of two confidences (see packages/proof-core/src/invoice-pdf-extract.ts):
 *   - 0.9  — vendor came from an explicit "Vendor:"/"Supplier:"/"Bill from:" label.
 *   - 0.78 — vendor was INFERRED from the document letterhead (no explicit label).
 * Letterhead inference is the lower-trust case: it can grab a bill-to name, a
 * remit-to entity, or unrelated header text instead of the true vendor. Setting
 * the threshold to 0.85 (between the two) means only explicitly-labelled-vendor
 * extractions (0.9) persist to history; inferred-vendor extractions (0.78) are
 * still fully scanned and returned to the caller, but are NOT written to
 * history. This is the conservative choice for a fraud tool: better to skip
 * accumulating duplicate-history for a letterhead-only invoice than to seed it
 * with a mis-attributed vendor and produce a false-positive duplicate finding
 * on a later, correctly extracted scan of the same invoice.
 */
const PDF_HISTORY_CONFIDENCE_THRESHOLD = 0.85;

export type ScanGateResult =
  | { allowed: true; recordFreeScan: boolean; organizationId?: string }
  | { allowed: false; status: 402 | 403; message: string; upgradeUrl: string };

@Injectable()
export class InvoiceProofService {
  private readonly logger = new Logger(InvoiceProofService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly erp: InvoiceProofErpService,
    private readonly intelligence: InvoiceProofIntelligenceService,
    @Inject(OUTBOUND_EMAIL) private readonly email: OutboundEmailPort,
    private readonly pdf: InvoicePdfService,
    // Optional (trailing, backward-compatible with existing direct-instantiation
    // tests that construct this service with 5 args): VerificationService +
    // ProofService give createScanProofRecord() access to the same chain-hashed
    // ProofRecord infrastructure VerifyAPI uses. createScanProofRecord() is
    // fail-soft (wrapped in try/catch — see its doc comment), so a test that
    // omits these entirely still behaves correctly: the call throws on
    // `undefined`, is caught, logged, and returns `proofUnavailable: true`
    // rather than crashing the scan.
    private readonly verification?: VerificationService,
    private readonly proof?: ProofService,
    // Optional (trailing, same backward-compatibility rationale): the real
    // Conduit browser engine (Patchright/Playwright), reused as-is for URL
    // intake (Work Item 2) — see scanUrl() below. Not ConduitSessionService:
    // that layer is the agent-to-agent marketplace billing/escrow wrapper
    // (requires a real Agent row, AP2 hiring/executing-agent semantics) and
    // does not fit a direct product feature unrelated to agent hiring — see
    // scanUrl()'s doc comment.
    @Inject(BROWSER_INTAKE) private readonly browserIntake?: BrowserIntakePort,
  ) {}

  async resolveOrgId(user: AuthenticatedUser | null): Promise<string | undefined> {
    if (!user) return undefined;
    // Fallback to user.id (always a non-empty string) when the user has no org so
    // org-scoped reads return an empty set rather than dropping the WHERE filter.
    // Controllers must use requireOrgId so an unresolved org fails closed.
    return (await this.resolveEntitledOrgId(user)) ?? user.id;
  }

  /**
   * Controller-facing org resolver. Identical to resolveOrgId on the happy path,
   * but never returns undefined — it throws so an unresolved org can never reach a
   * Prisma `where` clause as `undefined` (which would drop the filter and read
   * across organizations). Closes the latent cross-org footgun at the 16 call sites
   * that previously used the no-op `resolveOrgId(user)!` non-null assertion.
   */
  async requireOrgId(user: AuthenticatedUser | null): Promise<string> {
    const orgId = await this.resolveOrgId(user);
    if (!orgId) {
      throw new BadRequestException('No organization context for this request.');
    }
    return orgId;
  }

  /**
   * Resolve the effective organization ID for an authenticated user when the
   * JWT does not carry organizationId (which is the normal case — the JWT
   * strategy omits it). Mirrors the pattern in VerifyApiController.resolveOrgForUser.
   *
   * Priority:
   *  1. Explicit user.organizationId (future-proof; currently always undefined).
   *  2. Earliest membership org that holds an ACTIVE INVOICE_PROOF entitlement.
   *  3. Earliest membership org (fall-through — no entitlement, but org exists).
   *  4. undefined — no memberships found; caller falls through to free-scan gate.
   *
   * Returns undefined (not user.id) when there are no memberships so the caller
   * knows there is genuinely no org and can apply free-scan logic unchanged.
   */
  private async resolveEntitledOrgId(user: AuthenticatedUser): Promise<string | undefined> {
    const explicitOrg = (user as AuthenticatedUser & { organizationId?: string }).organizationId;
    return explicitOrg || undefined;
  }

  clientIpHash(ip: string): string {
    return hashFingerprint(`ip:${ip}`);
  }

  async checkScanGate(
    user: AuthenticatedUser | null,
    ip: string,
    email?: string,
  ): Promise<ScanGateResult> {
    const ipHash = this.clientIpHash(ip);

    if (user) {
      // Resolve the effective org, following membership even when the JWT omits
      // organizationId (which is always the case with the current JWT strategy).
      const resolvedOrgId = await this.resolveEntitledOrgId(user);

      if (resolvedOrgId) {
        const entitlement = await this.prisma.proofProductEntitlement.findFirst({
          where: {
            organizationId: resolvedOrgId,
            product: ProofProductType.INVOICE_PROOF,
            status: ProofEntitlementStatus.ACTIVE,
          },
        });
        if (entitlement) {
          return { allowed: true, recordFreeScan: false, organizationId: resolvedOrgId };
        }
      }

      // No active INVOICE_PROOF entitlement — apply the free-scan gate.
      const used = await this.prisma.proofFreeScan.findFirst({
        where: { userId: user.id, product: FREE_SCAN_PRODUCT },
      });
      if (used) {
        return {
          allowed: false,
          status: 402,
          message: 'Free InvoiceProof scan already used. Upgrade to continue scanning.',
          upgradeUrl: UPGRADE_URL,
        };
      }
      return {
        allowed: true,
        recordFreeScan: true,
        organizationId: resolvedOrgId,
      };
    }

    const usedByIp = await this.prisma.proofFreeScan.findFirst({
      where: { ipHash, product: FREE_SCAN_PRODUCT },
    });
    if (usedByIp) {
      return {
        allowed: false,
        status: 403,
        message: 'Free scan already used from this network. Register to continue.',
        upgradeUrl: REGISTER_URL,
      };
    }

    if (email) {
      const emailHash = hashFingerprint(`email:${email.toLowerCase().trim()}`);
      const usedByEmail = await this.prisma.proofFreeScan.findFirst({
        where: { emailHash, product: FREE_SCAN_PRODUCT },
      });
      if (usedByEmail) {
        return {
          allowed: false,
          status: 403,
          message: 'Free scan already used for this email. Register to continue.',
          upgradeUrl: REGISTER_URL,
        };
      }
    }

    return { allowed: true, recordFreeScan: true };
  }

  async recordFreeScan(user: AuthenticatedUser | null, ip: string, email?: string): Promise<void> {
    const ipHash = this.clientIpHash(ip);
    await this.prisma.proofFreeScan.create({
      data: {
        userId: user?.id,
        ipHash,
        emailHash: email ? hashFingerprint(`email:${email.toLowerCase().trim()}`) : undefined,
        product: FREE_SCAN_PRODUCT,
      },
    });
  }

  async loadOrgContext(organizationId: string) {
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const [vendorMasterRows, poRows, historyRows] = await Promise.all([
      this.prisma.orgVendorMaster.findMany({ where: { organizationId, status: OrgVendorStatus.ACTIVE } }),
      this.prisma.orgPoRegister.findMany({
        where: { organizationId, status: OrgPoStatus.OPEN },
      }),
      this.prisma.orgInvoiceHistory.findMany({
        where: {
          organizationId,
          OR: [{ paidAt: { gte: ninetyDaysAgo } }, { paidAt: null }],
        },
        orderBy: { paidAt: 'desc' },
        take: 500,
      }),
    ]);

    const vendorMaster = vendorMasterRows.map((v) => ({
      vendorName: v.vendorName,
      city: v.city ?? undefined,
      state: v.state ?? undefined,
      expectedEmailDomain: v.expectedEmailDomain ?? undefined,
      bankRoutingNumber: v.bankRoutingNumber ?? undefined,
      bankAccountLast4: v.bankAccountLast4 ?? undefined,
      remitAddress: v.remitAddress ?? undefined,
      status: v.status,
      bankDetailChangedAt: v.bankDetailChangedAt,
    }));

    const poRegister = poRows.map((p) => ({
      poNumber: p.poNumber,
      vendorName: p.vendorName,
      authorizedAmount: p.authorizedAmount,
    }));

    const paymentHistory = historyRows.map((h) => ({
      invoiceNo: h.invoiceNo,
      vendor: h.vendor,
      amount: h.amount,
      po: h.poNumber ?? '',
      submittedAt: h.paidAt ?? h.createdAt,
    }));

    return { vendorMaster, poRegister, paymentHistory };
  }

  computeRiskLevel(findings: Array<{ severity: string }>): InvoiceScanRiskLevel {
    if (findings.some((f) => f.severity === 'critical')) return InvoiceScanRiskLevel.CRITICAL;
    if (findings.some((f) => f.severity === 'high')) return InvoiceScanRiskLevel.HIGH;
    if (findings.some((f) => f.severity === 'medium')) return InvoiceScanRiskLevel.MEDIUM;
    return InvoiceScanRiskLevel.LOW;
  }

  /**
   * Map an InvoiceProof risk level onto the shared VerificationRun/ProofRecord
   * vocabulary. ProofRiskLevel has no CRITICAL tier (UNKNOWN/LOW/MEDIUM/HIGH
   * only) so CRITICAL folds into HIGH there — the original CRITICAL severity
   * is preserved unchanged in the proof's evidence payload, this only affects
   * the coarser run-level classification.
   */
  private mapRiskToProofDecision(riskLevel: InvoiceScanRiskLevel): {
    runStatus: ProofRunStatus;
    proofRiskLevel: ProofRiskLevel;
    finalDecision: ProofFinalDecision;
  } {
    switch (riskLevel) {
      case InvoiceScanRiskLevel.CRITICAL:
      case InvoiceScanRiskLevel.HIGH:
        return {
          runStatus: ProofRunStatus.FAILED,
          proofRiskLevel: ProofRiskLevel.HIGH,
          finalDecision: ProofFinalDecision.REJECTED,
        };
      case InvoiceScanRiskLevel.MEDIUM:
        return {
          runStatus: ProofRunStatus.NEEDS_REVIEW,
          proofRiskLevel: ProofRiskLevel.MEDIUM,
          finalDecision: ProofFinalDecision.ESCALATED,
        };
      default:
        return {
          runStatus: ProofRunStatus.PASSED,
          proofRiskLevel: ProofRiskLevel.LOW,
          finalDecision: ProofFinalDecision.APPROVED,
        };
    }
  }

  /**
   * Mint a chain-hashed ProofRecord (via the same VerificationRun → ProofService
   * pipeline VerifyAPI uses) for one InvoiceProof scan result, so the result can
   * be independently re-verified later through GET /api/proof/:id/export/*
   * exactly like a VerifyAPI proof — closing the gap where InvoiceProof scans
   * only ever produced a plain OrgInvoiceScanRun row with no tamper-evident
   * artifact.
   *
   * Fail-soft by design: a transient error here must not take down the scan
   * itself (the fraud-detection result is the product's core value and has
   * already been computed by the time this runs). Never silent, though — every
   * failure is logged loudly and the caller gets an honest `proofUnavailable:
   * true` in the response instead of either a fabricated proof id or a 500.
   */
  private async createScanProofRecord(params: {
    orgId?: string;
    scanId: string;
    riskLevel: InvoiceScanRiskLevel;
    findings: Array<{ severity: string; pattern?: string; detail?: string }>;
    findingCount: number;
    criticalCount: number;
    rowCount: number;
    coverageSummary: unknown;
  }): Promise<{ proofId: string; chainHash: string | null } | null> {
    const proofOrgId = params.orgId ?? ANONYMOUS_ORG_ID;
    try {
      const run = await this.verification.queueVerification(
        proofOrgId,
        VerificationProofProduct.INVOICE_AUDIT,
        ProofSourceType.API_PUSH,
        `InvoiceProof scan of ${params.rowCount} invoice(s) (scan ${params.scanId})`,
      );

      await this.verification.updateVerificationStatus(
        run.id,
        proofOrgId,
        ProofRunStatus.PROCESSING,
      );

      const decision = this.mapRiskToProofDecision(params.riskLevel);
      const outputSummary =
        params.findingCount === 0
          ? 'No fraud indicators found'
          : `${params.findingCount} finding(s), ${params.criticalCount} critical`;

      const completedRun = await this.verification.updateVerificationStatus(
        run.id,
        proofOrgId,
        decision.runStatus,
        {
          riskLevel: decision.proofRiskLevel,
          outputSummary,
          issuesFound: params.findings as unknown as Prisma.InputJsonValue,
          checksPerformed: ['invoice_fraud_scan'] as unknown as Prisma.InputJsonValue,
        },
      );

      const proofRecord = await this.proof.createProof(
        proofOrgId,
        run.id,
        VerificationProofProduct.INVOICE_AUDIT,
        ProofSubject.INVOICE,
        completedRun.outputSummary ?? outputSummary,
        [
          {
            source: 'invoice_proof_scan',
            scan_id: params.scanId,
            invoice_count: params.rowCount,
            finding_count: params.findingCount,
            critical_count: params.criticalCount,
            risk_level: params.riskLevel,
            findings: params.findings,
            coverage_summary: params.coverageSummary,
            checked_at: new Date().toISOString(),
          },
        ] as unknown as Prisma.InputJsonValue,
        decision.finalDecision,
      );

      return { proofId: proofRecord.id, chainHash: proofRecord.chain_hash };
    } catch (err) {
      this.logger.error(
        `InvoiceProof scan ${params.scanId}: failed to create chain-hashed ProofRecord — ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  async scan(
    body: InvoiceScanRequestBody,
    user: AuthenticatedUser | null,
    ip: string,
    email?: string,
    options?: {
      organizationId?: string;
      skipFreeScanGate?: boolean;
      /**
       * When true, skip the OrgInvoiceHistory persist step even though an org
       * context is present. Set only by low-confidence PDF-derived callers
       * (see PDF_HISTORY_CONFIDENCE_THRESHOLD) — never by the structured-JSON
       * scan path, which has no extraction confidence to gate on.
       */
      skipHistoryWrite?: boolean;
      /** Human-readable reason surfaced back to the caller when skipHistoryWrite is set. */
      historySkippedReason?: string;
    },
  ) {
    let gate: ScanGateResult;
    if (options?.skipFreeScanGate && options.organizationId) {
      gate = { allowed: true, recordFreeScan: false, organizationId: options.organizationId };
    } else {
      gate = await this.checkScanGate(user, ip, email);
    }
    if (gate.allowed === false) {
      if (gate.status === 402) {
        throw new HttpException(
          {
            message: gate.message,
            upgradeUrl: gate.upgradeUrl,
          },
          HttpStatus.PAYMENT_REQUIRED,
        );
      }
      throw new ForbiddenException({ message: gate.message, upgradeUrl: gate.upgradeUrl });
    }

    let parsed;
    try {
      parsed = parseInvoiceScanBody(body);
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : 'Invalid scan input');
    }

    const orgId = gate.organizationId;
    if (orgId && (!body.vendorMaster || (Array.isArray(body.vendorMaster) && body.vendorMaster.length === 0))) {
      const orgCtx = await this.loadOrgContext(orgId);
      parsed.vendorMaster = orgCtx.vendorMaster;
      parsed.vendorMasterExtended = orgCtx.vendorMaster.map((v) => ({ ...v, status: v.status }));
      if (!body.poRegister || (Array.isArray(body.poRegister) && body.poRegister.length === 0)) {
        parsed.poRegister = orgCtx.poRegister;
      }
      if (
        !body.paymentHistory ||
        (Array.isArray(body.paymentHistory) && body.paymentHistory.length === 0)
      ) {
        parsed.seededHistory = orgCtx.paymentHistory;
      }
    }

    const sessionHistory: typeof parsed.seededHistory = [];
    let result = runInvoiceScan(parsed, sessionHistory);

    const extraFindings = await this.intelligence.enrichFindings(
      orgId,
      parsed.rows,
      result.findings,
    );
    result = { ...result, findings: extraFindings, findingCount: extraFindings.length };

    const criticalCount = result.findings.filter((f) => f.severity === 'critical').length;
    const riskLevel = this.computeRiskLevel(result.findings);

    const scanRun = await this.prisma.orgInvoiceScanRun.create({
      data: {
        organizationId: orgId,
        userId: user?.id,
        ipHash: this.clientIpHash(ip),
        invoiceCount: result.rowCount,
        findingCount: result.findingCount,
        criticalCount,
        riskLevel,
        findings: result.findings as unknown as Prisma.InputJsonValue,
        coverageSummary: result.coverage_summary as unknown as Prisma.InputJsonValue,
      },
    });

    if (orgId) {
      if (options?.skipHistoryWrite) {
        this.logger.log(
          `InvoiceProof scan ${scanRun.id}: history write skipped (${options.historySkippedReason ?? 'low confidence'})`,
        );
      } else {
        await this.prisma.orgInvoiceHistory.createMany({
          data: parsed.rows.map((r) => ({
            organizationId: orgId,
            invoiceNo: r.invoiceNo,
            vendor: r.vendor,
            amount: r.amount,
            poNumber: r.po || undefined,
            paidAt: new Date(),
            source: OrgDataSource.MANUAL,
          })),
          skipDuplicates: true,
        });
      }

      await this.createApprovalRecords(orgId, scanRun.id, result.findings, parsed.rows);

      await this.markVendorsForBankReview(orgId, result.findings, parsed.rows);

      await this.intelligence.reportConsortiumSignals(result.findings, orgId);

      await this.sendReviewAlertIfNeeded(orgId, scanRun.id, riskLevel, result.findings);
    }

    if (gate.recordFreeScan) {
      await this.recordFreeScan(user, ip, email);
    }

    const proofResult = await this.createScanProofRecord({
      orgId,
      scanId: scanRun.id,
      riskLevel,
      findings: result.findings,
      findingCount: result.findingCount,
      criticalCount,
      rowCount: result.rowCount,
      coverageSummary: result.coverage_summary,
    });

    if (proofResult) {
      // Best-effort link-back; the proof already exists and is independently
      // fetchable via its own id even if this update fails.
      await this.prisma.orgInvoiceScanRun
        .update({ where: { id: scanRun.id }, data: { proofRecordId: proofResult.proofId } })
        .catch((err: unknown) =>
          this.logger.warn(
            `Failed to link proof ${proofResult.proofId} to scan ${scanRun.id}: ${String(err)}`,
          ),
        );
    }

    const historySkipped = Boolean(orgId) && Boolean(options?.skipHistoryWrite);

    return {
      ...result,
      scanId: scanRun.id,
      riskLevel,
      freeScanConsumed: gate.recordFreeScan,
      retained: Boolean(orgId) && !historySkipped,
      proofId: proofResult?.proofId ?? null,
      chainHash: proofResult?.chainHash ?? null,
      ...(proofResult ? {} : { proofUnavailable: true }),
      ...(historySkipped
        ? {
            historySkipped: true,
            historySkippedReason:
              options?.historySkippedReason ??
              'Extraction confidence too low — this scan was not recorded to org history.',
          }
        : {}),
    };
  }

  /**
   * PDF intake path: extract a single invoice PDF → structured fields → existing
   * scan engine. Only digital/text PDFs are supported (no OCR). The fraud rules are
   * NOT forked — an OK extraction is fed straight into scan(), so duplicate /
   * bank-change / missing-PO / overage / math / round-dollar checks all fire
   * identically to the structured-JSON path.
   *
   * Honesty contract: a low-confidence parse (NEEDS_REVIEW) or an unreadable file
   * (TEXT_EXTRACTION_FAILED / encrypted / corrupt / image-only) returns the status
   * for the caller to confirm or correct — it never fabricates a scan, and it does
   * NOT consume a free scan.
   *
   * History-write gate: even an 'OK' extraction is only persisted into the per-org
   * scan history (OrgInvoiceHistory) when its confidence meets
   * PDF_HISTORY_CONFIDENCE_THRESHOLD (0.85 — see the constant's doc comment).
   * `extractInvoiceFieldsFromText` only ever returns 'OK' at 0.9 (explicitly
   * labelled vendor) or 0.78 (vendor inferred from letterhead), so in practice
   * this means: letterhead-only invoices with no explicit "Vendor:" label never
   * persist to history, by design — the scan result is always returned to the
   * caller either way, only the history write is skipped, so a mis-attributed
   * letterhead vendor never seeds a false-positive duplicate finding on a
   * later, correctly extracted scan of the same invoice.
   */
  async scanPdf(
    buffer: Buffer,
    user: AuthenticatedUser | null,
    ip: string,
    email?: string,
  ) {
    const outcome = await this.pdf.extract(buffer);
    return this.handlePdfExtractOutcome(outcome, user, ip, email);
  }

  /**
   * Shared branching logic for "a PDF was decoded, now decide what to do with
   * it" — used by scanPdf() (direct upload) AND scanUrl()'s URL→PDF branch
   * (Work Item 2), so a URL that resolves directly to a PDF is routed through
   * this EXACT same pipeline, not a second/duplicated one. See the doc
   * comment on scanPdf() above for the full honesty-contract/history-write
   * reasoning this preserves unchanged.
   */
  private async handlePdfExtractOutcome(
    outcome: Awaited<ReturnType<InvoicePdfService['extract']>>,
    user: AuthenticatedUser | null,
    ip: string,
    email?: string,
  ) {
    if (outcome.ok === false) {
      return {
        status: outcome.reason,
        ok: false,
        message: outcome.message,
        pageCount: outcome.pageCount ?? null,
        extraction: null,
        scan: null,
      };
    }

    const { extraction } = outcome;

    if (extraction.status === 'TEXT_EXTRACTION_FAILED') {
      return {
        status: 'TEXT_EXTRACTION_FAILED',
        ok: false,
        message:
          extraction.warnings[0] ??
          'No machine-readable text found in this PDF (likely scanned/image-only) and OCR could not read it either.',
        extraction,
        scan: null,
      };
    }

    if (extraction.status === 'NEEDS_REVIEW') {
      const isOcr = extraction.extraction_method === 'ocr';

      // Digital-text NEEDS_REVIEW: unchanged v1 behavior — never scans, never
      // consumes a free scan / quota unit. The extracted fields are too sparse
      // to be worth running the fraud engine against.
      if (!isOcr) {
        return {
          status: 'NEEDS_REVIEW',
          ok: true,
          message:
            'Some fields could not be extracted with confidence. Review and correct them, then submit for scanning.',
          extraction,
          scan: null,
        };
      }

      // OCR NEEDS_REVIEW: the "needs review" status is a signal that a human
      // should double-check the EXTRACTED FIELDS before trusting them — it is
      // NOT a reason to withhold the fraud engine's own findings from that
      // human. When there is at least one fraud-relevant field to evaluate
      // (amount / bank routing / account), still run the scan so
      // BANK_ACCOUNT_CHANGE_DETECTED / LINE_ITEM_MATH_ERROR / etc. get a real
      // chance to fire on OCR-sourced data. The extraction status itself is
      // NEVER silently promoted past NEEDS_REVIEW by doing this. History
      // write is still skipped (same reasoning as the low-confidence-OK gate
      // just below) so a possible OCR misread never seeds the org's
      // duplicate-detection baseline.
      const hasFraudRelevantField =
        extraction.fields.amount !== undefined ||
        Boolean(extraction.fields.bankRouting) ||
        Boolean(extraction.fields.bankAccountLast4);

      if (!hasFraudRelevantField) {
        return {
          status: 'NEEDS_REVIEW',
          ok: true,
          message:
            'Some fields could not be extracted with confidence from this scanned document. Review and correct them, then submit for scanning.',
          extraction,
          scan: null,
        };
      }

      const ocrScan = await this.scan(
        { invoices: [this.pdfFieldsToInvoice(extraction.fields)] },
        user,
        ip,
        email,
        {
          skipHistoryWrite: true,
          historySkippedReason: `OCR-derived extraction (NEEDS_REVIEW, confidence ${extraction.confidence.toFixed(2)}) — scan was not recorded to org history.`,
        },
      );

      return {
        status: 'NEEDS_REVIEW',
        ok: true,
        message:
          'This is a scanned/photographed document read via OCR — findings below are provisional. ' +
          'Verify vendor, amount, and bank/routing details against the original document before acting on any finding.',
        extraction,
        scan: ocrScan,
      };
    }

    // OK — feed the extracted invoice into the live scan engine. History is only
    // persisted when confidence clears PDF_HISTORY_CONFIDENCE_THRESHOLD; the scan
    // itself always runs and is always returned to the caller.
    const belowHistoryThreshold = extraction.confidence < PDF_HISTORY_CONFIDENCE_THRESHOLD;
    const scan = await this.scan(
      { invoices: [this.pdfFieldsToInvoice(extraction.fields)] },
      user,
      ip,
      email,
      belowHistoryThreshold
        ? {
            skipHistoryWrite: true,
            historySkippedReason: `PDF extraction confidence ${extraction.confidence.toFixed(2)} is below the ${PDF_HISTORY_CONFIDENCE_THRESHOLD} history threshold — scan was not recorded to org history.`,
          }
        : undefined,
    );

    return { status: 'SCANNED', ok: true, extraction, scan };
  }

  /**
   * URL intake path (Work Item 2): accept a URL, use Conduit's real browser
   * engine to load it, then either (a) route a directly-fetched PDF through
   * the EXACT SAME pipeline scanPdf() uses (handlePdfExtractOutcome, above —
   * no duplicated logic), or (b) extract structured content from a rendered
   * HTML page via Conduit's EXTRACT_MAIN + ACCESSIBILITY_SNAPSHOT actions and
   * feed it through the SAME field parser every other intake path uses
   * (extractInvoiceFieldsFromText) — never a second/parallel HTML parser.
   *
   * SSRF: mandatory, checked BEFORE Conduit ever navigates. assertSsrfSafeWithDns
   * resolves the hostname and rejects private/loopback/link-local/CGNAT/cloud-
   * metadata targets and non-http(s) schemes (see apps/api/src/common/utils/ssrf-guard.ts,
   * the platform's one shared SSRF guard — not duplicated here). Redirect hops
   * Conduit's own NAVIGATE then follows are separately guarded inside
   * ConduitBrowserService.initSession's page.route() handler (added for this
   * work item, and applies to every Conduit session platform-wide, not just
   * this path) — see that file's doc comment for what it does and does not
   * close (a true DNS-rebinding redirect is a documented residual gap).
   *
   * Conduit engine choice: this calls ConduitBrowserService directly — the
   * actual Patchright/Playwright automation engine, real NAVIGATE/EXTRACT_MAIN/
   * ACCESSIBILITY_SNAPSHOT actions, real VOIX detection, real selector healing
   * — NOT ConduitSessionService. That service is the agent-to-agent
   * MARKETPLACE wrapper around the same engine: it requires a real Agent row
   * (FK, `agentId`), models an AP2 escrow relationship between a hiring and
   * an executing agent, and per-action billing (1c NAVIGATE, 2c EXTRACT) meant
   * to price one agent's paid use of another agent's browsing capability.
   * InvoiceProof scanning a URL a human/org pointed it at is not an
   * agent-to-agent transaction, so routing it through that layer would mean
   * fabricating a fictitious marketplace Agent + AP2 relationship purely to
   * satisfy a FK constraint that does not describe what is actually
   * happening — this uses the real engine without inventing marketplace
   * entities that would pollute the Agent table / AP2 ledger with fake
   * activity. This IS "using Conduit" per the work item, not a second,
   * parallel scraping engine: same DTOs, same action vocabulary, same
   * browser-automation code path as every other Conduit consumer.
   *
   * Metering (explicit decision, not left ambiguous): Conduit's per-action
   * costs are NOT passed through to the InvoiceProof customer as a second,
   * separate charge. A URL scan consumes exactly ONE InvoiceProof scan-quota
   * unit — identical to a PDF upload or a JSON batch — via the SAME scan()
   * gate scanPdf() already uses. Conduit's browser-automation compute is
   * treated as internal product-delivery infrastructure (the same way unpdf's
   * PDF parsing and Tesseract's OCR compute are absorbed rather than metered
   * separately), which is also why this bypasses ConduitSessionService's
   * billing layer entirely rather than "skipping" it — there is nothing to
   * skip, because that layer is simply not part of this path.
   */
  async scanUrl(url: string, user: AuthenticatedUser | null, ip: string, email?: string) {
    try {
      // eslint-disable-next-line no-new
      new URL(url);
    } catch {
      throw new BadRequestException('Invalid URL.');
    }

    try {
      // allowHttp=true: the spec for this feature blocks only non-http(s)
      // schemes, not plain http — many internal/legacy invoice portals are
      // not https-only.
      await assertSsrfSafeWithDns(url, true);
    } catch (err) {
      throw new BadRequestException(
        `URL rejected: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!this.browserIntake) {
      throw new ServiceUnavailableException(
        'URL intake is not available (Conduit browser engine not configured).',
      );
    }

    const sessionId = `invoiceproof-url-${randomUUID()}`;
    await this.browserIntake.initSession(sessionId, { allowedDomains: [] });

    try {
      const navResult = await this.browserIntake.navigate(sessionId, url);

      if (!navResult.success) {
        return {
          status: 'FETCH_FAILED',
          ok: false,
          message: 'Could not load the URL (navigation failed or was blocked by the SSRF guard).',
          extraction: null,
          scan: null,
        };
      }

      if (isPdfContentType(navResult.contentType) && navResult.bodyBase64) {
        const pdfBuffer = Buffer.from(navResult.bodyBase64, 'base64');
        const outcome = await this.pdf.extract(pdfBuffer);
        const taggedOutcome = outcome.ok
          ? { ...outcome, extraction: { ...outcome.extraction, extraction_method: 'url_pdf' as const } }
          : outcome;
        return this.handlePdfExtractOutcome(taggedOutcome, user, ip, email);
      }

      // HTML path.
      const [extractResult, snapshotResult] = await Promise.all([
        this.browserIntake.extractMain(sessionId),
        this.browserIntake.accessibilitySnapshot(sessionId),
      ]);

      const mainText = extractResult.success ? extractResult.data : null;
      const snapshotText = snapshotResult.success ? extractTextFromAriaSnapshot(snapshotResult.data) : '';
      const combinedText = combineUrlHtmlText(mainText, snapshotText);

      const parsed = extractInvoiceFieldsFromText(combinedText, 1);
      const hasFraudCriticalField =
        parsed.fields.amount !== undefined ||
        Boolean(parsed.fields.bankRouting) ||
        Boolean(parsed.fields.bankAccountLast4);

      let status = parsed.status;
      const warnings = [...parsed.warnings];
      if (hasFraudCriticalField && status === 'OK') {
        // Non-negotiable, mirroring Work Item 1's OCR gate: a bank/routing
        // number, account number, or total amount read from a LIVE, third-
        // party-controlled web page is never auto-approved — the page content
        // is not independently verified the way an uploaded document is.
        status = 'NEEDS_REVIEW';
        warnings.push(
          'A bank/routing number, account number, or total amount was read from a live web page — ' +
            'always routed to manual review regardless of confidence.',
        );
      }

      const extraction = { ...parsed, status, warnings, extraction_method: 'url_html' as const };

      if (status === 'TEXT_EXTRACTION_FAILED') {
        return {
          status: 'TEXT_EXTRACTION_FAILED',
          ok: false,
          message: warnings[0] ?? 'No usable content could be extracted from this page.',
          extraction,
          scan: null,
        };
      }

      if (status === 'NEEDS_REVIEW') {
        // Parity fix (truth-before-launch composition check): this branch was
        // originally written independently of Work Item 1's OCR intake and
        // duplicated the OLD pre-fix NEEDS_REVIEW handling (always scan:null).
        // Work Item 1 later established the correct pattern for this repo:
        // NEEDS_REVIEW means "a human should double-check the EXTRACTED
        // FIELDS", not "withhold the fraud engine's findings from that human"
        // — see handlePdfExtractOutcome's sibling logic in scanPdf's caller
        // (invoice-proof.service.ts's OCR branch) for the identical reasoning.
        // Without this, a URL-sourced HTML page with a fraud-critical field
        // (e.g. a changed bank/routing number) would NEVER surface
        // BANK_ACCOUNT_CHANGE_DETECTED, silently — a real regression against
        // the spec's explicit requirement that url_html follow "Same
        // NEEDS_REVIEW/confidence/provenance rules as Work Item 1". History
        // write is still skipped, same reasoning as below: url_html content
        // is fetched live from a third party and never independently
        // verified, so it should never seed the org's duplicate-detection
        // baseline.
        if (!hasFraudCriticalField) {
          return {
            status: 'NEEDS_REVIEW',
            ok: true,
            message:
              'Some fields could not be extracted with confidence from this page. Review and correct them, then submit for scanning.',
            extraction,
            scan: null,
          };
        }

        const urlScan = await this.scan(
          { invoices: [this.pdfFieldsToInvoice(extraction.fields)] },
          user,
          ip,
          email,
          {
            skipHistoryWrite: true,
            historySkippedReason: `URL-derived (HTML) extraction (NEEDS_REVIEW, confidence ${extraction.confidence.toFixed(2)}) — scan was not recorded to org history.`,
          },
        );

        return {
          status: 'NEEDS_REVIEW',
          ok: true,
          message:
            'This content was read from a live web page — findings below are provisional. ' +
            'Verify vendor, amount, and bank/routing details against the original source before acting on any finding.',
          extraction,
          scan: urlScan,
        };
      }

      // NOTE, documented deliberately (not a bug): status can only be 'OK' here
      // when NO fraud-critical field was found (the gate above forces
      // NEEDS_REVIEW whenever one is), and extractInvoiceFieldsFromText's own
      // OK status requires `amount` to be present (one of its three
      // coreCount===3 fields) — and `amount` IS on the fraud-critical list.
      // So, structurally, this branch is not reachable through a real page
      // today, exactly the same situation Work Item 1 documents for OCR's
      // OCR_MIN_CONFIDENCE_FOR_OK gate. Kept (not deleted) as defense-in-depth,
      // and skipHistoryWrite is still passed for the same reason: url_html
      // content is fetched live from a third party and never independently
      // verified the way an uploaded file is, so it should never seed the
      // org's duplicate-detection baseline even in this edge case.
      const scan = await this.scan(
        { invoices: [this.pdfFieldsToInvoice(extraction.fields)] },
        user,
        ip,
        email,
        {
          skipHistoryWrite: true,
          historySkippedReason: 'URL-derived (HTML) extraction — scan was not recorded to org history.',
        },
      );
      return { status: 'SCANNED', ok: true, extraction, scan };
    } finally {
      await this.browserIntake.closeSession(sessionId).catch(() => undefined);
    }
  }

  /** Map extracted PDF fields onto the invoice shape the scan runner normalizes. */
  private pdfFieldsToInvoice(fields: ExtractedInvoiceFields): Record<string, unknown> {
    return {
      vendor: fields.vendor ?? '',
      invoiceNo: fields.invoiceNo ?? '',
      amount: fields.amount ?? 0,
      po: fields.po ?? '',
      // runner reads `bankRouting` as an alias of the bank field for BEC detection.
      bankRouting: fields.bankRouting ?? '',
      ...(fields.lineItemsTotal !== undefined ? { lineItemsTotal: fields.lineItemsTotal } : {}),
    };
  }

  async markVendorsForBankReview(
    organizationId: string,
    findings: Array<{ pattern: string; rows?: string[] }>,
    rows: Array<{ invoiceNo: string; vendor: string }>,
  ) {
    // proof-core emits 'Bank account change (BANK_ACCOUNT_CHANGE)' — use substring match
    // so this works regardless of which variant the scanner produces.
    const bankFlags = findings.filter((f) => f.pattern.includes('BANK_ACCOUNT_CHANGE'));
    for (const f of bankFlags) {
      const rowRef = f.rows?.[0];
      const matched = rowRef
        ? rows.find((r) => r.invoiceNo === rowRef || `${r.vendor}-${r.invoiceNo}` === rowRef)
        : undefined;
      const vendorName = matched?.vendor;
      if (!vendorName) continue;
      const existing = await this.prisma.orgVendorMaster.findFirst({
        where: { organizationId, vendorName },
      });
      if (existing && existing.source !== OrgDataSource.VENDOR_PORTAL_VERIFIED) {
        await this.prisma.orgVendorMaster.update({
          where: { id: existing.id },
          data: { status: OrgVendorStatus.REVIEW },
        });
      }
    }
  }

  async createApprovalRecords(
    organizationId: string,
    scanRunId: string,
    findings: Array<{ severity: string; pattern: string; detail: string; rows?: string[] }>,
    rows: Array<{ invoiceNo: string; vendor: string }>,
  ) {
    const actionable = findings.filter((f) => f.severity === 'critical' || f.severity === 'high');
    if (actionable.length === 0) return;

    await this.prisma.scanFindingApproval.createMany({
      data: actionable.map((f) => {
        const rowRef = f.rows?.[0];
        const matched = rowRef
          ? rows.find((r) => r.invoiceNo === rowRef || `${r.vendor}-${r.invoiceNo}` === rowRef)
          : rows[0];
        return {
          scanRunId,
          organizationId,
          findingPattern: f.pattern,
          findingDetail: f.detail,
          invoiceNo: matched?.invoiceNo,
          vendor: matched?.vendor,
          status: ScanApprovalStatus.PENDING_REVIEW,
        };
      }),
    });
  }

  /** Resolve the email address of the org owner (OWNER role) for alert delivery. */
  private async resolveOrgOwnerEmail(
    organizationId: string,
  ): Promise<{ email: string; orgName: string } | null> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        name: true,
        members: {
          where: { role: 'OWNER' },
          take: 1,
          select: { user: { select: { email: true } } },
        },
      },
    });
    if (!org) return null;
    const ownerEmail = org.members[0]?.user?.email;
    if (!ownerEmail) return null;
    return { email: ownerEmail, orgName: org.name };
  }

  /**
   * Send a review alert email when a scan produces high/critical findings or a bank-change
   * finding. Fail-soft: a send failure is logged but never blocks scan creation.
   */
  private async sendReviewAlertIfNeeded(
    organizationId: string,
    scanId: string,
    riskLevel: InvoiceScanRiskLevel,
    findings: Array<{ severity: string; pattern: string }>,
  ): Promise<void> {
    const hasBankChange = findings.some((f) => f.pattern.includes('BANK_ACCOUNT_CHANGE'));
    const hasHighOrCritical = findings.some(
      (f) => f.severity === 'critical' || f.severity === 'high',
    );
    if (!hasBankChange && !hasHighOrCritical) return;

    try {
      const recipient = await this.resolveOrgOwnerEmail(organizationId);
      if (!recipient) return;

      const topFindings = findings
        .filter((f) => f.severity === 'critical' || f.severity === 'high')
        .slice(0, 5)
        .map((f) => ({ pattern: f.pattern, severity: f.severity }));

      await this.email.sendInvoiceProofReviewAlert({
        to: recipient.email,
        orgName: recipient.orgName,
        scanId,
        riskLevel: String(riskLevel),
        findingCount: findings.length,
        topFindings,
      });
    } catch (err) {
      this.logger.error(
        `InvoiceProof review alert failed for scan ${scanId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async listVendorMaster(organizationId: string) {
    return this.prisma.orgVendorMaster.findMany({
      where: { organizationId },
      orderBy: { vendorName: 'asc' },
    });
  }

  async upsertVendorMaster(
    organizationId: string,
    data: {
      vendorName: string;
      city?: string;
      state?: string;
      expectedEmailDomain?: string;
      bankRoutingNumber?: string;
      bankAccountLast4?: string;
      remitAddress?: string;
      source?: OrgDataSource;
      status?: OrgVendorStatus;
    },
  ) {
    const vendorName = String(data.vendorName ?? '');
    if (!vendorName) throw new BadRequestException('vendorName is required');
    const existing = await this.prisma.orgVendorMaster.findFirst({
      where: { organizationId, vendorName },
    });
    if (existing) {
      return this.prisma.orgVendorMaster.update({
        where: { id: existing.id },
        data: {
          city: data.city,
          state: data.state,
          expectedEmailDomain: data.expectedEmailDomain,
          bankRoutingNumber: data.bankRoutingNumber,
          bankAccountLast4: data.bankAccountLast4,
          remitAddress: data.remitAddress,
          source: data.source,
          status: data.status,
        },
      });
    }
    return this.prisma.orgVendorMaster.create({
      data: {
        organizationId,
        vendorName,
        city: data.city,
        state: data.state,
        expectedEmailDomain: data.expectedEmailDomain,
        bankRoutingNumber: data.bankRoutingNumber,
        bankAccountLast4: data.bankAccountLast4,
        remitAddress: data.remitAddress,
        source: data.source ?? OrgDataSource.MANUAL,
        status: data.status ?? OrgVendorStatus.ACTIVE,
      },
    });
  }

  async bulkImportVendorMaster(organizationId: string, rows: Record<string, unknown>[]) {
    let count = 0;
    for (const row of rows) {
      const vendorName = String(row.vendorName ?? row.VENDOR_NAME ?? row.vendor ?? '').trim();
      if (!vendorName) continue;
      await this.upsertVendorMaster(organizationId, {
        vendorName,
        city: String(row.city ?? row.CITY ?? '') || undefined,
        state: String(row.state ?? row.STATE ?? '') || undefined,
        expectedEmailDomain: String(row.expectedEmailDomain ?? row.email_domain ?? '') || undefined,
        bankRoutingNumber:
          String(row.bankRoutingNumber ?? row.routing_number ?? row.ROUTING_NUMBER ?? '') ||
          undefined,
        bankAccountLast4: String(row.bankAccountLast4 ?? row.account_last4 ?? '') || undefined,
        remitAddress: String(row.remitAddress ?? row.remit_address ?? '') || undefined,
        source: OrgDataSource.MANUAL,
      });
      count++;
    }
    return { imported: count };
  }

  async deleteVendorMaster(organizationId: string, id: string) {
    const row = await this.prisma.orgVendorMaster.findFirst({ where: { id, organizationId } });
    if (!row) throw new NotFoundException('Vendor not found');
    await this.prisma.orgVendorMaster.delete({ where: { id } });
    return { deleted: true };
  }

  async listPoRegister(organizationId: string) {
    return this.prisma.orgPoRegister.findMany({
      where: { organizationId },
      orderBy: { poNumber: 'asc' },
    });
  }

  async upsertPo(organizationId: string, data: {
    poNumber: string;
    vendorName: string;
    authorizedAmount: number;
    status?: OrgPoStatus;
    issuedAt?: Date;
    expiresAt?: Date;
  }) {
    return this.prisma.orgPoRegister.upsert({
      where: { organizationId_poNumber: { organizationId, poNumber: data.poNumber } },
      create: {
        organizationId,
        poNumber: data.poNumber,
        vendorName: data.vendorName,
        authorizedAmount: data.authorizedAmount,
        status: data.status ?? OrgPoStatus.OPEN,
        issuedAt: data.issuedAt,
        expiresAt: data.expiresAt,
        source: OrgDataSource.MANUAL,
      },
      update: {
        vendorName: data.vendorName,
        authorizedAmount: data.authorizedAmount,
        status: data.status,
        issuedAt: data.issuedAt,
        expiresAt: data.expiresAt,
      },
    });
  }

  async bulkImportPoRegister(organizationId: string, rows: Record<string, unknown>[]) {
    let count = 0;
    for (const row of rows) {
      const poNumber = String(row.poNumber ?? row.PO_NUMBER ?? row.po ?? '').trim();
      const vendorName = String(row.vendorName ?? row.VENDOR_NAME ?? row.vendor ?? '').trim();
      const authorizedAmount = Number(
        row.authorizedAmount ?? row.AUTHORIZED_AMOUNT ?? row.PO_AMOUNT ?? 0,
      );
      if (!poNumber || !vendorName) continue;
      await this.upsertPo(organizationId, { poNumber, vendorName, authorizedAmount });
      count++;
    }
    return { imported: count };
  }

  async bulkImportPaymentHistory(organizationId: string, rows: Record<string, unknown>[]) {
    const data = rows
      .map((row) => {
        const invoiceNo = String(
          row.invoiceNo ?? row.invoiceNumber ?? row.INVOICE_NUMBER ?? '',
        ).trim();
        const vendor = String(row.vendor ?? row.VENDOR_NAME ?? '').trim();
        const amount = Number(row.amount ?? row.INVOICE_AMOUNT ?? row.PAYMENT_AMOUNT ?? 0);
        if (!invoiceNo || !vendor || !amount) return null;
        return {
          organizationId,
          invoiceNo,
          vendor,
          amount,
          poNumber: String(row.po ?? row.PO_NUMBER ?? '') || undefined,
          paidAt: row.paidAt ? new Date(String(row.paidAt)) : row.PAYMENT_DATE ? new Date(String(row.PAYMENT_DATE)) : new Date(),
          source: OrgDataSource.MANUAL,
        };
      })
      .filter(Boolean) as Prisma.OrgInvoiceHistoryCreateManyInput[];

    if (data.length === 0) return { imported: 0 };
    await this.prisma.orgInvoiceHistory.createMany({ data, skipDuplicates: true });
    return { imported: data.length };
  }

  async listScans(organizationId: string) {
    return this.prisma.orgInvoiceScanRun.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        invoiceCount: true,
        findingCount: true,
        criticalCount: true,
        riskLevel: true,
        coverageSummary: true,
        createdAt: true,
      },
    });
  }

  async getScanReview(organizationId: string, scanId: string) {
    const scan = await this.prisma.orgInvoiceScanRun.findFirst({
      where: { id: scanId, organizationId },
    });
    if (!scan) throw new NotFoundException('Scan not found');
    const approvals = await this.prisma.scanFindingApproval.findMany({
      where: { scanRunId: scanId, organizationId },
      orderBy: { createdAt: 'asc' },
    });
    return { scan, approvals };
  }

  signApproval(userId: string, scanId: string, decision: string): string {
    const secret = process.env.JWT_SECRET ?? process.env.INTERNAL_SECRET;
    if (!secret) {
      throw new Error('Approval signing secret not configured (set JWT_SECRET or INTERNAL_SECRET).');
    }
    return createHmac('sha256', secret)
      .update(`${userId}:${scanId}:${decision}:${Date.now()}`)
      .digest('hex');
  }

  async decideApproval(
    organizationId: string,
    approvalId: string,
    userId: string,
    decision: 'APPROVED' | 'BLOCKED',
    note?: string,
  ) {
    const approval = await this.prisma.scanFindingApproval.findFirst({
      where: { id: approvalId, organizationId },
    });
    if (!approval) throw new NotFoundException('Approval record not found');
    const signatureHmac = this.signApproval(userId, approval.scanRunId, decision);
    return this.prisma.scanFindingApproval.update({
      where: { id: approvalId },
      data: {
        status: decision === 'APPROVED' ? ScanApprovalStatus.APPROVED : ScanApprovalStatus.BLOCKED,
        approverUserId: userId,
        decisionNote: note,
        signatureHmac,
        decidedAt: new Date(),
      },
    });
  }

  async webhookScan(orgId: string, body: InvoiceScanRequestBody) {
    const org = await this.prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) throw new NotFoundException('Organization not found');

    const entitlement = await this.prisma.proofProductEntitlement.findFirst({
      where: {
        organizationId: orgId,
        product: ProofProductType.INVOICE_PROOF,
        status: ProofEntitlementStatus.ACTIVE,
        planSlug: { contains: 'govern', mode: 'insensitive' },
      },
    });
    if (!entitlement) {
      throw new ForbiddenException(
        'Real-time AP webhook requires an active InvoiceProof Govern plan.',
      );
    }

    return this.scan(body, null, 'webhook', undefined, {
      organizationId: orgId,
      skipFreeScanGate: true,
    });
  }

  async createVendorPortalToken(organizationId: string, vendorName: string) {
    const token = randomBytes(24).toString('hex');
    return this.prisma.vendorPortalToken.create({
      data: {
        organizationId,
        vendorName,
        token,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
  }

  // -- OTP constants --
  private static readonly OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
  private static readonly OTP_MAX_ATTEMPTS = 5;

  private hashOtpCode(code: string): string {
    return createHash('sha256').update(code).digest('hex');
  }

  private async logVendorPortalAudit(
    event: string,
    organizationId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          event,
          metadata: metadata as Prisma.InputJsonValue,
          userId: organizationId,
          createdAt: new Date(),
        },
      });
    } catch (err) {
      this.logger.error(`Failed to write audit log event=${event}: ${(err as Error).message}`);
    }
  }

  private async resolvePortalToken(orgSlug: string, token: string) {
    const org = await this.prisma.organization.findUnique({ where: { slug: orgSlug } });
    if (!org) throw new NotFoundException('Organization not found');
    const portal = await this.prisma.vendorPortalToken.findFirst({
      where: { organizationId: org.id, token, expiresAt: { gt: new Date() } },
    });
    if (!portal) throw new ForbiddenException('Invalid or expired vendor portal link');
    return { org, portal };
  }

  async requestVendorPortalOtp(orgSlug: string, token: string) {
    const { org, portal } = await this.resolvePortalToken(orgSlug, token);

    // Look up the vendor's TRUSTED contact email on the vendor record
    const vendor = await this.prisma.orgVendorMaster.findFirst({
      where: { organizationId: org.id, vendorName: portal.vendorName },
      select: { contactEmail: true, vendorName: true },
    });

    const trustedEmail = vendor?.contactEmail?.trim();
    if (!trustedEmail) {
      await this.logVendorPortalAudit('VENDOR_PORTAL_OTP_BLOCKED_NO_EMAIL', org.id, {
        vendorName: portal.vendorName,
        tokenId: portal.id,
      });
      throw new ForbiddenException(
        'No verified contact email is on file for this vendor. ' +
          'Bank-detail changes require manual review — please contact your accounts-payable administrator.',
      );
    }

    // Generate a 6-digit numeric OTP using cryptographic randomness
    const code = String(randomInt(100_000, 1_000_000));
    const codeHash = this.hashOtpCode(code);

    // Store hashed OTP
    await this.prisma.vendorPortalOtp.create({
      data: {
        vendorPortalTokenId: portal.id,
        vendorName: portal.vendorName,
        organizationId: org.id,
        codeHash,
        expiresAt: new Date(Date.now() + InvoiceProofService.OTP_EXPIRY_MS),
      },
    });

    // Send OTP email — FAIL CLOSED: if send throws, the caller gets an error
    // and cannot proceed without the code.
    await this.email.sendVendorPortalOtp({
      to: trustedEmail,
      vendorName: portal.vendorName,
      orgName: org.name ?? orgSlug,
      code,
    });

    await this.logVendorPortalAudit('VENDOR_PORTAL_OTP_REQUESTED', org.id, {
      vendorName: portal.vendorName,
      tokenId: portal.id,
      sentTo: trustedEmail.replace(/(.{2}).*(@.*)/, '$1***$2'), // mask for audit
    });

    return {
      message: 'A one-time verification code has been sent to the email address on file for this vendor.',
    };
  }

  async submitVendorPortalBankUpdate(
    orgSlug: string,
    token: string,
    payload: {
      bankRoutingNumber: string;
      bankAccountLast4?: string;
      remitAddress?: string;
      otpCode?: string;
    },
  ) {
    const { org, portal } = await this.resolvePortalToken(orgSlug, token);

    // OTP is REQUIRED — no code means no bank change
    if (!payload.otpCode?.trim()) {
      await this.logVendorPortalAudit('VENDOR_PORTAL_BANK_CHANGE_BLOCKED', org.id, {
        vendorName: portal.vendorName,
        reason: 'MISSING_OTP',
      });
      throw new ForbiddenException(
        'A one-time verification code is required. Request a code first.',
      );
    }

    // Find the latest non-consumed, non-locked OTP for this portal token
    const otp = await this.prisma.vendorPortalOtp.findFirst({
      where: {
        vendorPortalTokenId: portal.id,
        consumedAt: null,
        lockedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!otp) {
      await this.logVendorPortalAudit('VENDOR_PORTAL_BANK_CHANGE_BLOCKED', org.id, {
        vendorName: portal.vendorName,
        reason: 'NO_VALID_OTP',
      });
      throw new ForbiddenException(
        'No valid verification code found. Request a new code.',
      );
    }

    // Verify OTP by comparing hashes using timing-safe comparison
    const suppliedHash = this.hashOtpCode(payload.otpCode.trim());
    const hashesMatch =
      Buffer.from(suppliedHash).length === Buffer.from(otp.codeHash).length &&
      timingSafeEqual(Buffer.from(suppliedHash), Buffer.from(otp.codeHash));

    if (!hashesMatch) {
      // Increment attempts and check for lockout
      const updatedOtp = await this.prisma.vendorPortalOtp.update({
        where: { id: otp.id },
        data: {
          attempts: { increment: 1 },
          ...(otp.attempts + 1 >= InvoiceProofService.OTP_MAX_ATTEMPTS
            ? { lockedAt: new Date() }
            : {}),
        },
      });

      await this.logVendorPortalAudit('VENDOR_PORTAL_OTP_FAILED', org.id, {
        vendorName: portal.vendorName,
        tokenId: portal.id,
        attempts: updatedOtp.attempts,
        locked: updatedOtp.lockedAt !== null,
      });

      if (updatedOtp.lockedAt) {
        throw new ForbiddenException(
          'Too many failed attempts. This code has been locked. Request a new code.',
        );
      }
      throw new ForbiddenException('Invalid verification code.');
    }

    // Mark OTP consumed (single-use)
    await this.prisma.vendorPortalOtp.update({
      where: { id: otp.id },
      data: { consumedAt: new Date() },
    });

    await this.logVendorPortalAudit('VENDOR_PORTAL_OTP_VERIFIED', org.id, {
      vendorName: portal.vendorName,
      tokenId: portal.id,
    });

    // Apply the bank change
    const existing = await this.prisma.orgVendorMaster.findFirst({
      where: { organizationId: org.id, vendorName: portal.vendorName },
    });
    const now = new Date();
    const bankLast4 = payload.bankRoutingNumber
      ? payload.bankRoutingNumber.slice(-4)
      : undefined;

    let result;
    if (existing) {
      result = await this.prisma.orgVendorMaster.update({
        where: { id: existing.id },
        data: {
          bankRoutingNumber: payload.bankRoutingNumber,
          bankAccountLast4: payload.bankAccountLast4,
          remitAddress: payload.remitAddress,
          source: OrgDataSource.VENDOR_PORTAL_VERIFIED,
          bankDetailChangedAt: now,
          status: OrgVendorStatus.ACTIVE,
        },
      });
    } else {
      result = await this.prisma.orgVendorMaster.create({
        data: {
          organizationId: org.id,
          vendorName: portal.vendorName,
          bankRoutingNumber: payload.bankRoutingNumber,
          bankAccountLast4: payload.bankAccountLast4,
          remitAddress: payload.remitAddress,
          source: OrgDataSource.VENDOR_PORTAL_VERIFIED,
          bankDetailChangedAt: now,
          status: OrgVendorStatus.ACTIVE,
        },
      });
    }

    await this.logVendorPortalAudit('VENDOR_PORTAL_BANK_CHANGE_ACCEPTED', org.id, {
      vendorName: portal.vendorName,
      tokenId: portal.id,
      routingLast4: bankLast4,
    });

    return result;
  }

  get erpService() {
    return this.erp;
  }

  async processInboundEmail(
    orgSlug: string,
    payload: {
      text?: string;
      html?: string;
      from?: string;
      subject?: string;
      attachments?: Array<{ content?: string; filename?: string }>;
    },
  ) {
    const org = await this.prisma.organization.findUnique({ where: { slug: orgSlug } });
    if (!org) throw new NotFoundException('Organization not found');

    const entitlement = await this.prisma.proofProductEntitlement.findFirst({
      where: {
        organizationId: org.id,
        product: ProofProductType.INVOICE_PROOF,
        status: ProofEntitlementStatus.ACTIVE,
      },
    });
    if (!entitlement) {
      throw new ForbiddenException('Inbound email scanning requires an active InvoiceProof paid plan.');
    }

    let text = payload.text?.trim() ?? '';
    if (!text && payload.html) {
      text = payload.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
    for (const att of payload.attachments ?? []) {
      if (att.content && att.filename?.match(/\.(txt|csv|tsv)$/i)) {
        try {
          text += `\n${Buffer.from(att.content, 'base64').toString('utf8')}`;
        } catch {
          this.logger.warn(`Failed to decode attachment ${att.filename}`);
        }
      }
    }
    if (text.length < 10) {
      throw new BadRequestException('No extractable invoice text in inbound email');
    }

    const result = await this.scan(
      { text },
      null,
      'inbound-email',
      payload.from,
      { organizationId: org.id, skipFreeScanGate: true },
    );
    return {
      orgSlug,
      from: payload.from,
      subject: payload.subject,
      scanId: result.scanId,
      findingCount: result.findingCount,
      riskLevel: result.riskLevel,
      summary:
        result.findingCount === 0
          ? 'No fraud findings detected.'
          : `${result.findingCount} finding(s) — review at /invoice-proof/review/${result.scanId}`,
    };
  }
}
