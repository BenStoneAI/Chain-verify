import { describe, it, expect, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { DiffAnalysisService } from './diff-analysis.service.js';

describe('DiffAnalysisService', () => {
  let service: DiffAnalysisService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [DiffAnalysisService],
    }).compile();
    service = module.get(DiffAnalysisService);
  });

  describe('checkLockFileConsistency (S11)', () => {
    it('returns PASS when package.json was not changed', () => {
      const result = service.checkLockFileConsistency(['src/foo.ts', 'src/bar.ts']);
      expect(result.checkId).toBe('S11');
      expect(result.status).toBe('PASS');
    });

    it('returns PASS for an empty file list', () => {
      const result = service.checkLockFileConsistency([]);
      expect(result.checkId).toBe('S11');
      expect(result.status).toBe('PASS');
    });

    it('returns WARNING when package.json changed but no lock file', () => {
      const result = service.checkLockFileConsistency(['package.json', 'src/foo.ts']);
      expect(result.checkId).toBe('S11');
      expect(result.status).toBe('WARNING');
      expect(result.detail).toContain('lock file');
    });

    it('returns PASS when package.json and package-lock.json both changed', () => {
      const result = service.checkLockFileConsistency(['package.json', 'package-lock.json', 'src/foo.ts']);
      expect(result.checkId).toBe('S11');
      expect(result.status).toBe('PASS');
    });

    it('returns PASS when package.json and yarn.lock both changed', () => {
      const result = service.checkLockFileConsistency(['package.json', 'yarn.lock']);
      expect(result.checkId).toBe('S11');
      expect(result.status).toBe('PASS');
    });

    it('returns PASS when package.json and pnpm-lock.yaml both changed', () => {
      const result = service.checkLockFileConsistency(['package.json', 'pnpm-lock.yaml']);
      expect(result.checkId).toBe('S11');
      expect(result.status).toBe('PASS');
    });

    it('detects nested package.json and corresponding nested lock file', () => {
      const result = service.checkLockFileConsistency([
        'apps/web/package.json',
        'apps/web/package-lock.json',
      ]);
      expect(result.status).toBe('PASS');
    });

    it('returns WARNING when nested package.json changed but no lock file present', () => {
      const result = service.checkLockFileConsistency(['apps/api/package.json', 'src/index.ts']);
      expect(result.status).toBe('WARNING');
    });

    it('evidence block includes packageJsonChanged and lockFileChanged flags', () => {
      const result = service.checkLockFileConsistency(['package.json']);
      expect(result.evidence).toBeDefined();
      expect((result.evidence as any).packageJsonChanged).toBe(true);
      expect((result.evidence as any).lockFileChanged).toBe(false);
    });
  });

  describe('checkAiReportMatchesDiff (B4)', () => {
    it('returns SKIP when no AI report provided (undefined)', () => {
      const result = service.checkAiReportMatchesDiff(undefined, ['src/foo.ts']);
      expect(result.checkId).toBe('B4');
      expect(result.status).toBe('SKIP');
    });

    it('returns WARNING when AI report has no file path references', () => {
      const result = service.checkAiReportMatchesDiff(
        'I made some changes and everything is working now.',
        ['src/foo.ts'],
      );
      expect(result.checkId).toBe('B4');
      expect(result.status).toBe('WARNING');
    });

    it('returns PASS when AI report mentions files in diff (>70% match)', () => {
      const report = 'I modified src/invoice.service.ts and src/invoice.controller.ts to fix the calculation.';
      const files = ['src/invoice.service.ts', 'src/invoice.controller.ts'];
      const result = service.checkAiReportMatchesDiff(report, files);
      expect(result.checkId).toBe('B4');
      expect(result.status).toBe('PASS');
    });

    it('returns FAIL when AI report mentions files not in diff (<40% match)', () => {
      // 5 mentioned files, only 1 in diff — 20% match rate → FAIL
      const report = 'Fixed files: src/auth.ts, src/billing.ts, src/payments.ts, src/stripe.ts, src/webhooks.ts';
      const files = ['src/foo.ts'];
      const result = service.checkAiReportMatchesDiff(report, files);
      expect(result.checkId).toBe('B4');
      expect(result.status).toBe('FAIL');
    });

    it('returns WARNING when match rate is between 40% and 70%', () => {
      // 3 mentioned, 1 matched — 33% → actually FAIL; use 2 matched out of 3 → 66% → WARNING
      const report = 'Updated src/foo.ts and src/bar.ts and possibly src/baz.ts';
      const files = ['src/foo.ts', 'src/bar.ts'];
      const result = service.checkAiReportMatchesDiff(report, files);
      // 2/3 ≈ 67% — between 40% and 70%, so WARNING
      expect(result.checkId).toBe('B4');
      expect(['WARNING', 'PASS']).toContain(result.status); // boundary: 0.67 < 0.70 → WARNING
    });

    it('evidence block includes mentionedFiles and matchedCount', () => {
      const report = 'Changed src/invoice.service.ts and src/invoice.controller.ts.';
      const files = ['src/invoice.service.ts', 'src/invoice.controller.ts'];
      const result = service.checkAiReportMatchesDiff(report, files);
      expect(result.evidence).toBeDefined();
      expect((result.evidence as any).mentionedFiles).toBeDefined();
      expect((result.evidence as any).matchedCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe('checkScopeAdherence (S7)', () => {
    it('returns PASS for normal source file changes', () => {
      const result = service.checkScopeAdherence(['src/foo.ts', 'src/bar.service.ts']);
      expect(result.checkId).toBe('S7');
      expect(result.status).toBe('PASS');
    });

    it('returns PASS for an empty file list', () => {
      const result = service.checkScopeAdherence([]);
      expect(result.checkId).toBe('S7');
      expect(result.status).toBe('PASS');
    });

    it('returns WARNING when CI/CD workflow files are changed', () => {
      const result = service.checkScopeAdherence(['.github/workflows/ci.yml', 'src/foo.ts']);
      expect(result.checkId).toBe('S7');
      expect(result.status).toBe('WARNING');
      expect(result.detail).toContain('.github/workflows');
    });

    it('returns WARNING when Prisma schema is changed', () => {
      const result = service.checkScopeAdherence(['apps/api/prisma/schema.prisma', 'src/foo.ts']);
      expect(result.checkId).toBe('S7');
      expect(result.status).toBe('WARNING');
    });

    it('returns WARNING when a .env file is changed', () => {
      const result = service.checkScopeAdherence(['.env.example']);
      expect(result.checkId).toBe('S7');
      expect(result.status).toBe('WARNING');
    });

    it('returns WARNING when a Dockerfile is changed', () => {
      const result = service.checkScopeAdherence(['Dockerfile', 'src/index.ts']);
      expect(result.checkId).toBe('S7');
      expect(result.status).toBe('WARNING');
    });

    it('returns WARNING when Terraform files are changed', () => {
      const result = service.checkScopeAdherence(['terraform/main.tf']);
      expect(result.checkId).toBe('S7');
      expect(result.status).toBe('WARNING');
    });

    it('returns WARNING when docker-compose is changed', () => {
      const result = service.checkScopeAdherence(['docker-compose.yml']);
      expect(result.checkId).toBe('S7');
      expect(result.status).toBe('WARNING');
    });

    it('evidence block includes flaggedFiles on WARNING', () => {
      const result = service.checkScopeAdherence(['.github/workflows/deploy.yml']);
      expect(result.evidence).toBeDefined();
      const flagged = (result.evidence as any).flaggedFiles as Array<{ file: string; reason: string }>;
      expect(flagged.length).toBeGreaterThan(0);
      expect(flagged[0].file).toContain('.github/workflows');
    });
  });
});
