import { vi, describe, it, expect, beforeEach, afterEach, type Mocked, type Mock } from 'vitest';
import { Test } from '@nestjs/testing';
import axios from 'axios';
import { SecurityChecksService } from '../checks/security-checks.service.js';

vi.mock('axios');
const mockedAxios = axios as Mocked<typeof axios>;

// ---------------------------------------------------------------------------
// Diff builder helpers
// ---------------------------------------------------------------------------

/** Wraps code into a unified diff "added line" format */
function _addedLine(code: string): string {
  return `+${code}`;
}

function makeDiff(addedLines: string[], removedLines: string[] = []): string {
  const lines: string[] = [
    '--- a/src/foo.ts',
    '+++ b/src/foo.ts',
    '@@ -1,5 +1,5 @@',
    ...removedLines.map(l => `-${l}`),
    ...addedLines.map(l => `+${l}`),
  ];
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// OSV API response fixtures
// ---------------------------------------------------------------------------

function makeOsvResponse(
  results: Array<{ vulns?: Array<{ id: string; database_specific?: { severity?: string } }> }>,
) {
  return { data: { results } };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SecurityChecksService', () => {
  let service: SecurityChecksService;

  beforeEach(async () => {
    vi.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [SecurityChecksService],
    }).compile();
    service = module.get(SecurityChecksService);
  });

  // ── S3: No hardcoded secrets ───────────────────────────────────────────────

  describe('checkNoHardcodedSecrets (S3)', () => {
    it('PASS on a clean diff with no secrets', async () => {
      const diff = makeDiff([`const greeting = 'hello world';`, `function add(a, b) { return a + b; }`]);
      const result = await service.checkNoHardcodedSecrets(diff);
      expect(result.checkId).toBe('S3');
      expect(result.status).toBe('PASS');
      expect(result.detail).toBeUndefined();
    });

    it('FAIL when Stripe live key appears in added line', async () => {
      const diff = makeDiff([`const stripeKey = 'sk_live_ABCDEFGHIJKLMNOPQRSTUVWX';`]);
      const result = await service.checkNoHardcodedSecrets(diff);
      expect(result.checkId).toBe('S3');
      expect(result.status).toBe('FAIL');
      expect(result.detail).toContain('Stripe live key');
    });

    it('FAIL when Stripe test key appears in added line', async () => {
      const diff = makeDiff([`const key = 'sk_test_ABCDEFGHIJKLMNOPQRSTUVWX';`]);
      const result = await service.checkNoHardcodedSecrets(diff);
      expect(result.checkId).toBe('S3');
      expect(result.status).toBe('FAIL');
      expect(result.detail).toContain('Stripe test key');
    });

    it('FAIL when AWS AKIA access key appears in added line', async () => {
      const diff = makeDiff([`const awsKey = "AKIAIOSFODNN7EXAMPLE1234";`]);
      const result = await service.checkNoHardcodedSecrets(diff);
      expect(result.checkId).toBe('S3');
      expect(result.status).toBe('FAIL');
      expect(result.detail).toContain('AWS access key');
    });

    it('FAIL when GitHub PAT (ghp_) appears in added line', async () => {
      // ghp_ + exactly 36 alphanumeric chars
      const diff = makeDiff([`const token = "ghp_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";`]);
      const result = await service.checkNoHardcodedSecrets(diff);
      expect(result.status).toBe('FAIL');
      expect(result.detail).toContain('GitHub token');
    });

    it('FAIL when GitHub OAuth token (gho_) appears in added line', async () => {
      // gho_ + exactly 36 alphanumeric characters (pattern: gho_[A-Za-z0-9]{36})
      const diff = makeDiff([`process.env.GH_TOKEN = "gho_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";`]);
      const result = await service.checkNoHardcodedSecrets(diff);
      expect(result.status).toBe('FAIL');
    });

    it('FAIL when hardcoded password assignment appears in added line', async () => {
      const diff = makeDiff([`const password = "mySecretPassword123";`]);
      const result = await service.checkNoHardcodedSecrets(diff);
      expect(result.checkId).toBe('S3');
      expect(result.status).toBe('FAIL');
      expect(result.detail).toContain('Hardcoded password');
    });

    it('FAIL when MongoDB URI with credentials appears in added line', async () => {
      const diff = makeDiff([`const uri = "mongodb+srv://admin:pass@cluster.mongodb.net/db";`]);
      const result = await service.checkNoHardcodedSecrets(diff);
      expect(result.status).toBe('FAIL');
      expect(result.detail).toContain('MongoDB URI');
    });

    it('FAIL when PostgreSQL URI with credentials appears in added line', async () => {
      const diff = makeDiff([`const db = "postgresql://user:secret@db.example.com:5432/mydb";`]);
      const result = await service.checkNoHardcodedSecrets(diff);
      expect(result.status).toBe('FAIL');
      expect(result.detail).toContain('PostgreSQL URI');
    });

    it('does NOT flag secrets in removed lines (removing a secret is good)', async () => {
      const diff = makeDiff(
        [`const greeting = 'hello';`], // added — safe
        [`const oldKey = 'sk_live_ABCDEFGHIJKLMNOPQRSTUVWX';`], // removed — should not flag
      );
      const result = await service.checkNoHardcodedSecrets(diff);
      expect(result.status).toBe('PASS');
    });

    it('does NOT flag secrets in diff header lines (+++ prefix)', async () => {
      // +++ lines are unified diff file headers, not code additions
      const diff = `+++ b/src/sk_live_ABCDEFGHIJKLMNOPQRSTUVWX.ts\n+const safeCode = true;`;
      const result = await service.checkNoHardcodedSecrets(diff);
      expect(result.status).toBe('PASS');
    });

    it('SKIP when diff text is empty string', async () => {
      const result = await service.checkNoHardcodedSecrets('');
      expect(result.checkId).toBe('S3');
      expect(result.status).toBe('SKIP');
    });

    it('evidence includes patternsChecked count on FAIL', async () => {
      const diff = makeDiff([`const k = "sk_live_ABCDEFGHIJKLMNOPQRSTUVWX";`]);
      const result = await service.checkNoHardcodedSecrets(diff);
      expect((result.evidence as Record<string, unknown>).patternsChecked).toBeGreaterThan(0);
      expect((result.evidence as Record<string, unknown>).matchesFound).toBeGreaterThan(0);
    });

    it('evidence matchesFound is 0 on PASS', async () => {
      const diff = makeDiff([`const x = 42;`]);
      const result = await service.checkNoHardcodedSecrets(diff);
      expect((result.evidence as Record<string, unknown>).matchesFound).toBe(0);
    });

    it('evidence matchedPatterns lists the pattern names that triggered', async () => {
      const diff = makeDiff([`const k = "sk_live_ABCDEFGHIJKLMNOPQRSTUVWX";`]);
      const result = await service.checkNoHardcodedSecrets(diff);
      expect((result.evidence as Record<string, unknown>).matchedPatterns).toContain('Stripe live key');
    });
  });

  // ── S6: New dependencies safe ─────────────────────────────────────────────

  describe('checkDependencySecurity (S6)', () => {
    it('PASS when no package.json changed', async () => {
      const result = await service.checkDependencySecurity(
        ['src/invoice.service.ts', 'src/invoice.spec.ts'],
        'acme', 'api', 'abc', 'def',
      );
      expect(result.checkId).toBe('S6');
      expect(result.status).toBe('PASS');
      expect(result.detail).toContain('No package.json');
    });

    it('PASS when nested package.json path not in diff files list', async () => {
      const result = await service.checkDependencySecurity(
        ['apps/api/src/main.ts', 'README.md'],
        'acme', 'api', 'abc', 'def',
      );
      expect(result.status).toBe('PASS');
    });

    it('FAIL when new package has HIGH severity CVE', async () => {
      // Mock: package.json changed (triggers extractNewPackages)
      // Mock GitHub compare to return a package.json with new dep
      mockedAxios.get.mockResolvedValue({
        data: {
          files: [{
            filename: 'package.json',
            patch: '@@ -5,6 +5,7 @@\n+  "lodash": "4.17.1",',
          }],
        },
      });
      // Mock OSV API returning HIGH CVE
      mockedAxios.post.mockResolvedValue(makeOsvResponse([
        { vulns: [{ id: 'GHSA-p6mc-m468-83gw', database_specific: { severity: 'HIGH' } }] },
      ]));

      const result = await service.checkDependencySecurity(
        ['package.json'],
        'acme', 'api', 'abc', 'def',
      );
      expect(result.checkId).toBe('S6');
      expect(result.status).toBe('FAIL');
      expect(result.detail).toContain('HIGH');
      expect(result.evidence).toBeDefined();
      expect((result.evidence as Record<string, unknown>).criticalVulnsFound).toBeGreaterThan(0);
    });

    it('FAIL when new package has CRITICAL severity CVE', async () => {
      mockedAxios.get.mockResolvedValue({
        data: {
          files: [{
            filename: 'package.json',
            patch: '@@ -5,6 +5,7 @@\n+  "axios": "0.21.0",',
          }],
        },
      });
      mockedAxios.post.mockResolvedValue(makeOsvResponse([
        { vulns: [{ id: 'GHSA-42xw-2xvc-qx8m', database_specific: { severity: 'CRITICAL' } }] },
      ]));

      const result = await service.checkDependencySecurity(
        ['package.json'],
        'acme', 'api', 'abc', 'def',
      );
      expect(result.status).toBe('FAIL');
      expect(result.detail).toContain('CRITICAL');
    });

    it('WARNING (not FAIL) when new package has only LOW severity CVE', async () => {
      mockedAxios.get.mockResolvedValue({
        data: {
          files: [{
            filename: 'package.json',
            patch: '@@ -5,6 +5,7 @@\n+  "debug": "2.6.9",',
          }],
        },
      });
      // A LOW CVE does not trigger FAIL, but it is no longer silently treated as
      // safe (fail-open, HKO M1) — it surfaces as a WARNING for manual review.
      mockedAxios.post.mockResolvedValue(makeOsvResponse([
        { vulns: [{ id: 'GHSA-low-1234', database_specific: { severity: 'LOW' } }] },
      ]));

      const result = await service.checkDependencySecurity(
        ['package.json'],
        'acme', 'api', 'abc', 'def',
      );
      expect(result.status).toBe('WARNING'); // lower-severity CVE → review, not silent PASS
    });

    it('WARNING (not FAIL) when new package has MEDIUM severity CVE', async () => {
      mockedAxios.get.mockResolvedValue({
        data: {
          files: [{
            filename: 'package.json',
            patch: '@@ -5,6 +5,7 @@\n+  "minimist": "1.2.5",',
          }],
        },
      });
      mockedAxios.post.mockResolvedValue(makeOsvResponse([
        { vulns: [{ id: 'GHSA-medium-5678', database_specific: { severity: 'MEDIUM' } }] },
      ]));

      const result = await service.checkDependencySecurity(
        ['package.json'],
        'acme', 'api', 'abc', 'def',
      );
      expect(result.status).toBe('WARNING'); // medium/unknown CVE → review, not silent PASS
    });

    it('PASS when new package has no CVEs', async () => {
      mockedAxios.get.mockResolvedValue({
        data: {
          files: [{
            filename: 'package.json',
            patch: '@@ -5,6 +5,7 @@\n+  "zod": "3.22.4",',
          }],
        },
      });
      mockedAxios.post.mockResolvedValue(makeOsvResponse([{ vulns: [] }]));

      const result = await service.checkDependencySecurity(
        ['package.json'],
        'acme', 'api', 'abc', 'def',
      );
      expect(result.status).toBe('PASS');
    });

    it('WARNING (not FAIL) when OSV API times out — do not block payment on external API outage', async () => {
      mockedAxios.get.mockResolvedValue({
        data: {
          files: [{
            filename: 'package.json',
            patch: '@@ -5,6 +5,7 @@\n+  "zod": "3.22.4",',
          }],
        },
      });
      // OSV API throws timeout
      mockedAxios.post.mockRejectedValue(new Error('ECONNABORTED: timeout of 10000ms exceeded'));

      const result = await service.checkDependencySecurity(
        ['package.json'],
        'acme', 'api', 'abc', 'def',
      );
      expect(result.checkId).toBe('S6');
      expect(result.status).toBe('WARNING'); // graceful degradation
      expect(result.detail).toContain('could not complete');
    });

    it('WARNING when OSV API returns 503 service unavailable', async () => {
      mockedAxios.get.mockResolvedValue({
        data: {
          files: [{
            filename: 'package.json',
            patch: '@@ -5,6 +5,7 @@\n+  "zod": "3.22.4",',
          }],
        },
      });
      mockedAxios.post.mockRejectedValue(
        Object.assign(new Error('Service Unavailable'), { response: { status: 503 } }),
      );

      const result = await service.checkDependencySecurity(
        ['package.json'],
        'acme', 'api', 'abc', 'def',
      );
      expect(result.status).toBe('WARNING');
    });

    it('detects nested package.json via endsWith check', async () => {
      mockedAxios.get.mockResolvedValue({ data: { files: [] } });
      const result = await service.checkDependencySecurity(
        ['apps/web/package.json'],
        'acme', 'api', 'abc', 'def',
      );
      // package.json detected → proceeds to extractNewPackages; no new packages → PASS
      expect(result.checkId).toBe('S6');
      expect(result.status).toBe('PASS');
    });

    it('includes scoped npm packages in OSV batch (regression: CVE filter)', async () => {
      mockedAxios.get.mockResolvedValue({
        data: {
          files: [{
            filename: 'package.json',
            patch: '@@ -5,6 +5,7 @@\n+  "@nestjs/common": "^10.0.0",',
          }],
        },
      });
      mockedAxios.post.mockResolvedValue(makeOsvResponse([{ vulns: [] }]));

      await service.checkDependencySecurity(['package.json'], 'acme', 'api', 'abc', 'def');

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://api.osv.dev/v1/querybatch',
        expect.objectContaining({
          queries: [{ package: { name: '@nestjs/common', ecosystem: 'npm' }, version: '10.0.0' }],
        }),
        expect.any(Object),
      );
    });

    it('does not treat package.json metadata fields as dependencies (regression: CVE filter)', async () => {
      mockedAxios.get.mockResolvedValue({
        data: {
          files: [{
            filename: 'package.json',
            patch: '@@ -1,3 +1,4 @@\n+  "version": "2.0.0",',
          }],
        },
      });
      mockedAxios.post.mockResolvedValue(makeOsvResponse([]));

      const result = await service.checkDependencySecurity(['package.json'], 'acme', 'api', 'abc', 'def');

      expect(mockedAxios.post).not.toHaveBeenCalled();
      expect(result.status).toBe('PASS');
      expect(result.detail).toContain('no new packages');
    });

    it('skips file: and git URL dependency versions (regression: CVE filter)', async () => {
      mockedAxios.get.mockResolvedValue({
        data: {
          files: [{
            filename: 'package.json',
            patch:
              '@@ -5,8 +5,10 @@\n+  "local-lib": "file:../lib",\n+  "remote-lib": "git+https://github.com/acme/lib.git",',
          }],
        },
      });
      mockedAxios.post.mockResolvedValue(makeOsvResponse([]));

      const result = await service.checkDependencySecurity(['package.json'], 'acme', 'api', 'abc', 'def');

      expect(mockedAxios.post).not.toHaveBeenCalled();
      expect(result.status).toBe('PASS');
    });
  });

  // ── INT1: No hardcoded credentials (full diff scan) ───────────────────────

  describe('checkNoHardcodedCredentials (INT1)', () => {
    it('PASS on clean diff', async () => {
      const diff = makeDiff([`const config = { host: 'localhost', port: 5432 };`]);
      const result = await service.checkNoHardcodedCredentials(diff);
      expect(result.checkId).toBe('INT1');
      expect(result.status).toBe('PASS');
    });

    it('FAIL when Stripe live key found in added line', async () => {
      const diff = makeDiff([`stripe.init('sk_live_ABCDEFGHIJKLMNOPQRSTUVWX')`]);
      const result = await service.checkNoHardcodedCredentials(diff);
      expect(result.checkId).toBe('INT1');
      expect(result.status).toBe('FAIL');
    });

    it('SKIP when diff is empty', async () => {
      const result = await service.checkNoHardcodedCredentials('');
      expect(result.checkId).toBe('INT1');
      expect(result.status).toBe('SKIP');
    });

    it('does not flag credentials in removed lines', async () => {
      const diff = makeDiff([], [`const secret = 'sk_live_ABCDEFGHIJKLMNOPQRSTUVWX';`]);
      const result = await service.checkNoHardcodedCredentials(diff);
      expect(result.status).toBe('PASS');
    });

    it('evidence matchedPatterns lists triggered pattern names on FAIL', async () => {
      const diff = makeDiff([`const k = 'sk_live_ABCDEFGHIJKLMNOPQRSTUVWX';`]);
      const result = await service.checkNoHardcodedCredentials(diff);
      expect((result.evidence as Record<string, unknown>).matchedPatterns).toBeDefined();
      expect((result.evidence as Record<string, unknown>).matchedPatterns.length).toBeGreaterThan(0);
    });
  });

  // ── INT2: Real credentials in production ──────────────────────────────────

  describe('checkRealCredentials (INT2)', () => {
    const originalKey = process.env.STRIPE_SECRET_KEY;

    afterEach(() => {
      // Restore env after each test
      if (originalKey !== undefined) {
        process.env.STRIPE_SECRET_KEY = originalKey;
      } else {
        delete process.env.STRIPE_SECRET_KEY;
      }
    });

    it('PASS when STRIPE_SECRET_KEY env var is not set', async () => {
      delete process.env.STRIPE_SECRET_KEY;
      const result = await service.checkRealCredentials(undefined);
      expect(result.checkId).toBe('INT2');
      expect(result.status).toBe('PASS');
    });

    it('PASS when STRIPE_SECRET_KEY is a live key', async () => {
      process.env.STRIPE_SECRET_KEY = 'sk_live_someProductionKeyHere';
      const result = await service.checkRealCredentials(undefined);
      expect(result.checkId).toBe('INT2');
      expect(result.status).toBe('PASS');
    });

    it('WARNING when STRIPE_SECRET_KEY is a test key (adversarial #12)', async () => {
      process.env.STRIPE_SECRET_KEY = 'sk_test_someTestKeyHere';
      const result = await service.checkRealCredentials(undefined);
      expect(result.checkId).toBe('INT2');
      expect(result.status).toBe('WARNING');
      expect(result.detail).toContain('sk_test_');
    });

    it('WARNING detail explains the problem clearly', async () => {
      process.env.STRIPE_SECRET_KEY = 'sk_test_anotherKey';
      const result = await service.checkRealCredentials('https://api.acme.com');
      expect(result.detail).toMatch(/test.*key|sk_test/i);
    });

    it('check is env-based not URL-based (deployUrl does not affect result)', async () => {
      process.env.STRIPE_SECRET_KEY = 'sk_live_validKey';
      const resultWithUrl = await service.checkRealCredentials('https://api.acme.com');
      const resultNoUrl = await service.checkRealCredentials(undefined);
      expect(resultWithUrl.status).toBe(resultNoUrl.status);
    });
  });

  describe('checkNoUnconditionalSuccessRegression (S12)', () => {
    it('FAIL — real arithmetic validation replaced by a hardcoded return with a masking comment (true positive, real-world shape)', () => {
      const diff = makeDiff(
        [
          '// TEMP: keep the release moving while reconciliation is repaired.',
          '// This intentionally flawed commit simulates an AI agent masking unfinished work.',
          'return true;',
        ],
        [
          'const calculated = lineItemTotal(invoice.lineItems) + (invoice.tax ?? 0);',
          'return Math.abs(calculated - invoice.total) <= tolerance;',
        ],
      );
      const result = service.checkNoUnconditionalSuccessRegression(diff);
      expect(result.checkId).toBe('S12');
      expect(result.status).toBe('FAIL');
      expect(result.detail).toMatch(/unconditional return/i);
      expect(result.detail).toMatch(/intentional\/temporary/i);
    });

    it('WARNING — real logic replaced by a trivial return with no red-flag comment (flagged for review, not auto-rejected)', () => {
      const diff = makeDiff(
        ['return true;'],
        ['if (user.role === "admin" && user.permissions.includes("edit")) return checkOwnership(user, resource);'],
      );
      const result = service.checkNoUnconditionalSuccessRegression(diff);
      expect(result.checkId).toBe('S12');
      // Ambiguous cases (no explicit "temp/bypass/hack"-style signal) are
      // WARNING, not FAIL — S12 is CRITICAL only on FAIL, so this alone must
      // not hard-block a delivery without stronger supporting evidence.
      expect(result.status).toBe('WARNING');
    });

    it('FAIL — hardcoded "approved" status literal introduced with no surrounding condition', () => {
      const diff = makeDiff(['result.status = "approved";'], ['result.status = evaluateRisk(result);']);
      const result = service.checkNoUnconditionalSuccessRegression(diff);
      expect(result.status).toBe('FAIL');
      expect(result.detail).toMatch(/hardcoded pass\/success\/approved/i);
    });

    it('WARNING — a validation guard (throw on invalid input) is deleted without replacement', () => {
      const diff = makeDiff(
        ['return submitOrder(order);'],
        ['if (!order.total || order.total <= 0) { throw new Error("invalid order total"); }', 'return submitOrder(order);'],
      );
      const result = service.checkNoUnconditionalSuccessRegression(diff);
      expect(result.status).toBe('WARNING');
      expect(result.detail).toMatch(/validation guard/i);
    });

    it('PASS — brand-new stub/feature-flag function with nothing removed (false-positive guard)', () => {
      const diff = makeDiff(['export function isBetaFeatureEnabled() {', '  return true;', '}'], []);
      const result = service.checkNoUnconditionalSuccessRegression(diff);
      expect(result.status).toBe('PASS');
    });

    it('PASS — legitimate return true inside a real conditional branch is not flagged', () => {
      const diff = makeDiff(
        ['if (user.isAdmin) {', '  return true;', '}', 'return hasExplicitGrant(user, resource);'],
        ['return hasExplicitGrant(user, resource);'],
      );
      const result = service.checkNoUnconditionalSuccessRegression(diff);
      expect(result.status).toBe('PASS');
    });

    it('PASS — status literal set conditionally (inside an if/else) is not flagged as hardcoded', () => {
      const diff = makeDiff(
        ['if (riskScore < threshold) { result.status = "approved"; } else { result.status = "rejected"; }'],
        ['result.status = evaluateRisk(result);'],
      );
      const result = service.checkNoUnconditionalSuccessRegression(diff);
      expect(result.status).toBe('PASS');
    });

    it('SKIP when diff text is unavailable', () => {
      const result = service.checkNoUnconditionalSuccessRegression('');
      expect(result.status).toBe('SKIP');
    });

    it('PASS on a diff with no removed lines and no suspicious added content', () => {
      const diff = makeDiff(['const x = 1;', 'console.log(x);'], []);
      const result = service.checkNoUnconditionalSuccessRegression(diff);
      expect(result.status).toBe('PASS');
    });
  });
});
