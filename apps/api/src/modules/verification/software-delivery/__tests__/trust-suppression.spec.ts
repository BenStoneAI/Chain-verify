/**
 * AG2: suppression detection (port of AgentGate evidence.SUPPRESSION_*).
 * Pure functions only; no network, no database.
 */
import { describe, expect, it } from 'vitest';
import { JobTypeChecksService } from '../checks/job-type-checks.service.js';
import {
  TEST1_SKIP_PATTERN,
  buildSuppressionCheck,
  scanSuppression,
} from '../trust/index.js';
import { CHECK_NAMES, TIER_CHECKS } from '../software-delivery.types.js';

/** Build a unified-diff fragment of added lines for one file. */
function diff(file: string, ...added: string[]): string {
  return [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    '@@ -1,1 +1,5 @@',
    ' context line that must never be scanned',
    ...added.map((l) => `+${l}`),
  ].join('\n');
}

function ag2(diffText: string, commands: string[] = [], test1Active = false) {
  return buildSuppressionCheck({ diffText, commands, test1Active });
}

function rules(diffText: string, commands: string[] = []): string[] {
  return scanSuppression({ diffText, commands }).findings.map((f) => f.rule);
}

describe('AG2 failure swallowing and no-test passes', () => {
  it("flags '|| true' on a test command in a CI workflow", () => {
    const r = ag2(diff('.github/workflows/ci.yml', '      - run: npm test || true'));
    expect(r.status).toBe('FAIL');
    expect(r.detail).toContain("'|| true' swallows failures");
    expect(r.checkId).toBe('AG2');
  });

  it("flags '|| exit 0' on a test command", () => {
    const r = ag2(diff('package.json', '    "test": "vitest run || exit 0",'));
    expect(r.status).toBe('FAIL');
    expect(r.detail).toContain("'|| exit 0' swallows failures");
  });

  it('flags --passWithNoTests', () => {
    const r = ag2(diff('package.json', '    "test": "jest --passWithNoTests",'));
    expect(r.status).toBe('FAIL');
    expect(r.detail).toContain('--passWithNoTests');
  });

  it("does not flag an unrelated '|| true' (cleanup commands are not suppressed tests)", () => {
    expect(ag2(diff('scripts/clean.sh', 'rm -rf .cache || true', 'mkdir -p out || true')).status).toBe('PASS');
  });

  it('flags the swallowing flags in submitted command strings, including those only AgentGate checks', () => {
    expect(rules('', ['pytest -x || true'])).toContain("'|| true' swallows failures");
    expect(rules('', ['npm test || exit 0'])).toContain("'|| exit 0' swallows failures");
    expect(rules('', ['jest --passWithNoTests'])).toContain('--passWithNoTests lets an empty test run pass');
    expect(rules('', ['git commit --no-verify -m x'])).toContain('--no-verify bypasses hooks');
    expect(rules('', ['SKIP_TESTS=1 npm run build'])).toContain('SKIP* environment override');
    expect(rules('', ['jest --bail'])).toContain('--bail hides later failures');
  });

  it('masks credentials on a flagged line before it is stored as evidence', () => {
    const r = ag2(
      diff('.github/workflows/ci.yml', 'STRIPE=sk_live_abcdefghijklmnopqrstuvwx TOKEN=hunter2value npm test || true'),
    );
    expect(r.status).toBe('FAIL');
    const stored = JSON.stringify(r.evidence);
    expect(stored).not.toContain('sk_live_abcdefgh');
    expect(stored).not.toContain('hunter2value');
    expect(stored).toContain('[redacted]');
  });

  it('a clean command and clean diff pass', () => {
    const r = ag2(diff('src/invoice.ts', 'export const total = (a: number, b: number) => a + b;'), ['npm test']);
    expect(r.status).toBe('PASS');
    expect(r.evidence).toMatchObject({ failCount: 0, warningCount: 0 });
  });
});

describe('AG2 skipped and expected-failure tests', () => {
  it('flags .skip( on a test declaration', () => {
    const r = ag2(diff('src/invoice.test.ts', "  it.skip('rounds half up', () => {"));
    expect(r.status).toBe('FAIL');
  });

  it('flags describe.skip / test.todo', () => {
    // One finding per category/line: describe.skip( is reported once.
    const skipped = scanSuppression({ diffText: diff('a.spec.ts', "describe.skip('suite', () => {})") });
    expect(skipped.findings).toHaveLength(1);
    expect(skipped.findings[0]).toMatchObject({ category: 'TEST_SKIP_MARKER', severity: 'FAIL', file: 'a.spec.ts' });
    expect(rules(diff('a.spec.ts', "test.todo('later')"))).toContain('test skip/todo marker added');
  });

  it('flags a bare .skip( call inside a test file', () => {
    expect(rules(diff('tests/api.test.js', "  suite.skip('flaky');"))).toContain('.skip( added');
  });

  it('does not flag .skip( outside test files (cursor.skip(n) is pagination)', () => {
    expect(ag2(diff('src/repo/orders.ts', 'const page = cursor.skip(20).limit(10);')).status).toBe('PASS');
  });

  it('flags xfail and pytest skip/xfail markers', () => {
    expect(ag2(diff('tests/test_x.py', '@pytest.mark.xfail(reason="later")', 'def test_x(): ...')).status).toBe('FAIL');
    expect(rules(diff('tests/test_x.py', 'pytestmark = pytest.mark.skip'))).toContain('pytest skip/xfail marker added');
    expect(rules(diff('tests/test_x.py', 'def test_x():  # xfail'))).toContain('xfail added');
  });

  it('flags @unittest.skip, Go t.Skip and @Disabled', () => {
    expect(rules(diff('t.py', '@unittest.skip("no")'))).toContain('unittest.skip added');
    expect(rules(diff('a_test.go', '\tt.Skip("flaky")'))).toContain('Go t.Skip added');
    expect(rules(diff('A.java', '@Disabled'))).toContain('ignored/disabled test annotation added');
  });

  it('flags skip-tests switches', () => {
    expect(rules(diff('pom.xml', '<argLine>-DskipTests</argLine>'))).toContain('skip-tests switch added');
    expect(ag2(diff('build.sh', 'mvn package -DskipTests')).status).toBe('FAIL');
  });

  it("flags 'tests skipped' / 'skip tests' wording as a WARNING", () => {
    const r = ag2(diff('src/notes.ts', '// tests skipped for now'));
    expect(r.status).toBe('WARNING');
    expect(rules(diff('src/notes.ts', '// we skip all tests in CI'))).toContain("'skip tests' added");
  });

  it('flags a bare SKIP as a WARNING', () => {
    const r = ag2(diff('src/report.ts', "const status = 'SKIP';"));
    expect(r.status).toBe('WARNING');
    expect(r.evidence).toMatchObject({ failCount: 0, warningCount: 1 });
  });
});

describe('AG2 keeps the PostgreSQL SKIP LOCKED exemption', () => {
  it('does not flag FOR UPDATE SKIP LOCKED', () => {
    const r = ag2(
      diff(
        'src/queue.ts',
        "const sql = 'SELECT id FROM jobs WHERE status = $1 FOR UPDATE SKIP LOCKED LIMIT 10';",
        '  SELECT * FROM tasks FOR NO KEY UPDATE SKIP LOCKED',
      ),
    );
    expect(r.status).toBe('PASS');
  });

  it('still flags other skip markers that sit next to SKIP LOCKED', () => {
    const r = ag2(diff('src/queue.test.ts', "it.skip('claims a job', () => { /* FOR UPDATE SKIP LOCKED */ });"));
    expect(r.status).toBe('FAIL');
  });
});

describe('AG2 scope', () => {
  it('only reads ADDED lines, never removed or context lines', () => {
    const text = [
      '+++ b/src/a.test.ts',
      '@@ -1,3 +1,2 @@',
      "-  it.skip('old', () => {})",
      " it.skip('context', () => {})",
      '+  const ok = 1;',
    ].join('\n');
    expect(ag2(text).status).toBe('PASS');
  });

  it('is SKIP (unable) when there is neither a diff nor a command', () => {
    const r = ag2('');
    expect(r.status).toBe('SKIP');
    expect(r.skipKind).toBe('UNABLE');
  });

  it('ignores wording rules in prose files', () => {
    expect(ag2(diff('docs/testing.md', 'To skip tests locally, set SKIP=1.')).status).toBe('PASS');
  });

  it('is registered for every tier', () => {
    for (const tier of ['BASIC', 'STANDARD', 'THOROUGH'] as const) {
      expect(TIER_CHECKS[tier]).toContain('AG2');
      expect(TIER_CHECKS[tier]).toContain('AG1');
    }
    expect(CHECK_NAMES['AG2']).toBeTruthy();
  });
});

describe('AG2 does not double-fire with TEST1', () => {
  const jobType = new JobTypeChecksService();

  it('leaves lines TEST1 already reports to TEST1 when TEST1 is part of the run', () => {
    const text = diff('src/invoice.test.ts', "it.skip('x', () => {})");
    expect(jobType.checkTestsNotSkipped(text).status).toBe('FAIL');
    expect(ag2(text, [], true).status).toBe('PASS');
    expect(ag2(text, [], false).status).toBe('FAIL');
  });

  it('still reports patterns TEST1 cannot see, even when TEST1 is active', () => {
    const text = diff('tests/test_x.py', '@pytest.mark.xfail', 'pytestmark = pytest.mark.skip');
    expect(ag2(text, [], true).status).toBe('FAIL');
  });

  it('keeps AG2 in lockstep with the TEST1 pattern', () => {
    const samples = ["it.skip('a')", "describe.skip('b')", "xit('c')", "xdescribe('d')", '@unittest.skip', "foo.skip('e')"];
    for (const line of samples) {
      const t1 = TEST1_SKIP_PATTERN.test(line);
      const real = jobType.checkTestsNotSkipped(`+${line}`).status === 'FAIL';
      expect(t1).toBe(real);
    }
  });
});
