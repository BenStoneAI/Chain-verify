/**
 * Commit-SHA comparison shared by receipt binding, deploy verification and
 * staleness detection.
 *
 * Equivalent to AgentGate's `_sha_match` (equal, or one is a prefix of the
 * other) with one deliberate tightening: a prefix match is only accepted when
 * the shorter value is a hex string of at least MIN_PREFIX_LENGTH characters.
 * Without that floor, `afterSha = "a"` would match every commit starting
 * with "a".
 */
export const MIN_SHA_PREFIX_LENGTH = 7;

const HEX = /^[0-9a-f]+$/;

export function normalizeSha(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function shasMatch(a: unknown, b: unknown): boolean {
  const x = normalizeSha(a);
  const y = normalizeSha(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.length < MIN_SHA_PREFIX_LENGTH || !HEX.test(short) || !HEX.test(long)) return false;
  return long.startsWith(short);
}

export function shortSha(value: unknown): string {
  const s = normalizeSha(value);
  return s ? s.slice(0, 12) : 'unknown';
}
