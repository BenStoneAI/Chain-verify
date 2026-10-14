import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// Boundary guard: the standalone verification module must not depend on SwarmSync-only
// modules, packages or hosts. The software-delivery engine (escalation, checks/*) is a
// legitimate in-repo module of Chain Verify and is scanned here like everything else.
const moduleDir = fileURLToPath(new URL('./', import.meta.url));

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue;
      out.push(...sourceFiles(full));
    } else if (name.endsWith('.ts') && !name.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

const FORBIDDEN = [
  '@agent-market/',
  '@swarmsync/',
  '../conduit/',
  'admin-only.guard',
  'service-accounts.service',
  'ssk-api-key.util',
  'api.swarmsync.ai',
];

describe('standalone verification dependency boundary', () => {
  const files = sourceFiles(moduleDir);

  it('scans the engine as well as the controller and proof service', () => {
    const rel = files.map((f) => f.replace(moduleDir, '').replace(/\\/g, '/'));
    expect(rel).toContain('proof.service.ts');
    expect(rel).toContain('verify-api.controller.ts');
    expect(rel).toContain('software-delivery/software-delivery.service.ts');
    expect(rel.some((r) => r.startsWith('software-delivery/checks/'))).toBe(true);
  });

  it('contains no SwarmSync-only module, package or host references', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const token of FORBIDDEN) {
        if (text.includes(token)) offenders.push(`${file.replace(moduleDir, '')}: ${token}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
