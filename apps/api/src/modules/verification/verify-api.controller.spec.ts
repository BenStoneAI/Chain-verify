import 'reflect-metadata';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

jest.mock('@agent-market/config', () => ({
  verifyApiPlanConfigs: [
    {
      slug: 'free',
      monthlyRuns: 10,
      overageCents: null,
      retentionDays: 7,
    },
  ],
}));

import { IS_PUBLIC_KEY } from '../auth/decorators/public.decorator.js';
import {
  invoiceProofDashboardFields,
  VerifyApiController,
  verifyApiRuleTestHooks as _testHooks,
} from './verify-api.controller.js';

// verifyApiRuleTestHooks is undefined in production (NODE_ENV=production) but
// always defined in test runs. Assert non-null so TypeScript is satisfied
// without spreading undefined checks through every test assertion.
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
const verifyApiRuleTestHooks = _testHooks!;

function loadVerifyApiFixtureScenario(name: string): { input: { output: Record<string, unknown> } } {
  const candidates = [
    resolve(process.cwd(), 'testing/proof-products/verifyapi.fixture.json'),
    resolve(process.cwd(), '../../testing/proof-products/verifyapi.fixture.json'),
  ];
  const file = candidates.find((candidate) => existsSync(candidate));
  if (!file) throw new Error('Unable to locate testing/proof-products/verifyapi.fixture.json');
  const fixture = JSON.parse(readFileSync(file, 'utf8')) as {
    scenarios: Array<{ name: string; input: { output: Record<string, unknown> } }>;
  };
  const scenario = fixture.scenarios.find((item) => item.name === name);
  if (!scenario) throw new Error(`VerifyAPI fixture scenario not found: ${name}`);
  return scenario;
}

describe('VerifyApiController public proof endpoints', () => {
  it.each([['exportProofAsPdf'], ['exportProofAsJson'], ['listPublicProofs']] as const)(
    'marks %s as public so anonymous proof access can use org scoping',
    (method) => {
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, VerifyApiController.prototype[method])).toBe(true);
    },
  );
});

describe('InvoiceProof legacy dashboard record mapping', () => {
  it('normalizes UNKNOWN risk and exposes a stable issue count', () => {
    expect(invoiceProofDashboardFields('UNKNOWN', null)).toEqual({
      riskLevel: 'LOW',
      risk_level: 'low',
      issuesFound: 0,
    });
    expect(invoiceProofDashboardFields('HIGH', [{ rule: 'duplicate' }])).toEqual({
      riskLevel: 'HIGH',
      risk_level: 'high',
      issuesFound: 1,
    });
  });
});

describe('VerifyApiController rule detectors', () => {
  beforeEach(() => {
    verifyApiRuleTestHooks.demoIpCounters.clear();
  });

  it('flags PII leaks while allowing legitimate invoice contact fields', () => {
    expect(
      verifyApiRuleTestHooks.detectPiiLeak({
        summary: 'Tenant Alex Reed can be reached at alex.reed@example.com or 555-555-0199.',
      }),
    ).toEqual([
      expect.objectContaining({
        rule: 'pii_leak_detected',
        severity: 'critical',
      }),
    ]);

    expect(
      verifyApiRuleTestHooks.detectPiiLeak({
        vendor_email: 'ap@harperlane.com',
        invoice_number: 'INV-123-45-6789',
      }),
    ).toEqual([]);
  });

  // PRB-PII-FP: business_document_mode allows vendor contact data in B2B invoices.
  it('business_document_mode — passes vendor invoice with phone/email/address, blocks SSN', () => {
    // A typical B2B vendor invoice: contact info in body text should NOT be blocked.
    expect(
      verifyApiRuleTestHooks.detectPiiLeak({
        business_document_mode: true,
        vendor_name: 'Acme Supplies Inc.',
        vendor_address: '123 Commerce Blvd, Suite 400, Chicago IL 60601',
        vendor_phone: '+1 312-555-0178',
        vendor_email: 'ap@acmesupplies.com',
        invoice_number: 'INV-2026-00441',
        summary:
          'Invoice from Acme Supplies Inc. Contact AP team at ap@acmesupplies.com or (312) 555-0178 for payment questions.',
      }),
    ).toEqual([]);

    // SSN in a business document is still blocked in business_document_mode.
    expect(
      verifyApiRuleTestHooks.detectPiiLeak({
        business_document_mode: true,
        summary: 'Employee SSN on file: 123-45-6789.',
      }),
    ).toEqual([
      expect.objectContaining({
        rule: 'pii_leak_detected',
        severity: 'critical',
      }),
    ]);

    // Credit card number is blocked in business_document_mode.
    expect(
      verifyApiRuleTestHooks.detectPiiLeak({
        business_document_mode: true,
        summary: 'Payment processed on card 4111-1111-1111-1111.',
      }),
    ).toEqual([
      expect.objectContaining({
        rule: 'pii_leak_detected',
        severity: 'critical',
      }),
    ]);
  });

  it('detects hallucinated citations without prefix substring false passes', () => {
    expect(
      verifyApiRuleTestHooks.detectHallucinatedCitations(
        { summary: 'Approved under section 1.2.' },
        ['Section 1.22 governs payments.'],
      ),
    ).toEqual([
      expect.objectContaining({
        rule: 'hallucinated_citation',
        severity: 'critical',
      }),
    ]);

    expect(
      verifyApiRuleTestHooks.detectHallucinatedCitations(
        { summary: 'Approved under Section 4 and §4.2.7.' },
        ['Section 4 covers approvals. Policy §4.2.7 covers payment review.'],
      ),
    ).toEqual([]);
  });

  it('returns concrete amount mismatch reasoning from string evidence', () => {
    expect(
      verifyApiRuleTestHooks.evaluateEvidenceConsistency({ amount_total: 52000 }, [
        'invoice:INV-T007 expected total 38900',
      ]),
    ).toEqual([
      expect.objectContaining({
        rule: 'evidence_total_mismatch',
        severity: 'critical',
        message: 'AMOUNT_MISMATCH — stated total $52,000 does not match evidence total $38,900.',
      }),
    ]);
  });

  it('blocks AUD-T003 critical bank-change with human approval required', () => {
    // AUD-T003 fixture shape (Vendor Risk After Bank Change, critical, approval required).
    expect(
      verifyApiRuleTestHooks.detectCriticalBankChange(
        {
          workflow_name: 'Vendor Risk After Bank Change',
          business_risk: 'critical',
          human_approval_required: true,
        },
        'workflow_event',
        [],
      ),
    ).toBe(true);
  });

  it('does not block low/medium-risk non-bank events', () => {
    // AUD-T001 (low, no bank change) and AUD-T002 (medium, no bank change).
    expect(
      verifyApiRuleTestHooks.detectCriticalBankChange(
        {
          workflow_name: 'Global Vendor Activity Summary',
          business_risk: 'low',
          human_approval_required: false,
        },
        'workflow_event',
        [],
      ),
    ).toBe(false);
    expect(
      verifyApiRuleTestHooks.detectCriticalBankChange(
        {
          workflow_name: 'Invoice Approval Recommendation',
          business_risk: 'medium',
          human_approval_required: false,
        },
        'workflow_event',
        [],
      ),
    ).toBe(false);
    // A bank change at LOW risk without approval must NOT block.
    expect(
      verifyApiRuleTestHooks.detectCriticalBankChange(
        {
          workflow_name: 'Routine Bank Detail Refresh',
          business_risk: 'low',
          human_approval_required: false,
        },
        'workflow_event',
        [],
      ),
    ).toBe(false);
  });

  it('blocks when a bank_detail_changes critical rule already fired', () => {
    expect(
      verifyApiRuleTestHooks.detectCriticalBankChange(
        { business_risk: 'high', human_approval_required: true },
        'invoice_extraction',
        [{ rule: 'bank_detail_changes', severity: 'critical', message: 'differs' }],
      ),
    ).toBe(true);
  });

  it('uses warning severity for invoice bank detail changes (needs_review parity)', () => {
    const issue = verifyApiRuleTestHooks.evaluateStringRule(
      'bank_detail_changes',
      { bank_or_payment_details: 'IBAN NEW' },
      [{ prior_bank_or_payment_details: 'IBAN OLD', vendor_master_bank_details: 'IBAN OLD' }],
      'invoice_extraction',
    );
    expect(issue).toEqual(
      expect.objectContaining({
        rule: 'bank_detail_changes',
        severity: 'warning',
      }),
    );
  });

  it('does not flag valid invoice bank details when routing and account tokens match', () => {
    expect(
      verifyApiRuleTestHooks.evaluateStringRule(
        'bank_detail_changes',
        {
          bank_or_payment_details:
            'ACH Routing 021000021 Account ending 8842 Remit to Blue Harbor Supply',
        },
        [
          {
            prior_bank_or_payment_details:
              'Prior paid invoices used Routing 021000021, Account x8842, terms net 30.',
            vendor_master_bank_details:
              'Approved payment rails: routing 021000021, account ending 8842.',
          },
        ],
        'invoice_extraction',
      ),
    ).toBeNull();
  });

  it('detects duplicate and modified duplicate invoices from payment-register evidence', () => {
    expect(
      verifyApiRuleTestHooks.evaluateInvoiceEvidence(
        {
          invoice_number: 'INV-ALPHA-2409',
          amount_total: 12450,
        },
        [
          {
            payment_register_status: 'paid',
            prior_invoice_number: 'INV-ALPHA-2409',
            paid_amount: 12450,
          },
        ],
      ),
    ).toEqual([
      expect.objectContaining({
        rule: 'duplicate_invoice_check',
        severity: 'critical',
      }),
    ]);

    expect(
      verifyApiRuleTestHooks.evaluateInvoiceEvidence(
        {
          invoice_number: 'INV-BETA-2410',
          amount_total: 12890,
        },
        [
          {
            duplicate_status: 'paid',
            duplicate_invoice_number: 'INV-BETA-2410',
            duplicate_amount: 12450,
          },
        ],
      ),
    ).toEqual([
      expect.objectContaining({
        rule: 'modified_duplicate_invoice',
        severity: 'critical',
      }),
    ]);
  });

  it('detects generic invoice red flags from structured vendor evidence', () => {
    const issues = verifyApiRuleTestHooks.evaluateInvoiceEvidence(
      {
        vendor_name: 'Blue Harbor Supply',
        invoice_number: 'INV-BH-1027',
        amount_total: 25000,
        sender_domain: 'billing-blueharbor.example',
        invoice_quantity: 4,
        remit_address: 'PO Box 4400, Example City, NY',
      },
      [
        {
          approved_domain: 'blueharbor.example',
          approval_limit: 10000,
          po_quantity: 3,
          vendor_status: 'pending',
          missing_compliance_docs: ['insurance certificate', 'tax form'],
          approved_remit_address: '100 Market Street, Example City, NY',
          urgent_payment_requested: true,
        },
      ],
    );

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: 'lookalike_domain_vendor', severity: 'critical' }),
        expect.objectContaining({ rule: 'approval_authority_mismatch', severity: 'high' }),
        expect.objectContaining({ rule: 'po_quantity_exceeded', severity: 'high' }),
        expect.objectContaining({ rule: 'vendor_compliance_missing', severity: 'high' }),
        expect.objectContaining({ rule: 'vendor_address_mismatch', severity: 'critical' }),
        expect.objectContaining({ rule: 'urgency_pressure', severity: 'critical' }),
      ]),
    );
  });

  it('detects generic invoice red flags from a second vendor evidence set', () => {
    const issues = verifyApiRuleTestHooks.evaluateInvoiceEvidence(
      {
        vendor_name: 'MetroParts Services',
        invoice_number: 'INV-MP-7781',
        amount_total: 7800,
      },
      [
        {
          sender_domain: 'pay-metroparts.example',
          approved_domain: 'metroparts.example',
          approval_authorized: false,
          compliance_status: 'non-compliant',
        },
      ],
    );

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: 'lookalike_domain_vendor', severity: 'critical' }),
        expect.objectContaining({ rule: 'approval_authority_mismatch', severity: 'high' }),
        expect.objectContaining({ rule: 'vendor_compliance_missing', severity: 'high' }),
      ]),
    );
  });

  it('accepts clean software-delivery documents and fails generic bad delivery documents', () => {
    expect(
      verifyApiRuleTestHooks.evaluateSoftwareDeliveryDocuments({
        required_deployment_target: 'production',
        deployment_target: 'production',
        required_sync_direction: 'bidirectional',
        sync_direction: 'bidirectional',
        required_api_version: 'v3.2',
        delivered_api_version: 'v3.2',
        approved_auth_method: 'OAuth2',
        delivered_auth_method: 'OAuth2',
        requirements: [
          { name: 'maintenance hold flag', status: 'passed' },
          { name: 'audit trail', status: 'passed' },
        ],
        rollback_plan_provided: true,
        open_defect_count: 0,
      }),
    ).toEqual([]);

    const issues = verifyApiRuleTestHooks.evaluateSoftwareDeliveryDocuments({
      required_deployment_target: 'production',
      deployment_target: 'staging',
      required_sync_direction: 'bidirectional',
      sync_direction: 'one-way',
      required_api_version: 'v3.2',
      delivered_api_version: 'v2.9',
      approved_auth_method: 'OAuth2',
      delivered_auth_method: 'API key',
      auth_change_approved: false,
      requirements: [
        { name: 'maintenance hold flag', status: 'not implemented' },
        { name: 'audit trail', status: 'missing' },
      ],
      open_defects: [{ severity: 'P2', status: 'open' }],
      full_payment_requested: true,
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: 'staging_not_production', severity: 'critical' }),
        expect.objectContaining({ rule: 'sync_direction_mismatch', severity: 'critical' }),
        expect.objectContaining({ rule: 'version_mismatch', severity: 'critical' }),
        expect.objectContaining({ rule: 'unauthorized_auth_scope_change', severity: 'critical' }),
        expect.objectContaining({ rule: 'fleet_hold_missing', severity: 'critical' }),
        expect.objectContaining({ rule: 'audit_trail_missing', severity: 'critical' }),
        expect.objectContaining({ rule: 'open_p2_defect', severity: 'critical' }),
        expect.objectContaining({
          rule: 'full_payment_incomplete_delivery',
          severity: 'critical',
        }),
      ]),
    );
  });

  it('downgrades AI approval-only audit issues to warning so audit-b stays needs_review', () => {
    expect(
      verifyApiRuleTestHooks.normalizeAiIssueSeverityForTask(
        'audit_proof',
        { human_approval_required: true, business_risk: 'high' },
        [],
        {
          rule: 'human_approval_required',
          severity: 'critical',
          message: 'No human approver recorded despite approval being required.',
        },
      ),
    ).toEqual(
      expect.objectContaining({
        rule: 'human_approval_required',
        severity: 'warning',
      }),
    );
  });

  it('ignores unsupported AI invoice amount anomalies without prior amount evidence', () => {
    expect(
      verifyApiRuleTestHooks.normalizeAiIssueSeverityForTask(
        'invoice_extraction',
        { amount_total: 12450 },
        [{ prior_bank_or_payment_details: 'Routing 021000021' }],
        {
          rule: 'amount_anomaly',
          severity: 'critical',
          message: 'Invoice amount exceeds 3x previous amounts for this vendor.',
        },
      ),
    ).toBeNull();

    expect(
      verifyApiRuleTestHooks.normalizeAiIssueSeverityForTask(
        'invoice_extraction',
        { amount_total: 52000 },
        ['expected total 38900'],
        {
          rule: 'amount_anomaly',
          severity: 'critical',
          message: 'Invoice amount exceeds prior invoice total.',
        },
      ),
    ).toEqual(
      expect.objectContaining({
        rule: 'amount_anomaly',
        severity: 'critical',
      }),
    );
  });

  it('increments anonymous demo usage before verification work can race past the limit', () => {
    const ip = '203.0.113.10';
    expect(verifyApiRuleTestHooks.getDemoIpUsage(ip).used).toBe(0);
    expect(verifyApiRuleTestHooks.incrementDemoIpUsage(ip).used).toBe(1);
    expect(verifyApiRuleTestHooks.incrementDemoIpUsage(ip).used).toBe(2);
    expect(verifyApiRuleTestHooks.getDemoIpUsage(ip).used).toBe(2);
  });
});

describe('VerifyApiController software_delivery retrieval fallback', () => {
  function makeController(findUnique: jest.Mock) {
    const prisma = {
      softwareDeliveryVerification: { findUnique },
    };
    return new VerifyApiController(
      {} as never, // verificationService
      {} as never, // proofService
      prisma as never,
      {} as never, // conduitVerification
      {} as never, // proofBilling
      {} as never, // proofClaim
      {} as never, // aiAnalysis
      {} as never, // softwareDelivery
      {} as never, // verifyApiUsage
    );
  }

  const sdRecord = {
    proofId: 'sdv_proof_xyz',
    overallStatus: 'NEEDS_REVIEW',
    tier: 'STANDARD',
    jobType: 'DEPLOY_UPDATE',
    escalated: true,
    escalationReason: 'Auto-escalated to Standard: sensitive keywords detected',
    buyerSummary: '3 of 7 checks passed. 0 failed, 1 warnings.',
    checksPassed: 3,
    checksFailed: 0,
    checksWarning: 1,
    checksSkipped: 2,
    results: [
      {
        checkId: 'S10',
        checkName: 'Deploy platform',
        status: 'SKIP',
        detail: 'RAILWAY not enabled',
        durationMs: 1,
        evidence: null,
      },
      {
        checkId: 'B1',
        checkName: 'Work exists',
        status: 'PASS',
        detail: null,
        durationMs: 5,
        evidence: null,
      },
    ],
  };

  it('GET /api/verify/:id returns the software_delivery record by proofId', async () => {
    const findUnique = jest.fn().mockResolvedValue(sdRecord);
    const controller = makeController(findUnique);
    const res = await controller.getVerify('sdv_proof_xyz', null);
    expect(findUnique).toHaveBeenCalledWith({
      where: { proofId: 'sdv_proof_xyz' },
      include: { results: true },
    });
    expect(res).toMatchObject({
      proof_id: 'sdv_proof_xyz',
      verification_status: 'needs-review',
      tier_run: 'STANDARD',
      job_type: 'DEPLOY_UPDATE',
      escalated: true,
      recommended_action: 'human_review',
    });
    expect(Array.isArray((res as { results: unknown[] }).results)).toBe(true);
  });

  // C2/H3 hardening: an unauthenticated (non-owning) caller must receive the SD
  // report in REDACTED form — proof_id + status are returned, but buyer_summary
  // (buyer free text) is withheld. (Owner-gets-buyer_summary is covered in
  // proof-phase8.spec.ts "Software-delivery redaction".) This test previously
  // asserted buyer_summary was returned to a null caller — that was the leak.
  it('GET /api/proof/:id returns a REDACTED software_delivery report to a non-owner (no buyer_summary leak)', async () => {
    const findUnique = jest.fn().mockResolvedValue(sdRecord);
    const controller = makeController(findUnique);
    const res = (await controller.getProof('sdv_proof_xyz', null)) as {
      buyer_summary?: string;
      proof_id?: string;
      redacted?: boolean;
    };
    expect(res.proof_id).toBe('sdv_proof_xyz');
    expect(res.redacted).toBe(true);
    // buyer_summary must NOT leak to a non-owner.
    expect(res.buyer_summary === '' || res.buyer_summary === undefined).toBe(true);
  });
});

describe('VerifyApiController chain_hash in software_delivery responses', () => {
  const validSdOutput = {
    repoOwner: 'acme',
    repoName: 'api',
    beforeSha: 'abc123',
    afterSha: 'def456',
    jobStartedAt: '2024-01-01T00:00:00.000Z',
    tier: 'BASIC',
    jobType: 'DEPLOY_UPDATE',
  };

  const defaultSdResult = {
    verificationId: 'vid_001',
    proofId: 'sdv_proof_001',
    verificationStatus: 'passed',
    confidence: 0.9,
    tierRun: 'BASIC',
    jobType: 'DEPLOY_UPDATE',
    escalated: false,
    escalationReason: null,
    summary: '7 of 7 checks passed.',
    checksPassed: 7,
    checksFailed: 0,
    checksWarning: 0,
    checksSkipped: 0,
    checksRun: 7,
    issuesFound: [],
    recommendedAction: 'approved',
    results: [],
  };

  function makeSdController(overrides: Partial<typeof defaultSdResult> = {}) {
    const sdResult = { ...defaultSdResult, ...overrides };
    const softwareDelivery = { verify: jest.fn().mockResolvedValue(sdResult) };
    const proofBilling = {
      resolveProofQuota: jest.fn().mockResolvedValue({ source: 'free', monthlyLimit: null }),
      getActiveProofEntitlement: jest.fn().mockResolvedValue(null),
    };
    const verifyApiUsage = { reserve: jest.fn().mockResolvedValue(undefined) };
    const prisma = {
      softwareDeliveryVerification: { findUnique: jest.fn() },
      organizationMembership: { findMany: jest.fn().mockResolvedValue([]) },
      organizationSubscription: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const controller = new VerifyApiController(
      {} as never, // verificationService
      {} as never, // proofService
      prisma as never,
      {} as never, // conduitVerification
      proofBilling as never,
      {} as never, // proofClaim
      {} as never, // aiAnalysis
      softwareDelivery as never,
      verifyApiUsage as never,
    );
    const user = { id: 'user_001', organizationId: 'org_001' } as never;
    return {
      run: () =>
        controller.verify(
          { source_type: 'software_delivery', output: validSdOutput },
          user,
        ) as Promise<Record<string, unknown>>,
    };
  }

  it('software_delivery response includes a valid SHA-256 chain_hash', async () => {
    const { run } = makeSdController();
    const result = await run();
    expect(result.chain_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('software_delivery risk_level is low when confidence is 0.90', async () => {
    const { run } = makeSdController({ confidence: 0.9 });
    const result = await run();
    expect(result.risk_level).toBe('low');
  });

  it('software_delivery risk_level is medium when confidence is 0.6', async () => {
    const { run } = makeSdController({ confidence: 0.6 });
    const result = await run();
    expect(result.risk_level).toBe('medium');
  });

  it('software_delivery risk_level is high when confidence is 0.3', async () => {
    const { run } = makeSdController({ confidence: 0.3 });
    const result = await run();
    expect(result.risk_level).toBe('high');
  });
});

describe('VerifyApiController document-based software_delivery proof-core path', () => {
  beforeEach(() => {
    verifyApiRuleTestHooks.demoIpCounters.clear();
  });

  function makeDocumentController() {
    const verificationService = {
      queueVerification: jest.fn().mockResolvedValue({ id: 'run_doc_001' }),
      updateVerificationStatus: jest.fn().mockResolvedValue(undefined),
    };
    const proofService = {
      createProof: jest.fn().mockResolvedValue({
        id: 'proof_doc_001',
        chain_hash: 'abc123',
      }),
    };
    const controller = new VerifyApiController(
      verificationService as never,
      proofService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const req = { headers: {}, ip: '203.0.113.22' } as never;
    return {
      run: (output: unknown) =>
        controller.verifyDemo({ source_type: 'software_delivery', output }, req) as Promise<
          Record<string, unknown>
        >,
      runAuthed: (output: unknown) =>
        controller.verify(
          { source_type: 'software_delivery', output },
          { id: 'user_doc_001', organizationId: 'org_doc_001' } as never,
        ) as Promise<Record<string, unknown>>,
    };
  }

  it('bad nested delivery returns low confidence and VR-C failures on the live controller path', async () => {
    const { run } = makeDocumentController();
    const result = await run({
      contract_scope: {
        requirements: [
          {
            id: 'VR-REQ-1',
            contractedDeploymentTarget: 'production',
            contractedVersion: '2.3.0',
            requiresBidirectionalSync: true,
          },
        ],
      },
      delivery: {
        deployment: { target: 'staging', environment: 'staging' },
        requirements_traceability: [
          {
            requirementId: 'VR-REQ-1',
            status: 'partial',
            contractedVersion: '2.3.0',
            deliveredVersion: '2.1.0',
          },
        ],
        defects: [{ id: 'BH-447', severity: 'P2', status: 'open' }],
      },
    });

    expect(result.confidence as number).toBeLessThanOrEqual(0.3);
    expect(['failed', 'needs_review']).toContain(result.status);
    expect(result.controls).toEqual(
      expect.objectContaining({
        failed: expect.arrayContaining(['VR-C1', 'VR-C2', 'VR-C5']),
      }),
    );
  });

  it('clean nested delivery passes with high confidence on the live controller path', async () => {
    const { run } = makeDocumentController();
    const result = await run({
      contract_scope: {
        requirements: [
          {
            id: 'VR-REQ-1',
            contractedDeploymentTarget: 'production',
            contractedVersion: '2.3.0',
            requiresBidirectionalSync: true,
          },
        ],
      },
      delivery: {
        deployment: { target: 'production', environment: 'production' },
        requirements_traceability: [
          {
            requirementId: 'VR-REQ-1',
            status: 'delivered',
            contractedVersion: '2.3.0',
            deliveredVersion: '2.3.0',
          },
        ],
        sync: { direction: 'bidirectional' },
        auth: { method: 'oauth2' },
        defects: [],
        rollback_plan_provided: true,
      },
    });

    expect(result.status).toBe('passed');
    expect(result.confidence as number).toBeGreaterThanOrEqual(0.8);
    expect(result.controls).toEqual(
      expect.objectContaining({
        failed: [],
      }),
    );
  });

  it('false-positive fixture passes on the demo path despite staging rollback/test wording', async () => {
    const { run } = makeDocumentController();
    const scenario = loadVerifyApiFixtureScenario('false-positive-guard');
    const result = await run(scenario.input.output);

    expect(['failed', 'blocked']).not.toContain(result.status);
    expect(result.status).toBe('passed');
    expect(result.confidence as number).toBeGreaterThanOrEqual(0.55);
    expect(result.controls).toEqual(
      expect.objectContaining({
        failed: [],
      }),
    );
    expect(result.issues_found).toEqual([]);
  });

  it('false-positive fixture passes on the authenticated path despite staging rollback/test wording', async () => {
    const { runAuthed } = makeDocumentController();
    const scenario = loadVerifyApiFixtureScenario('false-positive-guard');
    const result = await runAuthed(scenario.input.output);

    expect(['failed', 'blocked']).not.toContain(result.status);
    expect(result.status).toBe('passed');
    expect(result.confidence as number).toBeGreaterThanOrEqual(0.55);
    expect(result.controls).toEqual(
      expect.objectContaining({
        failed: [],
      }),
    );
    expect(result.issues_found).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Public investor-demo scope for git-based software_delivery verification.
// Anonymous POST /api/verify/demo may only verify commits in the approved
// public investor-demo repo; every other repo (including private ones) is
// rejected, and POST /api/verify keeps requiring authentication.
// ---------------------------------------------------------------------------
describe('VerifyApiController public investor-demo software_delivery scope', () => {
  beforeEach(() => {
    verifyApiRuleTestHooks.demoIpCounters.clear();
  });

  const APPROVED_DEMO_OUTPUT = {
    repoOwner: 'foxfirepoets',
    repoName: 'swarmsync-verifyapi-investor-demo',
    beforeSha: 'aff74f1595a6d35ec966034e9ce9ca6962ca88e2',
    afterSha: 'd47985078ed3b3352090ecc43410b5d2d6f1463f',
    jobStartedAt: '2026-07-28T00:00:00.000Z',
    tier: 'BASIC',
    jobType: 'NEW_FEATURE',
  };

  const demoSdResult = {
    verificationId: 'vid_demo_001',
    proofId: 'sdv_proof_demo_001',
    verificationStatus: 'passed',
    confidence: 0.92,
    tierRun: 'BASIC',
    jobType: 'NEW_FEATURE',
    escalated: false,
    escalationReason: undefined,
    summary: '5 of 5 checks passed.',
    checksPassed: 5,
    checksFailed: 0,
    checksWarning: 0,
    checksSkipped: 0,
    checksRun: 5,
    issuesFound: [],
    recommendedAction: 'approved',
    results: [],
  };

  function makeDemoSdController(sdOverrides: Partial<typeof demoSdResult> = {}) {
    const softwareDelivery = {
      verify: jest.fn().mockResolvedValue({ ...demoSdResult, ...sdOverrides }),
    };
    const verifyApiUsage = { reserve: jest.fn().mockResolvedValue(undefined) };
    const proofBilling = {
      resolveProofQuota: jest.fn().mockResolvedValue({ source: 'free', monthlyLimit: null }),
    };
    const prisma = {
      organizationSubscription: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const controller = new VerifyApiController(
      {} as never, // verificationService
      {} as never, // proofService
      prisma as never,
      {} as never, // conduitVerification
      proofBilling as never,
      {} as never, // proofClaim
      {} as never, // aiAnalysis
      softwareDelivery as never,
      verifyApiUsage as never,
    );
    const req = { headers: {}, ip: '203.0.113.50' } as never;
    return {
      softwareDelivery,
      run: (output: unknown, rules?: unknown[]) =>
        controller.verifyDemo(
          { source_type: 'software_delivery', output, ...(rules ? { rules } : {}) },
          req,
        ) as Promise<Record<string, unknown>>,
    };
  }

  it('the approved investor-demo repository verifies without authentication', async () => {
    const { run, softwareDelivery } = makeDemoSdController();
    const result = await run(APPROVED_DEMO_OUTPUT);

    expect(result).toMatchObject({
      proof_id: 'sdv_proof_demo_001',
      verification_id: 'vid_demo_001',
      verification_status: 'passed',
      recommended_action: 'approved',
    });
    expect(Array.isArray(result.findings)).toBe(true);

    // Only the read-only public-GitHub check set (plus S12, pure diff-text
    // static analysis) runs for anonymous callers — never live-site,
    // build-sandbox, or deploy-platform checks. B2 ("commit made after job
    // start") is excluded from the demo set: it compares against a
    // jobStartedAt generated live, which can never be satisfied by the demo's
    // fixed historical commits, so including it would only ever manufacture a
    // false failure.
    expect(softwareDelivery.verify).toHaveBeenCalledWith(
      expect.objectContaining({ repoOwner: 'foxfirepoets', repoName: 'swarmsync-verifyapi-investor-demo' }),
      ['B1', 'B3', 'B4', 'B7', 'S12'],
      expect.objectContaining({ organizationId: 'anonymous' }),
    );
  });

  it('rejects an unapproved repository', async () => {
    const { run, softwareDelivery } = makeDemoSdController();

    await expect(
      run({ ...APPROVED_DEMO_OUTPUT, repoOwner: 'someone-else', repoName: 'random-repo' }),
    ).rejects.toMatchObject({ status: 403 });
    expect(softwareDelivery.verify).not.toHaveBeenCalled();
  });

  it('rejects a private repository even when the owner matches the approved account', async () => {
    const { run, softwareDelivery } = makeDemoSdController();

    await expect(
      run({ ...APPROVED_DEMO_OUTPUT, repoName: 'private-internal-repo' }),
    ).rejects.toMatchObject({ status: 403 });
    expect(softwareDelivery.verify).not.toHaveBeenCalled();
  });

  it('rejects demo requests that carry deploy credentials or live-site targets', async () => {
    const { run, softwareDelivery } = makeDemoSdController();

    await expect(
      run({ ...APPROVED_DEMO_OUTPUT, netlifyToken: 'nfp_secret', deployUrl: 'https://internal.example.com' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(softwareDelivery.verify).not.toHaveBeenCalled();
  });

  it('rejects unsupported rules requested against the demo repo', async () => {
    const { run, softwareDelivery } = makeDemoSdController();

    await expect(run(APPROVED_DEMO_OUTPUT, ['S9'])).rejects.toMatchObject({ status: 400 });
    expect(softwareDelivery.verify).not.toHaveBeenCalled();
  });

  it('rejects deploy credentials even on a document-shaped anonymous software_delivery request', async () => {
    // Defense-in-depth: the disallowed-field gate must not depend on which
    // sub-path (document-based vs git-based) ends up handling the request.
    const { run, softwareDelivery } = makeDemoSdController();

    await expect(
      run({
        requirements: [{ id: 'REQ-1', status: 'delivered' }],
        netlifyToken: 'nfp_secret',
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(softwareDelivery.verify).not.toHaveBeenCalled();
  });

  it('caches a repeat anonymous request for the same commit pair — no second GitHub/verify call or quota unit spent', async () => {
    const { run, softwareDelivery } = makeDemoSdController();
    const cacheProbeOutput = {
      ...APPROVED_DEMO_OUTPUT,
      afterSha: 'cacheprobe000000000000000000000000000001',
    };

    const first = await run(cacheProbeOutput);
    const second = await run(cacheProbeOutput);

    expect(softwareDelivery.verify).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(second.proof_id).toBe('sdv_proof_demo_001');
  });

  it('does not cache across different commit pairs', async () => {
    const { run, softwareDelivery } = makeDemoSdController();
    const outputA = { ...APPROVED_DEMO_OUTPUT, afterSha: 'cacheprobe000000000000000000000000000002' };
    const outputB = { ...APPROVED_DEMO_OUTPUT, afterSha: 'cacheprobe000000000000000000000000000003' };

    await run(outputA);
    await run(outputB);

    expect(softwareDelivery.verify).toHaveBeenCalledTimes(2);
  });

  it('the authenticated software_delivery path is unaffected — arbitrary repos still work with a user', async () => {
    const softwareDelivery = { verify: jest.fn().mockResolvedValue(demoSdResult) };
    const proofBilling = {
      resolveProofQuota: jest.fn().mockResolvedValue({ source: 'free', monthlyLimit: null }),
    };
    const prisma = { organizationSubscription: { findUnique: jest.fn().mockResolvedValue(null) } };
    const verifyApiUsage = { reserve: jest.fn().mockResolvedValue(undefined) };
    const controller = new VerifyApiController(
      {} as never,
      {} as never,
      prisma as never,
      {} as never,
      proofBilling as never,
      {} as never,
      {} as never,
      softwareDelivery as never,
      verifyApiUsage as never,
    );
    const user = { id: 'user_demo_001', organizationId: 'org_demo_001' } as never;

    await controller.verify(
      {
        source_type: 'software_delivery',
        output: { ...APPROVED_DEMO_OUTPUT, repoOwner: 'acme', repoName: 'private-prod-repo' },
        rules: ['S9'],
      },
      user,
    );

    expect(softwareDelivery.verify).toHaveBeenCalledWith(
      expect.objectContaining({ repoOwner: 'acme', repoName: 'private-prod-repo' }),
      ['S9'],
      expect.objectContaining({ organizationId: 'org_demo_001' }),
    );
  });

  it('POST /api/verify is not marked @Public — JwtAuthGuard still protects it', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, VerifyApiController.prototype.verify)).not.toBe(true);
  });

  it('POST /api/verify/demo remains marked @Public', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, VerifyApiController.prototype.verifyDemo)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Regression: the existing InvoiceProof demo flow (non-software_delivery,
// task=invoice_extraction on POST /api/verify/demo) must be unaffected by the
// new software_delivery demo-scoping logic above.
// ---------------------------------------------------------------------------
describe('VerifyApiController invoice demo regression', () => {
  beforeEach(() => {
    verifyApiRuleTestHooks.demoIpCounters.clear();
  });

  it('a clean invoice still verifies through POST /api/verify/demo', async () => {
    const verificationService = {
      queueVerification: jest.fn().mockResolvedValue({ id: 'run_invoice_demo_001' }),
      updateVerificationStatus: jest.fn().mockResolvedValue({
        riskLevel: 'LOW',
        outputSummary: 'All checks passed',
      }),
    };
    const proofService = {
      createProof: jest.fn().mockResolvedValue({ id: 'proof_invoice_demo_001', chain_hash: 'c'.repeat(64) }),
    };
    const prisma = {
      organizationSubscription: { findUnique: jest.fn().mockResolvedValue(null) },
      verificationRun: {
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const aiAnalysis = {
      analyze: jest.fn().mockResolvedValue({
        llm_unavailable: false,
        issues: [],
        ai_summary: 'Invoice looks clean.',
        risk_assessment: 'low',
      }),
    };
    const proofClaim = { generateClaimToken: jest.fn().mockReturnValue('claim_invoice_demo') };
    const controller = new VerifyApiController(
      verificationService as never,
      proofService as never,
      prisma as never,
      {} as never, // conduitVerification
      {} as never, // proofBilling (unused for anonymous callers)
      proofClaim as never,
      aiAnalysis as never,
      {} as never, // softwareDelivery
      {} as never, // verifyApiUsage
    );
    const req = { headers: {}, ip: '203.0.113.60' } as never;

    const result = (await controller.verifyDemo(
      {
        task: 'invoice_extraction',
        output: {
          invoice_number: 'INV-DEMO-1001',
          vendor_name: 'Acme Test Vendor',
          amount_total: 1000,
          due_date: '2026-08-01',
        },
      },
      req,
    )) as Record<string, unknown>;

    expect(verificationService.queueVerification).toHaveBeenCalled();
    expect(proofService.createProof).toHaveBeenCalled();
    expect(result).toMatchObject({
      proof_id: 'proof_invoice_demo_001',
      verification_id: 'run_invoice_demo_001',
    });
    expect(Array.isArray(result.findings)).toBe(true);
    expect(['passed', 'needs_review', 'blocked', 'failed']).toContain(result.verification_status);
  });
});
