import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request } from 'express';

import { PDF_MAX_BYTES } from './invoice-pdf.service.js';

import { Public } from '../auth/decorators/public.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { InvoiceProofService } from './invoice-proof.service.js';
import type { InvoiceScanRequestBody } from './invoice-proof-scan.runner.js';
import { timingSafeEqual } from 'crypto';

function verifyWebhookSecret(header: string | undefined): void {
  const secret = process.env.INVOICEPROOF_WEBHOOK_SECRET;
  if (!secret) {
    throw new UnauthorizedException('Webhook authentication is not configured');
  }
  if (!header) {
    throw new UnauthorizedException('Missing X-InvoiceProof-Webhook-Secret header');
  }
  const a = Buffer.from(header);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new UnauthorizedException('Invalid webhook secret');
  }
}

function verifyInboundEmailSecret(header: string | undefined): void {
  const secret = process.env.INVOICEPROOF_INBOUND_EMAIL_SECRET;
  // Fail CLOSED: if the expected secret is not configured, reject all requests.
  // An unconfigured secret means the endpoint is not ready for use — permitting
  // traffic would be a security gap (unauthenticated inbound data accepted).
  if (!secret) {
    throw new ServiceUnavailableException('Inbound email webhook is not configured');
  }
  if (!header) {
    throw new UnauthorizedException('Missing X-InvoiceProof-Inbound-Secret header');
  }
  const a = Buffer.from(header);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new UnauthorizedException('Invalid inbound email secret');
  }
}

function clientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  return (typeof fwd === 'string' ? fwd.split(',')[0]?.trim() : null) || req.ip || 'unknown';
}

function parseCsvRows(text: string): Record<string, unknown>[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map((line) => {
    const cols = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    const row: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      row[h] = cols[i] ?? '';
    });
    return row;
  });
}

@ApiTags('InvoiceProof')
@Controller('invoice-proof')
@UseGuards(JwtAuthGuard)
export class InvoiceProofController {
  constructor(private readonly invoiceProof: InvoiceProofService) {}

  @Post('scan')
  @Public()
  @HttpCode(HttpStatus.OK)
  // Apply Redis-backed rate limiting via the global ThrottlerSecondsGuard.
  // 60 req/IP/min matches the old in-memory limit in the Next.js proxy but now
  // works correctly across Netlify serverless instances and multiple API pods.
  // Entitled callers (active INVOICE_PROOF entitlement) are not exempt here —
  // the NestJS throttler tracks by IP; 60/min is generous enough for any
  // legitimate paid use. Only name 'default' and 'strict' are skipped so the
  // 'public' slot (20/min base) is overridden to 60 here.
  @SkipThrottle({ default: true, strict: true })
  @Throttle({ public: { limit: 60, ttl: 60000 } })
  @ApiOperation({ summary: 'Scan invoice batch with auth/quota gate' })
  async scan(
    @Body() body: InvoiceScanRequestBody,
    @CurrentUser() user: AuthenticatedUser | null,
    @Req() req: Request,
    @Query('email') email?: string,
  ) {
    return this.invoiceProof.scan(body, user, clientIp(req), email);
  }

  @Post('scan-pdf')
  @Public()
  @HttpCode(HttpStatus.OK)
  @SkipThrottle({ default: true, strict: true })
  @Throttle({ public: { limit: 60, ttl: 60000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      // Hard byte ceiling at the edge; the service re-checks and inspects magic bytes.
      limits: { fileSize: PDF_MAX_BYTES, files: 1 },
      fileFilter: (_req, file, cb) => {
        const ok =
          file.mimetype === 'application/pdf' ||
          file.originalname?.toLowerCase().endsWith('.pdf');
        cb(ok ? null : new UnsupportedMediaTypeException('Only PDF files are accepted.'), ok);
      },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Scan a single invoice PDF (digital/text PDFs only — no OCR)',
    description:
      'Upload one PDF as multipart/form-data field "file". Digital/text PDFs are extracted and ' +
      'fed into the same fraud-scan engine as the JSON endpoint. Scanned/image-only, encrypted, ' +
      'or corrupt PDFs return a NEEDS_REVIEW / TEXT_EXTRACTION_FAILED status instead of a scan.',
  })
  async scanPdf(
    @UploadedFile() file: { buffer: Buffer; mimetype: string; originalname: string } | undefined,
    @CurrentUser() user: AuthenticatedUser | null,
    @Req() req: Request,
    @Query('email') email?: string,
  ) {
    if (!file?.buffer) {
      throw new BadRequestException('No PDF file uploaded (expected multipart field "file").');
    }
    return this.invoiceProof.scanPdf(file.buffer, user, clientIp(req), email);
  }

  @Post('scan-url')
  @Public()
  @HttpCode(HttpStatus.OK)
  @SkipThrottle({ default: true, strict: true })
  // Lower than scan/scan-pdf: each call drives a real headless-browser
  // navigation (Conduit), a meaningfully heavier operation per request than
  // parsing an uploaded buffer.
  @Throttle({ public: { limit: 20, ttl: 60000 } })
  @ApiOperation({
    summary: 'Scan an invoice reachable at a URL (PDF or HTML) via Conduit',
    description:
      'Fetches the URL through Conduit\'s real browser engine. A URL that resolves directly to a ' +
      'PDF is routed through the same pipeline as scan-pdf; an HTML-rendered invoice page has its ' +
      'content extracted and fed into the same fraud-scan engine as the other endpoints. Blocks ' +
      'private/internal/loopback targets, cloud metadata endpoints, and any non-http(s) scheme ' +
      'before Conduit ever navigates.',
  })
  async scanUrl(
    @Body() body: { url?: string },
    @CurrentUser() user: AuthenticatedUser | null,
    @Req() req: Request,
    @Query('email') email?: string,
  ) {
    if (!body?.url || typeof body.url !== 'string' || body.url.trim().length === 0) {
      throw new BadRequestException('A "url" field is required.');
    }
    return this.invoiceProof.scanUrl(body.url.trim(), user, clientIp(req), email);
  }

  @Get('vendor-master')
  @ApiOperation({ summary: 'List org vendor master' })
  async listVendorMaster(@CurrentUser() user: AuthenticatedUser) {
    const orgId = await this.invoiceProof.requireOrgId(user);
    return this.invoiceProof.listVendorMaster(orgId);
  }

  @Post('vendor-master')
  @ApiOperation({ summary: 'Add or update vendor master entry' })
  async upsertVendor(@CurrentUser() user: AuthenticatedUser, @Body() body: Record<string, unknown>) {
    const orgId = await this.invoiceProof.requireOrgId(user);
    return this.invoiceProof.upsertVendorMaster(orgId, body as never);
  }

  @Post('vendor-master/bulk')
  @ApiOperation({ summary: 'Bulk import vendor master CSV JSON rows' })
  async bulkVendor(@CurrentUser() user: AuthenticatedUser, @Body() body: { rows?: unknown[]; csv?: string }) {
    const orgId = await this.invoiceProof.requireOrgId(user);
    const rows = body.rows ?? (body.csv ? parseCsvRows(body.csv) : []);
    return this.invoiceProof.bulkImportVendorMaster(orgId, rows as Record<string, unknown>[]);
  }

  @Delete('vendor-master/:id')
  async deleteVendor(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const orgId = await this.invoiceProof.requireOrgId(user);
    return this.invoiceProof.deleteVendorMaster(orgId, id);
  }

  @Get('po-register')
  async listPo(@CurrentUser() user: AuthenticatedUser) {
    const orgId = await this.invoiceProof.requireOrgId(user);
    return this.invoiceProof.listPoRegister(orgId);
  }

  @Post('po-register')
  async upsertPo(@CurrentUser() user: AuthenticatedUser, @Body() body: Record<string, unknown>) {
    const orgId = await this.invoiceProof.requireOrgId(user);
    return this.invoiceProof.upsertPo(orgId, {
      poNumber: String(body.poNumber ?? ''),
      vendorName: String(body.vendorName ?? ''),
      authorizedAmount: Number(body.authorizedAmount ?? 0),
    });
  }

  @Post('po-register/bulk')
  async bulkPo(@CurrentUser() user: AuthenticatedUser, @Body() body: { rows?: unknown[]; csv?: string }) {
    const orgId = await this.invoiceProof.requireOrgId(user);
    const rows = body.rows ?? (body.csv ? parseCsvRows(body.csv) : []);
    return this.invoiceProof.bulkImportPoRegister(orgId, rows as Record<string, unknown>[]);
  }

  @Post('payment-history/bulk')
  async bulkPaymentHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { rows?: unknown[]; csv?: string },
  ) {
    const orgId = await this.invoiceProof.requireOrgId(user);
    const rows = body.rows ?? (body.csv ? parseCsvRows(body.csv) : []);
    return this.invoiceProof.bulkImportPaymentHistory(orgId, rows as Record<string, unknown>[]);
  }

  @Get('scans')
  async listScans(@CurrentUser() user: AuthenticatedUser) {
    const orgId = await this.invoiceProof.requireOrgId(user);
    return this.invoiceProof.listScans(orgId);
  }

  @Get('review/:scanId')
  async reviewScan(@CurrentUser() user: AuthenticatedUser, @Param('scanId') scanId: string) {
    const orgId = await this.invoiceProof.requireOrgId(user);
    return this.invoiceProof.getScanReview(orgId, scanId);
  }

  @Post('review/:scanId/approvals/:approvalId')
  async decideApproval(
    @CurrentUser() user: AuthenticatedUser,
    @Param('approvalId') approvalId: string,
    @Body() body: { decision: 'APPROVED' | 'BLOCKED'; note?: string },
  ) {
    const orgId = await this.invoiceProof.requireOrgId(user);
    return this.invoiceProof.decideApproval(orgId, approvalId, user.id, body.decision, body.note);
  }

  @Post('erp/connect/:provider')
  async erpConnect(
    @CurrentUser() user: AuthenticatedUser,
    @Param('provider') provider: string,
    @Body() body: { redirectUri?: string },
  ) {
    const orgId = await this.invoiceProof.requireOrgId(user);
    return this.invoiceProof.erpService.startConnect(orgId, provider, body.redirectUri);
  }

  @Get('erp/callback/:provider')
  @Public()
  async erpCallback(
    @Param('provider') provider: string,
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('realmId') realmId?: string,
  ) {
    return this.invoiceProof.erpService.handleCallback(provider, code, state, realmId);
  }

  @Get('erp/connections')
  async erpConnections(@CurrentUser() user: AuthenticatedUser) {
    const orgId = await this.invoiceProof.requireOrgId(user);
    return this.invoiceProof.erpService.listConnections(orgId);
  }

  @Delete('erp/connections/:provider')
  async erpDisconnect(@CurrentUser() user: AuthenticatedUser, @Param('provider') provider: string) {
    const orgId = await this.invoiceProof.requireOrgId(user);
    return this.invoiceProof.erpService.disconnect(orgId, provider);
  }

  @Post('erp/sync/:provider')
  async erpSync(@CurrentUser() user: AuthenticatedUser, @Param('provider') provider: string) {
    const orgId = await this.invoiceProof.requireOrgId(user);
    return this.invoiceProof.erpService.syncProvider(
      orgId,
      this.invoiceProof.erpService.normalizeProvider(provider),
    );
  }

  @Post('webhook/incoming/:orgId')
  @Public()
  @HttpCode(HttpStatus.OK)
  async webhookIncoming(
    @Param('orgId') orgId: string,
    @Body() body: InvoiceScanRequestBody,
    @Headers('x-invoiceproof-webhook-secret') webhookSecret?: string,
  ) {
    verifyWebhookSecret(webhookSecret);
    const result = await this.invoiceProof.webhookScan(orgId, body);
    const topFinding = result.findings[0];
    const block =
      result.riskLevel === 'CRITICAL' ||
      result.riskLevel === 'HIGH' ||
      result.findings.some((f) => f.severity === 'critical');
    return {
      decision: block ? 'BLOCK' : 'ALLOW',
      reason: topFinding?.pattern ?? null,
      detail: topFinding?.detail ?? 'No critical findings',
      scanId: result.scanId,
    };
  }

  @Post('vendor-portal/:orgSlug/:token/request-otp')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request a one-time verification code for bank-detail change' })
  async vendorPortalRequestOtp(
    @Param('orgSlug') orgSlug: string,
    @Param('token') token: string,
  ) {
    return this.invoiceProof.requestVendorPortalOtp(orgSlug, token);
  }

  @Post('vendor-portal/:orgSlug/:token')
  @Public()
  async vendorPortalSubmit(
    @Param('orgSlug') orgSlug: string,
    @Param('token') token: string,
    @Body()
    body: {
      bankRoutingNumber: string;
      bankAccountLast4?: string;
      remitAddress?: string;
      otpCode?: string;
    },
  ) {
    return this.invoiceProof.submitVendorPortalBankUpdate(orgSlug, token, body);
  }

  @Post('vendor-portal-token')
  async createVendorPortalToken(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { vendorName: string },
  ) {
    const orgId = await this.invoiceProof.requireOrgId(user);
    return this.invoiceProof.createVendorPortalToken(orgId, body.vendorName);
  }

  /**
   * Inbound email webhook stub — LIMITED CAPABILITY.
   *
   * What this endpoint DOES:
   *   - Accepts plain-text body or .txt/.csv/.tsv attachments and scans them for invoice fraud.
   *   - Requires INVOICEPROOF_INBOUND_EMAIL_SECRET header to be configured (fail-closed).
   *
   * What this endpoint does NOT do (not yet implemented):
   *   - No SendGrid / Postmark provider webhook signature verification.
   *   - No PDF text extraction — PDF attachments are silently skipped.
   *   - No automatic reply email is sent to the original sender.
   *   - No inbound email provider is wired up; caller must POST the parsed payload manually.
   *
   * A production implementation would require:
   *   - Chosen inbound provider (SendGrid Inbound Parse / Postmark Inbound) with HMAC signature verification on each request.
   *   - A PDF text-extraction library (e.g. pdf-parse or a cloud Document AI) for attachment processing.
   *   - An outbound reply provider (SendGrid / SES) with redacted result summaries.
   *   - Attachment storage + PII redaction before any persistence.
   */
  @Post('inbound-email/:orgSlug')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Inbound email webhook (stub) — plain-text/CSV only; PDF not supported; no reply email sent',
    description:
      'Accepts a parsed email payload with plain-text body or .txt/.csv/.tsv attachments and runs an InvoiceProof scan. ' +
      'PDF attachments are silently ignored. No provider webhook signature is verified. No reply email is sent. ' +
      'Requires INVOICEPROOF_INBOUND_EMAIL_SECRET to be set; rejects all requests when the env var is absent.',
  })
  async inboundEmail(
    @Param('orgSlug') orgSlug: string,
    @Body()
    body: {
      text?: string;
      html?: string;
      from?: string;
      subject?: string;
      attachments?: Array<{ content?: string; filename?: string }>;
    },
    @Headers('x-invoiceproof-inbound-secret') inboundSecret?: string,
  ) {
    verifyInboundEmailSecret(inboundSecret);
    return this.invoiceProof.processInboundEmail(orgSlug, body);
  }
}
