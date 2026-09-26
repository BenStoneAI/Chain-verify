/**
 * InvoiceProof service tests covering:
 *  - Part 1: Consortium distinct-org counting
 *  - Part 2: Approval/review email sending (fail-soft)
 *  - Part 3: Bank-review pattern-match bug fix
 *
 * Note: invoice-proof-scan.runner.ts transitively imports @swarmsync/proof-core which
 * is not resolvable in the Jest module mapper for sub-path imports (the pre-existing
 * runner.spec.ts has the same issue). We mock the runner module so service tests are
 * isolated from that resolution problem.
 */

// Mock the scan runner before any imports so Jest replaces the module.
jest.mock('./invoice-proof-scan.runner.js', () => ({
  hashFingerprint: jest.fn((v: string) => Buffer.from(v).toString('hex').slice(0, 64)),
  parseInvoiceScanBody: jest.fn((body: { invoices?: unknown[] }) => ({
    rows: (body.invoices ?? []).map((inv: Record<string, unknown>) => ({
      invoiceNo: inv.invoiceNo ?? 'INV-0',
      vendor: inv.vendor ?? 'Test Co',
      amount: Number(inv.amount ?? 0),
      po: inv.po ?? '',
      bank: inv.bank ?? '',
    })),
    vendorMaster: [],
    vendorMasterExtended: [],
    poRegister: [],
    seededHistory: [],
  })),
  runInvoiceScan: jest.fn(() => ({
    findings: [],
    findingCount: 0,
    rowCount: 1,
    coverage_summary: {},
  })),
}));

import { InvoiceProofIntelligenceService } from './invoice-proof-intelligence.service.js';
import { InvoiceProofService } from './invoice-proof.service.js';

// ---------------------------------------------------------------------------
// PART 1 — Consortium distinct-org counting
// ---------------------------------------------------------------------------

describe('InvoiceProofIntelligenceService — reportConsortiumSignals', () => {
  function makeIntelPrisma() {
    const orgReports: Record<string, Set<string>> = {};
    const signals: Record<string, { reportCount: number; distinctOrgCount: number }> = {};

    return {
      orgVendorBaseline: { findMany: jest.fn().mockResolvedValue([]) },
      orgVendorMaster: { findMany: jest.fn().mockResolvedValue([]) },
      fraudIntelSignal: {
        findMany: jest.fn().mockImplementation(async (args: {
          where?: { distinctOrgCount?: { gte?: number } };
        }) => {
          const minOrgs = args?.where?.distinctOrgCount?.gte ?? 0;
          return Object.entries(signals)
            .filter(([, s]) => s.distinctOrgCount >= minOrgs)
            .map(([routing, s]) => ({
              id: `sig-${routing}`,
              routingNumber: routing,
              reportCount: s.reportCount,
              distinctOrgCount: s.distinctOrgCount,
              confidence: 0.5,
              status: 'ACTIVE',
            }));
        }),
        upsert: jest.fn().mockImplementation(async (args: {
          where: { routingNumber: string };
          create: { reportCount: number; distinctOrgCount: number };
          update: { reportCount: { increment: number }; distinctOrgCount: number };
        }) => {
          const routing = args.where.routingNumber;
          if (!signals[routing]) {
            signals[routing] = {
              reportCount: args.create.reportCount,
              distinctOrgCount: args.create.distinctOrgCount,
            };
          } else {
            signals[routing].reportCount += args.update.reportCount.increment;
            signals[routing].distinctOrgCount = args.update.distinctOrgCount;
          }
          return signals[routing];
        }),
      },
      fraudIntelOrgReport: {
        upsert: jest.fn().mockImplementation(async (args: {
          where: { routingNumber_organizationId: { routingNumber: string; organizationId: string } };
          create: { routingNumber: string; organizationId: string };
        }) => {
          const { routingNumber, organizationId } = args.where.routingNumber_organizationId;
          if (!orgReports[routingNumber]) orgReports[routingNumber] = new Set();
          orgReports[routingNumber].add(organizationId);
        }),
        count: jest.fn().mockImplementation(async (args: { where: { routingNumber: string } }) => {
          return orgReports[args.where.routingNumber]?.size ?? 0;
        }),
      },
    };
  }

  it('same org reporting 5 times → distinctOrgCount stays 1', async () => {
    const prisma = makeIntelPrisma();
    const service = new InvoiceProofIntelligenceService(prisma as never);

    const bankFinding = {
      severity: 'critical' as const,
      pattern: 'Bank account change (BANK_ACCOUNT_CHANGE)',
      detail: 'BANK_ACCOUNT_CHANGE — routing 021000021 changed',
      rows: ['INV-1'],
      evidence: 'routing=021000021',
    };

    for (let i = 0; i < 5; i++) {
      await service.reportConsortiumSignals([bankFinding], 'org-alpha');
    }

    // OrgReport upsert called 5 times but the Set deduplicates
    expect(prisma.fraudIntelOrgReport.upsert).toHaveBeenCalledTimes(5);

    const signalCalls = (prisma.fraudIntelSignal.upsert as jest.Mock).mock.calls;
    const lastUpdateDistinctOrgCount: number = signalCalls[signalCalls.length - 1][0].update.distinctOrgCount;
    expect(lastUpdateDistinctOrgCount).toBe(1);
  });

  it('4 distinct orgs → distinctOrgCount = 4', async () => {
    const prisma = makeIntelPrisma();
    const service = new InvoiceProofIntelligenceService(prisma as never);

    const bankFinding = {
      severity: 'critical' as const,
      pattern: 'Bank account change (BANK_ACCOUNT_CHANGE)',
      detail: 'BANK_ACCOUNT_CHANGE — routing 021000021',
      rows: ['INV-X'],
      evidence: 'routing=021000021',
    };

    for (const orgId of ['org-1', 'org-2', 'org-3', 'org-4']) {
      await service.reportConsortiumSignals([bankFinding], orgId);
    }

    const signalCalls = (prisma.fraudIntelSignal.upsert as jest.Mock).mock.calls;
    const lastCall = signalCalls[signalCalls.length - 1][0];
    expect(lastCall.update.distinctOrgCount).toBe(4);
    // Raw reportCount should increment once per org call
    expect(lastCall.update.reportCount).toEqual({ increment: 1 });
  });

  it('checkConsortiumSignals label exposes both distinctOrgCount and reportCount', async () => {
    const prisma = {
      orgVendorBaseline: { findMany: jest.fn().mockResolvedValue([]) },
      orgVendorMaster: { findMany: jest.fn().mockResolvedValue([]) },
      fraudIntelSignal: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'sig-1',
            routingNumber: '021000021',
            reportCount: 7,
            distinctOrgCount: 4,
            confidence: 0.85,
            status: 'ACTIVE',
          },
        ]),
      },
      fraudIntelOrgReport: { upsert: jest.fn(), count: jest.fn() },
    };
    const service = new InvoiceProofIntelligenceService(prisma as never);
    const rows = [
      { bank: '021000021', vendor: 'Acme Corp', invoiceNo: 'INV-99', amount: 1000, po: '' },
    ];
    const findings = await service.checkConsortiumSignals(rows as never);

    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toContain('4 distinct InvoiceProof organizations');
    expect(findings[0].detail).toContain('7 total reports');
    expect(findings[0].evidence).toContain('distinctOrgCount=4');
    expect(findings[0].evidence).toContain('reportCount=7');
  });

  it('checkConsortiumSignals does NOT fire when distinctOrgCount < 3', async () => {
    const prisma = {
      orgVendorBaseline: { findMany: jest.fn().mockResolvedValue([]) },
      orgVendorMaster: { findMany: jest.fn().mockResolvedValue([]) },
      // Query filters distinctOrgCount >= 3 — returns nothing for signals with < 3 distinct orgs
      fraudIntelSignal: { findMany: jest.fn().mockResolvedValue([]) },
      fraudIntelOrgReport: { upsert: jest.fn(), count: jest.fn() },
    };
    const service = new InvoiceProofIntelligenceService(prisma as never);
    const rows = [{ bank: '021000021', vendor: 'Acme', invoiceNo: 'INV-1', amount: 500, po: '' }];
    const findings = await service.checkConsortiumSignals(rows as never);
    expect(findings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// PART 2 — Approval/review email (fail-soft)
// ---------------------------------------------------------------------------

describe('InvoiceProofService — sendReviewAlertIfNeeded (Part 2)', () => {
  function makeService(orgOwner: { email: string; orgName: string } | null) {
    const prisma = {
      proofProductEntitlement: { findFirst: jest.fn().mockResolvedValue(null) },
      proofFreeScan: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
      orgVendorMaster: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
      orgPoRegister: { findMany: jest.fn().mockResolvedValue([]) },
      orgInvoiceHistory: { findMany: jest.fn().mockResolvedValue([]), createMany: jest.fn() },
      orgInvoiceScanRun: {
        create: jest.fn().mockResolvedValue({ id: 'scan-abc' }),
        update: jest.fn().mockResolvedValue({}),
      },
      scanFindingApproval: { createMany: jest.fn() },
      organization: {
        findUnique: jest.fn().mockImplementation(async () => {
          if (!orgOwner) return null;
          return {
            name: orgOwner.orgName,
            members: [{ user: { email: orgOwner.email } }],
          };
        }),
      },
    };

    const emailSendSpy = jest.fn().mockResolvedValue(undefined);
    const emailService = { sendInvoiceProofReviewAlert: emailSendSpy };

    const intelligenceService = {
      enrichFindings: jest.fn().mockResolvedValue([]),
      reportConsortiumSignals: jest.fn().mockResolvedValue(undefined),
    };

    // Real-shaped mocks (not `{} as never`) so scan()'s ProofRecord creation
    // path (see createScanProofRecord) can be exercised end-to-end below.
    const verificationService = {
      queueVerification: jest.fn().mockResolvedValue({ id: 'vrun-1' }),
      updateVerificationStatus: jest
        .fn()
        .mockImplementation(
          async (
            runId: string,
            vOrgId: string,
            status: string,
            updates?: { outputSummary?: string; riskLevel?: string },
          ) => ({
            id: runId,
            orgId: vOrgId,
            status,
            outputSummary: updates?.outputSummary ?? null,
            riskLevel: updates?.riskLevel ?? 'UNKNOWN',
          }),
        ),
    };
    const proofService = {
      createProof: jest.fn().mockResolvedValue({ id: 'proof-xyz', chain_hash: 'abc123hash' }),
    };

    const service = new InvoiceProofService(
      prisma as never,
      {} as never,
      intelligenceService as never,
      emailService as never,
      {} as never,
      verificationService as never,
      proofService as never,
    );

    return { service, prisma, emailSendSpy, intelligenceService, verificationService, proofService };
  }

  it('sends email when scan has critical findings', async () => {
    const { service, emailSendSpy, intelligenceService } = makeService({
      email: 'owner@example.com',
      orgName: 'Acme Org',
    });

    (intelligenceService.enrichFindings as jest.Mock).mockResolvedValue([
      {
        severity: 'critical',
        pattern: 'Bank account change (BANK_ACCOUNT_CHANGE)',
        detail: 'BEC alert',
        rows: ['INV-1'],
      },
    ]);

    await service.scan(
      { invoices: [{ vendor: 'Test Co', invoiceNo: 'INV-1', amount: 1000 }] },
      null,
      '127.0.0.1',
      undefined,
      { organizationId: 'org-1', skipFreeScanGate: true },
    );

    expect(emailSendSpy).toHaveBeenCalledTimes(1);
    expect(emailSendSpy.mock.calls[0][0]).toMatchObject({
      to: 'owner@example.com',
      orgName: 'Acme Org',
      riskLevel: 'CRITICAL',
    });
  });

  it('sends email when scan has high-severity finding', async () => {
    const { service, emailSendSpy, intelligenceService } = makeService({
      email: 'owner@example.com',
      orgName: 'Acme Org',
    });

    (intelligenceService.enrichFindings as jest.Mock).mockResolvedValue([
      { severity: 'high', pattern: 'MISSING_PO_REFERENCE', detail: 'No PO', rows: ['INV-1'] },
    ]);

    await service.scan(
      { invoices: [{ vendor: 'Test Co', invoiceNo: 'INV-1', amount: 1000 }] },
      null,
      '127.0.0.1',
      undefined,
      { organizationId: 'org-1', skipFreeScanGate: true },
    );

    expect(emailSendSpy).toHaveBeenCalledTimes(1);
  });

  it('sends email when scan has a bank-change finding', async () => {
    const { service, emailSendSpy, intelligenceService } = makeService({
      email: 'owner@example.com',
      orgName: 'Acme Org',
    });

    (intelligenceService.enrichFindings as jest.Mock).mockResolvedValue([
      {
        severity: 'critical',
        pattern: 'Bank account change (BANK_ACCOUNT_CHANGE)',
        detail: 'BEC alert',
        rows: ['INV-1'],
      },
    ]);

    await service.scan(
      { invoices: [{ vendor: 'Test Co', invoiceNo: 'INV-1', amount: 1000 }] },
      null,
      '127.0.0.1',
      undefined,
      { organizationId: 'org-1', skipFreeScanGate: true },
    );

    expect(emailSendSpy).toHaveBeenCalledTimes(1);
  });

  it('does NOT send email for a clean scan (medium findings only)', async () => {
    const { service, emailSendSpy, intelligenceService } = makeService({
      email: 'owner@example.com',
      orgName: 'Acme Org',
    });

    (intelligenceService.enrichFindings as jest.Mock).mockResolvedValue([
      { severity: 'medium', pattern: 'ROUND_DOLLAR_AMOUNT', detail: 'Round dollar', rows: ['INV-1'] },
    ]);

    await service.scan(
      { invoices: [{ vendor: 'Test Co', invoiceNo: 'INV-1', amount: 1000 }] },
      null,
      '127.0.0.1',
      undefined,
      { organizationId: 'org-1', skipFreeScanGate: true },
    );

    expect(emailSendSpy).not.toHaveBeenCalled();
  });

  it('does NOT send email for a completely clean scan (no findings)', async () => {
    const { service, emailSendSpy, intelligenceService } = makeService({
      email: 'owner@example.com',
      orgName: 'Acme Org',
    });

    (intelligenceService.enrichFindings as jest.Mock).mockResolvedValue([]);

    await service.scan(
      { invoices: [{ vendor: 'Test Co', invoiceNo: 'INV-1', amount: 1000 }] },
      null,
      '127.0.0.1',
      undefined,
      { organizationId: 'org-1', skipFreeScanGate: true },
    );

    expect(emailSendSpy).not.toHaveBeenCalled();
  });

  it('email service throwing does NOT fail the scan (fail-soft)', async () => {
    const { service, emailSendSpy, intelligenceService } = makeService({
      email: 'owner@example.com',
      orgName: 'Acme Org',
    });

    emailSendSpy.mockRejectedValue(new Error('SMTP unavailable'));

    (intelligenceService.enrichFindings as jest.Mock).mockResolvedValue([
      { severity: 'critical', pattern: 'EXACT_DUPLICATE', detail: 'Dup', rows: ['INV-1'] },
    ]);

    await expect(
      service.scan(
        { invoices: [{ vendor: 'Test Co', invoiceNo: 'INV-1', amount: 1000 }] },
        null,
        '127.0.0.1',
        undefined,
        { organizationId: 'org-1', skipFreeScanGate: true },
      ),
    ).resolves.toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Issue #1 fix — chain-hashed ProofRecord on every scan
  // -------------------------------------------------------------------------

  it('mints a chain-hashed ProofRecord for the scan and returns proofId/chainHash', async () => {
    const { service, prisma, intelligenceService, verificationService, proofService } = makeService(
      null,
    );

    (intelligenceService.enrichFindings as jest.Mock).mockResolvedValue([
      {
        severity: 'critical',
        pattern: 'Bank account change (BANK_ACCOUNT_CHANGE)',
        detail: 'BEC alert',
        rows: ['INV-1'],
      },
    ]);

    const result = await service.scan(
      { invoices: [{ vendor: 'Test Co', invoiceNo: 'INV-1', amount: 1000 }] },
      null,
      '127.0.0.1',
      undefined,
      { organizationId: 'org-1', skipFreeScanGate: true },
    );

    // A VerificationRun is queued and driven QUEUED -> PROCESSING -> terminal
    // exactly like VerifyAPI's POST /api/verify pipeline (verify-api.controller.ts).
    expect(verificationService.queueVerification).toHaveBeenCalledWith(
      'org-1',
      'INVOICE_AUDIT',
      'API_PUSH',
      expect.any(String),
    );
    expect(verificationService.updateVerificationStatus).toHaveBeenNthCalledWith(
      1,
      'vrun-1',
      'org-1',
      'PROCESSING',
    );
    // Critical finding -> FAILED / REJECTED, mirroring computeRiskLevel's CRITICAL tier.
    expect(verificationService.updateVerificationStatus).toHaveBeenNthCalledWith(
      2,
      'vrun-1',
      'org-1',
      'FAILED',
      expect.objectContaining({ riskLevel: 'HIGH' }),
    );
    expect(proofService.createProof).toHaveBeenCalledWith(
      'org-1',
      'vrun-1',
      'INVOICE_AUDIT',
      'INVOICE',
      expect.any(String),
      expect.anything(),
      'REJECTED',
    );

    // The scan response surfaces the proof so a caller can independently
    // re-verify it later via GET /api/proof/:id/export/* the same way a
    // VerifyAPI proof is re-verifiable.
    expect(result.proofId).toBe('proof-xyz');
    expect(result.chainHash).toBe('abc123hash');
    expect(result.proofUnavailable).toBeUndefined();

    // Scan run is linked back to the proof it produced.
    expect(prisma.orgInvoiceScanRun.update).toHaveBeenCalledWith({
      where: { id: 'scan-abc' },
      data: { proofRecordId: 'proof-xyz' },
    });
  });

  it('degrades to proofUnavailable (never throws, never fabricates a proof id) when proof creation fails', async () => {
    const { service, intelligenceService, verificationService } = makeService(null);
    (verificationService.queueVerification as jest.Mock).mockRejectedValue(
      new Error('proof-chain DB unavailable'),
    );
    (intelligenceService.enrichFindings as jest.Mock).mockResolvedValue([]);

    const result = await service.scan(
      { invoices: [{ vendor: 'Test Co', invoiceNo: 'INV-1', amount: 1000 }] },
      null,
      '127.0.0.1',
      undefined,
      { organizationId: 'org-1', skipFreeScanGate: true },
    );

    // The core fraud-scan result still ships — a proof-chain hiccup must not
    // take the whole scan down.
    expect(result.scanId).toBe('scan-abc');
    expect(result.proofId).toBeNull();
    expect(result.chainHash).toBeNull();
    expect(result.proofUnavailable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PART 3 — Bank-review pattern-match bug fix
// ---------------------------------------------------------------------------

describe('InvoiceProofService.markVendorsForBankReview (Part 3 — pattern bug fix)', () => {
  function makeService() {
    const updatedStatuses: string[] = [];
    const prisma = {
      orgVendorMaster: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'vendor-1',
          source: 'MANUAL',
          status: 'ACTIVE',
        }),
        update: jest.fn().mockImplementation(async (args: {
          where: { id: string };
          data: { status: string };
        }) => {
          updatedStatuses.push(args.data.status);
          return { id: args.where.id, status: args.data.status };
        }),
      },
    };

    const service = new InvoiceProofService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    return { service, prisma, updatedStatuses };
  }

  it('flips vendor to REVIEW using proof-core emitted pattern (BANK_ACCOUNT_CHANGE in parens)', async () => {
    const { service, prisma, updatedStatuses } = makeService();

    // This is the EXACT string proof-core emits (line 674 of packages/proof-core/src/invoice-scan.ts)
    const findings = [
      {
        pattern: 'Bank account change (BANK_ACCOUNT_CHANGE)',
        severity: 'critical',
        rows: ['INV-1'],
        detail: 'BEC alert for Carolina Alloy Supply',
      },
    ];
    const rows = [{ invoiceNo: 'INV-1', vendor: 'Carolina Alloy Supply' }];

    await service.markVendorsForBankReview('org-1', findings, rows);

    // Before the fix this would have been empty (pattern === 'BANK_ACCOUNT_CHANGE_DETECTED' mismatch)
    expect(updatedStatuses).toContain('REVIEW');
    expect(prisma.orgVendorMaster.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'REVIEW' },
      }),
    );
  });

  it('also works with the legacy BANK_ACCOUNT_CHANGE_DETECTED pattern string', async () => {
    const { service, updatedStatuses } = makeService();

    const findings = [
      {
        pattern: 'BANK_ACCOUNT_CHANGE_DETECTED',
        severity: 'critical',
        rows: ['INV-2'],
        detail: 'BEC alert',
      },
    ];

    await service.markVendorsForBankReview('org-1', findings, [{ invoiceNo: 'INV-2', vendor: 'Acme' }]);

    expect(updatedStatuses).toContain('REVIEW');
  });

  it('does NOT flip vendor for an unrelated finding pattern', async () => {
    const { service, prisma } = makeService();

    const findings = [
      { pattern: 'MISSING_PO_REFERENCE', severity: 'high', rows: ['INV-1'], detail: 'No PO' },
    ];

    await service.markVendorsForBankReview('org-1', findings, [{ invoiceNo: 'INV-1', vendor: 'Acme' }]);

    expect(prisma.orgVendorMaster.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// PART 4 — PDF extraction confidence gates the OrgInvoiceHistory write
// (task-gate-history: low-confidence PDF-derived rows must not seed the
// per-org duplicate-detection history and cause false-positive findings on
// later, correctly extracted scans of the same invoice)
// ---------------------------------------------------------------------------

describe('InvoiceProofService.scanPdf — wiring to scan() by extraction confidence (Part 4a)', () => {
  function makeService(extractResult: unknown) {
    const prisma = { orgVendorMaster: { findFirst: jest.fn(), update: jest.fn() } };
    const pdfService = { extract: jest.fn().mockResolvedValue(extractResult) };
    const service = new InvoiceProofService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      pdfService as never,
      {} as never,
      {} as never,
    );
    return { service, pdfService };
  }

  it('TEXT_EXTRACTION_FAILED: never calls scan() — response still returned with scan: null', async () => {
    const { service } = makeService({
      ok: true,
      extraction: {
        status: 'TEXT_EXTRACTION_FAILED',
        confidence: 0,
        fields: {},
        warnings: ['No usable text layer found — likely a scanned/image-only PDF.'],
        pageCount: 1,
        charCount: 0,
      },
    });
    const scanSpy = jest.spyOn(service, 'scan');

    const result = await service.scanPdf(Buffer.from('%PDF-1.4 test'), null, '127.0.0.1');

    expect(scanSpy).not.toHaveBeenCalled();
    expect(result.status).toBe('TEXT_EXTRACTION_FAILED');
    expect(result.scan).toBeNull();
    expect(result.extraction).toBeTruthy();
  });

  it('NEEDS_REVIEW: never calls scan() — response is not dropped (status/message/extraction still returned)', async () => {
    const { service } = makeService({
      ok: true,
      extraction: {
        status: 'NEEDS_REVIEW',
        confidence: 0.5,
        fields: { vendor: 'Acme', amount: 100 },
        warnings: ['Could not confidently extract: invoice number. Review before scanning.'],
        pageCount: 1,
        charCount: 60,
      },
    });
    const scanSpy = jest.spyOn(service, 'scan');

    const result = await service.scanPdf(Buffer.from('%PDF-1.4 test'), null, '127.0.0.1');

    // Never calls scan() — preserves the existing "does NOT consume a free scan" contract.
    expect(scanSpy).not.toHaveBeenCalled();
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.ok).toBe(true);
    expect(result.scan).toBeNull();
    expect(result.extraction).toBeTruthy();
    expect(result.message).toBeTruthy();
  });

  // extractInvoiceFieldsFromText (packages/proof-core/src/invoice-pdf-extract.ts)
  // only ever produces status:'OK' at exactly ONE of two confidences: 0.9 when
  // the vendor came from an explicit label, or 0.78 when it was inferred from
  // letterhead. These two tests use those real values — NOT an arbitrary
  // mid-range number the extractor can never actually return — so the gate is
  // proven against production behavior instead of an impossible mock state.
  it('OK, vendor explicitly labelled (confidence 0.9, >= 0.85 threshold): calls scan() WITHOUT skipHistoryWrite — history persisted', async () => {
    const { service } = makeService({
      ok: true,
      extraction: {
        status: 'OK',
        confidence: 0.9,
        fields: { vendor: 'Acme', invoiceNo: 'INV-1', amount: 100 },
        warnings: [],
        pageCount: 1,
        charCount: 200,
      },
    });
    const scanSpy = jest.spyOn(service, 'scan').mockResolvedValue({ scanId: 'scan-1' } as never);

    const result = await service.scanPdf(Buffer.from('%PDF-1.4 test'), null, '127.0.0.1');

    expect(scanSpy).toHaveBeenCalledTimes(1);
    const optionsArg = scanSpy.mock.calls[0][4];
    expect(optionsArg).toBeUndefined();
    expect(result.status).toBe('SCANNED');
  });

  it('OK, vendor inferred from letterhead (confidence 0.78, < 0.85 threshold): calls scan() WITH skipHistoryWrite — history skipped, note surfaced', async () => {
    const { service } = makeService({
      ok: true,
      extraction: {
        status: 'OK',
        confidence: 0.78,
        fields: { vendor: 'Acme', invoiceNo: 'INV-1', amount: 100 },
        warnings: ['Vendor inferred from document letterhead — verify before approving.'],
        pageCount: 1,
        charCount: 200,
      },
    });
    const scanSpy = jest.spyOn(service, 'scan').mockResolvedValue({
      scanId: 'scan-1',
      historySkipped: true,
      historySkippedReason: 'PDF extraction confidence 0.78 is below the 0.85 history threshold',
    } as never);

    const result = await service.scanPdf(Buffer.from('%PDF-1.4 test'), null, '127.0.0.1');

    expect(scanSpy).toHaveBeenCalledTimes(1);
    const optionsArg = scanSpy.mock.calls[0][4] as
      | { skipHistoryWrite?: boolean; historySkippedReason?: string }
      | undefined;
    expect(optionsArg?.skipHistoryWrite).toBe(true);
    expect(optionsArg?.historySkippedReason).toContain('0.78');
    expect(result.status).toBe('SCANNED');
    expect((result.scan as { historySkipped?: boolean } | null)?.historySkipped).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Work Item 1 (OCR intake) — scanPdf()'s OCR-aware NEEDS_REVIEW branch.
//
// Digital-text NEEDS_REVIEW (no extraction_method / extraction_method:
// 'digital_text') keeps its EXACT pre-existing behavior: never calls scan(),
// per the two tests above this block (unmodified — this is the regression
// guard that Work Item 1 must not touch that path).
//
// OCR NEEDS_REVIEW is different on purpose: the "needs review" status is a
// signal that a human should double-check the EXTRACTED FIELDS, not a reason
// to withhold the fraud engine's own findings from that human — so when a
// fraud-relevant field (amount / bank routing / account) was actually
// extracted, scan() still runs (with skipHistoryWrite, same as the
// low-confidence-OK gate above) so BANK_ACCOUNT_CHANGE_DETECTED etc. get a
// real chance to fire on OCR-sourced data.
// ---------------------------------------------------------------------------
describe('InvoiceProofService.scanPdf — OCR-aware NEEDS_REVIEW branch (Work Item 1)', () => {
  function makeService(extractResult: unknown) {
    const prisma = { orgVendorMaster: { findFirst: jest.fn(), update: jest.fn() } };
    const pdfService = { extract: jest.fn().mockResolvedValue(extractResult) };
    const service = new InvoiceProofService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      pdfService as never,
    );
    return { service, pdfService };
  }

  it('digital-text NEEDS_REVIEW (no extraction_method) is completely unaffected — still never calls scan()', async () => {
    const { service } = makeService({
      ok: true,
      extraction: {
        status: 'NEEDS_REVIEW',
        confidence: 0.5,
        fields: { vendor: 'Acme', amount: 100 },
        warnings: ['Could not confidently extract: invoice number. Review before scanning.'],
        pageCount: 1,
        charCount: 60,
        // no extraction_method — matches every pre-Work-Item-1 caller/fixture
      },
    });
    const scanSpy = jest.spyOn(service, 'scan');

    const result = await service.scanPdf(Buffer.from('%PDF-1.4 test'), null, '127.0.0.1');

    expect(scanSpy).not.toHaveBeenCalled();
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.scan).toBeNull();
  });

  it('digital-text NEEDS_REVIEW explicitly tagged extraction_method:"digital_text" also never calls scan()', async () => {
    const { service } = makeService({
      ok: true,
      extraction: {
        status: 'NEEDS_REVIEW',
        confidence: 0.5,
        fields: { vendor: 'Acme', amount: 100 },
        warnings: [],
        pageCount: 1,
        charCount: 60,
        extraction_method: 'digital_text',
      },
    });
    const scanSpy = jest.spyOn(service, 'scan');

    const result = await service.scanPdf(Buffer.from('%PDF-1.4 test'), null, '127.0.0.1');

    expect(scanSpy).not.toHaveBeenCalled();
    expect(result.scan).toBeNull();
  });

  it('OCR NEEDS_REVIEW WITH a fraud-relevant field (amount) DOES call scan() — findings must not be withheld', async () => {
    const { service } = makeService({
      ok: true,
      extraction: {
        status: 'NEEDS_REVIEW',
        confidence: 0.6,
        fields: { vendor: 'Acme', invoiceNo: 'INV-1', amount: 3200, bankRouting: '999999999' },
        warnings: ['A bank/routing number, account number, or total amount on this proof was read via OCR.'],
        pageCount: 1,
        charCount: 180,
        extraction_method: 'ocr',
      },
    });
    const scanSpy = jest.spyOn(service, 'scan').mockResolvedValue({
      scanId: 'scan-ocr-1',
      findings: [{ pattern: 'Bank account change (BANK_ACCOUNT_CHANGE)', severity: 'critical' }],
    } as never);

    const result = await service.scanPdf(Buffer.from('%PDF-1.4 test'), null, '127.0.0.1');

    expect(scanSpy).toHaveBeenCalledTimes(1);
    const optionsArg = scanSpy.mock.calls[0][4] as
      | { skipHistoryWrite?: boolean; historySkippedReason?: string }
      | undefined;
    // History is still skipped for OCR-derived data, same conservative
    // reasoning as the low-confidence-OK gate above — never seed the org's
    // duplicate-detection baseline off a possible OCR misread.
    expect(optionsArg?.skipHistoryWrite).toBe(true);
    // Status is NEVER silently promoted past NEEDS_REVIEW just because scan() ran.
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.scan).not.toBeNull();
    expect(
      (result.scan as { findings: Array<{ pattern: string }> }).findings.some((f) =>
        f.pattern.includes('BANK_ACCOUNT_CHANGE'),
      ),
    ).toBe(true);
  });

  it('OCR NEEDS_REVIEW WITHOUT any fraud-relevant field does NOT call scan() — nothing useful to evaluate', async () => {
    const { service } = makeService({
      ok: true,
      extraction: {
        status: 'NEEDS_REVIEW',
        confidence: 0.3,
        fields: { vendor: 'Acme' },
        warnings: ['OCR engine confidence (40/100) is below the 60 review threshold.'],
        pageCount: 1,
        charCount: 90,
        extraction_method: 'ocr',
      },
    });
    const scanSpy = jest.spyOn(service, 'scan');

    const result = await service.scanPdf(Buffer.from('%PDF-1.4 test'), null, '127.0.0.1');

    expect(scanSpy).not.toHaveBeenCalled();
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.scan).toBeNull();
  });
});

describe('InvoiceProofService.scan — OrgInvoiceHistory write respects skipHistoryWrite (Part 4b)', () => {
  function makeScanService() {
    const historyCreateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      proofProductEntitlement: { findFirst: jest.fn().mockResolvedValue(null) },
      proofFreeScan: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
      orgVendorMaster: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
      orgPoRegister: { findMany: jest.fn().mockResolvedValue([]) },
      orgInvoiceHistory: { findMany: jest.fn().mockResolvedValue([]), createMany: historyCreateMany },
      orgInvoiceScanRun: { create: jest.fn().mockResolvedValue({ id: 'scan-run-1' }) },
      scanFindingApproval: { createMany: jest.fn() },
      organization: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const intelligenceService = {
      enrichFindings: jest.fn().mockResolvedValue([]),
      reportConsortiumSignals: jest.fn().mockResolvedValue(undefined),
    };
    const service = new InvoiceProofService(
      prisma as never,
      {} as never,
      intelligenceService as never,
      { sendInvoiceProofReviewAlert: jest.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, prisma, historyCreateMany };
  }

  it('persists to OrgInvoiceHistory when skipHistoryWrite is not set (JSON scan path — unchanged)', async () => {
    const { service, historyCreateMany } = makeScanService();

    const result = await service.scan(
      { invoices: [{ vendor: 'Acme', invoiceNo: 'INV-1', amount: 500 }] },
      null,
      '127.0.0.1',
      undefined,
      { organizationId: 'org-1', skipFreeScanGate: true },
    );

    expect(historyCreateMany).toHaveBeenCalledTimes(1);
    expect(result.retained).toBe(true);
    expect((result as { historySkipped?: boolean }).historySkipped).toBeUndefined();
  });

  it('skips the OrgInvoiceHistory persist and surfaces a note when skipHistoryWrite is set', async () => {
    const { service, historyCreateMany } = makeScanService();

    const result = await service.scan(
      { invoices: [{ vendor: 'Acme', invoiceNo: 'INV-1', amount: 500 }] },
      null,
      '127.0.0.1',
      undefined,
      {
        organizationId: 'org-1',
        skipFreeScanGate: true,
        skipHistoryWrite: true,
        historySkippedReason: 'low-confidence PDF extraction',
      },
    );

    expect(historyCreateMany).not.toHaveBeenCalled();
    expect(result.retained).toBe(false);
    expect((result as { historySkipped?: boolean }).historySkipped).toBe(true);
    expect((result as { historySkippedReason?: string }).historySkippedReason).toBe(
      'low-confidence PDF extraction',
    );
    // The fraud scan itself is still fully computed and returned to the caller —
    // only the history write is skipped.
    expect(result.scanId).toBe('scan-run-1');
    expect(result).toHaveProperty('findings');
  });
});
