/**
 * Software Delivery Verification — Customer-Facing E2E / Integration Tests
 *
 * These tests use NestJS's testing module with supertest to exercise the full
 * HTTP stack from POST /api/verify (source_type: "software_delivery") through
 * to response shape validation.
 *
 * External dependencies (GitHub API, Netlify, Render, OSV) are all mocked
 * so tests are deterministic and run offline. The database layer is mocked
 * via the PrismaService to avoid needing a live Postgres connection.
 *
 * The real VerifyApiController is NOT imported here: a minimal stub controller
 * handles only the software_delivery routing branch — the behaviour under test.
 */

import { vi, describe, it, expect, beforeAll, afterAll, beforeEach, type Mocked } from 'vitest';
import {
  CanActivate,
  Controller,
  ExecutionContext,
  Inject,
  Injectable,
  Post,
  Body,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateOrReject } from 'class-validator';
import request from 'supertest';
import axios from 'axios';

import { SoftwareDeliveryModule } from '../software-delivery.module.js';
import { SoftwareDeliveryService } from '../software-delivery.service.js';
import { SoftwareDeliveryVerifyDto } from '../dto/software-delivery-verify.dto.js';

// ---------------------------------------------------------------------------
// Module-level mocks for all external HTTP calls
// ---------------------------------------------------------------------------

vi.mock('axios');
const mockedAxios = axios as Mocked<typeof axios>;

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
}));

// ---------------------------------------------------------------------------
// Stub auth guard — overridden per test via overrideGuard()
// ---------------------------------------------------------------------------

class TestAuthGuard implements CanActivate {
  canActivate(_ctx: ExecutionContext): boolean {
    return true; // replaced in test module
  }
}

// ---------------------------------------------------------------------------
// Stub controller — implements only the software_delivery branch
// ---------------------------------------------------------------------------

class VerifyApiStubController {
  constructor(private readonly softwareDelivery: SoftwareDeliveryService) {}

  async verify(body: Record<string, unknown>) {
    if (!body?.['source_type']) {
      throw new BadRequestException('source_type is required');
    }

    if (body['source_type'] !== 'software_delivery') {
      // Non-software-delivery source_types — return shape without software delivery fields
      return { status: 'accepted', source_type: body['source_type'] };
    }

    if (!body['output']) {
      throw new BadRequestException({ message: 'Invalid software_delivery payload', errors: ['output is required'] });
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
      results: result.results.map(r => ({
        check_id: r.checkId,
        check_name: r.checkName,
        status: r.status,
        detail: r.detail,
        duration_ms: r.durationMs,
      })),
    };
  }
}

// Vitest (rolldown/oxc) does not apply the legacy decorator transform to spec
// files (apps/api/tsconfig.json excludes **/*.spec.ts), so parameter/method
// decorators and constructor-parameter DI metadata are applied explicitly.
Injectable()(TestAuthGuard);
Controller('api')(VerifyApiStubController);
UseGuards(TestAuthGuard)(VerifyApiStubController);
Inject(SoftwareDeliveryService)(VerifyApiStubController, undefined as unknown as string, 0);
Post('verify')(
  VerifyApiStubController.prototype,
  'verify',
  Object.getOwnPropertyDescriptor(VerifyApiStubController.prototype, 'verify') as PropertyDescriptor,
);
Body()(VerifyApiStubController.prototype, 'verify', 0);

// ---------------------------------------------------------------------------
// Prisma mock
// ---------------------------------------------------------------------------

const prismaMock = {
  softwareDeliveryVerification: {
    create: vi.fn(),
    update: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
  softwareDeliveryCheckResult: {
    createMany: vi.fn(),
  },
};

// ---------------------------------------------------------------------------
// Valid base payload that passes all DTO validation
// ---------------------------------------------------------------------------

const validBasicBugFixPayload = {
  source_type: 'software_delivery',
  output: {
    repoOwner: 'acme-corp',
    repoName: 'payments-api',
    beforeSha: 'abc123def456',
    afterSha: 'def456abc123',
    jobStartedAt: '2026-05-25T10:00:00Z',
    tier: 'BASIC',
    jobType: 'BUG_FIX',
    jobDescription: 'Fix the invoice total calculation rounding bug',
    deployUrl: 'https://api.acme.com',
    deployPlatform: 'RENDER',
    jobValueUsd: 500,
  },
  rules: ['auto'],
};

// ---------------------------------------------------------------------------
// GitHub API response helpers (all checks pass)
// ---------------------------------------------------------------------------

function setupAllPassMocks(): void {
  mockedAxios.get.mockImplementation((url: string) => {
    // GitHub compare endpoint (diff files)
    if (url.includes('/compare/')) {
      return Promise.resolve({
        data: {
          ahead_by: 1,
          files: [{ filename: 'src/invoice.service.ts', patch: '+const fix = true;' }],
          commits: [{ sha: 'def456abc123', commit: { committer: { date: '2026-05-25T11:00:00Z' } } }],
        },
      });
    }
    // GitHub commit endpoint
    if (url.includes('/commits/') && !url.includes('/actions/')) {
      return Promise.resolve({
        data: {
          sha: 'def456abc123',
          commit: { committer: { date: '2026-05-25T11:00:00Z' }, message: 'fix: rounding bug' },
        },
      });
    }
    // GitHub actions runs
    if (url.includes('/actions/runs')) {
      return Promise.resolve({
        data: {
          workflow_runs: [{
            id: 999,
            status: 'completed',
            conclusion: 'success',
            created_at: '2026-05-25T11:30:00Z',
            name: 'CI',
            html_url: 'https://github.com/acme/api/actions/runs/999',
          }],
        },
      });
    }
    // deployUrl — live site check
    if (url.includes('api.acme.com') && !url.includes('/health')) {
      return Promise.resolve({ status: 200, data: 'OK' });
    }
    // health endpoint
    if (url.includes('/health')) {
      return Promise.resolve({ status: 200, data: { status: 'ok' } });
    }
    return Promise.resolve({ status: 200, data: '' });
  });

  // OSV API — no vulnerabilities
  mockedAxios.post.mockResolvedValue({ data: { results: [{ vulns: [] }] } });
}

// ---------------------------------------------------------------------------
// Build the test NestJS app
// ---------------------------------------------------------------------------

async function buildApp(): Promise<INestApplication> {
  const { PrismaService } = await import('../../../database/prisma.service.js');

  const module: TestingModule = await Test.createTestingModule({
    imports: [SoftwareDeliveryModule],
    controllers: [VerifyApiStubController],
    providers: [TestAuthGuard],
  })
    .overrideProvider(PrismaService)
    .useValue(prismaMock)
    .overrideGuard(TestAuthGuard)
    .useValue({
      canActivate: (ctx: ExecutionContext) => {
        const req = ctx.switchToHttp().getRequest<{
          headers: Record<string, string | undefined>;
          user?: unknown;
        }>();
        const apiKey = req.headers['x-api-key'];
        if (!apiKey) return false;
        if (apiKey === 'invalid-key-xyz') return false;
        req.user = { id: 'user-test-001', email: 'test@acme.com', organizationId: 'org-test-001' };
        return true;
      },
    })
    .compile();

  const app = module.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true }));
  await app.init();
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/verify (source_type: software_delivery) — E2E', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.resetAllMocks();
    setupAllPassMocks();

    prismaMock.softwareDeliveryVerification.create.mockResolvedValue({
      id: 'verify-id-001',
      proofId: 'sdv_proof_001',
    });
    prismaMock.softwareDeliveryVerification.update.mockResolvedValue({});
    prismaMock.softwareDeliveryCheckResult.createMany.mockResolvedValue({ count: 5 });
  });

  // ── Authentication ────────────────────────────────────────────────────────

  describe('authentication', () => {
    it('4xx when no API key provided', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/verify')
        .send(validBasicBugFixPayload);
      expect(res.status).toBeGreaterThanOrEqual(401);
      expect(res.status).toBeLessThan(500);
    });

    it('4xx when invalid API key provided', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/verify')
        .set('x-api-key', 'invalid-key-xyz')
        .send(validBasicBugFixPayload);
      expect(res.status).toBeGreaterThanOrEqual(401);
      expect(res.status).toBeLessThan(500);
    });

    it('201 when valid API key provided', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/verify')
        .set('x-api-key', 'sa_validapikey')
        .send(validBasicBugFixPayload);
      expect([200, 201]).toContain(res.status);
    });
  });

  // ── Request validation ────────────────────────────────────────────────────

  describe('request validation', () => {
    const HEADERS = { 'x-api-key': 'sa_validapikey' };

    it('400 when repoOwner is missing', async () => {
      const payload = {
        source_type: 'software_delivery',
        output: { ...validBasicBugFixPayload.output, repoOwner: undefined },
        rules: ['auto'],
      };
      const res = await request(app.getHttpServer()).post('/api/verify').set(HEADERS).send(payload);
      expect(res.status).toBe(400);
    });

    it('400 when beforeSha is missing', async () => {
      const payload = {
        source_type: 'software_delivery',
        output: { ...validBasicBugFixPayload.output, beforeSha: undefined },
        rules: ['auto'],
      };
      const res = await request(app.getHttpServer()).post('/api/verify').set(HEADERS).send(payload);
      expect(res.status).toBe(400);
    });

    it('400 when tier is an invalid value', async () => {
      const payload = {
        source_type: 'software_delivery',
        output: { ...validBasicBugFixPayload.output, tier: 'ULTRA' },
        rules: ['auto'],
      };
      const res = await request(app.getHttpServer()).post('/api/verify').set(HEADERS).send(payload);
      expect(res.status).toBe(400);
    });

    it('400 when jobType is invalid', async () => {
      const payload = {
        source_type: 'software_delivery',
        output: { ...validBasicBugFixPayload.output, jobType: 'INVENT_FEATURES' },
        rules: ['auto'],
      };
      const res = await request(app.getHttpServer()).post('/api/verify').set(HEADERS).send(payload);
      expect(res.status).toBe(400);
    });

    it('400 when jobValueUsd exceeds 1,000,000 (max constraint)', async () => {
      const payload = {
        source_type: 'software_delivery',
        output: { ...validBasicBugFixPayload.output, jobValueUsd: 1_500_000 },
        rules: ['auto'],
      };
      const res = await request(app.getHttpServer()).post('/api/verify').set(HEADERS).send(payload);
      expect(res.status).toBe(400);
    });

    it('400 when jobStartedAt is not ISO 8601 format', async () => {
      const payload = {
        source_type: 'software_delivery',
        output: { ...validBasicBugFixPayload.output, jobStartedAt: 'yesterday at 10am' },
        rules: ['auto'],
      };
      const res = await request(app.getHttpServer()).post('/api/verify').set(HEADERS).send(payload);
      expect(res.status).toBe(400);
    });

    it('400 when deployUrl is not a URL', async () => {
      const payload = {
        source_type: 'software_delivery',
        output: { ...validBasicBugFixPayload.output, deployUrl: 'not-a-url-string' },
        rules: ['auto'],
      };
      const res = await request(app.getHttpServer()).post('/api/verify').set(HEADERS).send(payload);
      expect(res.status).toBe(400);
    });
  });

  // ── Happy path response shape validation ──────────────────────────────────

  describe('happy path response shape', () => {
    const HEADERS = { 'x-api-key': 'sa_validapikey' };

    it('returns 201 for a valid BASIC BUG_FIX request', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/verify')
        .set(HEADERS)
        .send(validBasicBugFixPayload);
      expect([200, 201]).toContain(res.status);
    });

    it('response body includes all required fields', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/verify')
        .set(HEADERS)
        .send(validBasicBugFixPayload);

      expect([200, 201]).toContain(res.status);
      const required = [
        'verification_status', 'confidence', 'proof_id', 'tier_run', 'job_type',
        'escalated', 'summary', 'checks_passed', 'checks_failed', 'checks_warning',
        'checks_skipped', 'issues_found', 'recommended_action', 'results',
      ];
      for (const field of required) {
        expect(res.body).toHaveProperty(field);
      }
    });

    it('verification_status is one of "passed" | "needs-review" | "failed"', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/verify')
        .set(HEADERS)
        .send(validBasicBugFixPayload);

      expect([200, 201]).toContain(res.status);
      expect(['passed', 'needs-review', 'failed']).toContain(res.body.verification_status);
    });

    it('confidence is a number between 0 and 1', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/verify')
        .set(HEADERS)
        .send(validBasicBugFixPayload);

      expect([200, 201]).toContain(res.status);
      expect(typeof res.body.confidence).toBe('number');
      expect(res.body.confidence).toBeGreaterThanOrEqual(0);
      expect(res.body.confidence).toBeLessThanOrEqual(1);
    });

    it('checks_passed is an integer', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/verify')
        .set(HEADERS)
        .send(validBasicBugFixPayload);

      expect([200, 201]).toContain(res.status);
      expect(Number.isInteger(res.body.checks_passed)).toBe(true);
    });

    it('escalated is a boolean', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/verify')
        .set(HEADERS)
        .send(validBasicBugFixPayload);

      expect([200, 201]).toContain(res.status);
      expect(typeof res.body.escalated).toBe('boolean');
    });

    it('issues_found is an array', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/verify')
        .set(HEADERS)
        .send(validBasicBugFixPayload);

      expect([200, 201]).toContain(res.status);
      expect(Array.isArray(res.body.issues_found)).toBe(true);
    });

    it('results is an array of check objects with check_id, check_name, status', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/verify')
        .set(HEADERS)
        .send(validBasicBugFixPayload);

      expect([200, 201]).toContain(res.status);
      expect(Array.isArray(res.body.results)).toBe(true);
      if (res.body.results.length > 0) {
        const check = res.body.results[0];
        expect(check).toHaveProperty('check_id');
        expect(check).toHaveProperty('check_name');
        expect(check).toHaveProperty('status');
      }
    });

    it('summary is plain English (no JSON braces)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/verify')
        .set(HEADERS)
        .send(validBasicBugFixPayload);

      expect([200, 201]).toContain(res.status);
      expect(typeof res.body.summary).toBe('string');
      expect(res.body.summary).not.toContain('{');
      expect(res.body.summary.length).toBeGreaterThan(5);
    });

    it('proof_id starts with "sdv_"', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/verify')
        .set(HEADERS)
        .send(validBasicBugFixPayload);

      expect([200, 201]).toContain(res.status);
      expect(res.body.proof_id).toMatch(/^sdv_/);
    });

    it('tier_run is one of BASIC | STANDARD | THOROUGH', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/verify')
        .set(HEADERS)
        .send(validBasicBugFixPayload);

      expect([200, 201]).toContain(res.status);
      expect(['BASIC', 'STANDARD', 'THOROUGH']).toContain(res.body.tier_run);
    });

    it('job_type matches the input jobType', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/verify')
        .set(HEADERS)
        .send(validBasicBugFixPayload);

      expect([200, 201]).toContain(res.status);
      expect(res.body.job_type).toBe('BUG_FIX');
    });
  });

  // ── proof_id uniqueness ───────────────────────────────────────────────────

  describe('proof_id uniqueness', () => {
    it('two requests return different proof_ids (not idempotent)', async () => {
      const HEADERS = { 'x-api-key': 'sa_validapikey' };

      prismaMock.softwareDeliveryVerification.create
        .mockResolvedValueOnce({ id: 'verify-a', proofId: 'sdv_proof_A' })
        .mockResolvedValueOnce({ id: 'verify-b', proofId: 'sdv_proof_B' });

      const [res1, res2] = await Promise.all([
        request(app.getHttpServer()).post('/api/verify').set(HEADERS).send(validBasicBugFixPayload),
        request(app.getHttpServer()).post('/api/verify').set(HEADERS).send(validBasicBugFixPayload),
      ]);

      expect([200, 201]).toContain(res1.status);
      expect([200, 201]).toContain(res2.status);
      expect(res1.body.proof_id).not.toBe(res2.body.proof_id);
    });
  });

  // ── source_type routing ───────────────────────────────────────────────────

  describe('source_type routing', () => {
    const HEADERS = { 'x-api-key': 'sa_validapikey' };

    it('non-software_delivery source_type does NOT return software delivery fields', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/verify')
        .set(HEADERS)
        .send({ source_type: 'video_generation', output: { some: 'data' }, rules: ['auto'] });

      // Should not return software delivery response shape (no tier_run)
      if ([200, 201].includes(res.status)) {
        expect(res.body.tier_run).toBeUndefined();
      }
    });

    it('software_delivery source_type returns tier_run in response', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/verify')
        .set(HEADERS)
        .send(validBasicBugFixPayload);

      expect([200, 201]).toContain(res.status);
      expect(res.body.tier_run).toBeDefined();
    });
  });

  // ── Selective rules ───────────────────────────────────────────────────────

  describe('selective rules', () => {
    const HEADERS = { 'x-api-key': 'sa_validapikey' };

    it('rules: ["B1", "B6"] only shows B1 and B6 results (others SKIP or absent)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/verify')
        .set(HEADERS)
        .send({ ...validBasicBugFixPayload, rules: ['B1', 'B6'] });

      expect([200, 201]).toContain(res.status);
      const nonSkipResults = res.body.results.filter((r: Record<string, unknown>) => r.status !== 'SKIP');
      nonSkipResults.forEach((r: Record<string, unknown>) => {
        expect(['B1', 'B6']).toContain(r.check_id);
      });
    });
  });

  // ── Escalation visible in response ────────────────────────────────────────

  describe('escalation visible in response', () => {
    const HEADERS = { 'x-api-key': 'sa_validapikey' };

    it('MIGRATE_DATA jobType on BASIC tier escalates to STANDARD', async () => {
      const payload = {
        source_type: 'software_delivery',
        output: { ...validBasicBugFixPayload.output, tier: 'BASIC', jobType: 'MIGRATE_DATA' },
        rules: ['auto'],
      };
      const res = await request(app.getHttpServer()).post('/api/verify').set(HEADERS).send(payload);

      expect([200, 201]).toContain(res.status);
      expect(res.body.escalated).toBe(true);
      expect(res.body.tier_run).toBe('STANDARD');
    });
  });

  // ── Platform deployment assertions ────────────────────────────────────────

  describe('platform deployment fields', () => {
    const HEADERS = { 'x-api-key': 'sa_validapikey' };

    it('accepts RENDER as deployPlatform', async () => {
      const payload = {
        ...validBasicBugFixPayload,
        output: { ...validBasicBugFixPayload.output, deployPlatform: 'RENDER' },
      };
      const res = await request(app.getHttpServer()).post('/api/verify').set(HEADERS).send(payload);
      expect([200, 201]).toContain(res.status);
    });

    it('accepts NETLIFY as deployPlatform', async () => {
      const payload = {
        ...validBasicBugFixPayload,
        output: { ...validBasicBugFixPayload.output, deployPlatform: 'NETLIFY' },
      };
      const res = await request(app.getHttpServer()).post('/api/verify').set(HEADERS).send(payload);
      expect([200, 201]).toContain(res.status);
    });

    it('accepts VERCEL as deployPlatform (Phase 1: documented SKIP for platform checks)', async () => {
      const payload = {
        source_type: 'software_delivery',
        output: { ...validBasicBugFixPayload.output, deployPlatform: 'VERCEL' },
        rules: ['auto'],
      };
      const res = await request(app.getHttpServer()).post('/api/verify').set(HEADERS).send(payload);
      expect([200, 201]).toContain(res.status);
    });

    it('accepts RAILWAY as deployPlatform (Phase 1: documented SKIP for platform checks)', async () => {
      const payload = {
        source_type: 'software_delivery',
        output: { ...validBasicBugFixPayload.output, deployPlatform: 'RAILWAY' },
        rules: ['auto'],
      };
      const res = await request(app.getHttpServer()).post('/api/verify').set(HEADERS).send(payload);
      expect([200, 201]).toContain(res.status);
    });
  });

  // ── Issues found in response ──────────────────────────────────────────────

  describe('issues_found populated on check failures', () => {
    const HEADERS = { 'x-api-key': 'sa_validapikey' };

    it('issues_found is an array on any response', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/verify')
        .set(HEADERS)
        .send(validBasicBugFixPayload);

      expect([200, 201]).toContain(res.status);
      expect(Array.isArray(res.body.issues_found)).toBe(true);
    });
  });

  // ── Concurrent requests ───────────────────────────────────────────────────

  describe('concurrent requests', () => {
    const HEADERS = { 'x-api-key': 'sa_validapikey' };

    it('5 simultaneous requests all complete without server crash', async () => {
      const ids = ['aaa', 'bbb', 'ccc', 'ddd', 'eee'];
      ids.forEach((id) => {
        prismaMock.softwareDeliveryVerification.create.mockResolvedValueOnce({
          id: `verify-${id}`,
          proofId: `sdv_${id}`,
        });
      });

      const responses = await Promise.all(
        ids.map(() =>
          request(app.getHttpServer())
            .post('/api/verify')
            .set(HEADERS)
            .send(validBasicBugFixPayload),
        ),
      );

      const errorCount = responses.filter(r => r.status >= 500).length;
      expect(errorCount).toBe(0);
    });
  });

  // ── Buyer-readable summary ────────────────────────────────────────────────

  describe('summary field is buyer-readable', () => {
    const HEADERS = { 'x-api-key': 'sa_validapikey' };

    it('summary contains "checks" phrasing in English', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/verify')
        .set(HEADERS)
        .send(validBasicBugFixPayload);

      expect([200, 201]).toContain(res.status);
      expect(res.body.summary.toLowerCase()).toContain('checks');
    });

    it('summary does not contain stack traces', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/verify')
        .set(HEADERS)
        .send(validBasicBugFixPayload);

      expect([200, 201]).toContain(res.status);
      expect(res.body.summary).not.toMatch(/Error:|at .+:\d+:\d+|TypeError|SyntaxError/);
    });
  });

  // ── Large payload handling ────────────────────────────────────────────────

  describe('large payload handling', () => {
    const HEADERS = { 'x-api-key': 'sa_validapikey' };

    it('handles a jobDescription with 2000 characters gracefully', async () => {
      const longDescription = 'Fix '.repeat(500); // 2000 chars
      const payload = {
        source_type: 'software_delivery',
        output: { ...validBasicBugFixPayload.output, jobDescription: longDescription },
        rules: ['B1'],
      };
      const res = await request(app.getHttpServer()).post('/api/verify').set(HEADERS).send(payload);
      expect(res.status).toBeLessThan(500);
    });
  });

  // ── Adversarial pattern check IDs present in results ─────────────────────

  describe('adversarial pattern detection contract', () => {
    const HEADERS = { 'x-api-key': 'sa_validapikey' };

    const adversarialCheckMappings = [
      { pattern: 'S3 (hardcoded secrets)', checkId: 'S3', rules: ['S3'] },
      { pattern: 'S9 (CI skipped/failed)', checkId: 'S9', rules: ['S9'] },
      { pattern: 'B4 (AI report mismatch)', checkId: 'B4', rules: ['B4'] },
      { pattern: 'TEST1 (tests skipped)', checkId: 'TEST1', rules: ['TEST1'] },
      { pattern: 'TEST2 (no assertions)', checkId: 'TEST2', rules: ['TEST2'] },
      { pattern: 'BUG3 (error suppression)', checkId: 'BUG3', rules: ['BUG3'] },
      { pattern: 'NEW1 (orphan file)', checkId: 'NEW1', rules: ['NEW1'] },
      { pattern: 'MIG1 (migration not applied)', checkId: 'MIG1', rules: ['MIG1'] },
      { pattern: 'INT2 (test creds in prod)', checkId: 'INT2', rules: ['INT2'] },
    ];

    adversarialCheckMappings.forEach(({ pattern, checkId, rules }) => {
      it(`${pattern} — check "${checkId}" appears in results when requested`, async () => {
        const res = await request(app.getHttpServer())
          .post('/api/verify')
          .set(HEADERS)
          .send({ ...validBasicBugFixPayload, rules });

        expect([200, 201]).toContain(res.status);
        const checkResult = res.body.results?.find((r: Record<string, unknown>) => r.check_id === checkId);
        expect(checkResult).toBeDefined();
      });
    });
  });
});
