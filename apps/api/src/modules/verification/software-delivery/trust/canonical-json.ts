import { createHash } from 'node:crypto';

/**
 * Canonical JSON, byte-compatible with AgentGate's `receipt.canonical_json`
 * (agentgate/receipt.py):
 *   - object keys sorted by Unicode code point (Python `sort_keys=True`)
 *   - no insignificant whitespace (`separators=(",", ":")`)
 *   - non-ASCII emitted raw, encoded as UTF-8 (`ensure_ascii=False`)
 *   - integral numbers emitted as integers, NaN / Infinity / non-integral
 *     floats rejected with CanonicalizationError
 *
 * Never uses JSON.stringify on whole objects: the output is assembled by hand
 * so key order and number formatting cannot drift with the JS engine.
 */
export class CanonicalizationError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalizationError';
  }
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** Compare two strings by Unicode code point (matches Python `str` ordering). */
function compareCodePoints(a: string, b: string): number {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const ca = a.codePointAt(i) as number;
    const cb = b.codePointAt(j) as number;
    if (ca !== cb) return ca < cb ? -1 : 1;
    i += ca > 0xffff ? 2 : 1;
    j += cb > 0xffff ? 2 : 1;
  }
  if (i < a.length) return 1;
  if (j < b.length) return -1;
  return 0;
}

function serialize(value: unknown, path: string): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number': {
      if (!Number.isFinite(value)) {
        throw new CanonicalizationError(`${path}: non-finite number not allowed in canonical JSON`);
      }
      if (!Number.isInteger(value)) {
        throw new CanonicalizationError(`${path}: non-integral float not allowed in canonical JSON`);
      }
      if (!Number.isSafeInteger(value)) {
        throw new CanonicalizationError(`${path}: integer outside the exactly-representable range`);
      }
      return String(value === 0 ? 0 : value);
    }
    case 'string': {
      if (LONE_SURROGATE.test(value)) {
        throw new CanonicalizationError(`${path}: string contains a lone surrogate and cannot be UTF-8 encoded`);
      }
      return JSON.stringify(value);
    }
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value.map((v, i) => serialize(v, `${path}[${i}]`)).join(',')}]`;
      }
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) {
        throw new CanonicalizationError(`${path}: unsupported object type`);
      }
      const keys = Object.keys(value as Record<string, unknown>).sort(compareCodePoints);
      const parts = keys.map((k) => {
        if (LONE_SURROGATE.test(k)) {
          throw new CanonicalizationError(`${path}: key contains a lone surrogate`);
        }
        return `${JSON.stringify(k)}:${serialize((value as Record<string, unknown>)[k], `${path}.${k}`)}`;
      });
      return `{${parts.join(',')}}`;
    }
    default:
      throw new CanonicalizationError(`${path}: unsupported type ${typeof value}`);
  }
}

export function canonicalJson(value: unknown): string {
  return serialize(value, '$');
}

export function canonicalJsonBytes(value: unknown): Buffer {
  return Buffer.from(canonicalJson(value), 'utf8');
}

export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}
