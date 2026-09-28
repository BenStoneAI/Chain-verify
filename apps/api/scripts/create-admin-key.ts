/**
 * One-off bootstrap: mint a new AdminIdentity (platform admin master key).
 *
 * This is the only way to create the *first* admin key — there is no admin
 * UI for it, deliberately (you need a key to reach the admin UI at all).
 * Run it again with a new label any time you need an additional key (e.g.
 * one per operator, so revoking one person's access doesn't require
 * rotating everyone else's).
 *
 * Usage (local dev DB, from the repo root):
 *   npx tsx apps/api/scripts/create-admin-key.ts "Ben Stone — primary"
 *
 * Against production, once Render DB access is confirmed, run the same
 * command with DATABASE_URL pointed at the production database instead —
 * this script never touches any database other than the one DATABASE_URL
 * names.
 *
 * The raw key is printed to stdout exactly once and is never logged,
 * persisted, or retrievable again — only its SHA-256 hash is written to
 * admin_identities.apiKeyHash. Send the raw key back as the `x-admin-key`
 * header on every /api/admin/* request.
 */
import { randomBytes } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

import { sha256Hex } from '../src/common/utils/api-key-hash.js';

const ADMIN_KEY_PREFIX = 'cv_admin_';

async function main(): Promise<void> {
  const label = process.argv[2]?.trim();
  if (!label) {
    console.error('Usage: npx tsx apps/api/scripts/create-admin-key.ts "<label>"');
    console.error('Example: npx tsx apps/api/scripts/create-admin-key.ts "Ben Stone — primary"');
    process.exitCode = 1;
    return;
  }

  const rawKey = `${ADMIN_KEY_PREFIX}${randomBytes(32).toString('hex')}`;
  const apiKeyHash = sha256Hex(rawKey);

  const prisma = new PrismaClient();
  try {
    const identity = await prisma.adminIdentity.create({ data: { label, apiKeyHash } });

    console.log('Admin key created.');
    console.log(`  id:    ${identity.id}`);
    console.log(`  label: ${identity.label}`);
    console.log('');
    console.log('RAW ADMIN KEY — shown once, store it now (e.g. in a password manager):');
    console.log(rawKey);
    console.log('');
    console.log('Send it as the x-admin-key header on every /api/admin/* request.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error('Failed to create admin key:', err);
  process.exitCode = 1;
});
