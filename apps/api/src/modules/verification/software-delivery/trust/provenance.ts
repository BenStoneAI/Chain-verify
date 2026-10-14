/**
 * Evidence provenance: WHO observed a fact, as opposed to who merely said it.
 *
 *   OBSERVED_BY_AGENT_GATE     an Agent Gate-recorded test run carried by a
 *                              receipt that passed hash, signature (trusted
 *                              key), HEAD, repo and freshness validation
 *   OBSERVED_BY_CHAINVERIFY    ChainVerify itself fetched/probed/analysed it
 *   OBSERVED_BY_REMOTE_PROVIDER a GitHub / deploy-provider / Sentry API
 *                              response fetched by this engine
 *   SUBMITTED_BY_CUSTOMER      supplied by the caller, not independently
 *                              checkable (includes untrusted receipts)
 *   SELF_REPORTED              the delivering agent's own claim about its work
 *                              (AI report, Semgrep output, test output, logs)
 *   DERIVED                    computed by comparing/combining the above
 *
 * Being present in the request JSON never makes something verified.
 */
import type { CheckResult } from '../software-delivery.types.js';
import type { ReceiptValidation } from './receipt.js';

export const PROVENANCE_VALUES = [
  'OBSERVED_BY_AGENT_GATE',
  'OBSERVED_BY_CHAINVERIFY',
  'OBSERVED_BY_REMOTE_PROVIDER',
  'SUBMITTED_BY_CUSTOMER',
  'SELF_REPORTED',
  'DERIVED',
] as const;

export type Provenance = (typeof PROVENANCE_VALUES)[number];

const OBSERVED: ReadonlySet<Provenance> = new Set<Provenance>([
  'OBSERVED_BY_AGENT_GATE',
  'OBSERVED_BY_CHAINVERIFY',
  'OBSERVED_BY_REMOTE_PROVIDER',
]);

/** True only for facts a party other than the delivering agent observed. */
export function isObserved(p: Provenance | null | undefined): boolean {
  return p !== null && p !== undefined && OBSERVED.has(p);
}

export interface ProvenanceAssignment {
  provenance: Provenance;
  basis: string;
}

const REMOTE = 'OBSERVED_BY_REMOTE_PROVIDER' as const;
const CV = 'OBSERVED_BY_CHAINVERIFY' as const;
const DERIVED = 'DERIVED' as const;
const SELF = 'SELF_REPORTED' as const;

const GITHUB_DIFF = 'GitHub compare/commit API response fetched by ChainVerify';
const DIFF_ANALYSIS = 'ChainVerify analysis of the diff it fetched from GitHub';
const PROBE = 'HTTP probe of deployUrl performed by ChainVerify';
const DEPLOY_API = 'Deployment-provider API response fetched by ChainVerify';
const CLAIM_VS_DIFF = 'Customer-submitted claim compared with the diff ChainVerify fetched';

const CHECK_SOURCES: Record<string, ProvenanceAssignment> = {
  B1: { provenance: REMOTE, basis: GITHUB_DIFF },
  B2: { provenance: REMOTE, basis: GITHUB_DIFF },
  B3: { provenance: REMOTE, basis: GITHUB_DIFF },
  B7: { provenance: REMOTE, basis: 'GitHub pull-request API response fetched by ChainVerify' },
  S9: { provenance: REMOTE, basis: 'GitHub Actions workflow-run API response fetched by ChainVerify' },
  B5: { provenance: REMOTE, basis: 'GitHub check-run / commit-status API response fetched by ChainVerify' },
  S2: { provenance: REMOTE, basis: 'GitHub check-run / commit-status API response fetched by ChainVerify' },
  S4: { provenance: REMOTE, basis: 'GitHub check-run / commit-status API response fetched by ChainVerify' },
  S5: { provenance: REMOTE, basis: 'GitHub check-run / commit-status API response fetched by ChainVerify' },
  B4: { provenance: DERIVED, basis: CLAIM_VS_DIFF },
  T10: { provenance: DERIVED, basis: CLAIM_VS_DIFF },
  T12: { provenance: DERIVED, basis: CLAIM_VS_DIFF },
  REV1: { provenance: DERIVED, basis: CLAIM_VS_DIFF },
  REV2: { provenance: DERIVED, basis: CLAIM_VS_DIFF },
  REV3: { provenance: DERIVED, basis: CLAIM_VS_DIFF },
  REV4: { provenance: DERIVED, basis: CLAIM_VS_DIFF },
  B6: { provenance: CV, basis: PROBE },
  DEP1: { provenance: CV, basis: PROBE },
  DEP4: { provenance: CV, basis: PROBE },
  S8: { provenance: CV, basis: PROBE },
  BUG1: { provenance: CV, basis: PROBE },
  INT2: { provenance: CV, basis: 'ChainVerify inspection of deployUrl' },
  T6: { provenance: CV, basis: 'Latency probes sent by ChainVerify against deployUrl (baseline is customer-supplied)' },
  S3: { provenance: CV, basis: DIFF_ANALYSIS },
  S6: { provenance: CV, basis: 'ChainVerify analysis of fetched manifests against the OSV advisory database' },
  S7: { provenance: CV, basis: DIFF_ANALYSIS },
  S11: { provenance: CV, basis: DIFF_ANALYSIS },
  S12: { provenance: CV, basis: DIFF_ANALYSIS },
  T1: { provenance: CV, basis: DIFF_ANALYSIS },
  T2: { provenance: CV, basis: DIFF_ANALYSIS },
  T4: { provenance: CV, basis: DIFF_ANALYSIS },
  T5: { provenance: CV, basis: DIFF_ANALYSIS },
  T7: { provenance: CV, basis: DIFF_ANALYSIS },
  T8: { provenance: CV, basis: DIFF_ANALYSIS },
  T9: { provenance: CV, basis: DIFF_ANALYSIS },
  INT1: { provenance: CV, basis: DIFF_ANALYSIS },
  BUG2: { provenance: CV, basis: DIFF_ANALYSIS },
  BUG3: { provenance: CV, basis: DIFF_ANALYSIS },
  TEST1: { provenance: CV, basis: DIFF_ANALYSIS },
  TEST2: { provenance: CV, basis: DIFF_ANALYSIS },
  TEST5: { provenance: CV, basis: DIFF_ANALYSIS },
  MIG1: { provenance: CV, basis: DIFF_ANALYSIS },
  MIG4: { provenance: CV, basis: DIFF_ANALYSIS },
  NEW1: { provenance: CV, basis: DIFF_ANALYSIS },
  NEW4: { provenance: CV, basis: DIFF_ANALYSIS },
  AG2: { provenance: CV, basis: 'ChainVerify scan of added diff lines and submitted command strings' },
  MIG0: { provenance: DERIVED, basis: 'Static reminder; the backup cannot be observed by ChainVerify' },
  T3: { provenance: SELF, basis: 'Semgrep findings submitted by the customer; ChainVerify did not run Semgrep' },
  T11: { provenance: REMOTE, basis: 'Sentry API response fetched by ChainVerify' },
  S10: { provenance: REMOTE, basis: DEPLOY_API },
  DEP2: { provenance: REMOTE, basis: DEPLOY_API },
  DEP3: { provenance: REMOTE, basis: DEPLOY_API },
  DEP5: { provenance: REMOTE, basis: DEPLOY_API },
};

const FALLBACK: ProvenanceAssignment = {
  provenance: DERIVED,
  basis: 'Computed by ChainVerify from other evidence',
};

/**
 * Provenance of a single check result. Static per check ID, with two evidence-
 * dependent exceptions: a build-family check executed in the local sandbox is
 * observed by ChainVerify, and AG1 is only OBSERVED_BY_AGENT_GATE when the
 * receipt was fully validated against a trusted key.
 */
export function provenanceForCheck(
  result: Pick<CheckResult, 'checkId' | 'evidence'>,
  receipt?: ReceiptValidation | null,
): ProvenanceAssignment {
  if (result.checkId === 'AG1') {
    if (receipt?.accepted && receipt.testsObserved) {
      return {
        provenance: 'OBSERVED_BY_AGENT_GATE',
        basis: `Agent Gate receipt ${receipt.receiptId} validated against a trusted signing key`,
      };
    }
    return {
      provenance: 'SUBMITTED_BY_CUSTOMER',
      basis: 'Agent Gate receipt submitted by the customer; it was not accepted as observed evidence',
    };
  }
  const evidence = result.evidence as Record<string, unknown> | undefined;
  if (['B5', 'S2', 'S4', 'S5'].includes(result.checkId) && evidence?.['sandbox'] === true) {
    return { provenance: CV, basis: 'Executed by ChainVerify in its build sandbox' };
  }
  return CHECK_SOURCES[result.checkId] ?? FALLBACK;
}

export type ProvenanceCounts = Record<Provenance, number>;

export function emptyProvenanceCounts(): ProvenanceCounts {
  return Object.fromEntries(PROVENANCE_VALUES.map((p) => [p, 0])) as ProvenanceCounts;
}
