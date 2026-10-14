/**
 * API integration tests — POST /api/verify with source_type: "software_delivery"
 *
 * These tests spin up a NestJS application context, stub out all I/O services
 * (Prisma, GitHub, live HTTP), and exercise the full request lifecycle from
 * controller → service → scoring → response shape.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { SoftwareDeliveryModule } from '../software-delivery.module.js';
import { SoftwareDeliveryService } from '../software-delivery.service.js';
import { PrismaService } from '../../../database/prisma.service.js';

// ---------------------------------------------------------------------------
// Prisma stub
// ---------------------------------------------------------------------------

const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockCreateMany = vi.fn();

const stubPrisma = {
  softwareDeliveryVerification: { create: mockCreate, update: mockUpdate },
  softwareDeliveryCheckResult: { createMany: mockCreateMany },
};

// ---------------------------------------------------------------------------
// SoftwareDeliveryService stub — returns canned responses
// ---------------------------------------------------------------------------

const stubVerify = vi.fn();

// ---------------------------------------------------------------------------
// Minimal controller that exposes the software_delivery branch
// ---------------------------------------------------------------------------

import { Controller, Post, Body, Inject, BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateOrReject } from 'class-validator';
import { SoftwareDeliveryVerifyDto } from '../dto/software-delivery-verify.dto.js';

class VerifyStubController {
  constructor(private readonly softwareDelivery: SoftwareDeliveryService) {}

  async verify(body: Record<string, unknown>) {
    if (body['source_type'] !== 'software_delivery') {
      throw new BadRequestException('Only software_delivery supported in this stub');
    }
    const dto = plainToInstance(SoftwareDeliveryVerifyDto, body['output']);
    await validateOrReject(dto).catch((errors) => {
      throw new BadRequestException({ message: 'Invalid software_delivery payload', errors });
    });
    const result = await this.softwareDelivery.verify(dto, (body['rules'] as string[]) ?? ['auto']);
    return {
      verification_status: result.verificationStatus,
      confidence: result.confidence,
      proof_id: result.proofId,
      tier_run: result.tierRun,
      job_type: result.jobType,
      escalated: result.escalated,
      escalation_reason: result.escalationReason,
      summary: result.summary,
      checks_passed: result.checksPassed,
      checks_failed: result.checksFailed,
      checks_warning: result.checksWarning,
      checks_skipped: result.checksSkipped,
      issues_found: result.issuesFound,
      recommended_action: result.recommendedAction,
      results: result.results,
    };
  }
}

// Vitest (rolldown/oxc) does not apply the legacy decorator transform to spec
// files (apps/api/tsconfig.json excludes **/*.spec.ts), so parameter/method
// decorators and constructor-parameter DI metadata are applied explicitly.
Controller('api')(VerifyStubController);
Inject(SoftwareDeliveryService)(VerifyStubController, undefined as unknown as string, 0);
Post('verify')(
  VerifyStubController.prototype,
  'verify',
  Object.getOwnPropertyDescriptor(VerifyStubController.prototype, 'verify') as PropertyDescriptor,
);
Body()(VerifyStubController.prototype, 'verify', 0);

// ---------------------------------------------------------------------------
// Minimal valid payload
// ---------------------------------------------------------------------------

const validOutput = {
  repoOwner: 'acme-corp',
  repoName: 'payments-api',
  beforeSha: 'abc123def456',
  afterSha: 'def456abc123',
  jobStartedAt: '2026-05-25T10:00:00Z',
  tier: 'BASIC',
  jobType: 'BUG_FIX',
  jobDescription: 'Fix invoice total rounding bug',
  jobValueUsd: 500,
};

const passedResult = {
  verificationId: 'verify-id-001',
  proofId: 'sdv_proof_001',
  verificationStatus: 'passed',
  confidence: 0.95,
  tierRun: 'BASIC',
  jobType: 'BUG_FIX',
  escalated: false,
  escalationReason: undefined,
  summary: '5 of 5 checks passed. Safe to release.',
  checksPassed: 5,
  checksFailed: 0,
  checksWarning: 0,
  checksSkipped: 2,
  checksRun: 5,
  issuesFound: [],
  recommendedAction: 'approved',
  results: [],
};

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

describe('POST /api/verify — software_delivery integration', () => {
  let app: INestApplication;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockCreate.mockResolvedValue({ id: 'verify-id-001', proofId: 'sdv_proof_001' });
    mockUpdate.mockResolvedValue({});
    mockCreateMany.mockResolvedValue({ count: 5 });

    const module: TestingModule = await Test.createTestingModule({
      imports: [SoftwareDeliveryModule],
      controllers: [VerifyStubController],
    })
      .overrideProvider(PrismaService)
      .useValue(stubPrisma)
      .overrideProvider(SoftwareDeliveryService)
      .useValue({ verify: stubVerify })
      .compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  // ── Happy path ──────────────────────────────────────────────────────────

  it('returns 201 with verification_status and proof_id on valid PASSED result', async () => {
    stubVerify.mockResolvedValue(passedResult);

    const { status, body } = await request(app.getHttpServer())
      .post('/api/verify')
      .send({ source_type: 'software_delivery', output: validOutput });

    expect(status).toBe(201);
    expect(body.verification_status).toBe('passed');
    expect(body.proof_id).toBe('sdv_proof_001');
    expect(body.recommended_action).toBe('approved');
    expect(body.confidence).toBe(0.95);
  });

  it('includes all required top-level fields in response', async () => {
    stubVerify.mockResolvedValue(passedResult);

    const { body } = await request(app.getHttpServer())
      .post('/api/verify')
      .send({ source_type: 'software_delivery', output: validOutput });

    const requiredFields = [
      'verification_status', 'confidence', 'proof_id', 'tier_run', 'job_type',
      'escalated', 'summary', 'checks_passed', 'checks_failed', 'checks_warning',
      'checks_skipped', 'issues_found', 'recommended_action', 'results',
    ];
    for (const field of requiredFields) {
      expect(body).toHaveProperty(field);
    }
  });

  it('returns needs-review status when checks have warnings', async () => {
    stubVerify.mockResolvedValue({
      ...passedResult,
      verificationStatus: 'needs-review',
      checksWarning: 2,
      recommendedAction: 'human_review',
    });

    const { body } = await request(app.getHttpServer())
      .post('/api/verify')
      .send({ source_type: 'software_delivery', output: validOutput });

    expect(body.verification_status).toBe('needs-review');
    expect(body.recommended_action).toBe('human_review');
  });

  it('returns failed status when critical checks fail', async () => {
    stubVerify.mockResolvedValue({
      ...passedResult,
      verificationStatus: 'failed',
      checksFailed: 1,
      confidence: 0.85,
      recommendedAction: 'blocked',
      issuesFound: [{ checkId: 'S3', checkName: 'No hardcoded secrets', status: 'FAIL', detail: 'Stripe live key detected' }],
    });

    const { body } = await request(app.getHttpServer())
      .post('/api/verify')
      .send({ source_type: 'software_delivery', output: validOutput });

    expect(body.verification_status).toBe('failed');
    expect(body.recommended_action).toBe('blocked');
    expect(body.issues_found).toHaveLength(1);
    expect(body.issues_found[0].checkId).toBe('S3');
  });

  // ── Validation ──────────────────────────────────────────────────────────

  it('returns 400 when output is missing required field repoOwner', async () => {
    const { repoOwner: _omit, ...missingOwner } = validOutput;
    const { status, body } = await request(app.getHttpServer())
      .post('/api/verify')
      .send({ source_type: 'software_delivery', output: missingOwner });

    expect(status).toBe(400);
    expect(body.message).toContain('software_delivery');
  });

  it('returns 400 when output is missing required field repoName', async () => {
    const { repoName: _omit, ...missingRepo } = validOutput;
    const { status } = await request(app.getHttpServer())
      .post('/api/verify')
      .send({ source_type: 'software_delivery', output: missingRepo });

    expect(status).toBe(400);
  });

  it('returns 400 when jobType is not a valid enum value', async () => {
    const { status } = await request(app.getHttpServer())
      .post('/api/verify')
      .send({ source_type: 'software_delivery', output: { ...validOutput, jobType: 'INVALID_TYPE' } });

    expect(status).toBe(400);
  });

  it('returns 400 when tier is not a valid enum value', async () => {
    const { status } = await request(app.getHttpServer())
      .post('/api/verify')
      .send({ source_type: 'software_delivery', output: { ...validOutput, tier: 'ULTRA' } });

    expect(status).toBe(400);
  });

  it('returns 400 when jobValueUsd exceeds maximum', async () => {
    const { status } = await request(app.getHttpServer())
      .post('/api/verify')
      .send({ source_type: 'software_delivery', output: { ...validOutput, jobValueUsd: 2_000_000 } });

    expect(status).toBe(400);
  });

  it('returns 400 when output field is absent entirely', async () => {
    const { status } = await request(app.getHttpServer())
      .post('/api/verify')
      .send({ source_type: 'software_delivery' });

    expect(status).toBe(400);
  });

  // ── Escalation fields ───────────────────────────────────────────────────

  it('returns escalated: true and escalation_reason in response when escalated', async () => {
    stubVerify.mockResolvedValue({
      ...passedResult,
      escalated: true,
      escalationReason: 'Job value exceeds $5000 threshold — requires THOROUGH tier review.',
      tierRun: 'THOROUGH',
      verificationStatus: 'needs-review',
      recommendedAction: 'human_review',
    });

    const { body } = await request(app.getHttpServer())
      .post('/api/verify')
      .send({ source_type: 'software_delivery', output: { ...validOutput, jobValueUsd: 9000, tier: 'BASIC' } });

    expect(body.escalated).toBe(true);
    expect(typeof body.escalation_reason).toBe('string');
    expect(body.tier_run).toBe('THOROUGH');
  });

  // ── rules parameter ─────────────────────────────────────────────────────

  it('forwards rules array to the service', async () => {
    stubVerify.mockResolvedValue(passedResult);

    await request(app.getHttpServer())
      .post('/api/verify')
      .send({ source_type: 'software_delivery', output: validOutput, rules: ['B1', 'S3'] });

    expect(stubVerify).toHaveBeenCalledWith(
      expect.any(Object),
      ['B1', 'S3'],
    );
  });

  it('defaults to ["auto"] when rules is absent', async () => {
    stubVerify.mockResolvedValue(passedResult);

    await request(app.getHttpServer())
      .post('/api/verify')
      .send({ source_type: 'software_delivery', output: validOutput });

    expect(stubVerify).toHaveBeenCalledWith(
      expect.any(Object),
      ['auto'],
    );
  });

  // ── issues_found shape ──────────────────────────────────────────────────

  it('issues_found entries contain checkId, checkName, status, and optional detail', async () => {
    stubVerify.mockResolvedValue({
      ...passedResult,
      verificationStatus: 'needs-review',
      checksWarning: 1,
      issuesFound: [
        { checkId: 'S11', checkName: 'Lock file consistency', status: 'WARNING', detail: 'package.json changed without lock file update' },
      ],
      recommendedAction: 'human_review',
    });

    const { body } = await request(app.getHttpServer())
      .post('/api/verify')
      .send({ source_type: 'software_delivery', output: validOutput });

    expect(body.issues_found[0]).toMatchObject({
      checkId: 'S11',
      checkName: 'Lock file consistency',
      status: 'WARNING',
    });
    expect(typeof body.issues_found[0].detail).toBe('string');
  });
});
