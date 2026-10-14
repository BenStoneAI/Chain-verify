import { Injectable } from '@nestjs/common';
import axios from 'axios';
import type { CheckResult } from '../software-delivery.types.js';
import { CHECK_NAMES } from '../software-delivery.types.js';

const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'Stripe live key', pattern: /sk_live_[a-zA-Z0-9]{24,}/ },
  { name: 'Stripe test key', pattern: /sk_test_[a-zA-Z0-9]{24,}/ },
  { name: 'Google API key', pattern: /AIza[0-9A-Za-z\-_]{35}/ },
  { name: 'AWS access key', pattern: /AKIA[0-9A-Z]{16}/ },
  { name: 'GitHub token (PAT)', pattern: /ghp_[A-Za-z0-9]{36}/ },
  { name: 'GitHub token (OAuth)', pattern: /gho_[A-Za-z0-9]{36}/ },
  { name: 'GitHub token (server)', pattern: /ghs_[A-Za-z0-9]{36}/ },
  { name: 'GitHub refresh token', pattern: /ghr_[A-Za-z0-9]{76}/ },
  { name: 'Hardcoded password', pattern: /password\s*=\s*["'][^"']{8,}["']/i },
  { name: 'MongoDB URI with credentials', pattern: /mongodb\+srv:\/\/[^@]+@/ },
  { name: 'PostgreSQL URI with credentials', pattern: /postgres(?:ql)?:\/\/[^@]+:[^@]+@/ },
  { name: 'Generic API key assignment', pattern: /api[_-]?key\s*=\s*["'][A-Za-z0-9]{20,}["']/i },
  { name: 'Anthropic API key', pattern: /sk-ant-[A-Za-z0-9\-_]{40,}/ },
  { name: 'OpenAI API key', pattern: /sk-[A-Za-z0-9]{48,}/ },
];

// S12 — patterns that indicate real logic was removed and swallowed by a
// trivial, always-succeeding replacement. Kept generic (not tied to any one
// repo/vendor/language) so the check is a legitimate reusable VerifyAPI
// control, not a demo-specific hack.
const TRIVIAL_RETURN_RE = /^return\s+(true|false|1|0|null|"(?:ok|pass(?:ed)?|success)")\s*;?$/i;
const REAL_LOGIC_SIGNAL_RE = /[=!<>]==?|&&|\|\||\b[a-zA-Z_$][\w$]*\s*\(|\b(valid|verify|verified|check|match|compare|assert|throw|reject)\b/i;
const RED_FLAG_COMMENT_RE =
  /\b(temp|temporary|todo|fixme|hack|bypass|disable[ds]?|skip(?:ped)?|stub(?:bed)?|placeholder|for now|masking|fake|not\s+yet)\b/i;
const HARDCODED_SUCCESS_LITERAL_RE =
  /\b(status|result|verdict|outcome|state)\s*[:=]\s*["'](pass(?:ed)?|success|approved|ok|valid)["']/i;
const VALIDATION_GUARD_RE = /\bif\s*\([^)]*\)/;
const GUARD_FAILURE_RE = /\b(throw|return\s+false|reject\s*\()/;

interface DiffHunk {
  file: string;
  removed: string[];
  added: string[];
}

// Splits a unified diff into per-file, per-hunk removed/added line groups.
// Pure text parsing — never executes anything from the diff content.
function splitDiffIntoHunks(diffText: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let currentFile = 'unknown';
  let removed: string[] = [];
  let added: string[] = [];
  const flush = () => {
    if (removed.length > 0 || added.length > 0) {
      hunks.push({ file: currentFile, removed, added });
    }
    removed = [];
    added = [];
  };
  for (const line of diffText.split('\n')) {
    if (line.startsWith('+++ b/')) {
      flush();
      currentFile = line.slice('+++ b/'.length).trim();
      continue;
    }
    if (line.startsWith('@@')) {
      flush();
      continue;
    }
    if (line.startsWith('-') && !line.startsWith('---')) {
      removed.push(line.slice(1));
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      added.push(line.slice(1));
    }
  }
  flush();
  return hunks;
}

const PKG_JSON_METADATA_KEYS = new Set([
  'name',
  'version',
  'description',
  'license',
  'author',
  'repository',
  'bugs',
  'homepage',
  'main',
  'types',
  'module',
  'exports',
  'engines',
  'private',
  'type',
  'scripts',
  'keywords',
  'workspaces',
  'packageManager',
]);

@Injectable()
export class SecurityChecksService {

  /**
   * Classify an OSV advisory's severity. Prefers the GHSA string
   * (database_specific.severity), falls back to the CVSS v3 base score in the
   * severity[] vector, and returns 'UNKNOWN' when neither is present. Returning
   * 'UNKNOWN' (rather than treating it as safe) is what closes the S6 fail-open.
   */
  private classifyOsvSeverity(vuln: {
    database_specific?: { severity?: string };
    severity?: Array<{ type?: string; score?: string }>;
  }): string {
    const ghsa = vuln.database_specific?.severity?.toUpperCase();
    if (ghsa === 'CRITICAL' || ghsa === 'HIGH' || ghsa === 'MODERATE' || ghsa === 'LOW') {
      return ghsa;
    }
    const cvss = (vuln.severity ?? []).find(s => /CVSS/i.test(s.type ?? '') && s.score);
    if (cvss?.score) {
      // OSV stores the CVSS vector string; extract a base score if numeric, else
      // derive a coarse band from the vector when it embeds one.
      const numeric = Number(cvss.score);
      const score = Number.isFinite(numeric)
        ? numeric
        : Number(/(?:^|\/)(?:CR|base[:=])?\s*(\d{1,2}(?:\.\d)?)\b/i.exec(cvss.score)?.[1] ?? NaN);
      if (Number.isFinite(score)) {
        if (score >= 9.0) return 'CRITICAL';
        if (score >= 7.0) return 'HIGH';
        if (score >= 4.0) return 'MODERATE';
        return 'LOW';
      }
    }
    return 'UNKNOWN';
  }

  /** Validates a parsed package.json dependency entry before OSV lookup. */
  private isValidNpmPackageQuery(name: string, rawVersion: string): boolean {
    if (!name || !rawVersion) return false;
    if (PKG_JSON_METADATA_KEYS.has(name)) return false;
    if (name.startsWith('@types/')) return false;
    return (
      /^[@a-zA-Z]/.test(name) &&
      !rawVersion.includes('://') &&
      !rawVersion.startsWith('file:')
    );
  }

  // S3 — No hardcoded secrets introduced in diff
  async checkNoHardcodedSecrets(diffText: string): Promise<CheckResult> {
    const start = Date.now();
    if (!diffText) {
      return {
        checkId: 'S3',
        checkName: CHECK_NAMES['S3'],
        tier: 'STANDARD',
        status: 'SKIP',
        detail: 'Could not retrieve diff text — skipping secrets scan.',
        durationMs: 0,
      };
    }

    // Only scan added lines (lines starting with + in the diff)
    const addedLines = diffText
      .split('\n')
      .filter(line => line.startsWith('+') && !line.startsWith('+++'))
      .join('\n');

    const matches = SECRET_PATTERNS.filter(({ pattern }) => pattern.test(addedLines)).map(m => m.name);

    return {
      checkId: 'S3',
      checkName: CHECK_NAMES['S3'],
      tier: 'STANDARD',
      status: matches.length === 0 ? 'PASS' : 'FAIL',
      detail:
        matches.length > 0
          ? `Potential hardcoded secrets detected matching patterns: ${matches.join(', ')}. Review the diff immediately.`
          : undefined,
      evidence: { patternsChecked: SECRET_PATTERNS.length, matchesFound: matches.length, matchedPatterns: matches },
      durationMs: Date.now() - start,
    };
  }

  // S12 — Detects real validation/comparison logic being replaced by a
  // trivial, unconditionally-succeeding return (or a hardcoded pass/success
  // status literal), and validation guard branches being deleted outright.
  // Static diff-text analysis only — no repository code is executed, so this
  // is safe to run on the public, unauthenticated demo endpoint. Deliberately
  // conservative: a bare `return true;` added on its own (e.g. a brand-new
  // stub function, a feature flag) never fires — it only fires when the SAME
  // hunk also removes a line carrying real logic (a comparison, a function
  // call, or validation-adjacent language), so legitimate simplifications and
  // new stub methods are not flagged without that supporting context.
  checkNoUnconditionalSuccessRegression(diffText: string): CheckResult {
    const start = Date.now();
    if (!diffText) {
      return {
        checkId: 'S12',
        checkName: CHECK_NAMES['S12'],
        tier: 'STANDARD',
        status: 'SKIP',
        detail: 'Could not retrieve diff text — skipping unconditional-success regression scan.',
        durationMs: 0,
      };
    }

    const hunks = splitDiffIntoHunks(diffText);
    const strongFindings: string[] = [];
    const weakFindings: string[] = [];

    for (const hunk of hunks) {
      const addedNonBlank = hunk.added.map(l => l.trim()).filter(l => l.length > 0);
      const removedBlob = hunk.removed.join('\n');
      const addedBlob = hunk.added.join('\n');

      // Pattern A: real logic removed, replaced by nothing but trivial returns.
      const addedIsOnlyTrivialReturns =
        addedNonBlank.length > 0 && addedNonBlank.every(l => TRIVIAL_RETURN_RE.test(l) || l.startsWith('//') || l.startsWith('*'));
      if (addedIsOnlyTrivialReturns && REAL_LOGIC_SIGNAL_RE.test(removedBlob)) {
        const flagged = `${hunk.file}: real validation logic removed, replaced by an unconditional return`;
        if (RED_FLAG_COMMENT_RE.test(addedBlob)) {
          strongFindings.push(`${flagged} (added comment signals it is intentional/temporary).`);
        } else {
          weakFindings.push(`${flagged}.`);
        }
        continue;
      }

      // Pattern B: a hardcoded pass/success/approved status literal newly
      // introduced without any conditional in the same hunk.
      if (
        HARDCODED_SUCCESS_LITERAL_RE.test(addedBlob) &&
        !HARDCODED_SUCCESS_LITERAL_RE.test(removedBlob) &&
        !/\?|switch\s*\(/.test(addedBlob) &&
        !VALIDATION_GUARD_RE.test(addedBlob)
      ) {
        strongFindings.push(`${hunk.file}: a hardcoded pass/success/approved status was introduced with no surrounding condition.`);
        continue;
      }

      // Pattern C: a validation guard (if-check that throws/returns
      // false/rejects) present in the removed lines has no equivalent guard
      // among the added lines — the check was deleted, not just refactored.
      if (
        VALIDATION_GUARD_RE.test(removedBlob) &&
        GUARD_FAILURE_RE.test(removedBlob) &&
        !(VALIDATION_GUARD_RE.test(addedBlob) && GUARD_FAILURE_RE.test(addedBlob))
      ) {
        weakFindings.push(`${hunk.file}: a validation guard that could reject invalid input was removed without a replacement.`);
      }
    }

    if (strongFindings.length === 0 && weakFindings.length === 0) {
      return {
        checkId: 'S12',
        checkName: CHECK_NAMES['S12'],
        tier: 'STANDARD',
        status: 'PASS',
        durationMs: Date.now() - start,
      };
    }

    const status = strongFindings.length > 0 ? 'FAIL' : 'WARNING';
    const allFindings = [...strongFindings, ...weakFindings];
    return {
      checkId: 'S12',
      checkName: CHECK_NAMES['S12'],
      tier: 'STANDARD',
      status,
      detail: allFindings.join(' '),
      evidence: { strongFindings, weakFindings },
      durationMs: Date.now() - start,
    };
  }

  // S6 — New dependencies are safe (OSV vulnerability database)
  async checkDependencySecurity(
    diffFiles: string[],
    owner: string,
    repo: string,
    before: string,
    after: string,
  ): Promise<CheckResult> {
    const start = Date.now();

    const packageJsonChanged = diffFiles.some(f => f === 'package.json' || f.endsWith('/package.json'));
    if (!packageJsonChanged) {
      return {
        checkId: 'S6',
        checkName: CHECK_NAMES['S6'],
        tier: 'STANDARD',
        status: 'PASS',
        detail: 'No package.json changes detected — no new dependencies to check.',
        durationMs: Date.now() - start,
      };
    }

    // Parse new packages from the diff (look for + lines in package.json diff)
    const newPackages = await this.extractNewPackages(owner, repo, before, after);

    if (newPackages.length === 0) {
      return {
        checkId: 'S6',
        checkName: CHECK_NAMES['S6'],
        tier: 'STANDARD',
        status: 'PASS',
        detail: 'package.json changed but no new packages were added (possibly version bumps or removals).',
        durationMs: Date.now() - start,
      };
    }

    try {
      const osvResponse = await axios.post(
        'https://api.osv.dev/v1/querybatch',
        {
          queries: newPackages.map(pkg => ({
            package: { name: pkg.name, ecosystem: 'npm' },
            version: pkg.version,
          })),
        },
        { timeout: 10000 },
      );

      const results: Array<{
        vulns?: Array<{
          id: string;
          database_specific?: { severity?: string };
          severity?: Array<{ type?: string; score?: string }>;
        }>;
      }> = osvResponse.data.results ?? [];

      // Collect EVERY advisory with its classified severity. Previously only
      // advisories whose database_specific.severity was literally HIGH/CRITICAL
      // were counted, so any vuln with a missing/unknown severity string was
      // silently treated as safe (fail-open, HKO M1). Now unknown-severity
      // advisories surface as a WARNING for manual review instead of PASS.
      const highCritical: Array<{ package: string; id: string; severity: string }> = [];
      const otherVulns: Array<{ package: string; id: string; severity: string }> = [];
      results.forEach((result, i) => {
        (result.vulns ?? []).forEach(vuln => {
          const severity = this.classifyOsvSeverity(vuln);
          const entry = { package: newPackages[i]?.name ?? 'unknown', id: vuln.id, severity };
          if (severity === 'HIGH' || severity === 'CRITICAL') highCritical.push(entry);
          else otherVulns.push(entry);
        });
      });

      const status = highCritical.length > 0 ? 'FAIL' : otherVulns.length > 0 ? 'WARNING' : 'PASS';
      return {
        checkId: 'S6',
        checkName: CHECK_NAMES['S6'],
        tier: 'STANDARD',
        status,
        detail:
          highCritical.length > 0
            ? `High/Critical CVEs found in new dependencies: ${highCritical.map(v => `${v.package} (${v.id} — ${v.severity})`).join(', ')}`
            : otherVulns.length > 0
              ? `${otherVulns.length} lower/unknown-severity advisory(ies) found in new dependencies — manual review recommended: ${otherVulns.map(v => `${v.package} (${v.id} — ${v.severity})`).join(', ')}`
              : undefined,
        evidence: {
          newPackagesChecked: newPackages.length,
          criticalVulnsFound: highCritical.length,
          otherVulnsFound: otherVulns.length,
          vulnerabilities: [...highCritical, ...otherVulns],
        },
        durationMs: Date.now() - start,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        checkId: 'S6',
        checkName: CHECK_NAMES['S6'],
        tier: 'STANDARD',
        status: 'WARNING',
        detail: `OSV vulnerability check could not complete: ${message}. Manual dependency review recommended.`,
        durationMs: Date.now() - start,
      };
    }
  }

  // INT1 — No hardcoded credentials (full codebase scan of the diff)
  async checkNoHardcodedCredentials(diffText: string): Promise<CheckResult> {
    const start = Date.now();
    if (!diffText) {
      return { checkId: 'INT1', checkName: CHECK_NAMES['INT1'], tier: 'STANDARD', status: 'SKIP', detail: 'No diff available.', durationMs: 0 };
    }
    const addedLines = diffText.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++')).join('\n');
    const matches = SECRET_PATTERNS.filter(({ pattern }) => pattern.test(addedLines)).map(m => m.name);
    return {
      checkId: 'INT1',
      checkName: CHECK_NAMES['INT1'],
      tier: 'STANDARD',
      status: matches.length === 0 ? 'PASS' : 'FAIL',
      detail: matches.length > 0 ? `Credentials found in diff matching: ${matches.join(', ')}` : undefined,
      evidence: { matchedPatterns: matches },
      durationMs: Date.now() - start,
    };
  }

  // INT2 — Real credentials, not test credentials
  async checkRealCredentials(_deployUrl: string | undefined): Promise<CheckResult> {
    const start = Date.now();
    // Check if environment variables use live (not test) prefixes
    // This check requires the caller to confirm; we check what we can automatically
    const stripeKey = process.env.STRIPE_SECRET_KEY ?? '';
    if (stripeKey.startsWith('sk_test_')) {
      return {
        checkId: 'INT2',
        checkName: CHECK_NAMES['INT2'],
        tier: 'STANDARD',
        status: 'WARNING',
        detail: 'STRIPE_SECRET_KEY appears to be a test key (sk_test_...). Ensure production uses sk_live_... credentials.',
        durationMs: Date.now() - start,
      };
    }
    return {
      checkId: 'INT2',
      checkName: CHECK_NAMES['INT2'],
      tier: 'STANDARD',
      status: 'PASS',
      detail: 'No test-mode credentials detected in server environment.',
      durationMs: Date.now() - start,
    };
  }

  private async extractNewPackages(
    owner: string,
    repo: string,
    before: string,
    after: string,
  ): Promise<Array<{ name: string; version: string }>> {
    try {
      const token = process.env.GITHUB_TOKEN ?? '';
      const response = await axios.get(
        `https://api.github.com/repos/${owner}/${repo}/compare/${before}...${after}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
          },
          timeout: 10000,
        },
      );
      const pkgFile = (response.data.files ?? []).find(
        (f: { filename: string }) => f.filename === 'package.json' || f.filename.endsWith('/package.json'),
      );
      if (!pkgFile?.patch) return [];

      const addedLines = pkgFile.patch
        .split('\n')
        .filter((l: string) => l.startsWith('+') && !l.startsWith('+++'));

      const packages: Array<{ name: string; version: string }> = [];
      for (const line of addedLines) {
        const match = line.match(/"((?:@[^/]+\/[^"]+|[^"@][^"]+))"\s*:\s*"([^"]+)"/);
        if (!match) continue;
        const [, name, rawVersion] = match;
        if (!this.isValidNpmPackageQuery(name, rawVersion)) continue;
        packages.push({ name, version: rawVersion.replace(/^[\^~>=<]*/, '') });
      }
      return packages;
    } catch {
      return [];
    }
  }
}
