import type { CheckResult } from '../software-delivery.types.js';

/**
 * Per-check recommended action, shown next to the reason. Keyed by check ID;
 * only FAIL / WARNING / SKIP results receive one.
 */
const ACTIONS: Record<string, string> = {
  B1: 'Confirm beforeSha and afterSha are the right pair and that the work was actually committed between them.',
  B2: 'Verify the delivery commit was made after the job started; a commit that predates the job is not this job\'s work.',
  B3: 'Check that the change touches source files, not only documentation or config.',
  B4: 'Correct the AI report so it describes only files and behaviour that are in the diff.',
  B5: 'Make the build job run on the delivery commit, or enable the build sandbox, so a real build result exists.',
  B6: 'Make the deployed site reachable from the public internet and re-run the check.',
  B7: 'Merge the pull request after the job started, then re-verify.',
  S2: 'Publish the test run as a CI check on the delivery commit, or attach a signed Agent Gate receipt of an executed test run.',
  S3: 'Remove the hardcoded secret from the diff, rotate it, and move it to environment configuration.',
  S4: 'Run the type checker in CI on the delivery commit and fix the errors.',
  S5: 'Run the linter in CI on the delivery commit and fix the findings.',
  S6: 'Review and upgrade or replace the flagged dependency before delivery.',
  S7: 'Revert changes outside the job scope or explain them in the description.',
  S8: 'Name the entry point (route or URL) in the job description so reachability can be probed.',
  S9: 'Re-run CI on the delivery commit and wait for a completed, successful run.',
  S10: 'Deploy the delivery commit to production and verify the provider reports that exact commit.',
  S11: 'Commit the regenerated lock file alongside the package.json change.',
  S12: 'Restore the removed validation logic instead of returning an unconditional success.',
  T1: 'Add tests so coverage does not drop for the changed code.',
  T2: 'Add at least one test that covers the new code.',
  T3: 'Fix the high-severity Semgrep findings, or run Semgrep in CI so the report is observable.',
  T4: 'Restore the authentication/authorization guard that the diff removed.',
  T5: 'Add rate limiting to the new public endpoint.',
  T6: 'Investigate the latency regression against the baseline before shipping.',
  T7: 'Document every new environment variable.',
  T8: 'Remove or wire in the orphaned files.',
  T9: 'Update the consumers of the changed shared export.',
  T10: 'Address the missing requirements from the job description.',
  T11: 'Investigate the post-deploy error-rate increase in Sentry.',
  T12: 'Make the delivery description match what the diff actually does.',
  BUG1: 'Provide a probe URL or reproduction steps so the original bug can be re-tested.',
  BUG2: 'Add a regression test that would have caught this bug.',
  BUG3: 'Fix the root cause instead of swallowing or hiding the error.',
  DEP1: 'Confirm production serves the new build (bypass caches) and re-run.',
  DEP2: 'Trigger a fresh deployment; the last one was a cache hit.',
  DEP3: 'Deploy the delivery commit; the running commit differs from the requested one.',
  DEP4: 'Fix the health endpoint so it returns success on the deployed commit.',
  DEP5: 'Investigate the failed or cancelled deploys after the job started.',
  TEST1: 'Remove the skip markers so the new tests actually run.',
  TEST2: 'Add real assertions to the new tests.',
  TEST5: 'Add tests; the net test count did not increase.',
  MIG0: 'Take and record a database backup before the migration runs.',
  MIG1: 'Include the migration file in the delivery.',
  MIG4: 'Add a DEFAULT to the new NOT NULL column or backfill before applying the constraint.',
  NEW1: 'Register the new code in a module or index file so it is reachable.',
  NEW4: 'Generate and include the migration for the schema change.',
  INT1: 'Remove hardcoded credentials and load them from configuration.',
  INT2: 'Replace test credentials with real production credentials.',
  REV1: 'Address every changed file in the review.',
  AG1: 'Submit a receipt produced by Agent Gate for this exact commit, signed with a key this deployment trusts, from a clean working tree.',
  AG2: 'Remove the suppression (skip markers, failure-swallowing flags) so failing tests fail the pipeline.',
};

export function recommendedActionFor(result: Pick<CheckResult, 'checkId' | 'status' | 'detail'>): string {
  if (result.status === 'PASS') return 'No action required.';
  const specific = ACTIONS[result.checkId];
  if (specific) {
    if (result.status === 'SKIP') {
      return `${specific} (This check could not be evaluated, so it provided no assurance.)`;
    }
    return specific;
  }
  if (result.status === 'SKIP') {
    return 'Provide the missing evidence for this check and re-run the verification.';
  }
  return result.status === 'FAIL'
    ? 'Resolve the failure described in the reason and re-run the verification.'
    : 'Review the warning described in the reason before accepting this delivery.';
}
