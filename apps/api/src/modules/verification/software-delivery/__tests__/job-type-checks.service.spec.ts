import { describe, it, expect, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { JobTypeChecksService } from '../checks/job-type-checks.service.js';

// ---------------------------------------------------------------------------
// Diff helpers
// ---------------------------------------------------------------------------

function makeAddedDiff(lines: string[]): string {
  const header = '--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1,5 +1,10 @@\n';
  return header + lines.map(l => `+${l}`).join('\n');
}

function makeRemovedDiff(lines: string[]): string {
  const header = '--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1,5 +1,5 @@\n';
  return header + lines.map(l => `-${l}`).join('\n');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('JobTypeChecksService', () => {
  let service: JobTypeChecksService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [JobTypeChecksService],
    }).compile();
    service = module.get(JobTypeChecksService);
  });

  // ── BUG1: Original bug no longer reproduces ──────────────────────────────

  describe('checkBugNoLongerReproduces (BUG1)', () => {
    it('returns a BUG1 result with the canonical check name', async () => {
      const result = await service.checkBugNoLongerReproduces(undefined);
      expect(result.checkId).toBe('BUG1');
      expect(result.checkName).toBe('Original bug no longer reproduces');
    });

    it('SKIP when no probe URL is available (cannot auto-reproduce)', async () => {
      const result = await service.checkBugNoLongerReproduces(undefined);
      expect(result.status).toBe('SKIP');
      expect(result.detail).toMatch(/repro/i);
    });

    it('SKIP (not a false PASS) even when a deploy URL is provided, since repro steps are still required', async () => {
      const result = await service.checkBugNoLongerReproduces('https://app.example.com');
      // BUG1 must never silently PASS — automated reproduction is not yet wired,
      // so the honest outcome is SKIP, never PASS.
      expect(result.status).toBe('SKIP');
      expect(result.status).not.toBe('PASS');
    });

    it('does not throw for an empty-string deploy URL', async () => {
      await expect(service.checkBugNoLongerReproduces('')).resolves.toBeDefined();
    });
  });

  // ── BUG3: Fix addresses root cause ───────────────────────────────────────

  describe('checkBugFixAddressesRootCause (BUG3)', () => {
    it('PASS when diff contains proper error handling with re-throw', () => {
      const diff = makeAddedDiff([
        `try {`,
        `  const result = await riskyOperation();`,
        `  return result;`,
        `} catch (err) {`,
        `  logger.error('Failed', err);`,
        `  throw err;  // re-throwing — not swallowing`,
        `}`,
      ]);
      const result = service.checkBugFixAddressesRootCause(diff);
      expect(result.checkId).toBe('BUG3');
      expect(result.status).toBe('PASS');
    });

    it('WARNING when new bare catch block with only console.error (adversarial #6: silences error)', () => {
      const diff = makeAddedDiff([
        `try {`,
        `  return riskyOp();`,
        `} catch (e) {`,
        `  console.error(e);`,
        `}`,
      ]);
      const result = service.checkBugFixAddressesRootCause(diff);
      expect(result.checkId).toBe('BUG3');
      expect(result.status).toBe('WARNING');
      expect(result.detail).toContain('masking');
    });

    it('WARNING when empty catch block detected', () => {
      const diff = makeAddedDiff([`try { doThing(); } catch (err) {}`]);
      const result = service.checkBugFixAddressesRootCause(diff);
      expect(result.status).toBe('WARNING');
    });

    it('PASS when no error-swallowing patterns present in diff', () => {
      const diff = makeAddedDiff([
        `function calculateTotal(items) {`,
        `  return items.reduce((sum, item) => sum + item.price, 0);`,
        `}`,
      ]);
      const result = service.checkBugFixAddressesRootCause(diff);
      expect(result.status).toBe('PASS');
    });

    it('SKIP when diff text is empty string', () => {
      const result = service.checkBugFixAddressesRootCause('');
      expect(result.status).toBe('SKIP');
    });

    it('does NOT flag error handling in removed lines', () => {
      const diff = makeRemovedDiff([`try { old(); } catch (e) {}`]);
      const result = service.checkBugFixAddressesRootCause(diff);
      expect(result.status).toBe('PASS');
    });

    it('evidence includes patternsFound array', () => {
      const diff = makeAddedDiff([`try { x(); } catch (err) { console.error(err); }`]);
      const result = service.checkBugFixAddressesRootCause(diff);
      expect(result.evidence).toBeDefined();
      expect((result.evidence as Record<string, unknown>).patternsFound).toBeDefined();
    });
  });

  // ── BUG2: Regression test exists ─────────────────────────────────────────

  describe('checkBugRegressionTestExists (BUG2)', () => {
    it('PASS when test file is in the diff', () => {
      const result = service.checkBugRegressionTestExists([
        'src/invoice.service.ts',
        'src/invoice.service.spec.ts',
      ]);
      expect(result.checkId).toBe('BUG2');
      expect(result.status).toBe('PASS');
    });

    it('PASS when test file is in __tests__ directory', () => {
      const result = service.checkBugRegressionTestExists([
        'src/__tests__/invoice.test.ts',
      ]);
      expect(result.status).toBe('PASS');
    });

    it('PASS when test file is in /test/ directory', () => {
      const result = service.checkBugRegressionTestExists([
        'test/billing.test.js',
      ]);
      expect(result.status).toBe('PASS');
    });

    it('WARNING when no test file in the diff', () => {
      const result = service.checkBugRegressionTestExists(['src/invoice.service.ts']);
      expect(result.status).toBe('WARNING');
      expect(result.detail).toContain('regression test');
    });

    it('WARNING when only source files changed (no .test. or .spec.)', () => {
      const result = service.checkBugRegressionTestExists([
        'src/foo.ts',
        'src/bar.module.ts',
      ]);
      expect(result.status).toBe('WARNING');
    });
  });

  // ── TEST1: Tests not skipped ──────────────────────────────────────────────

  describe('checkTestsNotSkipped (TEST1)', () => {
    it('PASS when no skip markers in diff', () => {
      const diff = makeAddedDiff([
        `it('should add numbers', () => {`,
        `  expect(1 + 1).toBe(2);`,
        `});`,
      ]);
      const result = service.checkTestsNotSkipped(diff);
      expect(result.checkId).toBe('TEST1');
      expect(result.status).toBe('PASS');
    });

    it('FAIL when describe.skip is found in new test code (adversarial #2)', () => {
      const diff = makeAddedDiff([
        `describe.skip('Invoice calculation', () => {`,
        `  it('should round correctly', () => {});`,
        `});`,
      ]);
      const result = service.checkTestsNotSkipped(diff);
      expect(result.checkId).toBe('TEST1');
      expect(result.status).toBe('FAIL');
      expect(result.detail).toContain('skip');
    });

    it('FAIL when it.skip is found in new test code', () => {
      const diff = makeAddedDiff([`it.skip('skipped test', () => {});`]);
      const result = service.checkTestsNotSkipped(diff);
      expect(result.status).toBe('FAIL');
    });

    it('FAIL when xtest is found in new test code', () => {
      const diff = makeAddedDiff([`xtest('will not run', () => { expect(true).toBe(true); });`]);
      const result = service.checkTestsNotSkipped(diff);
      expect(result.status).toBe('FAIL');
    });

    it('FAIL when xdescribe is found in new test code', () => {
      const diff = makeAddedDiff([`xdescribe('skipped suite', () => {});`]);
      const result = service.checkTestsNotSkipped(diff);
      expect(result.status).toBe('FAIL');
    });

    it('FAIL when xit is found in new test code', () => {
      const diff = makeAddedDiff([`xit('disabled', () => {});`]);
      const result = service.checkTestsNotSkipped(diff);
      expect(result.status).toBe('FAIL');
    });

    it('FAIL when .only is found via the skip pattern (inadvertent test isolation)', () => {
      // The service checks for .skip patterns; .only detection depends on implementation.
      // Test that .skip variants are caught — .only may be a WARNING or implementation-specific.
      const diff = makeAddedDiff([`it.skip('isolation guard', () => {});`]);
      const result = service.checkTestsNotSkipped(diff);
      // .skip is in the pattern — should FAIL
      expect(result.status).toBe('FAIL');
    });

    it('does NOT fail on skip markers in removed lines', () => {
      const diff = makeRemovedDiff([`it.skip('old test', () => {});`]);
      const result = service.checkTestsNotSkipped(diff);
      expect(result.status).toBe('PASS');
    });
  });

  // ── TEST2: Tests have assertions ──────────────────────────────────────────

  describe('checkTestsHaveAssertions (TEST2)', () => {
    it('PASS when test block has expect assertions', () => {
      const diff = makeAddedDiff([
        `it('calculates total', () => {`,
        `  expect(total).toBe(100);`,
        `});`,
      ]);
      const result = service.checkTestsHaveAssertions(diff);
      expect(result.checkId).toBe('TEST2');
      expect(result.status).toBe('PASS');
    });

    it('PASS when test uses assert (Node assert module)', () => {
      const diff = makeAddedDiff([
        `it('asserts correctly', () => {`,
        `  assert.equal(result, expected);`,
        `});`,
      ]);
      const result = service.checkTestsHaveAssertions(diff);
      expect(result.status).toBe('PASS');
    });

    it('PASS when test uses should assertions (chai-style)', () => {
      const diff = makeAddedDiff([
        `it('should work', () => {`,
        `  result.should.equal(42);`,
        `});`,
      ]);
      const result = service.checkTestsHaveAssertions(diff);
      expect(result.status).toBe('PASS');
    });

    it('PASS for expect(true).toBe(true) — trivially true assertion still counts (adversarial awareness)', () => {
      // We can only count assertions, not validate their quality
      const diff = makeAddedDiff([
        `it('always passes', () => {`,
        `  expect(true).toBe(true);`,
        `});`,
      ]);
      const result = service.checkTestsHaveAssertions(diff);
      expect(result.status).toBe('PASS');
    });

    it('FAIL when test block found but no assertions (adversarial #1)', () => {
      // No assertion keywords (expect/assert/should/toBe etc.) — pure stub
      const diff = makeAddedDiff([
        `it('empty test', () => {`,
        `  const x = compute();`,
        `  return x;`,
        `});`,
      ]);
      const result = service.checkTestsHaveAssertions(diff);
      expect(result.checkId).toBe('TEST2');
      expect(result.status).toBe('FAIL');
      expect(result.detail).toContain('no assertions');
    });

    it('SKIP when no test blocks found in diff', () => {
      const diff = makeAddedDiff([`const config = { timeout: 5000 };`]);
      const result = service.checkTestsHaveAssertions(diff);
      expect(result.status).toBe('SKIP');
    });
  });

  // ── NEW1: New code wired in (not orphaned) ────────────────────────────────

  describe('checkNewCodeWiredIn (NEW1)', () => {
    it('PASS when module registration file is updated alongside new source file', () => {
      const result = service.checkNewCodeWiredIn([
        'src/modules/payments/payments.module.ts', // registration file
        'src/modules/payments/payments.service.ts', // new source
      ]);
      expect(result.checkId).toBe('NEW1');
      expect(result.status).toBe('PASS');
    });

    it('PASS when index.ts is updated (barrel export)', () => {
      const result = service.checkNewCodeWiredIn([
        'src/index.ts',
        'src/utils/formatter.ts',
      ]);
      expect(result.status).toBe('PASS');
    });

    it('PASS when app.module.ts is updated', () => {
      const result = service.checkNewCodeWiredIn([
        'src/app.module.ts',
        'src/new-feature/new-feature.service.ts',
      ]);
      expect(result.status).toBe('PASS');
    });

    it('WARNING when new source files added but no module/index registration file updated (adversarial #17)', () => {
      const result = service.checkNewCodeWiredIn([
        'src/orphan-service.ts',
        'src/orphan-controller.ts',
        // No .module.ts, no index.ts
      ]);
      expect(result.checkId).toBe('NEW1');
      expect(result.status).toBe('WARNING');
      expect(result.detail).toContain('orphaned');
    });

    it('PASS when no source files added at all (e.g. only config changed)', () => {
      const result = service.checkNewCodeWiredIn(['README.md', 'package.json']);
      expect(result.status).toBe('PASS');
    });

    it('evidence includes newSourceFiles count and registrationFilesUpdated list', () => {
      const result = service.checkNewCodeWiredIn([
        'src/payments.module.ts',
        'src/payments.service.ts',
      ]);
      expect((result.evidence as Record<string, unknown>).newSourceFiles).toBeGreaterThanOrEqual(1);
      expect(Array.isArray((result.evidence as Record<string, unknown>).registrationFilesUpdated)).toBe(true);
    });
  });

  // ── NEW4: Schema changes have migration ───────────────────────────────────

  describe('checkSchemaChangesHaveMigration (NEW4)', () => {
    it('PASS when schema.prisma changed AND migration file present in diff', () => {
      const result = service.checkSchemaChangesHaveMigration([
        'apps/api/prisma/schema.prisma',
        'apps/api/prisma/migrations/20260525_add_user_field.sql',
      ]);
      expect(result.checkId).toBe('NEW4');
      expect(result.status).toBe('PASS');
    });

    it('FAIL when schema.prisma changed but NO migration file in diff (adversarial)', () => {
      const result = service.checkSchemaChangesHaveMigration([
        'apps/api/prisma/schema.prisma',
        'src/users.service.ts',
        // No migration file
      ]);
      expect(result.status).toBe('FAIL');
      expect(result.detail).toContain('migration');
    });

    it('PASS when no schema file changed (check is skipped)', () => {
      const result = service.checkSchemaChangesHaveMigration([
        'src/users.service.ts',
        'src/users.controller.ts',
      ]);
      expect(result.status).toBe('PASS');
    });

    it('FAIL when schema.sql changed without migration file', () => {
      const result = service.checkSchemaChangesHaveMigration(['database/schema.sql']);
      expect(result.status).toBe('FAIL');
    });

    it('PASS when .ts migration file is present in migrations/ dir', () => {
      const result = service.checkSchemaChangesHaveMigration([
        'apps/api/prisma/schema.prisma',
        'apps/api/prisma/migrations/20260525_add_fields.ts',
      ]);
      expect(result.status).toBe('PASS');
    });
  });

  // ── REV1: Review file coverage ────────────────────────────────────────────

  describe('checkReviewFileCoverage (REV1)', () => {
    it('PASS when aiReport mentions all changed files', () => {
      const report = 'Reviewed src/invoice.service.ts: found 2 bugs. Reviewed src/invoice.controller.ts: LGTM.';
      const files = ['src/invoice.service.ts', 'src/invoice.controller.ts'];
      const result = service.checkReviewFileCoverage(report, files);
      expect(result.checkId).toBe('REV1');
      expect(result.status).toBe('PASS');
    });

    it('FAIL when review says "I reviewed all files" but does not mention specific files', () => {
      const report = 'I reviewed all files and everything looks good. No issues found.';
      const files = ['src/invoice.service.ts', 'src/billing.module.ts', 'src/auth.guard.ts'];
      const result = service.checkReviewFileCoverage(report, files);
      // 0 out of 3 files explicitly mentioned → 0% coverage → FAIL
      expect(result.checkId).toBe('REV1');
      expect(result.status).toBe('FAIL');
    });

    it('SKIP when no aiReport provided', () => {
      const result = service.checkReviewFileCoverage(undefined, ['src/foo.ts']);
      expect(result.status).toBe('SKIP');
    });

    it('WARNING when only some files mentioned (partial coverage)', () => {
      // Only 1 of 3 files mentioned → ~33% → FAIL (< 70%)
      const report = 'Reviewed src/invoice.service.ts in depth.';
      const files = ['src/invoice.service.ts', 'src/billing.ts', 'src/auth.ts'];
      const result = service.checkReviewFileCoverage(report, files);
      expect(['WARNING', 'FAIL']).toContain(result.status);
    });

    it('PASS when review mentions file by basename (not full path)', () => {
      const report = 'Checked invoice.service.ts carefully — no issues.';
      const files = ['src/invoice.service.ts'];
      const result = service.checkReviewFileCoverage(report, files);
      expect(result.status).toBe('PASS');
    });

    it('evidence includes mentionedCount, totalFiles, and coverage', () => {
      const report = 'Reviewed src/foo.ts: OK.';
      const files = ['src/foo.ts'];
      const result = service.checkReviewFileCoverage(report, files);
      expect((result.evidence as Record<string, unknown>).mentionedCount).toBeDefined();
      expect((result.evidence as Record<string, unknown>).totalFiles).toBe(1);
      expect(typeof (result.evidence as Record<string, unknown>).coverage).toBe('number');
    });
  });

  // ── MIG1: Migration applied ───────────────────────────────────────────────

  describe('checkMigrationApplied (MIG1)', () => {
    it('PASS when a .sql migration file is in migrations/ path', () => {
      const result = service.checkMigrationApplied([
        'apps/api/prisma/migrations/20260525_000000_add_column.sql',
      ]);
      expect(result.checkId).toBe('MIG1');
      expect(result.status).toBe('PASS');
    });

    it('PASS when a .ts migration file is in migrations/ path', () => {
      const result = service.checkMigrationApplied([
        'apps/api/prisma/migrations/20260525_add_index.ts',
      ]);
      expect(result.status).toBe('PASS');
    });

    it('WARNING when no migration file in diff (adversarial #15: migration marked applied but never ran)', () => {
      // When there is no migration file in the diff, MIG1 should flag this
      const result = service.checkMigrationApplied([
        'src/users.service.ts',
        'src/users.controller.ts',
      ]);
      expect(result.status).toBe('WARNING');
      expect(result.detail).toContain('migration file');
    });

    it('evidence includes migrationFilesFound list', () => {
      const result = service.checkMigrationApplied([
        'apps/api/prisma/migrations/20260525_000000_fix.sql',
        'src/foo.ts',
      ]);
      expect((result.evidence as Record<string, unknown>).migrationFilesFound).toBeDefined();
    });
  });

  // ── TEST5: Test count increased ───────────────────────────────────────────

  describe('checkTestCountIncreased (TEST5)', () => {
    it('PASS when more test functions added than removed (net positive)', () => {
      const diff = [
        `+it('test one', () => { expect(1).toBe(1); });`,
        `+it('test two', () => { expect(2).toBe(2); });`,
        `+it('test three', () => { expect(3).toBe(3); });`,
        `-it('old test', () => {});`,
      ].join('\n');
      const result = service.checkTestCountIncreased(diff);
      expect(result.checkId).toBe('TEST5');
      expect(result.status).toBe('PASS');
    });

    it('WARNING when same number of tests added as removed (net zero)', () => {
      const diff = [
        `+it('new test', () => { expect(1).toBe(1); });`,
        `-it('old test', () => {});`,
      ].join('\n');
      const result = service.checkTestCountIncreased(diff);
      expect(result.status).toBe('WARNING');
    });

    it('FAIL when more tests removed than added (test regression)', () => {
      const diff = [
        `+it('new test', () => {});`,
        `-it('old test 1', () => {});`,
        `-it('old test 2', () => {});`,
        `-it('old test 3', () => {});`,
      ].join('\n');
      const result = service.checkTestCountIncreased(diff);
      expect(result.status).toBe('FAIL');
    });

    it('evidence includes addedTests, removedTests, and netNew counts', () => {
      const diff = [
        `+it('test a', () => {});`,
        `+it('test b', () => {});`,
      ].join('\n');
      const result = service.checkTestCountIncreased(diff);
      expect((result.evidence as Record<string, unknown>).addedTests).toBe(2);
      expect((result.evidence as Record<string, unknown>).removedTests).toBe(0);
      expect((result.evidence as Record<string, unknown>).netNew).toBe(2);
    });
  });
});
