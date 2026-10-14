import type { CheckResult } from '../software-delivery.types.js';
import { shasMatch } from './sha.js';

export interface DeployEvidence {
  /** A deployment provider API returned a deployment record naming a commit. */
  observed: boolean;
  provider: string | null;
  deploymentId: string | null;
  deploymentUrl: string | null;
  state: string | null;
  deployedSha: string | null;
  expectedSha: string;
  /** deployedSha equals the requested afterSha (prefix-compatible), recomputed here. */
  shaMatch: boolean | null;
  /** DEP4 (health endpoint) or B6 (site opens) outcome; null when neither ran. */
  healthy: boolean | null;
  healthSource: 'DEP4' | 'B6' | null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function firstString(record: Record<string, unknown> | undefined, keys: string[]): string | null {
  if (!record) return null;
  for (const k of keys) {
    const v = str(record[k]);
    if (v) return v;
  }
  return null;
}

/**
 * Collapses the provider deployment checks (DEP3 / S10) and the health probes
 * (DEP4 / B6) into one deploy-state record. The SHA comparison is recomputed
 * here from the recorded SHAs rather than trusting the check's own verdict.
 */
export function summarizeDeployEvidence(results: CheckResult[], afterSha: string): DeployEvidence {
  const byId = (id: string) => results.find((r) => r.checkId === id);
  const dep3 = byId('DEP3');
  const s10 = byId('S10');
  const providerResult = [dep3, s10].find(
    (r) =>
      r !== undefined &&
      (r.status === 'PASS' || r.status === 'FAIL') &&
      firstString(r.evidence, ['deployedSha', 'commitSha', 'commitRef']) !== null,
  );
  const ev = providerResult?.evidence;
  const deployedSha = firstString(ev, ['deployedSha', 'commitSha', 'commitRef']);

  const dep4 = byId('DEP4');
  const b6 = byId('B6');
  let healthy: boolean | null = null;
  let healthSource: DeployEvidence['healthSource'] = null;
  if (dep4 && (dep4.status === 'PASS' || dep4.status === 'FAIL')) {
    healthy = dep4.status === 'PASS';
    healthSource = 'DEP4';
  } else if (b6 && (b6.status === 'PASS' || b6.status === 'FAIL')) {
    healthy = b6.status === 'PASS';
    healthSource = 'B6';
  }

  return {
    observed: providerResult !== undefined,
    provider: firstString(ev, ['provider']),
    deploymentId: firstString(ev, ['deploymentId', 'deployId']),
    deploymentUrl: firstString(ev, ['deploymentUrl', 'deployUrl', 'url']),
    state: firstString(ev, ['state', 'status', 'readyState']),
    deployedSha,
    expectedSha: afterSha,
    shaMatch: deployedSha ? shasMatch(deployedSha, afterSha) : null,
    healthy,
    healthSource,
  };
}
