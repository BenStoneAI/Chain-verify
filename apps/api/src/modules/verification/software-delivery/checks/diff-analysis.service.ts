import { Injectable } from '@nestjs/common';
import type { CheckResult } from '../software-delivery.types.js';
import { CHECK_NAMES } from '../software-delivery.types.js';

@Injectable()
export class DiffAnalysisService {

  // B4 — AI's delivery description matches reality (>70% file match rate)
  checkAiReportMatchesDiff(aiReport: string | undefined, diffFiles: string[]): CheckResult {
    const start = Date.now();
    if (!aiReport) {
      return {
        checkId: 'B4',
        checkName: CHECK_NAMES['B4'],
        tier: 'BASIC',
        status: 'SKIP',
        detail: 'No AI report provided — skipping description match check.',
        durationMs: 0,
      };
    }

    const mentionedFiles = this.extractFilePaths(aiReport);
    if (mentionedFiles.length === 0) {
      return {
        checkId: 'B4',
        checkName: CHECK_NAMES['B4'],
        tier: 'BASIC',
        status: 'WARNING',
        detail: 'AI report contains no specific file path references. Cannot verify description accuracy.',
        durationMs: Date.now() - start,
      };
    }

    const matchedCount = mentionedFiles.filter(mentioned =>
      diffFiles.some(diffFile => {
        const dNorm = diffFile.toLowerCase().replace(/\\/g, '/');
        const mNorm = mentioned.toLowerCase().replace(/\\/g, '/');
        return dNorm.includes(mNorm) || mNorm.includes(dNorm) ||
          dNorm.endsWith(mNorm) || mNorm.endsWith(dNorm);
      }),
    ).length;

    const matchRate = matchedCount / mentionedFiles.length;

    return {
      checkId: 'B4',
      checkName: CHECK_NAMES['B4'],
      tier: 'BASIC',
      status: matchRate >= 0.7 ? 'PASS' : matchRate >= 0.4 ? 'WARNING' : 'FAIL',
      detail:
        matchRate < 0.7
          ? `AI report mentioned ${mentionedFiles.length} files; ${matchedCount} found in diff (${Math.round(matchRate * 100)}% match — threshold is 70%).`
          : undefined,
      evidence: { mentionedFiles, matchedCount, matchRate: Math.round(matchRate * 100) / 100, diffFiles },
      durationMs: Date.now() - start,
    };
  }

  // S7 — Nothing outside scope was changed
  checkScopeAdherence(diffFiles: string[]): CheckResult {
    const start = Date.now();
    const sensitivePatterns = [
      { pattern: /^\.github\/workflows\//i, label: 'CI/CD workflow' },
      { pattern: /prisma\/schema\.prisma$/i, label: 'Prisma schema' },
      { pattern: /^\.env/i, label: 'Environment file' },
      { pattern: /^docker-compose/i, label: 'Docker compose' },
      { pattern: /^Dockerfile/i, label: 'Dockerfile' },
      { pattern: /^terraform\//i, label: 'Terraform infrastructure' },
      { pattern: /^\.github\/CODEOWNERS$/i, label: 'CODEOWNERS file' },
    ];

    const flagged: Array<{ file: string; reason: string }> = [];
    for (const file of diffFiles) {
      for (const { pattern, label } of sensitivePatterns) {
        if (pattern.test(file)) {
          flagged.push({ file, reason: label });
          break;
        }
      }
    }

    if (flagged.length === 0) {
      return {
        checkId: 'S7',
        checkName: CHECK_NAMES['S7'],
        tier: 'STANDARD',
        status: 'PASS',
        durationMs: Date.now() - start,
      };
    }

    return {
      checkId: 'S7',
      checkName: CHECK_NAMES['S7'],
      tier: 'STANDARD',
      status: 'WARNING',
      detail: `Changes found in sensitive/infrastructure files — verify these are intentional: ${flagged.map(f => `${f.file} (${f.reason})`).join(', ')}`,
      evidence: { flaggedFiles: flagged },
      durationMs: Date.now() - start,
    };
  }

  // S11 — Lock file is consistent with package.json changes
  checkLockFileConsistency(diffFiles: string[]): CheckResult {
    const start = Date.now();
    const packageJsonChanged = diffFiles.some(
      f => f === 'package.json' || f.endsWith('/package.json'),
    );

    if (!packageJsonChanged) {
      return {
        checkId: 'S11',
        checkName: CHECK_NAMES['S11'],
        tier: 'STANDARD',
        status: 'PASS',
        detail: 'package.json was not modified.',
        durationMs: Date.now() - start,
      };
    }

    const lockFileChanged = diffFiles.some(
      f =>
        f === 'package-lock.json' ||
        f === 'yarn.lock' ||
        f === 'pnpm-lock.yaml' ||
        f.endsWith('/package-lock.json') ||
        f.endsWith('/yarn.lock') ||
        f.endsWith('/pnpm-lock.yaml'),
    );

    return {
      checkId: 'S11',
      checkName: CHECK_NAMES['S11'],
      tier: 'STANDARD',
      status: lockFileChanged ? 'PASS' : 'WARNING',
      detail: !lockFileChanged
        ? 'package.json was modified but no lock file (package-lock.json / yarn.lock / pnpm-lock.yaml) was updated in the same commit. This causes environment drift.'
        : undefined,
      evidence: { packageJsonChanged, lockFileChanged, filesChecked: diffFiles.length },
      durationMs: Date.now() - start,
    };
  }

  // T7 — New environment variables are documented in .env.example
  checkEnvVarsDocumented(diffText: string, diffFiles: string[]): CheckResult {
    const start = Date.now();
    if (!diffText) {
      return {
        checkId: 'T7',
        checkName: CHECK_NAMES['T7'],
        tier: 'THOROUGH',
        status: 'SKIP',
        detail: 'No diff text available.',
        durationMs: 0,
      };
    }

    // Extract new process.env references from added lines
    const addedLines = diffText.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++'));
    const envRefs = new Set<string>();
    const envPattern = /process\.env\.([A-Z][A-Z0-9_]+)/g;
    for (const line of addedLines) {
      let match: RegExpExecArray | null;
      while ((match = envPattern.exec(line)) !== null) {
        envRefs.add(match[1]);
      }
    }

    if (envRefs.size === 0) {
      return {
        checkId: 'T7',
        checkName: CHECK_NAMES['T7'],
        tier: 'THOROUGH',
        status: 'PASS',
        detail: 'No new environment variable references found.',
        durationMs: Date.now() - start,
      };
    }

    // Check if .env.example was updated
    const envExampleChanged = diffFiles.some(f => f === '.env.example' || f.endsWith('/.env.example'));
    return {
      checkId: 'T7',
      checkName: CHECK_NAMES['T7'],
      tier: 'THOROUGH',
      status: envExampleChanged ? 'PASS' : 'WARNING',
      detail: !envExampleChanged
        ? `New env vars referenced (${Array.from(envRefs).join(', ')}) but .env.example was not updated.`
        : undefined,
      evidence: { newEnvVars: Array.from(envRefs), envExampleUpdated: envExampleChanged },
      durationMs: Date.now() - start,
    };
  }

  // T10 — Specification requirements addressed
  checkSpecRequirementsAddressed(jobDescription: string | undefined, diffFiles: string[]): CheckResult {
    const start = Date.now();
    if (!jobDescription) {
      return {
        checkId: 'T10',
        checkName: CHECK_NAMES['T10'],
        tier: 'THOROUGH',
        status: 'SKIP',
        detail: 'No job description provided.',
        durationMs: 0,
      };
    }

    // Basic heuristic: count action verbs in job description and check if diff is substantial
    const actionVerbs = ['add', 'fix', 'update', 'create', 'implement', 'remove', 'refactor', 'migrate', 'build', 'write', 'deploy'];
    const requirementCount = actionVerbs.filter(v => jobDescription.toLowerCase().includes(v)).length;

    if (diffFiles.length === 0) {
      return {
        checkId: 'T10',
        checkName: CHECK_NAMES['T10'],
        tier: 'THOROUGH',
        status: 'FAIL',
        detail: 'Job description mentions requirements but no files were changed.',
        durationMs: Date.now() - start,
      };
    }

    return {
      checkId: 'T10',
      checkName: CHECK_NAMES['T10'],
      tier: 'THOROUGH',
      status: 'PASS',
      detail: `Detected ${requirementCount} action verbs in job description; ${diffFiles.length} files changed. Manual review recommended for full requirements tracing.`,
      evidence: { fileCount: diffFiles.length, requirementVerbs: requirementCount },
      durationMs: Date.now() - start,
    };
  }

  // T12 — Delivery description vs. actual diff (semantic comparison)
  checkDeliveryDescriptionMatchesDiff(aiReport: string | undefined, diffFiles: string[], diffText: string): CheckResult {
    const start = Date.now();
    if (!aiReport) {
      return { checkId: 'T12', checkName: CHECK_NAMES['T12'], tier: 'THOROUGH', status: 'SKIP', detail: 'No AI report provided.', durationMs: 0 };
    }

    const mentionedFiles = this.extractFilePaths(aiReport);
    const totalMentioned = mentionedFiles.length;
    if (totalMentioned === 0) {
      return { checkId: 'T12', checkName: CHECK_NAMES['T12'], tier: 'THOROUGH', status: 'WARNING', detail: 'AI report contains no file references to cross-check against.', durationMs: Date.now() - start };
    }

    const matched = mentionedFiles.filter(f => diffFiles.some(df => df.includes(f) || f.includes(df))).length;
    const rate = matched / totalMentioned;

    // Also check for phantom claims: AI mentions features not reflected in small diffs
    const addedLineCount = diffText.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++')).length;
    const aiClaimsLargeWork = aiReport.length > 500 && addedLineCount < 20;

    return {
      checkId: 'T12',
      checkName: CHECK_NAMES['T12'],
      tier: 'THOROUGH',
      status: rate >= 0.7 && !aiClaimsLargeWork ? 'PASS' : rate >= 0.4 ? 'WARNING' : 'FAIL',
      detail: rate < 0.7
        ? `Only ${Math.round(rate * 100)}% of AI-mentioned files found in diff (threshold: 70%).`
        : aiClaimsLargeWork
        ? 'AI report is detailed but only a small number of lines were added. Possible overclaiming.'
        : undefined,
      evidence: { matchRate: Math.round(rate * 100) / 100, addedLines: addedLineCount, mentionedFiles },
      durationMs: Date.now() - start,
    };
  }

  // T1 — Test coverage did not drop.
  // Real logic: if the delivery diff includes a published coverage artifact
  // (coverage-summary.json / coverage-final.json / lcov.info), parse the
  // percentage values from removed vs. added lines and compare. We never
  // fabricate a baseline — when no coverage artifact is present in the diff we
  // SKIP (honest "not measurable in Phase 1") rather than emit a false PASS.
  checkCoverageDidNotDrop(diffFiles: string[], diffText: string): CheckResult {
    const start = Date.now();
    const coverageArtifact = diffFiles.find(f =>
      /coverage-summary\.json$/i.test(f) ||
      /coverage-final\.json$/i.test(f) ||
      /lcov\.info$/i.test(f) ||
      /(^|\/)coverage\//i.test(f),
    );

    if (!coverageArtifact || !diffText) {
      return {
        checkId: 'T1',
        checkName: CHECK_NAMES['T1'],
        tier: 'THOROUGH',
        status: 'SKIP',
        detail:
          'No coverage report (coverage-summary.json / coverage-final.json / lcov.info) was included in the delivery diff. Coverage-drop comparison requires a published coverage artifact.',
        evidence: { coverageArtifactFound: false },
        durationMs: Date.now() - start,
      };
    }

    const { added, removed } = this.splitDiff(diffText);
    const pctOf = (lines: string[]): number[] => {
      const pcts: number[] = [];
      for (const line of lines) {
        // coverage-summary.json: "pct": 87.5    |    lcov totals are LF/LH (handled below)
        const jsonMatch = /"pct"\s*:\s*([0-9]+(?:\.[0-9]+)?)/g;
        let m: RegExpExecArray | null;
        while ((m = jsonMatch.exec(line)) !== null) pcts.push(parseFloat(m[1]));
      }
      return pcts;
    };

    const removedPcts = pctOf(removed);
    const addedPcts = pctOf(added);

    if (removedPcts.length === 0 || addedPcts.length === 0) {
      return {
        checkId: 'T1',
        checkName: CHECK_NAMES['T1'],
        tier: 'THOROUGH',
        status: 'SKIP',
        detail:
          'A coverage file was changed but no comparable percentage values were found in both the before and after versions of the diff.',
        evidence: { coverageArtifact, removedPcts, addedPcts },
        durationMs: Date.now() - start,
      };
    }

    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const before = avg(removedPcts);
    const after = avg(addedPcts);
    const delta = Math.round((after - before) * 100) / 100;

    // Spec threshold: coverage may decrease by no more than 2%.
    let status: CheckResult['status'];
    let detail: string | undefined;
    if (delta >= -2) {
      status = 'PASS';
      detail =
        delta >= 0
          ? `Coverage held or improved (${before.toFixed(1)}% → ${after.toFixed(1)}%).`
          : `Coverage dropped ${Math.abs(delta).toFixed(1)}%, within the 2% tolerance (${before.toFixed(1)}% → ${after.toFixed(1)}%).`;
    } else if (delta >= -10) {
      status = 'WARNING';
      detail = `Coverage dropped ${Math.abs(delta).toFixed(1)}% (${before.toFixed(1)}% → ${after.toFixed(1)}%), exceeding the 2% tolerance.`;
    } else {
      status = 'FAIL';
      detail = `Coverage dropped sharply by ${Math.abs(delta).toFixed(1)}% (${before.toFixed(1)}% → ${after.toFixed(1)}%).`;
    }

    return {
      checkId: 'T1',
      checkName: CHECK_NAMES['T1'],
      tier: 'THOROUGH',
      status,
      detail,
      evidence: { coverageArtifact, before, after, delta },
      durationMs: Date.now() - start,
    };
  }

  // T2 — New code has at least one test.
  // If more than 50 lines of new non-test source were added, a test file must
  // also appear in the diff. Small changes (≤50 new source lines) are not
  // required to ship a dedicated test.
  checkNewCodeHasTest(diffFiles: string[], diffText: string): CheckResult {
    const start = Date.now();
    if (!diffText) {
      return {
        checkId: 'T2',
        checkName: CHECK_NAMES['T2'],
        tier: 'THOROUGH',
        status: 'SKIP',
        detail: 'No diff text available.',
        durationMs: 0,
      };
    }

    // Count added lines that belong to non-test source code, attributing each
    // added line to its file via the diff's `+++ b/<path>` headers so test-file
    // and non-source additions never inflate the count (important: T2 is a
    // hard-blocking critical check). When a diff carries no file headers, fall
    // back to counting all non-comment added lines (best effort).
    const newSourceLines = this.countNewSourceLines(diffText);

    const testFiles = diffFiles.filter(f => this.isTestFile(f));
    const sourceFiles = diffFiles.filter(f => this.isSourceFile(f) && !this.isTestFile(f));

    if (newSourceLines <= 50) {
      return {
        checkId: 'T2',
        checkName: CHECK_NAMES['T2'],
        tier: 'THOROUGH',
        status: 'PASS',
        detail: `Only ${newSourceLines} new source lines added — below the 50-line threshold that requires a dedicated test.`,
        evidence: { newSourceLines, testFiles, sourceFiles },
        durationMs: Date.now() - start,
      };
    }

    return {
      checkId: 'T2',
      checkName: CHECK_NAMES['T2'],
      tier: 'THOROUGH',
      status: testFiles.length > 0 ? 'PASS' : 'FAIL',
      detail:
        testFiles.length > 0
          ? undefined
          : `${newSourceLines} new source lines added but no test file (*.test.*, *.spec.*, __tests__/) appears in the diff.`,
      evidence: { newSourceLines, testFiles, sourceFiles },
      durationMs: Date.now() - start,
    };
  }

  // T4 — Protected routes are still protected.
  // Strongest, lowest-false-positive signal available from a diff: detect a net
  // REMOVAL of an auth guard (a guard token present in removed lines but not
  // re-added). That is the classic "auth bypass left in for debug mode" pattern
  // and is a hard FAIL. New route handlers added with no guard are a WARNING.
  checkProtectedRoutesStillProtected(diffFiles: string[], diffText: string): CheckResult {
    const start = Date.now();
    if (!diffText) {
      return { checkId: 'T4', checkName: CHECK_NAMES['T4'], tier: 'THOROUGH', status: 'SKIP', detail: 'No diff text available.', durationMs: 0 };
    }

    const guardPattern = /@UseGuards|JwtAuthGuard|AuthGuard|@Auth\b|requireAuth|ensureAuthenticated|passport\.authenticate|isAuthenticated/;
    const routePattern = /@(Get|Post|Put|Patch|Delete)\s*\(|\b(router|app)\.(get|post|put|patch|delete)\s*\(/;

    const { added, removed } = this.splitDiff(diffText);
    // Only count decorator/usage lines as guards. A commented-out guard protects
    // nothing (so it must not offset a real removal), and an `import` line is mere
    // bookkeeping — consolidating two guard imports into one barrel import, or
    // dropping an unused guard import, must NOT be read as removing protection.
    const isImportLine = (l: string) => /^\s*import\s/.test(l.replace(/^[+-]/, ''));
    const guardCount = (l: string) => guardPattern.test(l) && !this.isCommentLine(l) && !isImportLine(l);
    const removedGuards = removed.filter(guardCount).length;
    const addedGuards = added.filter(guardCount).length;
    const touchesRouteFile = diffFiles.some(f => /controller\.[jt]s$/i.test(f) || /routes?\.[jt]s$/i.test(f) || /router\.[jt]s$/i.test(f));

    if (removedGuards > addedGuards) {
      return {
        checkId: 'T4',
        checkName: CHECK_NAMES['T4'],
        tier: 'THOROUGH',
        status: 'FAIL',
        detail: `An auth guard appears to have been removed (${removedGuards} guard reference(s) deleted, ${addedGuards} added). A previously-protected route may now be reachable without credentials.`,
        evidence: { removedGuards, addedGuards, touchesRouteFile },
        durationMs: Date.now() - start,
      };
    }

    const newRoutes = added.filter(l => routePattern.test(l)).length;
    if (newRoutes > 0 && addedGuards === 0 && touchesRouteFile) {
      return {
        checkId: 'T4',
        checkName: CHECK_NAMES['T4'],
        tier: 'THOROUGH',
        status: 'WARNING',
        detail: `${newRoutes} new route handler(s) added with no auth guard in the same diff. Confirm these endpoints are intentionally public.`,
        evidence: { newRoutes, addedGuards, removedGuards },
        durationMs: Date.now() - start,
      };
    }

    return {
      checkId: 'T4',
      checkName: CHECK_NAMES['T4'],
      tier: 'THOROUGH',
      status: 'PASS',
      detail: 'No auth guard was removed and no unguarded new routes were detected in the diff.',
      evidence: { newRoutes, addedGuards, removedGuards },
      durationMs: Date.now() - start,
    };
  }

  // T5 — Rate limiting is present on new public endpoints.
  // If new public route handlers are added, a rate-limit reference should appear
  // in the same diff. Missing rate limiting on a new public endpoint is a WARNING.
  checkRateLimitOnNewEndpoints(diffFiles: string[], diffText: string): CheckResult {
    const start = Date.now();
    if (!diffText) {
      return { checkId: 'T5', checkName: CHECK_NAMES['T5'], tier: 'THOROUGH', status: 'SKIP', detail: 'No diff text available.', durationMs: 0 };
    }

    const { added } = this.splitDiff(diffText);
    const routePattern = /@(Get|Post|Put|Patch|Delete)\s*\(|\b(router|app)\.(get|post|put|patch|delete)\s*\(/;
    const publicPattern = /@Public\s*\(/;
    const guardPattern = /@UseGuards|JwtAuthGuard|AuthGuard/;
    const rateLimitPattern = /@Throttle|ThrottlerGuard|@RateLimit|rateLimit|express-rate-limit|@SkipThrottle/;

    const newRoutes = added.filter(l => routePattern.test(l)).length;
    if (newRoutes === 0) {
      return {
        checkId: 'T5',
        checkName: CHECK_NAMES['T5'],
        tier: 'THOROUGH',
        status: 'PASS',
        detail: 'No new route handlers were added in this diff.',
        evidence: { newRoutes: 0 },
        durationMs: Date.now() - start,
      };
    }

    const hasRateLimit = added.some(l => rateLimitPattern.test(l));
    // "Public" = explicitly marked @Public() or a new route with no guard added.
    const looksPublic = added.some(l => publicPattern.test(l)) || !added.some(l => guardPattern.test(l));

    if (hasRateLimit || !looksPublic) {
      return {
        checkId: 'T5',
        checkName: CHECK_NAMES['T5'],
        tier: 'THOROUGH',
        status: 'PASS',
        detail: hasRateLimit
          ? 'New endpoints include a rate-limiting reference.'
          : 'New endpoints appear to be guarded (not public).',
        evidence: { newRoutes, hasRateLimit, looksPublic },
        durationMs: Date.now() - start,
      };
    }

    return {
      checkId: 'T5',
      checkName: CHECK_NAMES['T5'],
      tier: 'THOROUGH',
      status: 'WARNING',
      detail: `${newRoutes} new public endpoint(s) added with no rate-limiting reference (@Throttle / ThrottlerGuard / rateLimit) in the diff.`,
      evidence: { newRoutes, hasRateLimit, looksPublic },
      durationMs: Date.now() - start,
    };
  }

  // T8 — No orphan files left behind.
  // Diff-scoped heuristic: every newly added source file should be referenced
  // (imported / registered) somewhere in the diff. A file that appears in the
  // diff but is never imported and has no module/index registration alongside
  // it is flagged as a possible orphan. Capped at WARNING because an unchanged
  // file outside the diff could still import it.
  checkNoOrphanFiles(diffFiles: string[], diffText: string): CheckResult {
    const start = Date.now();
    const sourceFiles = diffFiles.filter(f => this.isSourceFile(f) && !this.isTestFile(f) && !this.isIndexOrModule(f));
    if (sourceFiles.length === 0) {
      return {
        checkId: 'T8',
        checkName: CHECK_NAMES['T8'],
        tier: 'THOROUGH',
        status: 'PASS',
        detail: 'No new non-test source files to check for orphaning.',
        evidence: { sourceFiles: [] },
        durationMs: Date.now() - start,
      };
    }

    const { added } = this.splitDiff(diffText);
    const addedText = added.join('\n');
    const registrationFileChanged = diffFiles.some(f => this.isIndexOrModule(f));

    const orphans = sourceFiles.filter(f => {
      const base = f.split('/').pop()?.replace(/\.[jt]sx?$/, '') ?? f;
      // A file is considered wired if it is imported by path anywhere in the
      // diff, or a module/index/app registration file was changed alongside it.
      // We deliberately do NOT treat the file's own definition of a symbol as a
      // reference — that would make every new file self-satisfy this check.
      const importedByName = new RegExp(`['"\`][^'"\`]*${this.escapeRegex(base)}(?:\\.[jt]sx?)?['"\`]`).test(addedText);
      return !importedByName && !registrationFileChanged;
    });

    return {
      checkId: 'T8',
      checkName: CHECK_NAMES['T8'],
      tier: 'THOROUGH',
      status: orphans.length > 0 ? 'WARNING' : 'PASS',
      detail:
        orphans.length > 0
          ? `New source file(s) with no import/registration found in the diff (possible orphans): ${orphans.join(', ')}. Confirm they are wired in.`
          : 'All new source files are imported or registered within the diff.',
      evidence: { sourceFiles, orphans, registrationFileChanged },
      durationMs: Date.now() - start,
    };
  }

  // T9 — Breaking changes to shared exports are handled.
  // Detect exported symbols whose signature changed or were removed. Capped at
  // WARNING because the full caller graph lives outside the diff.
  checkBreakingExportsHandled(diffText: string): CheckResult {
    const start = Date.now();
    if (!diffText) {
      return { checkId: 'T9', checkName: CHECK_NAMES['T9'], tier: 'THOROUGH', status: 'SKIP', detail: 'No diff text available.', durationMs: 0 };
    }

    const { added, removed } = this.splitDiff(diffText);
    const exportSig = /export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z0-9_$]+)\s*(\([^)]*\))?/;

    const removedExports = new Map<string, string>();
    for (const line of removed) {
      const m = exportSig.exec(line.slice(1));
      if (m) removedExports.set(m[1], m[2] ?? '');
    }
    const addedExports = new Map<string, string>();
    for (const line of added) {
      const m = exportSig.exec(line.slice(1));
      if (m) addedExports.set(m[1], m[2] ?? '');
    }

    const removedEntirely: string[] = [];
    const signatureChanged: string[] = [];
    for (const [name, sig] of removedExports) {
      if (!addedExports.has(name)) {
        removedEntirely.push(name);
      } else if (addedExports.get(name) !== sig) {
        signatureChanged.push(name);
      }
    }

    const breaking = [...removedEntirely, ...signatureChanged];
    return {
      checkId: 'T9',
      checkName: CHECK_NAMES['T9'],
      tier: 'THOROUGH',
      status: breaking.length > 0 ? 'WARNING' : 'PASS',
      detail:
        breaking.length > 0
          ? `Shared export(s) changed or removed: ${breaking.join(', ')}. Verify every caller across the codebase was updated.`
          : 'No shared exports were removed or had their signatures changed.',
      evidence: { removedEntirely, signatureChanged },
      durationMs: Date.now() - start,
    };
  }

  private splitDiff(diffText: string): { added: string[]; removed: string[] } {
    const lines = (diffText || '').split('\n');
    return {
      added: lines.filter(l => l.startsWith('+') && !l.startsWith('+++')),
      removed: lines.filter(l => l.startsWith('-') && !l.startsWith('---')),
    };
  }

  private countNewSourceLines(diffText: string): number {
    let currentFile = '';
    let count = 0;
    for (const raw of (diffText || '').split('\n')) {
      if (raw.startsWith('+++')) {
        currentFile = raw.replace(/^\+\+\+\s+(?:b\/)?/, '').trim();
        continue;
      }
      if (raw.startsWith('---')) continue;
      if (!raw.startsWith('+')) continue;
      // When the line is attributable to a file, skip test files and non-source files.
      if (currentFile && (this.isTestFile(currentFile) || !this.isSourceFile(currentFile))) continue;
      const code = raw.slice(1).trim();
      if (code.length === 0 || code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) continue;
      count++;
    }
    return count;
  }

  private isCommentLine(line: string): boolean {
    const code = line.replace(/^[+-]/, '').trim();
    return code.startsWith('//') || code.startsWith('*') || code.startsWith('/*');
  }

  private isTestFile(f: string): boolean {
    return /\.(test|spec)\.[jt]sx?$/i.test(f) || /(^|\/)(__tests__|tests?)\//i.test(f);
  }

  private isSourceFile(f: string): boolean {
    return /\.[jt]sx?$/i.test(f) && !/\.d\.ts$/i.test(f);
  }

  private isIndexOrModule(f: string): boolean {
    return /(^|\/)index\.[jt]sx?$/i.test(f) || /\.module\.[jt]s$/i.test(f) || /(^|\/)app\.[jt]s$/i.test(f);
  }

  private escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private extractFilePaths(text: string): string[] {
    const paths: string[] = [];
    // Match file paths like src/foo/bar.ts, components/Button.tsx, etc.
    const pathPattern = /(?:^|[\s`'"(])([a-zA-Z0-9._/-]+\.[a-zA-Z]{1,5})(?:[\s`'")\n:]|$)/gm;
    let match: RegExpExecArray | null;
    while ((match = pathPattern.exec(text)) !== null) {
      const path = match[1].trim();
      // Filter out common false positives
      if (path.length > 3 && !path.startsWith('http') && (path.includes('/') || path.includes('.'))) {
        paths.push(path);
      }
    }
    return [...new Set(paths)];
  }
}
