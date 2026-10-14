/**
 * AG2: test / failure suppression detection.
 *
 * Port of AgentGate `evidence.SUPPRESSION_CMD` and `SUPPRESSION_DIFF`. The
 * scan reads ADDED diff lines (never removed or context lines) and any
 * command strings the caller submitted (for example the test commands inside
 * an Agent Gate receipt).
 *
 * Differences from the Python source, all in the direction of fewer false
 * positives without dropping a pattern:
 *   - failure-swallowing patterns (`|| true`, `|| exit 0`) are only flagged in
 *     a diff line that also names a test / lint / build command, because
 *     `rm -f x || true` is not a suppressed test;
 *   - `.skip(` is only flagged in test-like files or on a test-declaration
 *     line (`cursor.skip(10)` is not a skipped test);
 *   - wording and bare-SKIP heuristics are WARNING and ignore prose files.
 * The PostgreSQL `FOR UPDATE SKIP LOCKED` clause is never evidence.
 */
export type SuppressionSeverity = 'FAIL' | 'WARNING';

export type SuppressionCategory =
  | 'FAILURE_SWALLOWED'
  | 'NO_TESTS_ALLOWED'
  | 'HOOKS_BYPASSED'
  | 'ENV_SKIP_OVERRIDE'
  | 'BAIL'
  | 'TEST_SKIP_MARKER'
  | 'TEST_DISABLED'
  | 'XFAIL'
  | 'SKIP_SWITCH'
  | 'SKIP_WORDING'
  | 'BARE_SKIP';

export interface SuppressionFinding {
  category: SuppressionCategory;
  severity: SuppressionSeverity;
  rule: string;
  source: 'diff' | 'command';
  file?: string;
  line: string;
}

interface Rule {
  pattern: RegExp;
  category: SuppressionCategory;
  severity: SuppressionSeverity;
  rule: string;
  /** Needs a test/lint/build command token on the same line (diff scan only). */
  requiresCommandContext?: boolean;
  /** Needs a test-like file or test-declaration token (diff scan only). */
  requiresTestContext?: boolean;
  /** Skip lines from prose/doc files (diff scan only). */
  ignoreProse?: boolean;
  /** Part of what job-type check TEST1 already reports. */
  ownedByTest1?: boolean;
}

// `skip <word> tests` must not fire on "SKIP LOCKED". A (?i:) group is not
// available in JS, so the "locked" alternative is spelled out.
const NOT_SKIP_LOCKED = '(?![Ll][Oo][Cc][Kk][Ee][Dd]\\b)';

/** Command-string rules: apply to submitted commands; first three also to diffs. */
const COMMAND_RULES: Rule[] = [
  {
    pattern: /\|\|\s*true\b/,
    category: 'FAILURE_SWALLOWED',
    severity: 'FAIL',
    rule: "'|| true' swallows failures",
    requiresCommandContext: true,
  },
  {
    pattern: /\|\|\s*exit\s+0\b/,
    category: 'FAILURE_SWALLOWED',
    severity: 'FAIL',
    rule: "'|| exit 0' swallows failures",
    requiresCommandContext: true,
  },
  {
    pattern: /--passWithNoTests\b/,
    category: 'NO_TESTS_ALLOWED',
    severity: 'FAIL',
    rule: '--passWithNoTests lets an empty test run pass',
  },
];

/** Applied to submitted command strings only (too noisy to apply to arbitrary diff lines). */
const COMMAND_ONLY_RULES: Rule[] = [
  {
    pattern: /--no-verify\b/,
    category: 'HOOKS_BYPASSED',
    severity: 'WARNING',
    rule: '--no-verify bypasses hooks',
  },
  {
    pattern: /(^|[\s;&|])SKIP[A-Z_]*=/,
    category: 'ENV_SKIP_OVERRIDE',
    severity: 'WARNING',
    rule: 'SKIP* environment override',
  },
  {
    pattern: /--bail\b/,
    category: 'BAIL',
    severity: 'WARNING',
    rule: '--bail hides later failures',
  },
];

const DIFF_RULES: Rule[] = [
  {
    pattern: /\.skip\(/,
    category: 'TEST_SKIP_MARKER',
    severity: 'FAIL',
    rule: '.skip( added',
    requiresTestContext: true,
    ownedByTest1: true,
  },
  {
    pattern: /\b(it|test|describe)\.(skip|todo)\b/,
    category: 'TEST_SKIP_MARKER',
    severity: 'FAIL',
    rule: 'test skip/todo marker added',
    ownedByTest1: true,
  },
  {
    pattern: /\bxit\(|\bxdescribe\(|\bxtest\(/,
    category: 'TEST_DISABLED',
    severity: 'FAIL',
    rule: 'x-prefixed disabled test added',
    ownedByTest1: true,
  },
  {
    pattern: /pytest\.mark\.(skip|xfail)/,
    category: 'TEST_SKIP_MARKER',
    severity: 'FAIL',
    rule: 'pytest skip/xfail marker added',
    ownedByTest1: true,
  },
  { pattern: /\bxfail\b/, category: 'XFAIL', severity: 'FAIL', rule: 'xfail added' },
  {
    pattern: /@unittest\.skip/,
    category: 'TEST_SKIP_MARKER',
    severity: 'FAIL',
    rule: 'unittest.skip added',
    ownedByTest1: true,
  },
  {
    pattern: /\bt\.Skip(?:Now|f)?\(/,
    category: 'TEST_SKIP_MARKER',
    severity: 'FAIL',
    rule: 'Go t.Skip added',
  },
  {
    pattern: /#\[ignore\b|@Ignore\b|@Disabled\b/,
    category: 'TEST_DISABLED',
    severity: 'FAIL',
    rule: 'ignored/disabled test annotation added',
  },
  {
    pattern: /--skip-tests?\b|-DskipTests\b/i,
    category: 'SKIP_SWITCH',
    severity: 'FAIL',
    rule: 'skip-tests switch added',
  },
  {
    pattern: /\bSKIP_TESTS?\b|\bskipTests\b/i,
    category: 'SKIP_SWITCH',
    severity: 'WARNING',
    rule: 'skip-tests switch added',
    ignoreProse: true,
  },
  {
    pattern: new RegExp(`\\bskip(?:s|ping|ped)?\\s+${NOT_SKIP_LOCKED}(?:\\w+\\s+){0,2}tests?\\b`, 'i'),
    category: 'SKIP_WORDING',
    severity: 'WARNING',
    rule: "'skip tests' added",
    ignoreProse: true,
  },
  {
    pattern: /\btests?\s+(?:\w+\s+){0,2}skipped\b|\bskipped\s+(?:\w+\s+){0,2}(?:tests?|suites?)\b/i,
    category: 'SKIP_WORDING',
    severity: 'WARNING',
    rule: "'tests skipped' added",
    ignoreProse: true,
  },
  {
    pattern: new RegExp(`\\bSKIP\\b(?!\\s+[Ll][Oo][Cc][Kk][Ee][Dd]\\b)`),
    category: 'BARE_SKIP',
    severity: 'WARNING',
    rule: 'SKIP added',
    ignoreProse: true,
  },
];

// A line that actually runs a test / lint / typecheck / build tool.
const COMMAND_CONTEXT =
  /\b(test|tests|jest|vitest|mocha|pytest|unittest|tox|nox|rspec|phpunit|playwright|cypress|karma|go\s+test|cargo\s+test|mvn|gradle|dotnet\s+test|lint|eslint|tsc|typecheck|type-check|build|e2e|coverage|npm\s+run|pnpm|yarn|npx|make)\b/i;

const TEST_FILE_PATH =
  /(^|\/)(__tests__|tests?|spec|specs|e2e|cypress|playwright)\/|\.(test|spec)\.[a-z0-9]+$|(^|\/)test_[^/]+\.py$|_test\.(go|py|rb)$|Test\.(java|kt)$/i;
const TEST_DECLARATION = /\b(it|test|describe|context|suite|scenario|feature)\b/i;
const PROSE_PATH = /\.(md|mdx|markdown|txt|rst|adoc)$/i;

// What job-type check TEST1 (checkTestsNotSkipped) already matches. Kept as a
// copy so AG2 can avoid reporting the same line twice; a unit test pins the
// two to each other.
export const TEST1_SKIP_PATTERN =
  /(?:\.skip|xtest|xdescribe|xit|@pytest\.mark\.skip|@unittest\.skip|it\.skip|describe\.skip)/;

export interface SuppressionScanInput {
  /** Raw unified diff text; only `+` lines are examined. */
  diffText?: string;
  /** Submitted CI / test command strings. */
  commands?: string[];
  /**
   * True when job-type check TEST1 is part of this run: lines TEST1 already
   * flags are not re-reported by AG2.
   */
  test1Active?: boolean;
}

export interface SuppressionScanResult {
  findings: SuppressionFinding[];
  addedLinesScanned: number;
  commandsScanned: number;
}

const MAX_FINDINGS = 50;
const MAX_LINE_LENGTH = 200;

// Matched lines are persisted as evidence, so anything that looks like a
// credential on the same line is masked before it is stored.
const SECRET_TOKEN =
  /\b(?:sk_live_|sk_test_|sk-ant-|sk-|ghp_|gho_|ghs_|ghr_|AKIA|AIza)[A-Za-z0-9_-]{8,}|\b((?:password|passwd|secret|token|api[_-]?key|authorization)\s*[=:]\s*)["']?[^\s"']{4,}["']?/gi;

function clip(line: string): string {
  const trimmed = line.trim().replace(SECRET_TOKEN, (_m, assignment?: string) =>
    assignment ? `${assignment}[redacted]` : '[redacted]',
  );
  return trimmed.length > MAX_LINE_LENGTH ? `${trimmed.slice(0, MAX_LINE_LENGTH)}...` : trimmed;
}

function* addedLines(diffText: string): Generator<{ file?: string; line: string }> {
  let file: string | undefined;
  for (const raw of diffText.split('\n')) {
    if (raw.startsWith('+++ ')) {
      const target = raw.slice(4).trim();
      file = target === '/dev/null' ? undefined : target.replace(/^b\//, '');
      continue;
    }
    if (raw.startsWith('+') && !raw.startsWith('+++')) {
      yield { file, line: raw.slice(1) };
    }
  }
}

export function scanSuppression(input: SuppressionScanInput): SuppressionScanResult {
  const findings: SuppressionFinding[] = [];
  const seen = new Set<string>();
  const record = (f: SuppressionFinding) => {
    const key = `${f.category}|${f.source}|${f.file ?? ''}|${f.line}`;
    if (seen.has(key) || findings.length >= MAX_FINDINGS) return;
    seen.add(key);
    findings.push(f);
  };

  let commandsScanned = 0;
  for (const cmd of input.commands ?? []) {
    commandsScanned += 1;
    for (const r of [...COMMAND_RULES, ...COMMAND_ONLY_RULES]) {
      if (r.pattern.test(cmd)) {
        record({
          category: r.category,
          severity: r.severity,
          rule: r.rule,
          source: 'command',
          line: clip(cmd),
        });
      }
    }
  }

  let addedLinesScanned = 0;
  for (const { file, line } of addedLines(input.diffText ?? '')) {
    addedLinesScanned += 1;
    const isProse = file ? PROSE_PATH.test(file) : false;
    for (const r of [...COMMAND_RULES, ...DIFF_RULES]) {
      if (isProse && r.ignoreProse) continue;
      if (!r.pattern.test(line)) continue;
      if (r.requiresCommandContext && !COMMAND_CONTEXT.test(line)) continue;
      if (r.requiresTestContext) {
        const testish = file ? TEST_FILE_PATH.test(file) : false;
        if (!testish && !TEST_DECLARATION.test(line)) continue;
      }
      if (r.ownedByTest1 && input.test1Active && TEST1_SKIP_PATTERN.test(line)) continue;
      record({
        category: r.category,
        severity: r.severity,
        rule: r.rule,
        source: 'diff',
        file,
        line: clip(line),
      });
    }
  }

  return { findings, addedLinesScanned, commandsScanned };
}
