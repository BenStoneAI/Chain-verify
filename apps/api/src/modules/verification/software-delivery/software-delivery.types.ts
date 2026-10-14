import type { Provenance } from './trust/provenance.js';

export interface CheckResult {
  checkId: string;
  checkName: string;
  tier: SoftwareTier;
  status: CheckStatus;
  detail?: string;
  evidence?: Record<string, unknown>;
  durationMs?: number;
  /** Who observed the fact this result rests on. Set by the trust layer. */
  provenance?: Provenance;
  /** One-line statement of where that observation came from. */
  provenanceBasis?: string;
  /** What the caller should do about this result. */
  recommendedAction?: string;
  /**
   * For SKIP results: NOT_EVALUATED = the check was declared but not enabled in
   * this run; UNABLE = the check ran but lacked the evidence/credentials to decide.
   */
  skipKind?: 'NOT_EVALUATED' | 'UNABLE';
}

export type CheckStatus = 'PASS' | 'FAIL' | 'WARNING' | 'SKIP';
export type SoftwareTier = 'BASIC' | 'STANDARD' | 'THOROUGH';

// Maps each check ID to its human-readable name
export const CHECK_NAMES: Record<string, string> = {
  B1: 'Work exists in the repo',
  B2: 'Commit made after job started',
  B3: 'Correct files were touched',
  B4: 'Delivery description matches reality',
  B5: 'Project still builds',
  B6: 'Live site still opens',
  B7: 'PR is merged (not just opened)',
  S1: 'All Tier 1 checks',
  S2: 'Existing tests still pass',
  S3: 'No hardcoded secrets introduced',
  S4: 'Type checker is clean',
  S5: 'Linter is clean',
  S6: 'New dependencies are safe',
  S7: 'Nothing outside scope was changed',
  S8: 'Feature reachable via entry point',
  S9: 'CI/CD pipeline passed on delivery commit',
  S10: 'Delivery went to real production environment',
  S11: 'Lock file consistent with package.json changes',
  S12: 'No unconditional-success regression introduced',
  T1: 'Test coverage did not drop',
  T2: 'New code has at least one test',
  T3: 'Static security analysis',
  T4: 'Protected routes are still protected',
  T5: 'Rate limiting present on new public endpoints',
  T6: 'Performance did not regress',
  T7: 'New environment variables are documented',
  T8: 'No orphan files left behind',
  T9: 'Breaking changes to shared exports are handled',
  T10: 'Specification requirements addressed',
  T11: 'Error rate stable post-deploy',
  T12: 'Delivery description vs. actual diff',
  BUG1: 'Original bug no longer reproduces',
  BUG2: 'A test exists that would have caught this bug',
  BUG3: 'Fix addresses root cause, not symptoms',
  BUG4: 'Error rate dropped in production',
  DEP1: 'Production running new code, not cached',
  DEP2: 'Deployment was not a cache hit',
  DEP3: 'Running commit SHA matches intended commit',
  DEP4: 'Health check passes',
  DEP5: 'No crash loops after deploy',
  TEST1: 'Tests actually run (not skipped)',
  TEST2: 'Tests are not empty',
  TEST3: 'Tests cover the target code',
  TEST4: 'Tests would catch a real bug',
  TEST5: 'Test count increased',
  MIG0: 'Pre-migration backup exists',
  MIG1: 'Migration recorded as applied',
  MIG2: 'Schema matches what was declared',
  MIG3: 'No data was lost',
  MIG4: 'No unexpected NULLs introduced',
  MIG5: 'Migration cannot run twice',
  INT1: 'No hardcoded credentials',
  INT2: 'Real credentials, not test credentials',
  INT3: 'Transaction appears in third-party dashboard',
  INT4: 'Error cases are handled',
  INT5: 'Webhook signature is verified',
  NEW1: 'New code is wired in, not orphaned',
  NEW2: 'Feature accessible to regular user',
  NEW3: 'Feature does not break adjacent behavior',
  NEW4: 'Schema changes have a migration',
  REV1: 'Every file in scope was addressed',
  REV2: 'Findings include specific line references',
  REV3: 'Review was not written from the code itself',
  REV4: 'Non-trivial codebase produced at least one finding',
  AG1: 'Agent Gate receipt is valid and bound to this commit',
  AG2: 'Test and failure suppression not introduced',
};

// Which checks belong to each tier (cumulative — STANDARD includes BASIC)
export const TIER_CHECKS: Record<SoftwareTier, string[]> = {
  BASIC: ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'AG1', 'AG2'],
  STANDARD: ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'AG1', 'AG2', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10', 'S11', 'S12'],
  THOROUGH: ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'AG1', 'AG2', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10', 'S11', 'S12', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12'],
};

// Job-type specific check IDs
export const JOB_TYPE_CHECKS: Record<string, string[]> = {
  BUG_FIX: ['BUG1', 'BUG2', 'BUG3'],
  DEPLOY_UPDATE: ['DEP1', 'DEP2', 'DEP3', 'DEP4', 'DEP5'],
  WRITE_TESTS: ['TEST1', 'TEST2', 'TEST3', 'TEST5'],
  MIGRATE_DATA: ['MIG0', 'MIG1', 'MIG2', 'MIG3', 'MIG4', 'MIG5'],
  BUILD_INTEGRATION: ['INT1', 'INT2', 'INT4', 'INT5'],
  NEW_FEATURE: ['NEW1', 'NEW2', 'NEW3', 'NEW4'],
  CODE_REVIEW: ['REV1', 'REV2', 'REV3', 'REV4'],
};
