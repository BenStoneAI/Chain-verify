import { Injectable } from '@nestjs/common';
import axios from 'axios';
import type { CheckResult } from '../software-delivery.types.js';
import { CHECK_NAMES } from '../software-delivery.types.js';

@Injectable()
export class JobTypeChecksService {

  // ── BUG FIX ─────────────────────────────────────────────────────────────

  // BUG1 — Original bug no longer reproduces (requires reproduction steps)
  async checkBugNoLongerReproduces(deployUrl: string | undefined): Promise<CheckResult> {
    return {
      checkId: 'BUG1',
      checkName: CHECK_NAMES['BUG1'],
      tier: 'BASIC',
      status: 'SKIP',
      detail: 'Automated bug reproduction requires a specific repro endpoint or repro steps. Provide a probe URL in job description for automatic verification.',
    };
  }

  // BUG2 — A regression test exists for this bug
  checkBugRegressionTestExists(diffFiles: string[]): CheckResult {
    const start = Date.now();
    const testFiles = diffFiles.filter(f =>
      f.includes('.test.') || f.includes('.spec.') || f.includes('/__tests__/') || f.includes('/test/'),
    );
    return {
      checkId: 'BUG2',
      checkName: CHECK_NAMES['BUG2'],
      tier: 'BASIC',
      status: testFiles.length > 0 ? 'PASS' : 'WARNING',
      detail: testFiles.length === 0
        ? 'No test files found in the diff. A regression test should be added to prevent this bug from reoccurring.'
        : undefined,
      evidence: { testFilesChanged: testFiles, count: testFiles.length },
      durationMs: Date.now() - start,
    };
  }

  // BUG3 — Fix addresses root cause, not symptoms (no bare catch patterns)
  checkBugFixAddressesRootCause(diffText: string): CheckResult {
    const start = Date.now();
    if (!diffText) {
      return { checkId: 'BUG3', checkName: CHECK_NAMES['BUG3'], tier: 'BASIC', status: 'SKIP', detail: 'No diff text available.', durationMs: 0 };
    }

    const addedLines = diffText.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++'));
    const addedText = addedLines.join('\n');

    const swallowingPatterns = [
      { name: 'empty catch block', pattern: /catch\s*\([^)]*\)\s*\{\s*\}/ },
      { name: 'catch with only logging', pattern: /catch\s*\([^)]*\)\s*\{[^}]*console\.(log|error|warn)[^}]*\}(?!\s*finally)/ },
      { name: 'silent null coalescing on error', pattern: /\|\|\s*null\s*(?:\/\/.*)?$/ },
    ];

    const found = swallowingPatterns.filter(({ pattern }) => pattern.test(addedText)).map(p => p.name);

    return {
      checkId: 'BUG3',
      checkName: CHECK_NAMES['BUG3'],
      tier: 'BASIC',
      status: found.length === 0 ? 'PASS' : 'WARNING',
      detail: found.length > 0
        ? `Potential symptom-masking patterns found in new code: ${found.join(', ')}. Verify these aren't suppressing the original error.`
        : undefined,
      evidence: { patternsFound: found },
      durationMs: Date.now() - start,
    };
  }

  // ── WRITE TESTS ──────────────────────────────────────────────────────────

  // TEST1 — Tests actually run (no skip markers)
  checkTestsNotSkipped(diffText: string): CheckResult {
    const start = Date.now();
    const addedLines = diffText.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++'));
    const addedText = addedLines.join('\n');
    const skipPattern = /(?:\.skip|xtest|xdescribe|xit|@pytest\.mark\.skip|@unittest\.skip|it\.skip|describe\.skip)/;
    const found = skipPattern.test(addedText);
    return {
      checkId: 'TEST1',
      checkName: CHECK_NAMES['TEST1'],
      tier: 'BASIC',
      status: found ? 'FAIL' : 'PASS',
      detail: found ? 'Skip markers found in new test code (.skip, xtest, xdescribe, etc.). These tests will not run.' : undefined,
      durationMs: Date.now() - start,
    };
  }

  // TEST2 — Tests are not empty (have at least one assertion)
  checkTestsHaveAssertions(diffText: string): CheckResult {
    const start = Date.now();
    const addedText = diffText.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++')).join('\n');
    const hasTest = /(?:it|test|describe)\s*\(/.test(addedText);
    if (!hasTest) {
      return { checkId: 'TEST2', checkName: CHECK_NAMES['TEST2'], tier: 'BASIC', status: 'SKIP', detail: 'No test blocks found in diff.', durationMs: 0 };
    }
    const assertionPattern = /(?:expect|assert|assertEqual|assertThat|should|toBe|toEqual|toHave)/;
    const hasAssertions = assertionPattern.test(addedText);
    return {
      checkId: 'TEST2',
      checkName: CHECK_NAMES['TEST2'],
      tier: 'BASIC',
      status: hasAssertions ? 'PASS' : 'FAIL',
      detail: !hasAssertions ? 'Test blocks found but no assertions detected. Tests without assertions always pass and provide no value.' : undefined,
      durationMs: Date.now() - start,
    };
  }

  // TEST5 — Test count increased
  checkTestCountIncreased(diffText: string): CheckResult {
    const start = Date.now();
    const addedLines = diffText.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++'));
    const removedLines = diffText.split('\n').filter(l => l.startsWith('-') && !l.startsWith('---'));
    const testPattern = /(?:it|test)\s*\(/;
    const addedTests = addedLines.filter(l => testPattern.test(l)).length;
    const removedTests = removedLines.filter(l => testPattern.test(l)).length;
    const netNew = addedTests - removedTests;

    return {
      checkId: 'TEST5',
      checkName: CHECK_NAMES['TEST5'],
      tier: 'BASIC',
      status: netNew > 0 ? 'PASS' : netNew === 0 ? 'WARNING' : 'FAIL',
      detail: netNew <= 0
        ? `Net test count change: ${netNew}. ${addedTests} tests added, ${removedTests} removed.`
        : undefined,
      evidence: { addedTests, removedTests, netNew },
      durationMs: Date.now() - start,
    };
  }

  // ── DATA MIGRATION ───────────────────────────────────────────────────────

  // MIG0 — Pre-migration backup exists
  checkPreMigrationBackup(jobStartedAt: Date): CheckResult {
    return {
      checkId: 'MIG0',
      checkName: CHECK_NAMES['MIG0'],
      tier: 'BASIC',
      status: 'WARNING',
      detail: 'Pre-migration backup cannot be automatically verified in Phase 1. Confirm a pg_dump backup was taken before this migration started. Check the GitHub Actions "Database logical backup" artifact.',
    };
  }

  // MIG1 — Migration recorded as applied
  checkMigrationApplied(diffFiles: string[]): CheckResult {
    const start = Date.now();
    const hasMigrationFile = diffFiles.some(f =>
      f.includes('/migrations/') && (f.endsWith('.sql') || f.endsWith('.ts')),
    );
    return {
      checkId: 'MIG1',
      checkName: CHECK_NAMES['MIG1'],
      tier: 'BASIC',
      status: hasMigrationFile ? 'PASS' : 'WARNING',
      detail: !hasMigrationFile
        ? 'No migration file found in diff. If this is a data migration, a migration file should be present.'
        : undefined,
      evidence: { migrationFilesFound: diffFiles.filter(f => f.includes('/migrations/')) },
      durationMs: Date.now() - start,
    };
  }

  // MIG4 — No unexpected NULLs introduced
  checkNoUnexpectedNulls(diffText: string): CheckResult {
    const start = Date.now();
    const addedText = diffText.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++')).join('\n');
    // Look for new NOT NULL columns without DEFAULT values (risky on existing tables)
    const riskPattern = /ADD\s+COLUMN\s+\w+\s+\w+(?!\s+DEFAULT)\s+NOT\s+NULL/i;
    const hasRisk = riskPattern.test(addedText);
    return {
      checkId: 'MIG4',
      checkName: CHECK_NAMES['MIG4'],
      tier: 'STANDARD',
      status: hasRisk ? 'WARNING' : 'PASS',
      detail: hasRisk ? 'New NOT NULL column without DEFAULT value detected. This will fail on non-empty tables in PostgreSQL.' : undefined,
      durationMs: Date.now() - start,
    };
  }

  // ── NEW FEATURE ──────────────────────────────────────────────────────────

  // NEW1 — New code is wired in (not orphaned)
  checkNewCodeWiredIn(diffFiles: string[]): CheckResult {
    const start = Date.now();
    const srcFiles = diffFiles.filter(f =>
      (f.endsWith('.ts') || f.endsWith('.js') || f.endsWith('.tsx') || f.endsWith('.jsx')) &&
      !f.endsWith('.test.ts') && !f.endsWith('.spec.ts') && !f.endsWith('.d.ts'),
    );
    // Check if there are module/index files that could register the new code
    const registrationFiles = diffFiles.filter(f =>
      f.endsWith('.module.ts') || f.endsWith('index.ts') || f.endsWith('app.module.ts') || f.includes('module.ts'),
    );
    return {
      checkId: 'NEW1',
      checkName: CHECK_NAMES['NEW1'],
      tier: 'BASIC',
      status: registrationFiles.length > 0 || srcFiles.length === 0 ? 'PASS' : 'WARNING',
      detail: registrationFiles.length === 0 && srcFiles.length > 0
        ? 'New source files added but no module registration files (*.module.ts, index.ts) were updated. New code may be orphaned.'
        : undefined,
      evidence: { newSourceFiles: srcFiles.length, registrationFilesUpdated: registrationFiles },
      durationMs: Date.now() - start,
    };
  }

  // NEW4 — Schema changes have a migration
  checkSchemaChangesHaveMigration(diffFiles: string[]): CheckResult {
    const start = Date.now();
    const schemaChanged = diffFiles.some(f => f.endsWith('schema.prisma') || f.endsWith('schema.sql'));
    const migrationExists = diffFiles.some(f => f.includes('/migrations/') && (f.endsWith('.sql') || f.endsWith('.ts')));

    if (!schemaChanged) {
      return { checkId: 'NEW4', checkName: CHECK_NAMES['NEW4'], tier: 'BASIC', status: 'PASS', detail: 'No schema file changes detected.', durationMs: Date.now() - start };
    }
    return {
      checkId: 'NEW4',
      checkName: CHECK_NAMES['NEW4'],
      tier: 'BASIC',
      status: migrationExists ? 'PASS' : 'FAIL',
      detail: !migrationExists ? 'Prisma/SQL schema changed but no migration file found in the diff. Run `prisma migrate dev` and include the generated migration.' : undefined,
      evidence: { schemaChanged, migrationFound: migrationExists },
      durationMs: Date.now() - start,
    };
  }

  // ── CODE REVIEW ──────────────────────────────────────────────────────────

  checkReviewFileCoverage(aiReport: string | undefined, diffFiles: string[]): CheckResult {
    const start = Date.now();
    if (!aiReport) {
      return { checkId: 'REV1', checkName: CHECK_NAMES['REV1'], tier: 'BASIC', status: 'SKIP', detail: 'No AI report provided.', durationMs: 0 };
    }
    const mentioned = diffFiles.filter(f => aiReport.includes(f) || aiReport.includes(f.split('/').pop() ?? '')).length;
    const coverage = diffFiles.length > 0 ? mentioned / diffFiles.length : 1;
    return {
      checkId: 'REV1',
      checkName: CHECK_NAMES['REV1'],
      tier: 'BASIC',
      status: coverage >= 1.0 ? 'PASS' : coverage >= 0.7 ? 'WARNING' : 'FAIL',
      detail: coverage < 1.0 ? `Only ${Math.round(coverage * 100)}% of changed files explicitly mentioned in the review (${mentioned}/${diffFiles.length}).` : undefined,
      evidence: { mentionedCount: mentioned, totalFiles: diffFiles.length, coverage: Math.round(coverage * 100) },
      durationMs: Date.now() - start,
    };
  }
}
