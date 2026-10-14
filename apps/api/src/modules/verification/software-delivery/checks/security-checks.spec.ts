import { describe, it, expect, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { SecurityChecksService } from './security-checks.service.js';

describe('SecurityChecksService', () => {
  let service: SecurityChecksService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [SecurityChecksService],
    }).compile();
    service = module.get(SecurityChecksService);
  });

  describe('checkNoHardcodedSecrets (S3)', () => {
    it('returns PASS when no secrets in diff', async () => {
      const diff = `
+const foo = 'bar';
+function hello() { return 'world'; }
`;
      const result = await service.checkNoHardcodedSecrets(diff);
      expect(result.checkId).toBe('S3');
      expect(result.status).toBe('PASS');
      expect(result.detail).toBeUndefined();
    });

    it('returns FAIL when Stripe live key found in added lines', async () => {
      const diff = `
+const apiKey = 'sk_live_ABCDEFGHIJKLMNOPQRSTUVWX';
`;
      const result = await service.checkNoHardcodedSecrets(diff);
      expect(result.checkId).toBe('S3');
      expect(result.status).toBe('FAIL');
      expect(result.detail).toContain('Stripe live key');
    });

    it('returns FAIL when Stripe test key found in added lines', async () => {
      const diff = `
+const key = 'sk_test_ABCDEFGHIJKLMNOPQRSTUVWX';
`;
      const result = await service.checkNoHardcodedSecrets(diff);
      expect(result.checkId).toBe('S3');
      expect(result.status).toBe('FAIL');
      expect(result.detail).toContain('Stripe test key');
    });

    it('returns FAIL when AWS access key found', async () => {
      const diff = '+const awsKey = "AKIAIOSFODNN7EXAMPLE";';
      const result = await service.checkNoHardcodedSecrets(diff);
      expect(result.checkId).toBe('S3');
      expect(result.status).toBe('FAIL');
    });

    it('returns FAIL when GitHub PAT found in added lines', async () => {
      // ghp_ + 36 alphanum chars
      const diff = '+const token = "ghp_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";';
      const result = await service.checkNoHardcodedSecrets(diff);
      expect(result.status).toBe('FAIL');
    });

    it('does NOT flag secrets in removed lines (- prefix)', async () => {
      // Removing a hardcoded secret is a good change — must not be flagged
      const diff = `-const oldKey = 'sk_live_ABCDEFGHIJKLMNOPQRSTUVWX';`;
      const result = await service.checkNoHardcodedSecrets(diff);
      expect(result.checkId).toBe('S3');
      expect(result.status).toBe('PASS');
    });

    it('does NOT flag secrets on diff header lines (+++ prefix)', async () => {
      // +++ lines are file path headers in unified diff format, not added code
      const diff = `+++ b/src/sk_live_ABCDEFGHIJKLMNOPQRSTUVWX.ts`;
      const result = await service.checkNoHardcodedSecrets(diff);
      expect(result.status).toBe('PASS');
    });

    it('returns SKIP when diff text is empty string', async () => {
      const result = await service.checkNoHardcodedSecrets('');
      expect(result.checkId).toBe('S3');
      expect(result.status).toBe('SKIP');
    });

    it('evidence block includes patternsChecked and matchesFound counts on FAIL', async () => {
      const diff = '+const k = "sk_live_ABCDEFGHIJKLMNOPQRSTUVWX";';
      const result = await service.checkNoHardcodedSecrets(diff);
      expect(result.evidence).toBeDefined();
      expect((result.evidence as any).patternsChecked).toBeGreaterThan(0);
      expect((result.evidence as any).matchesFound).toBeGreaterThan(0);
    });

    it('evidence block shows zero matchesFound on PASS', async () => {
      const diff = '+const greeting = "hello world";';
      const result = await service.checkNoHardcodedSecrets(diff);
      expect(result.status).toBe('PASS');
      expect((result.evidence as any).matchesFound).toBe(0);
    });
  });

  describe('checkDependencySecurity (S6)', () => {
    it('returns PASS when no package.json change', async () => {
      const result = await service.checkDependencySecurity(
        ['src/foo.ts', 'src/bar.ts'],
        'owner', 'repo', 'abc', 'def',
      );
      expect(result.checkId).toBe('S6');
      expect(result.status).toBe('PASS');
      expect(result.detail).toContain('No package.json changes');
    });

    it('returns PASS when nested package.json path is not present in changed files', async () => {
      const result = await service.checkDependencySecurity(
        ['apps/api/src/main.ts', 'README.md'],
        'owner', 'repo', 'abc', 'def',
      );
      expect(result.checkId).toBe('S6');
      expect(result.status).toBe('PASS');
    });

    it('detects package.json at root path', async () => {
      // When package.json IS changed it tries to fetch from GitHub — we just verify it proceeds past the early exit
      // (It will return WARNING if the GitHub call fails with no token, which is expected in test env)
      const result = await service.checkDependencySecurity(
        ['package.json'],
        'nonexistent-owner', 'nonexistent-repo', 'abc', 'def',
      );
      expect(result.checkId).toBe('S6');
      // May return PASS (no new packages extracted) or WARNING (OSV unreachable); never FAIL here
      expect(['PASS', 'WARNING']).toContain(result.status);
    });

    it('detects nested package.json via endsWith check', async () => {
      const result = await service.checkDependencySecurity(
        ['apps/web/package.json'],
        'nonexistent-owner', 'nonexistent-repo', 'abc', 'def',
      );
      expect(result.checkId).toBe('S6');
      expect(['PASS', 'WARNING']).toContain(result.status);
    });
  });

  describe('checkNoHardcodedCredentials (INT1)', () => {
    it('returns PASS when no credentials in diff', async () => {
      const diff = `+const config = { host: 'localhost', port: 5432 };`;
      const result = await service.checkNoHardcodedCredentials(diff);
      expect(result.checkId).toBe('INT1');
      expect(result.status).toBe('PASS');
    });

    it('returns FAIL when Stripe live key found in added line', async () => {
      const diff = `+stripe.init('sk_live_ABCDEFGHIJKLMNOPQRSTUVWX')`;
      const result = await service.checkNoHardcodedCredentials(diff);
      expect(result.checkId).toBe('INT1');
      expect(result.status).toBe('FAIL');
    });

    it('returns SKIP when diff is empty', async () => {
      const result = await service.checkNoHardcodedCredentials('');
      expect(result.checkId).toBe('INT1');
      expect(result.status).toBe('SKIP');
    });

    it('does not flag credentials in removed lines', async () => {
      const diff = `-const secret = 'sk_live_ABCDEFGHIJKLMNOPQRSTUVWX';`;
      const result = await service.checkNoHardcodedCredentials(diff);
      expect(result.status).toBe('PASS');
    });

    it('evidence block includes matchedPatterns on FAIL', async () => {
      const diff = `+const k = 'sk_live_ABCDEFGHIJKLMNOPQRSTUVWX';`;
      const result = await service.checkNoHardcodedCredentials(diff);
      expect(result.evidence).toBeDefined();
      expect((result.evidence as any).matchedPatterns.length).toBeGreaterThan(0);
    });
  });

  describe('checkRealCredentials (INT2)', () => {
    it('returns PASS when STRIPE_SECRET_KEY env var is not set', async () => {
      const original = process.env.STRIPE_SECRET_KEY;
      delete process.env.STRIPE_SECRET_KEY;

      const result = await service.checkRealCredentials(undefined);

      expect(result.checkId).toBe('INT2');
      expect(result.status).toBe('PASS');

      // Restore
      if (original !== undefined) process.env.STRIPE_SECRET_KEY = original;
    });

    it('returns PASS when STRIPE_SECRET_KEY is a live key', async () => {
      const original = process.env.STRIPE_SECRET_KEY;
      process.env.STRIPE_SECRET_KEY = 'sk_live_someProductionKeyHere';

      const result = await service.checkRealCredentials(undefined);

      expect(result.checkId).toBe('INT2');
      expect(result.status).toBe('PASS');

      if (original !== undefined) process.env.STRIPE_SECRET_KEY = original;
      else delete process.env.STRIPE_SECRET_KEY;
    });

    it('returns WARNING when STRIPE_SECRET_KEY is a test key', async () => {
      const original = process.env.STRIPE_SECRET_KEY;
      process.env.STRIPE_SECRET_KEY = 'sk_test_someTestKeyHere';

      const result = await service.checkRealCredentials(undefined);

      expect(result.checkId).toBe('INT2');
      expect(result.status).toBe('WARNING');
      expect(result.detail).toContain('sk_test_');

      if (original !== undefined) process.env.STRIPE_SECRET_KEY = original;
      else delete process.env.STRIPE_SECRET_KEY;
    });

    it('returns WARNING with a deployUrl argument — check is env-based, not URL-based', async () => {
      const original = process.env.STRIPE_SECRET_KEY;
      process.env.STRIPE_SECRET_KEY = 'sk_test_anotherTestKey';

      const result = await service.checkRealCredentials('https://example.com');

      expect(result.status).toBe('WARNING');

      if (original !== undefined) process.env.STRIPE_SECRET_KEY = original;
      else delete process.env.STRIPE_SECRET_KEY;
    });
  });
});
