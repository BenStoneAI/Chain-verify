import { createHash } from 'node:crypto';

/**
 * SHA-256 hex digest used for every API-key-style credential this codebase
 * stores — customer-facing ApiIdentity keys (org-scoped) and platform
 * AdminIdentity keys (see apps/api/src/modules/admin/). Keys themselves are
 * never persisted; only this hash is written, and a lookup hashes the
 * incoming credential the same way before querying.
 */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
