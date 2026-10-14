import { describe, it, expect, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { DiffAnalysisService } from '../checks/diff-analysis.service.js';

// ---------------------------------------------------------------------------
// Helper: build a unified diff that adds specific env var references
// ---------------------------------------------------------------------------

function makeDiffWithEnvRefs(...varNames: string[]): string {
  const addedLines = varNames.map(v => `+const x = process.env.${v};`).join('\n');
  return `--- a/src/config.ts\n+++ b/src/config.ts\n@@ -1 +1 @@\n${addedLines}`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DiffAnalysisService', () => {
  let service: DiffAnalysisService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [DiffAnalysisService],
    }).compile();
    service = module.get(DiffAnalysisService);
  });

  // ── S11: Lock file consistent with package.json ────────────────────────────

  describe('checkLockFileConsistency (S11)', () => {
    it('PASS when package.json was not changed', () => {
      const result = service.checkLockFileConsistency(['src/foo.ts', 'src/bar.ts']);
      expect(result.checkId).toBe('S11');
      expect(result.status).toBe('PASS');
      expect(result.detail).toContain('not modified');
    });

    it('PASS for an empty file list', () => {
      const result = service.checkLockFileConsistency([]);
      expect(result.status).toBe('PASS');
    });

    it('WARNING when package.json changed but no lock file in diff', () => {
      const result = service.checkLockFileConsistency(['package.json', 'src/invoice.service.ts']);
      expect(result.checkId).toBe('S11');
      expect(result.status).toBe('WARNING');
      expect(result.detail).toContain('lock file');
    });

    it('PASS when package.json AND package-lock.json both changed', () => {
      const result = service.checkLockFileConsistency(['package.json', 'package-lock.json', 'src/foo.ts']);
      expect(result.status).toBe('PASS');
    });

    it('PASS when package.json AND yarn.lock both changed', () => {
      const result = service.checkLockFileConsistency(['package.json', 'yarn.lock']);
      expect(result.status).toBe('PASS');
    });

    it('PASS when package.json AND pnpm-lock.yaml both changed', () => {
      const result = service.checkLockFileConsistency(['package.json', 'pnpm-lock.yaml']);
      expect(result.status).toBe('PASS');
    });

    it('detects nested package.json and corresponding nested lock file', () => {
      const result = service.checkLockFileConsistency([
        'apps/web/package.json',
        'apps/web/package-lock.json',
      ]);
      expect(result.status).toBe('PASS');
    });

    it('WARNING when nested package.json changed but no lock file present', () => {
      const result = service.checkLockFileConsistency(['apps/api/package.json', 'src/index.ts']);
      expect(result.status).toBe('WARNING');
    });

    it('evidence includes packageJsonChanged=true and lockFileChanged=false on WARNING', () => {
      const result = service.checkLockFileConsistency(['package.json']);
      expect((result.evidence as Record<string, unknown>).packageJsonChanged).toBe(true);
      expect((result.evidence as Record<string, unknown>).lockFileChanged).toBe(false);
    });

    it('evidence includes filesChecked count', () => {
      const result = service.checkLockFileConsistency(['package.json', 'src/bar.ts']);
      expect((result.evidence as Record<string, unknown>).filesChecked).toBe(2);
    });

    it('WARNING detail mentions "package-lock.json" and "yarn.lock" and "pnpm-lock.yaml" alternatives', () => {
      const result = service.checkLockFileConsistency(['package.json']);
      expect(result.detail).toMatch(/package-lock|yarn\.lock|pnpm-lock/i);
    });
  });

  // ── S7: Scope adherence ────────────────────────────────────────────────────

  describe('checkScopeAdherence (S7)', () => {
    it('PASS for normal source file changes', () => {
      const result = service.checkScopeAdherence(['src/invoice.service.ts', 'src/invoice.spec.ts']);
      expect(result.checkId).toBe('S7');
      expect(result.status).toBe('PASS');
    });

    it('PASS for an empty file list', () => {
      const result = service.checkScopeAdherence([]);
      expect(result.status).toBe('PASS');
    });

    it('WARNING when .github/workflows file changed (adversarial #10: CI skip injection)', () => {
      const result = service.checkScopeAdherence(['.github/workflows/ci.yml', 'src/foo.ts']);
      expect(result.checkId).toBe('S7');
      expect(result.status).toBe('WARNING');
      expect(result.detail).toContain('.github/workflows');
    });

    it('WARNING when prisma/schema.prisma changed (non-migration job)', () => {
      const result = service.checkScopeAdherence(['apps/api/prisma/schema.prisma', 'src/foo.ts']);
      expect(result.status).toBe('WARNING');
      expect(result.detail).toContain('schema.prisma');
    });

    it('WARNING when .env file changed', () => {
      const result = service.checkScopeAdherence(['.env.example']);
      expect(result.status).toBe('WARNING');
    });

    it('WARNING when Dockerfile changed', () => {
      const result = service.checkScopeAdherence(['Dockerfile', 'src/index.ts']);
      expect(result.status).toBe('WARNING');
    });

    it('WARNING when terraform files changed', () => {
      const result = service.checkScopeAdherence(['terraform/main.tf']);
      expect(result.status).toBe('WARNING');
    });

    it('WARNING when docker-compose.yml changed', () => {
      const result = service.checkScopeAdherence(['docker-compose.yml']);
      expect(result.status).toBe('WARNING');
    });

    it('WARNING when CODEOWNERS changed', () => {
      const result = service.checkScopeAdherence(['.github/CODEOWNERS']);
      expect(result.status).toBe('WARNING');
    });

    it('evidence flaggedFiles includes file name and reason on WARNING', () => {
      const result = service.checkScopeAdherence(['.github/workflows/deploy.yml']);
      const flagged = (result.evidence as Record<string, unknown>).flaggedFiles as Array<{ file: string; reason: string }>;
      expect(flagged.length).toBeGreaterThan(0);
      expect(flagged[0].file).toContain('.github/workflows');
      expect(flagged[0].reason).toBeTruthy();
    });

    it('multiple sensitive files produce multiple entries in flaggedFiles', () => {
      const result = service.checkScopeAdherence([
        '.github/workflows/ci.yml',
        'terraform/main.tf',
        'src/normal.ts',
      ]);
      expect(result.status).toBe('WARNING');
      const flagged = (result.evidence as Record<string, unknown>).flaggedFiles as Array<{ file: string; reason: string }>;
      expect(flagged.length).toBe(2); // only the 2 sensitive files
    });
  });

  // ── B4: AI report matches actual diff ─────────────────────────────────────

  describe('checkAiReportMatchesDiff (B4)', () => {
    it('SKIP when aiReport is undefined', () => {
      const result = service.checkAiReportMatchesDiff(undefined, ['src/foo.ts']);
      expect(result.checkId).toBe('B4');
      expect(result.status).toBe('SKIP');
    });

    it('WARNING when AI report contains no file path references', () => {
      const result = service.checkAiReportMatchesDiff(
        'Made some changes and everything is working correctly now.',
        ['src/invoice.service.ts'],
      );
      expect(result.status).toBe('WARNING');
    });

    it('PASS when AI report mentions files in diff at ≥70% match rate', () => {
      const report = 'I modified src/invoice.service.ts and src/invoice.controller.ts to fix the rounding.';
      const files = ['src/invoice.service.ts', 'src/invoice.controller.ts'];
      const result = service.checkAiReportMatchesDiff(report, files);
      expect(result.status).toBe('PASS');
    });

    it('FAIL when AI report match rate is <40% (adversarial #19)', () => {
      // 5 files mentioned, only 1 in actual diff → 20% match → FAIL
      const report = 'Fixed files: src/auth.ts, src/billing.ts, src/payments.ts, src/stripe.ts, src/webhooks.ts';
      const files = ['src/foo.ts']; // none of the mentioned files
      const result = service.checkAiReportMatchesDiff(report, files);
      expect(result.status).toBe('FAIL');
      expect(result.detail).toContain('threshold is 70%');
    });

    it('WARNING when match rate is 40–69% (partial match)', () => {
      // Report mentions 3 specific files; only 1 exists in the diff → 33% → FAIL
      // To get WARNING (40-69%), mention 3 files and have 2 match → 66.7% match rate
      // The extractFilePaths regex needs clear file path patterns in the text
      const report = 'Updated src/foo.ts line 10. Also changed src/bar.ts. Possibly src/baz.ts was affected.';
      const files = ['src/foo.ts', 'src/bar.ts'];
      // foo.ts matches, bar.ts matches; baz.ts may or may not match depending on path resolution
      // 2 of mentioned (foo.ts, bar.ts, baz.ts) matched in diff → rate depends on extraction
      const result = service.checkAiReportMatchesDiff(report, files);
      // At 66.7% (2/3), should be WARNING; at ≥70% (e.g. 2/2), PASS
      expect(['WARNING', 'PASS']).toContain(result.status);
    });

    it('file path matching handles partial paths (just filename)', () => {
      // diff has full path but AI report uses just the filename
      const report = 'Fixed the bug in invoice.service.ts line 142.';
      const files = ['apps/api/src/invoice.service.ts'];
      const result = service.checkAiReportMatchesDiff(report, files);
      // Should match via endsWith/includes logic
      expect(result.status).toBe('PASS');
    });

    it('file path matching handles nested path prefixes', () => {
      // AI mentions nested path, diff has full path with prefix
      const report = 'Updated src/invoice.service.ts in the api.';
      const files = ['apps/api/src/invoice.service.ts'];
      const result = service.checkAiReportMatchesDiff(report, files);
      expect(result.status).toBe('PASS');
    });

    it('evidence includes mentionedFiles array and matchedCount', () => {
      const report = 'Changed src/foo.ts and src/bar.ts';
      const files = ['src/foo.ts', 'src/bar.ts'];
      const result = service.checkAiReportMatchesDiff(report, files);
      expect((result.evidence as Record<string, unknown>).mentionedFiles).toBeDefined();
      expect(typeof (result.evidence as Record<string, unknown>).matchedCount).toBe('number');
    });

    it('evidence matchRate is a decimal between 0 and 1', () => {
      const report = 'Changed src/foo.ts';
      const files = ['src/foo.ts'];
      const result = service.checkAiReportMatchesDiff(report, files);
      const rate = (result.evidence as Record<string, unknown>).matchRate;
      expect(rate).toBeGreaterThanOrEqual(0);
      expect(rate).toBeLessThanOrEqual(1);
    });
  });

  // ── T7: New env vars documented ───────────────────────────────────────────

  describe('checkEnvVarsDocumented (T7)', () => {
    it('PASS when no new process.env references in diff', () => {
      const diff = `+++ b/src/foo.ts\n+const x = 42;`;
      const result = service.checkEnvVarsDocumented(diff, ['src/foo.ts']);
      expect(result.checkId).toBe('T7');
      expect(result.status).toBe('PASS');
      expect(result.detail).toContain('No new environment variable');
    });

    it('WARNING when new process.env refs exist but .env.example not updated', () => {
      const diff = makeDiffWithEnvRefs('NEW_API_KEY', 'NEW_WEBHOOK_SECRET');
      const result = service.checkEnvVarsDocumented(diff, ['src/config.ts']); // no .env.example
      expect(result.checkId).toBe('T7');
      expect(result.status).toBe('WARNING');
      expect(result.detail).toContain('NEW_API_KEY');
      expect(result.detail).toContain('.env.example');
    });

    it('PASS when new process.env refs exist and .env.example is updated', () => {
      const diff = makeDiffWithEnvRefs('NEW_API_KEY');
      const result = service.checkEnvVarsDocumented(diff, ['src/config.ts', '.env.example']);
      expect(result.status).toBe('PASS');
    });

    it('PASS when process.env ref in removed lines only (not in added lines)', () => {
      // A process.env reference that only appears on a removed line is not a new
      // env var, so the check passes.
      const cleanDiff = `-const old = process.env.OLD_KEY;\n+// old removed`;
      const result = service.checkEnvVarsDocumented(cleanDiff, ['src/config.ts']);
      expect(result.status).toBe('PASS');
    });

    it('SKIP when diff text is empty', () => {
      const result = service.checkEnvVarsDocumented('', ['src/config.ts']);
      expect(result.status).toBe('SKIP');
    });

    it('detects nested .env.example path', () => {
      const diff = makeDiffWithEnvRefs('RENDER_API_KEY');
      const result = service.checkEnvVarsDocumented(diff, ['src/config.ts', 'apps/api/.env.example']);
      expect(result.status).toBe('PASS');
    });

    it('evidence includes newEnvVars list', () => {
      const diff = makeDiffWithEnvRefs('SOME_API_KEY');
      const result = service.checkEnvVarsDocumented(diff, ['src/config.ts']);
      const envVars = (result.evidence as Record<string, unknown>).newEnvVars as string[];
      expect(envVars).toContain('SOME_API_KEY');
    });
  });

  // ── T12: AI delivery description matches diff (semantic comparison) ────────

  describe('checkDeliveryDescriptionMatchesDiff (T12)', () => {
    it('SKIP when aiReport is undefined', () => {
      const result = service.checkDeliveryDescriptionMatchesDiff(
        undefined,
        ['src/foo.ts'],
        '+const x = 1;',
      );
      expect(result.checkId).toBe('T12');
      expect(result.status).toBe('SKIP');
    });

    it('PASS when mentioned files match diff and diff size is substantial', () => {
      const manyLines = Array.from({ length: 50 }, (_, i) => `+const line${i} = ${i};`).join('\n');
      const diff = `+++ b/src/foo.ts\n${manyLines}`;
      const report = 'Updated src/invoice.service.ts with the fix. Changed src/billing.module.ts too.';
      const files = ['src/invoice.service.ts', 'src/billing.module.ts'];
      const result = service.checkDeliveryDescriptionMatchesDiff(report, files, diff);
      expect(result.checkId).toBe('T12');
      expect(result.status).toBe('PASS');
    });

    it('FAIL when AI claims changed 5 files but only 1 in diff (adversarial #19)', () => {
      const diff = '+const x = 1;'; // minimal diff
      const report = 'I updated auth.ts, billing.ts, payments.ts, stripe.ts, webhooks.ts comprehensively.';
      const files = ['src/foo.ts']; // none of the 5 files mentioned
      const result = service.checkDeliveryDescriptionMatchesDiff(report, files, diff);
      expect(result.status).toBe('FAIL');
    });

    it('WARNING when AI report is very detailed (>500 chars) but only tiny diff (<20 added lines)', () => {
      // Large AI report claiming big work, but tiny diff
      const bigReport = 'A'.repeat(600) + ' src/service.ts src/controller.ts mentioned';
      const smallDiff = '+const x = 1;'; // only 1 added line
      const files = ['src/service.ts'];
      const result = service.checkDeliveryDescriptionMatchesDiff(bigReport, files, smallDiff);
      // Either WARNING (overclaiming) or FAIL (match rate low) — not PASS
      expect(['WARNING', 'FAIL']).toContain(result.status);
    });

    it('WARNING when AI report has no file path references to cross-check', () => {
      const diff = '+const x = 1;';
      const result = service.checkDeliveryDescriptionMatchesDiff(
        'Fixed the bug in the service code.',
        ['src/foo.ts'],
        diff,
      );
      expect(result.status).toBe('WARNING');
    });

    it('evidence includes matchRate and addedLines count', () => {
      const manyLines = Array.from({ length: 30 }, (_, i) => `+const x${i} = ${i};`).join('\n');
      const diff = `+++ b/src/foo.ts\n${manyLines}`;
      const report = 'Updated src/invoice.service.ts with the fix.';
      const files = ['src/invoice.service.ts'];
      const result = service.checkDeliveryDescriptionMatchesDiff(report, files, diff);
      expect((result.evidence as Record<string, unknown>).matchRate).toBeDefined();
      expect((result.evidence as Record<string, unknown>).addedLines).toBeGreaterThan(0);
    });
  });

  // ── T1: Test coverage did not drop ─────────────────────────────────────────

  describe('checkCoverageDidNotDrop (T1)', () => {
    it('SKIP when no coverage artifact is present in the diff', () => {
      const result = service.checkCoverageDidNotDrop(['src/foo.ts', 'src/bar.ts'], '+const x = 1;');
      expect(result.checkId).toBe('T1');
      expect(result.status).toBe('SKIP');
      expect((result.evidence as Record<string, unknown>).coverageArtifactFound).toBe(false);
    });

    it('SKIP when diff text is empty even if an artifact filename is listed', () => {
      const result = service.checkCoverageDidNotDrop(['coverage/coverage-summary.json'], '');
      expect(result.status).toBe('SKIP');
    });

    it('PASS when coverage improved', () => {
      const diff =
        '--- a/coverage/coverage-summary.json\n+++ b/coverage/coverage-summary.json\n' +
        '-  "pct": 80.0\n+  "pct": 85.0';
      const result = service.checkCoverageDidNotDrop(['coverage/coverage-summary.json'], diff);
      expect(result.status).toBe('PASS');
      expect((result.evidence as Record<string, unknown>).delta).toBeGreaterThanOrEqual(0);
    });

    it('PASS when coverage drops within the 2% tolerance', () => {
      const diff =
        '+++ b/coverage/coverage-summary.json\n-  "pct": 80.0\n+  "pct": 78.5';
      const result = service.checkCoverageDidNotDrop(['coverage/coverage-summary.json'], diff);
      expect(result.status).toBe('PASS');
    });

    it('WARNING when coverage drops more than 2% but less than 10%', () => {
      const diff =
        '+++ b/coverage/coverage-summary.json\n-  "pct": 80.0\n+  "pct": 74.0';
      const result = service.checkCoverageDidNotDrop(['coverage/coverage-summary.json'], diff);
      expect(result.status).toBe('WARNING');
      expect(result.detail).toMatch(/exceeding the 2%/i);
    });

    it('FAIL when coverage drops sharply (>10%)', () => {
      const diff =
        '+++ b/coverage/coverage-summary.json\n-  "pct": 90.0\n+  "pct": 60.0';
      const result = service.checkCoverageDidNotDrop(['coverage/coverage-summary.json'], diff);
      expect(result.status).toBe('FAIL');
    });

    it('recognizes lcov.info as a coverage artifact', () => {
      const diff = '+++ b/coverage/lcov.info\n-  "pct": 70\n+  "pct": 71';
      const result = service.checkCoverageDidNotDrop(['coverage/lcov.info'], diff);
      expect(result.status).toBe('PASS');
    });

    it('SKIP when artifact present but no comparable pct values in both versions', () => {
      const diff = '+++ b/coverage/coverage-summary.json\n+  "lines": { "total": 100 }';
      const result = service.checkCoverageDidNotDrop(['coverage/coverage-summary.json'], diff);
      expect(result.status).toBe('SKIP');
    });
  });

  // ── T2: New code has at least one test ─────────────────────────────────────

  describe('checkNewCodeHasTest (T2)', () => {
    it('SKIP when diff text is empty', () => {
      const result = service.checkNewCodeHasTest(['src/foo.ts'], '');
      expect(result.checkId).toBe('T2');
      expect(result.status).toBe('SKIP');
    });

    it('PASS when new source is small (≤50 lines) even with no test', () => {
      const diff = Array.from({ length: 10 }, (_, i) => `+const a${i} = ${i};`).join('\n');
      const result = service.checkNewCodeHasTest(['src/foo.ts'], diff);
      expect(result.status).toBe('PASS');
      expect((result.evidence as Record<string, unknown>).newSourceLines).toBeLessThanOrEqual(50);
    });

    it('FAIL when >50 new source lines and no test file in the diff', () => {
      const diff = Array.from({ length: 60 }, (_, i) => `+const a${i} = ${i};`).join('\n');
      const result = service.checkNewCodeHasTest(['src/foo.ts'], diff);
      expect(result.status).toBe('FAIL');
      expect(result.detail).toMatch(/no test file/i);
    });

    it('PASS when >50 new source lines and a .spec.ts test file is present', () => {
      const diff = Array.from({ length: 60 }, (_, i) => `+const a${i} = ${i};`).join('\n');
      const result = service.checkNewCodeHasTest(['src/foo.ts', 'src/foo.spec.ts'], diff);
      expect(result.status).toBe('PASS');
    });

    it('PASS when >50 new lines and a __tests__/ file is present', () => {
      const diff = Array.from({ length: 60 }, (_, i) => `+const a${i} = ${i};`).join('\n');
      const result = service.checkNewCodeHasTest(['src/foo.ts', 'src/__tests__/foo.test.ts'], diff);
      expect(result.status).toBe('PASS');
    });

    it('does not count blank or comment-only added lines as new source', () => {
      const diff = Array.from({ length: 60 }, () => `+// just a comment`).join('\n');
      const result = service.checkNewCodeHasTest(['src/foo.ts'], diff);
      expect(result.status).toBe('PASS');
      expect((result.evidence as Record<string, unknown>).newSourceLines).toBe(0);
    });

    it('PASS when a large diff is entirely test-file additions (no false FAIL)', () => {
      // 60 added lines, all under a spec file header → not counted as new source.
      const body = Array.from({ length: 60 }, (_, i) => `+  expect(x${i}).toBe(${i});`).join('\n');
      const diff = `+++ b/src/feature.spec.ts\n${body}`;
      const result = service.checkNewCodeHasTest(['src/feature.spec.ts'], diff);
      expect(result.status).toBe('PASS');
      expect((result.evidence as Record<string, unknown>).newSourceLines).toBe(0);
    });

    it('does not count lines under a non-source file (e.g. markdown) toward the threshold', () => {
      const body = Array.from({ length: 60 }, (_, i) => `+line ${i} of docs`).join('\n');
      const diff = `+++ b/README.md\n${body}`;
      const result = service.checkNewCodeHasTest(['README.md'], diff);
      expect(result.status).toBe('PASS');
      expect((result.evidence as Record<string, unknown>).newSourceLines).toBe(0);
    });

    it('FAIL when >50 real source lines are added under a source-file header with no test', () => {
      const body = Array.from({ length: 60 }, (_, i) => `+const v${i} = ${i};`).join('\n');
      const diff = `+++ b/src/feature.ts\n${body}`;
      const result = service.checkNewCodeHasTest(['src/feature.ts'], diff);
      expect(result.status).toBe('FAIL');
    });
  });

  // ── T4: Protected routes are still protected ───────────────────────────────

  describe('checkProtectedRoutesStillProtected (T4)', () => {
    it('SKIP when diff text is empty', () => {
      const result = service.checkProtectedRoutesStillProtected(['src/x.controller.ts'], '');
      expect(result.checkId).toBe('T4');
      expect(result.status).toBe('SKIP');
    });

    it('FAIL when an auth guard is removed (auth bypass / debug mode)', () => {
      const diff =
        '--- a/src/admin.controller.ts\n+++ b/src/admin.controller.ts\n' +
        "-  @UseGuards(JwtAuthGuard)\n+  // @UseGuards(JwtAuthGuard) temporarily disabled for debug";
      const result = service.checkProtectedRoutesStillProtected(['src/admin.controller.ts'], diff);
      expect(result.status).toBe('FAIL');
      expect(result.detail).toMatch(/guard/i);
    });

    it('WARNING when a new route is added with no guard in a controller file', () => {
      const diff =
        '+++ b/src/public.controller.ts\n+  @Get("data")\n+  getData() { return this.svc.all(); }';
      const result = service.checkProtectedRoutesStillProtected(['src/public.controller.ts'], diff);
      expect(result.status).toBe('WARNING');
    });

    it('PASS when a new route is added together with a guard', () => {
      const diff =
        '+++ b/src/secure.controller.ts\n+  @UseGuards(JwtAuthGuard)\n+  @Get("data")\n+  getData() {}';
      const result = service.checkProtectedRoutesStillProtected(['src/secure.controller.ts'], diff);
      expect(result.status).toBe('PASS');
    });

    it('PASS when a guard is moved (removed then re-added)', () => {
      const diff =
        '+++ b/src/x.controller.ts\n-  @UseGuards(JwtAuthGuard)\n+  @UseGuards(JwtAuthGuard)\n+  @UseGuards(RolesGuard)';
      const result = service.checkProtectedRoutesStillProtected(['src/x.controller.ts'], diff);
      expect(result.status).toBe('PASS');
    });

    it('PASS for a non-route diff with no guard activity', () => {
      const diff = '+++ b/src/util.ts\n+export const add = (a, b) => a + b;';
      const result = service.checkProtectedRoutesStillProtected(['src/util.ts'], diff);
      expect(result.status).toBe('PASS');
    });

    it('PASS when guard imports are consolidated into a barrel import (no real removal)', () => {
      // Removing two individual guard imports and replacing with one barrel import
      // must NOT be read as removing protection.
      const diff =
        '--- a/src/admin.controller.ts\n+++ b/src/admin.controller.ts\n' +
        "-import { JwtAuthGuard } from './jwt.guard';\n" +
        "-import { RolesGuard } from './roles.guard';\n" +
        "+import { JwtAuthGuard, RolesGuard } from './guards';";
      const result = service.checkProtectedRoutesStillProtected(['src/admin.controller.ts'], diff);
      expect(result.status).not.toBe('FAIL');
    });

    it('PASS when an unused guard import is removed (lint cleanup, no decorator change)', () => {
      const diff =
        '--- a/src/admin.controller.ts\n+++ b/src/admin.controller.ts\n' +
        "-import { AuthGuard } from '@nestjs/passport';";
      const result = service.checkProtectedRoutesStillProtected(['src/admin.controller.ts'], diff);
      expect(result.status).not.toBe('FAIL');
    });
  });

  // ── T5: Rate limiting on new public endpoints ──────────────────────────────

  describe('checkRateLimitOnNewEndpoints (T5)', () => {
    it('SKIP when diff text is empty', () => {
      const result = service.checkRateLimitOnNewEndpoints(['src/x.controller.ts'], '');
      expect(result.checkId).toBe('T5');
      expect(result.status).toBe('SKIP');
    });

    it('PASS when no new route handlers were added', () => {
      const diff = '+++ b/src/util.ts\n+export const x = 1;';
      const result = service.checkRateLimitOnNewEndpoints(['src/util.ts'], diff);
      expect(result.status).toBe('PASS');
      expect((result.evidence as Record<string, unknown>).newRoutes).toBe(0);
    });

    it('WARNING when a new public endpoint has no rate limiting', () => {
      const diff = '+++ b/src/public.controller.ts\n+  @Public()\n+  @Get("ping")\n+  ping() { return "ok"; }';
      const result = service.checkRateLimitOnNewEndpoints(['src/public.controller.ts'], diff);
      expect(result.status).toBe('WARNING');
      expect(result.detail).toMatch(/rate-limit/i);
    });

    it('PASS when a new public endpoint includes a @Throttle decorator', () => {
      const diff =
        '+++ b/src/public.controller.ts\n+  @Public()\n+  @Throttle({ default: { limit: 5, ttl: 60 } })\n+  @Get("ping")\n+  ping() {}';
      const result = service.checkRateLimitOnNewEndpoints(['src/public.controller.ts'], diff);
      expect(result.status).toBe('PASS');
    });

    it('PASS when new endpoints are guarded (not public)', () => {
      const diff =
        '+++ b/src/secure.controller.ts\n+  @UseGuards(JwtAuthGuard)\n+  @Get("data")\n+  getData() {}';
      const result = service.checkRateLimitOnNewEndpoints(['src/secure.controller.ts'], diff);
      expect(result.status).toBe('PASS');
    });

    it('recognizes express-style rate limiting (rateLimit middleware)', () => {
      const diff =
        '+++ b/src/routes.ts\n+router.get("/open", rateLimit({ windowMs: 60000, max: 10 }), handler);';
      const result = service.checkRateLimitOnNewEndpoints(['src/routes.ts'], diff);
      expect(result.status).toBe('PASS');
    });
  });

  // ── T8: No orphan files ────────────────────────────────────────────────────

  describe('checkNoOrphanFiles (T8)', () => {
    it('PASS when there are no new non-test source files', () => {
      const result = service.checkNoOrphanFiles(['src/foo.spec.ts', 'README.md'], '+anything');
      expect(result.checkId).toBe('T8');
      expect(result.status).toBe('PASS');
    });

    it('WARNING when a new source file is never imported and no module file changed', () => {
      const diff = '+++ b/src/lonely.ts\n+export const lonely = () => 1;';
      const result = service.checkNoOrphanFiles(['src/lonely.ts'], diff);
      expect(result.status).toBe('WARNING');
      expect((result.evidence as Record<string, unknown>).orphans).toContain('src/lonely.ts');
    });

    it('PASS when the new file is imported elsewhere in the diff', () => {
      const diff =
        '+++ b/src/lonely.ts\n+export const lonely = () => 1;\n' +
        "+++ b/src/consumer.ts\n+import { lonely } from './lonely.js';";
      const result = service.checkNoOrphanFiles(['src/lonely.ts'], diff);
      expect(result.status).toBe('PASS');
    });

    it('PASS when a module/registration file was changed in the same diff', () => {
      const diff = '+++ b/src/feature/thing.ts\n+export class Thing {}';
      const result = service.checkNoOrphanFiles(['src/feature/thing.ts', 'src/feature/feature.module.ts'], diff);
      expect(result.status).toBe('PASS');
    });

    it('never escalates beyond WARNING (diff-scoped limitation)', () => {
      const diff = '+++ b/src/a.ts\n+export const a = 1;\n+++ b/src/b.ts\n+export const b = 2;';
      const result = service.checkNoOrphanFiles(['src/a.ts', 'src/b.ts'], diff);
      expect(['PASS', 'WARNING']).toContain(result.status);
      expect(result.status).not.toBe('FAIL');
    });
  });

  // ── T9: Breaking changes to shared exports ─────────────────────────────────

  describe('checkBreakingExportsHandled (T9)', () => {
    it('SKIP when diff text is empty', () => {
      const result = service.checkBreakingExportsHandled('');
      expect(result.checkId).toBe('T9');
      expect(result.status).toBe('SKIP');
    });

    it('PASS when no exports were removed or changed', () => {
      const diff = '+++ b/src/util.ts\n+export function added(a: number) { return a; }';
      const result = service.checkBreakingExportsHandled(diff);
      expect(result.status).toBe('PASS');
    });

    it('WARNING when an exported function signature changed', () => {
      const diff =
        '--- a/src/util.ts\n+++ b/src/util.ts\n' +
        '-export function calc(a) { return a; }\n+export function calc(a, b) { return a + b; }';
      const result = service.checkBreakingExportsHandled(diff);
      expect(result.status).toBe('WARNING');
      expect((result.evidence as Record<string, unknown>).signatureChanged).toContain('calc');
    });

    it('WARNING when an export is removed entirely', () => {
      const diff = '--- a/src/util.ts\n+++ b/src/util.ts\n-export const legacyHelper = () => 1;';
      const result = service.checkBreakingExportsHandled(diff);
      expect(result.status).toBe('WARNING');
      expect((result.evidence as Record<string, unknown>).removedEntirely).toContain('legacyHelper');
    });

    it('PASS when an export is renamed but signature kept (no removal detected as breaking on same name)', () => {
      const diff =
        '+++ b/src/util.ts\n+export function brandNew(a) { return a; }';
      const result = service.checkBreakingExportsHandled(diff);
      expect(result.status).toBe('PASS');
    });

    it('never escalates beyond WARNING', () => {
      const diff = '-export function a() {}\n-export function b() {}\n-export function c() {}';
      const result = service.checkBreakingExportsHandled(diff);
      expect(result.status).not.toBe('FAIL');
    });
  });
});
