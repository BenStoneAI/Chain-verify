/**
 * ssrf-guard.ts — Task p11-ssrf-protection-everywhere (KEYSTONE)
 *
 * Centralized SSRF guard for ALL external URL fields across the platform.
 * Apply to: supplier endpoints, AP2 callbacks, artifact URLs, webhook URLs,
 * delivery references — any field that triggers an outbound HTTP request.
 *
 * Coverage (regex-only, synchronous — no DNS resolution):
 *   - Loopback: 127.x, ::1, localhost
 *   - All-zeros: 0.0.0.0
 *   - RFC-1918: 10.x, 172.16–31.x, 192.168.x
 *   - Link-local + AWS IMDS: 169.254.x
 *   - Carrier-grade NAT: 100.64–127.x (RFC 6598)
 *   - IPv6 unique-local (fc/fd), link-local (fe80), mapped (::ffff:)
 *   - Known cloud metadata hostnames
 *   - Protocol: only https:// (configurable via allowHttp flag for tests)
 *   - No embedded credentials (user:pass@ form)
 *
 * Wave 2 services MUST import isSsrfUnsafe() or assertSsrfSafeUrl() from this
 * module — do NOT duplicate the pattern elsewhere.
 */

import { BadRequestException } from '@nestjs/common';
import { lookup } from 'node:dns/promises';

// ---------------------------------------------------------------------------
// RFC-1918 + loopback + link-local + CGNAT pattern (IPv4)
// ---------------------------------------------------------------------------

const RFC1918_AND_PRIVATE_PATTERN =
  /^(localhost|127\.|0\.0\.0\.0|::1|169\.254\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/i;

// ---------------------------------------------------------------------------
// IPv6 blocked prefixes (extended: unique-local, link-local, loopback, mapped,
// unspecified ::, and any bracket-wrapped form)
// ---------------------------------------------------------------------------

const BLOCKED_IPV6 = /^(\[?::\]?$|\[?::1\]?|fc[0-9a-f]{2}|fd[0-9a-f]{2}|fe80|::ffff:|0{0,4}:0{0,4}:0{0,4}:0{0,4}:0{0,4}:0{0,4}:0{0,4}:0{0,4}$)/i;

// ---------------------------------------------------------------------------
// Decimal-encoded IPv4: e.g. 2130706433 == 127.0.0.1
// Octal-encoded segments and pure integer hostnames bypass dotted-notation checks.
// Block any hostname that is a pure 32-bit integer (no dots) in the private
// range when parsed as a decimal IP.
// ---------------------------------------------------------------------------

function isDecimalIp(hostname: string): boolean {
  // Pure decimal integer hostname (no dots, no colons)
  if (!/^\d+$/.test(hostname)) return false;
  const n = parseInt(hostname, 10);
  if (isNaN(n) || n < 0 || n > 0xffffffff) return false;
  const a = (n >>> 24) & 0xff;
  const b = (n >>> 16) & 0xff;
  // Loopback 127.x.x.x
  if (a === 127) return true;
  // All-zeros 0.0.0.0
  if (n === 0) return true;
  // RFC-1918: 10.x
  if (a === 10) return true;
  // RFC-1918: 172.16-31.x
  if (a === 172 && b >= 16 && b <= 31) return true;
  // RFC-1918: 192.168.x
  if (a === 192 && b === 168) return true;
  // Link-local 169.254.x
  if (a === 169 && b === 254) return true;
  // CGNAT 100.64-127
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Cloud metadata hostnames
// ---------------------------------------------------------------------------

const BLOCKED_HOSTNAMES = new Set([
  'metadata.google.internal',
  'metadata.internal',
  '0.0.0.0',
]);

// ---------------------------------------------------------------------------
// Blocked URL path patterns (metadata endpoints)
// ---------------------------------------------------------------------------

const BLOCKED_PATHS: RegExp[] = [
  /\/latest\/meta-data/i,
  /\/computeMetadata/i,
  /\/metadata\/v1/i,
];

// ---------------------------------------------------------------------------
// Core check — synchronous, no network calls
// ---------------------------------------------------------------------------

export interface SsrfCheckResult {
  safe: boolean;
  reason?: string;
}

/**
 * Returns { safe: false, reason } when the URL is SSRF-unsafe.
 * Returns { safe: true } when the URL passes all checks.
 *
 * @param raw         - Raw URL string from untrusted input
 * @param allowHttp   - When true, allows http:// in addition to https://
 *                      Use ONLY in test environments.
 */
export function isSsrfSafeUrl(raw: string, allowHttp = false): SsrfCheckResult {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { safe: false, reason: 'URL is not parseable' };
  }

  if (!allowHttp && parsed.protocol !== 'https:') {
    return { safe: false, reason: `only https:// URLs are permitted (got ${parsed.protocol})` };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { safe: false, reason: `disallowed protocol: ${parsed.protocol}` };
  }

  if (parsed.username || parsed.password) {
    return { safe: false, reason: 'URL must not contain embedded credentials (user:pass@ form)' };
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { safe: false, reason: `hostname '${hostname}' is a blocked metadata/loopback address` };
  }

  if (RFC1918_AND_PRIVATE_PATTERN.test(hostname)) {
    return {
      safe: false,
      reason: `hostname '${hostname}' resolves to a private/loopback/reserved IPv4 address`,
    };
  }

  if (isDecimalIp(hostname)) {
    return {
      safe: false,
      reason: `hostname '${hostname}' is a decimal-encoded private/loopback IPv4 address`,
    };
  }

  if (BLOCKED_IPV6.test(hostname)) {
    return { safe: false, reason: `hostname '${hostname}' is a blocked IPv6 address` };
  }

  const pathAndQuery = parsed.pathname + parsed.search;
  for (const pattern of BLOCKED_PATHS) {
    if (pattern.test(pathAndQuery)) {
      return {
        safe: false,
        reason: `URL path matches a blocked cloud metadata pattern: ${parsed.pathname}`,
      };
    }
  }

  return { safe: true };
}

/**
 * Returns true when the URL is SSRF-unsafe (inverse of isSsrfSafeUrl).
 * Preferred when used as a filter predicate: `candidates.filter(c => !isSsrfUnsafe(c.url))`
 */
export function isSsrfUnsafe(raw: string, allowHttp = false): boolean {
  return !isSsrfSafeUrl(raw, allowHttp).safe;
}

/**
 * Throws BadRequestException when the URL fails SSRF validation.
 * Use at API boundaries (DTOs, webhook handler entry points).
 */
export function assertSsrfSafeUrl(raw: string, fieldName = 'url', allowHttp = false): void {
  const result = isSsrfSafeUrl(raw, allowHttp);
  if (!result.safe) {
    throw new BadRequestException(
      `${fieldName} rejected: ${result.reason ?? 'SSRF safety check failed'}.`,
    );
  }
}

// Private/loopback/link-local IP ranges used by the DNS-resolution stage so a
// public hostname that resolves to an internal address (DNS rebinding) is
// blocked even though the literal hostname passed the synchronous checks.
const RESOLVED_PRIVATE_IP: RegExp[] = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^0\./,
  /^::1$/i,
  /^fc[0-9a-f]{2}/i,
  /^fd[0-9a-f]{2}/i,
  /^fe80/i,
];

/**
 * SSRF guard with DNS resolution. Runs the synchronous {@link isSsrfSafeUrl}
 * checks first, then resolves the hostname and rejects if ANY resolved address
 * is private/loopback/link-local (DNS-rebinding defense). Throws Error with a
 * `Blocked:`-prefixed message when an address is unsafe. Shared by every
 * outbound probe that targets a caller-supplied deploy URL (live, deployment,
 * performance checks) so the DNS stage cannot drift between copies (HKO L1).
 */
export async function assertSsrfSafeWithDns(rawUrl: string, allowHttp = false): Promise<void> {
  const sync = isSsrfSafeUrl(rawUrl, allowHttp);
  if (!sync.safe) {
    throw new Error(sync.reason ?? 'SSRF safety check failed');
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }
  try {
    const addresses = await lookup(parsed.hostname, { all: true });
    for (const { address } of addresses) {
      if (RESOLVED_PRIVATE_IP.some(r => r.test(address))) {
        throw new Error(`Blocked: ${parsed.hostname} resolves to private IP ${address}`);
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith('Blocked:')) throw err;
    throw new Error(`DNS resolution failed for ${parsed.hostname}: ${msg}`);
  }
}
