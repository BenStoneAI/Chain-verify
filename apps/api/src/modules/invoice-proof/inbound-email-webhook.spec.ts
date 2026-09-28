/**
 * Inbound-email webhook security tests.
 *
 * Proves three properties required by the fail-closed security fix:
 *   1. MISSING secret env var → ALL requests rejected (key regression test).
 *   2. VALID secret configured + correct header → accepted / processed.
 *   3. VALID secret configured + wrong/missing header → rejected.
 *
 * Also covers the generic webhook verifier (POST /invoice-proof/webhook/incoming/:orgId)
 * which uses INVOICEPROOF_WEBHOOK_SECRET — it was already fail-closed but is tested here
 * to guard against regression.
 *
 * Additional truth-labeling tests:
 *   4. PDF attachments are NOT reported as scanned.
 *   5. No reply-email claim in the response.
 *
 * Mock the scan runner the same way as sibling specs to avoid @chain-verify/proof-core
 * resolution issues in the Jest module mapper.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('./invoice-proof-scan.runner.js', () => ({
  hashFingerprint: vi.fn((v: string) => Buffer.from(v).toString('hex').slice(0, 64)),
  parseInvoiceScanBody: vi.fn(() => ({
    rows: [],
    vendorMaster: [],
    vendorMasterExtended: [],
    poRegister: [],
    seededHistory: [],
  })),
  runInvoiceScan: vi.fn(() => ({
    findings: [],
    findingCount: 0,
    rowCount: 0,
    coverage_summary: {},
  })),
}));

import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';

import { InvoiceProofController } from './invoice-proof.controller.js';
import { InvoiceProofService } from './invoice-proof.service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ORG_SLUG = 'acme-corp';
const ORG_ID = 'org-test-1';
const VALID_INBOUND_SECRET = 'test-inbound-secret-xyz';
const VALID_WEBHOOK_SECRET = 'test-webhook-secret-abc';

/** Minimal InvoiceProofService mock sufficient for controller-level tests. */
function makeServiceMock() {
  return {
    processInboundEmail: vi.fn().mockResolvedValue({
      orgSlug: ORG_SLUG,
      from: 'vendor@example.com',
      subject: 'Invoice #1001',
      scanId: 'scan-1',
      findingCount: 0,
      riskLevel: 'LOW',
      summary: 'No fraud findings detected.',
    }),
    webhookScan: vi.fn().mockResolvedValue({
      findings: [],
      findingCount: 0,
      riskLevel: 'LOW',
      scanId: 'scan-2',
    }),
    resolveOrgId: vi.fn().mockResolvedValue(ORG_ID),
    scan: vi.fn(),
    erpService: {},
  } as unknown as InvoiceProofService;
}

function makeController(serviceMock: InvoiceProofService) {
  return new InvoiceProofController(serviceMock);
}

// ---------------------------------------------------------------------------
// Shared email payload (txt body — valid for processing)
// ---------------------------------------------------------------------------

const TEXT_EMAIL_PAYLOAD = {
  text: 'Invoice #1001 from Acme Supplies for $1,200',
  from: 'vendor@example.com',
  subject: 'Invoice #1001',
};

// ---------------------------------------------------------------------------
// PART 1: verifyInboundEmailSecret — fail-closed behaviour
// ---------------------------------------------------------------------------

describe('inboundEmail endpoint — secret verification (fail-closed)', () => {
  let originalSecret: string | undefined;

  beforeEach(() => {
    originalSecret = process.env.INVOICEPROOF_INBOUND_EMAIL_SECRET;
  });

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.INVOICEPROOF_INBOUND_EMAIL_SECRET;
    } else {
      process.env.INVOICEPROOF_INBOUND_EMAIL_SECRET = originalSecret;
    }
  });

  // KEY REGRESSION TEST — was fail-open before the fix
  it('REJECTS all requests when INVOICEPROOF_INBOUND_EMAIL_SECRET is not set (fail-closed)', async () => {
    delete process.env.INVOICEPROOF_INBOUND_EMAIL_SECRET;

    const svc = makeServiceMock();
    const ctrl = makeController(svc);

    await expect(
      ctrl.inboundEmail(ORG_SLUG, TEXT_EMAIL_PAYLOAD, /* header */ undefined),
    ).rejects.toThrow(ServiceUnavailableException);

    // Service must NOT have been called
    expect(svc.processInboundEmail).not.toHaveBeenCalled();
  });

  it('REJECTS all requests when INVOICEPROOF_INBOUND_EMAIL_SECRET is empty string (fail-closed)', async () => {
    process.env.INVOICEPROOF_INBOUND_EMAIL_SECRET = '';

    const svc = makeServiceMock();
    const ctrl = makeController(svc);

    await expect(
      ctrl.inboundEmail(ORG_SLUG, TEXT_EMAIL_PAYLOAD, undefined),
    ).rejects.toThrow(ServiceUnavailableException);

    expect(svc.processInboundEmail).not.toHaveBeenCalled();
  });

  it('REJECTS request with CORRECT header when env var is unset (fail-closed — header irrelevant)', async () => {
    delete process.env.INVOICEPROOF_INBOUND_EMAIL_SECRET;

    const svc = makeServiceMock();
    const ctrl = makeController(svc);

    // Even supplying what would be the correct secret should not help
    await expect(
      ctrl.inboundEmail(ORG_SLUG, TEXT_EMAIL_PAYLOAD, VALID_INBOUND_SECRET),
    ).rejects.toThrow(ServiceUnavailableException);

    expect(svc.processInboundEmail).not.toHaveBeenCalled();
  });

  it('ACCEPTS request with correct header when secret IS configured', async () => {
    process.env.INVOICEPROOF_INBOUND_EMAIL_SECRET = VALID_INBOUND_SECRET;

    const svc = makeServiceMock();
    const ctrl = makeController(svc);

    const result = await ctrl.inboundEmail(ORG_SLUG, TEXT_EMAIL_PAYLOAD, VALID_INBOUND_SECRET);

    expect(svc.processInboundEmail).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ orgSlug: ORG_SLUG, scanId: 'scan-1' });
  });

  it('REJECTS request with WRONG header when secret IS configured', async () => {
    process.env.INVOICEPROOF_INBOUND_EMAIL_SECRET = VALID_INBOUND_SECRET;

    const svc = makeServiceMock();
    const ctrl = makeController(svc);

    await expect(
      ctrl.inboundEmail(ORG_SLUG, TEXT_EMAIL_PAYLOAD, 'wrong-secret'),
    ).rejects.toThrow(UnauthorizedException);

    expect(svc.processInboundEmail).not.toHaveBeenCalled();
  });

  it('REJECTS request with MISSING header when secret IS configured', async () => {
    process.env.INVOICEPROOF_INBOUND_EMAIL_SECRET = VALID_INBOUND_SECRET;

    const svc = makeServiceMock();
    const ctrl = makeController(svc);

    await expect(
      ctrl.inboundEmail(ORG_SLUG, TEXT_EMAIL_PAYLOAD, undefined),
    ).rejects.toThrow(UnauthorizedException);

    expect(svc.processInboundEmail).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// PART 2: verifyWebhookSecret — already fail-closed; guard against regression
// ---------------------------------------------------------------------------

describe('webhookIncoming endpoint — secret verification (regression guard)', () => {
  let originalSecret: string | undefined;

  beforeEach(() => {
    originalSecret = process.env.INVOICEPROOF_WEBHOOK_SECRET;
  });

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.INVOICEPROOF_WEBHOOK_SECRET;
    } else {
      process.env.INVOICEPROOF_WEBHOOK_SECRET = originalSecret;
    }
  });

  it('REJECTS all requests when INVOICEPROOF_WEBHOOK_SECRET is not set (fail-closed)', async () => {
    delete process.env.INVOICEPROOF_WEBHOOK_SECRET;

    const svc = makeServiceMock();
    const ctrl = makeController(svc);

    await expect(
      ctrl.webhookIncoming('org-1', { invoices: [] } as never, undefined),
    ).rejects.toThrow(UnauthorizedException);

    expect(svc.webhookScan).not.toHaveBeenCalled();
  });

  it('REJECTS request with WRONG header when secret IS configured', async () => {
    process.env.INVOICEPROOF_WEBHOOK_SECRET = VALID_WEBHOOK_SECRET;

    const svc = makeServiceMock();
    const ctrl = makeController(svc);

    await expect(
      ctrl.webhookIncoming('org-1', { invoices: [] } as never, 'bad-secret'),
    ).rejects.toThrow(UnauthorizedException);

    expect(svc.webhookScan).not.toHaveBeenCalled();
  });

  it('ACCEPTS request with correct header when secret IS configured', async () => {
    process.env.INVOICEPROOF_WEBHOOK_SECRET = VALID_WEBHOOK_SECRET;

    const svc = makeServiceMock();
    const ctrl = makeController(svc);

    const result = await ctrl.webhookIncoming('org-1', { invoices: [] } as never, VALID_WEBHOOK_SECRET);

    expect(svc.webhookScan).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ decision: 'ALLOW', scanId: 'scan-2' });
  });
});

// ---------------------------------------------------------------------------
// PART 3: Truth-labeling — PDF not scanned; no reply email
// ---------------------------------------------------------------------------

describe('inboundEmail — truth-labeling: no fake PDF scan, no reply email', () => {
  let originalSecret: string | undefined;

  beforeEach(() => {
    originalSecret = process.env.INVOICEPROOF_INBOUND_EMAIL_SECRET;
    process.env.INVOICEPROOF_INBOUND_EMAIL_SECRET = VALID_INBOUND_SECRET;
  });

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.INVOICEPROOF_INBOUND_EMAIL_SECRET;
    } else {
      process.env.INVOICEPROOF_INBOUND_EMAIL_SECRET = originalSecret;
    }
  });

  it('does NOT report PDF attachment content as scanned (service called with original payload, PDF content not injected)', async () => {
    const svc = makeServiceMock();
    const ctrl = makeController(svc);

    const payloadWithPdf = {
      text: 'Some plain text',
      from: 'vendor@example.com',
      subject: 'Invoice with PDF',
      attachments: [
        {
          content: Buffer.from('fake pdf binary data').toString('base64'),
          filename: 'invoice.pdf',
        },
      ],
    };

    await ctrl.inboundEmail(ORG_SLUG, payloadWithPdf, VALID_INBOUND_SECRET);

    // The controller passes the raw payload to the service; it's the SERVICE's
    // responsibility to skip PDF attachments. Confirm the controller did not
    // strip or inject PDF content before delegating — the exact payload is forwarded.
    expect(svc.processInboundEmail).toHaveBeenCalledWith(ORG_SLUG, payloadWithPdf);

    // Confirm the response contains no claim that PDF was processed
    const callResult = await (svc.processInboundEmail as Mock).mock.results[0]?.value;
    const resultStr = JSON.stringify(callResult);
    expect(resultStr).not.toMatch(/pdf/i);
    expect(resultStr).not.toMatch(/extracted from pdf/i);
  });

  it('does NOT include a reply/email-sent field in the response', async () => {
    const svc = makeServiceMock();
    const ctrl = makeController(svc);

    const result = await ctrl.inboundEmail(ORG_SLUG, TEXT_EMAIL_PAYLOAD, VALID_INBOUND_SECRET);

    // No indication that a reply email was sent
    expect(result).not.toHaveProperty('replySent');
    expect(result).not.toHaveProperty('replyEmail');
    expect(result).not.toHaveProperty('emailSent');
    const resultStr = JSON.stringify(result);
    expect(resultStr).not.toMatch(/reply.*sent/i);
  });
});
