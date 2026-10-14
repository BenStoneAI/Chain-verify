// Secret-safety boundary for immutable proof evidence.
//
// Proof evidence is hashed into an append-only chain, so anything that enters it can
// never be removed without breaking verification. This module runs BEFORE the
// evidence is stored or hashed and replaces credentials with a marker, so the secret
// never becomes part of the immutable record.
//
// Two independent detectors:
//   1. KEY NAME — the last word(s) of a key name a credential: `netlifyToken`,
//      `api_key`, `clientSecret`, `Authorization`. Matching on the final word (not a
//      substring) keeps business fields such as `authorization_level`, `token_count`
//      or `password_policy` intact.
//   2. VALUE PATTERN — well-known credential formats that appear inside free text
//      (Stripe/GitHub/AWS keys, Bearer tokens, PEM private keys, our own API keys).
//
// Only key names / JSON paths are ever reported. Values are never logged or returned.

export type SecretRedaction = {
  /** JSON path of the redacted value, e.g. `$[0].submitted_output.netlifyToken`. */
  path: string;
  reason: 'credential_key_name' | 'credential_value_pattern';
  /** The offending key name (key-name redactions only). */
  keyName?: string;
};

export type SecretGuardResult<T> = { evidence: T; redactions: SecretRedaction[] };

export const REDACTION_MARKER = '[REDACTED:credential]';

const SENSITIVE_LAST_WORD = new Set([
  'token',
  'secret',
  'secrets',
  'password',
  'passwords',
  'passwd',
  'passphrase',
  'credential',
  'credentials',
  'authorization',
  'bearer',
  'apikey',
  'privatekey',
  'accesskey',
  'secretkey',
  'clientsecret',
]);

const SENSITIVE_LAST_TWO_WORDS = new Set([
  'api key',
  'private key',
  'access key',
  'secret key',
  'client secret',
  'signing key',
]);

const VALUE_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}/g, // Stripe secret / restricted keys
  /\bwhsec_[A-Za-z0-9]{10,}/g, // Stripe webhook signing secret
  /\bssk_live_[A-Za-z0-9]{8,}/g, // SwarmSync API keys
  /\b(?:cv|ag)_live_[A-Za-z0-9]{16,}/g, // Chain Verify / Agent Gate API keys
  /\bgh[pousr]_[A-Za-z0-9]{30,}/g, // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/gi,
];

const MAX_DEPTH = 64;

/** Split a key into lowercase words across camelCase, snake_case, kebab-case and dots. */
function keyWords(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

/** True when the key's final word(s) name a credential. */
export function isCredentialKeyName(key: string): boolean {
  const words = keyWords(key);
  if (words.length === 0) return false;
  const last = words[words.length - 1] as string;
  if (SENSITIVE_LAST_WORD.has(last)) return true;
  if (words.length >= 2) {
    const lastTwo = `${words[words.length - 2]} ${last}`;
    if (SENSITIVE_LAST_TWO_WORDS.has(lastTwo)) return true;
  }
  return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

function scrubString(value: string): { value: string; changed: boolean } {
  let out = value;
  let changed = false;
  for (const pattern of VALUE_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(out)) {
      pattern.lastIndex = 0;
      out = out.replace(pattern, REDACTION_MARKER);
      changed = true;
    }
    pattern.lastIndex = 0;
  }
  return { value: out, changed };
}

function walk(value: unknown, path: string, depth: number, redactions: SecretRedaction[]): unknown {
  if (typeof value === 'string') {
    const scrubbed = scrubString(value);
    if (scrubbed.changed) redactions.push({ path, reason: 'credential_value_pattern' });
    return scrubbed.value;
  }
  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH) {
      redactions.push({ path, reason: 'credential_value_pattern' });
      return REDACTION_MARKER;
    }
    return value.map((item, i) => walk(item, `${path}[${i}]`, depth + 1, redactions));
  }
  if (isPlainObject(value)) {
    if (depth >= MAX_DEPTH) {
      redactions.push({ path, reason: 'credential_value_pattern' });
      return REDACTION_MARKER;
    }
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      const childPath = `${path}.${key}`;
      if (isCredentialKeyName(key) && child !== null && child !== undefined && child !== '') {
        redactions.push({ path: childPath, reason: 'credential_key_name', keyName: key });
        out[key] = REDACTION_MARKER;
      } else {
        out[key] = walk(child, childPath, depth + 1, redactions);
      }
    }
    return out;
  }
  return value;
}

/**
 * Return a deep copy of `evidence` with credentials replaced by REDACTION_MARKER, plus
 * the list of paths/key names that were redacted. The input is never mutated.
 */
export function redactCredentialsFromEvidence<T>(evidence: T): SecretGuardResult<T> {
  const redactions: SecretRedaction[] = [];
  const cleaned = walk(evidence, '$', 0, redactions) as T;
  return { evidence: cleaned, redactions };
}

/**
 * Describe the redactions as a transparent evidence entry, so the immutable record
 * states that (and where) a credential was removed. Contains key names/paths only.
 */
export function redactionNotice(redactions: SecretRedaction[]): Record<string, unknown> {
  return {
    source: 'secret_safety_boundary',
    note: 'Credentials were removed before this evidence was hashed. Values are not retained.',
    redaction_count: redactions.length,
    redactions: redactions.map((r) => ({
      path: r.path,
      reason: r.reason,
      ...(r.keyName ? { key_name: r.keyName } : {}),
    })),
  };
}
