/**
 * Delivery lifecycle: CLAIMED < IMPLEMENTED < TESTED < INTEGRATED < DEPLOYED
 * < VERIFIED, computed from check outcomes AND who observed them.
 *
 * Each level requires the previous one. STALE and INVALID_RECEIPT are not
 * levels; they are reported as separate flags next to the level reached, and
 * the per-check results, coverage, confidence and overall decision are kept
 * alongside (the lifecycle never replaces them).
 */
import type { CheckResult } from '../software-delivery.types.js';
import { summarizeDeployEvidence, type DeployEvidence } from './deploy.js';
import { isObserved } from './provenance.js';
import type { ReceiptValidation } from './receipt.js';

export const LIFECYCLE_LEVELS = [
  'CLAIMED',
  'IMPLEMENTED',
  'TESTED',
  'INTEGRATED',
  'DEPLOYED',
  'VERIFIED',
] as const;

export type LifecycleLevel = (typeof LIFECYCLE_LEVELS)[number];

export interface LifecycleResult {
  status: LifecycleLevel;
  reached: LifecycleLevel[];
  /** Why the next level above `status` was not reached (and why each higher one is blocked). */
  blocked: Partial<Record<LifecycleLevel, string>>;
  flags: {
    /** Set by freshness evaluation; false at creation time. */
    stale: boolean;
    /** A receipt was submitted but not accepted as evidence. */
    invalidReceipt: boolean;
  };
  deploy: DeployEvidence;
}

export interface LifecycleInput {
  results: CheckResult[];
  afterSha: string;
  receipt: ReceiptValidation;
  /** Number of changed files the engine itself fetched; used when B1 did not run. */
  fetchedDiffFileCount: number;
}

function find(results: CheckResult[], id: string): CheckResult | undefined {
  return results.find((r) => r.checkId === id);
}

function observedPass(r: CheckResult | undefined): boolean {
  return r?.status === 'PASS' && isObserved(r.provenance);
}

export function computeLifecycle(input: LifecycleInput): LifecycleResult {
  const { results, receipt } = input;
  const reached: LifecycleLevel[] = ['CLAIMED'];
  const blocked: Partial<Record<LifecycleLevel, string>> = {};
  const deploy = summarizeDeployEvidence(results, input.afterSha);

  const b1 = find(results, 'B1');
  const s2 = find(results, 'S2');
  const s9 = find(results, 'S9');
  const s8 = find(results, 'S8');

  const block = (level: LifecycleLevel, why: string): void => {
    const idx = LIFECYCLE_LEVELS.indexOf(level);
    for (const higher of LIFECYCLE_LEVELS.slice(idx)) {
      if (!blocked[higher]) {
        blocked[higher] =
          higher === level ? why : `Requires ${level}, which was not reached: ${why}`;
      }
    }
  };

  // IMPLEMENTED: work observed in the repository between the two commits.
  let implemented = false;
  if (b1) {
    implemented = observedPass(b1);
    if (!implemented) {
      block('IMPLEMENTED', `B1 is ${b1.status}: ${b1.detail ?? 'no observed change between the commits'}`);
    }
  } else if (input.fetchedDiffFileCount > 0) {
    implemented = true;
  } else {
    block('IMPLEMENTED', 'No change between the commits was observed (B1 did not run and no diff was fetched).');
  }
  if (implemented) reached.push('IMPLEMENTED');

  // TESTED: observed test execution - a validated trusted receipt, or CI the
  // provider reports as successful for this commit. Customer text never counts.
  let tested = false;
  if (implemented) {
    const ciFailure = [s2, s9].find((r) => r?.status === 'FAIL');
    const receiptTests = receipt.accepted && receipt.testsObserved;
    const ciTests = observedPass(s2) || observedPass(s9);
    if (ciFailure) {
      block('TESTED', `${ciFailure.checkId} failed: ${ciFailure.detail ?? 'CI reported a failure on the delivery commit'}`);
    } else if (receiptTests || ciTests) {
      tested = true;
      reached.push('TESTED');
    } else {
      const submitted = receipt.submitted
        ? ' The submitted receipt was not accepted as observed evidence.'
        : '';
      block(
        'TESTED',
        `No observed test execution: no CI result for this commit reported success and no validated Agent Gate receipt of an executed test run was supplied.${submitted}`,
      );
    }
  }

  // INTEGRATED: the remote provider reports CI success on the delivery commit.
  let integrated = false;
  if (tested) {
    if (observedPass(s9) || observedPass(s2)) {
      integrated = true;
      reached.push('INTEGRATED');
    } else {
      const why = s9
        ? `S9 is ${s9.status}${s9.detail ? `: ${s9.detail}` : ''}`
        : 'S9 (CI on the delivery commit) was not evaluated';
      block('INTEGRATED', `Remote CI success on the delivery commit was not observed. ${why}`);
    }
  }

  // DEPLOYED: provider-observed deployment of exactly the requested commit, healthy.
  let deployed = false;
  if (integrated) {
    if (!deploy.observed) {
      block('DEPLOYED', 'No deployment provider reported which commit is live.');
    } else if (deploy.shaMatch !== true) {
      block(
        'DEPLOYED',
        `The provider reports ${deploy.deployedSha ?? 'no commit'} is live, not the requested ${input.afterSha}.`,
      );
    } else if (deploy.healthy !== true) {
      block(
        'DEPLOYED',
        deploy.healthy === false
          ? `The deployment runs the requested commit but its ${deploy.healthSource} health check failed.`
          : 'The deployment runs the requested commit but no health check (DEP4 or B6) produced a result.',
      );
    } else {
      deployed = true;
      reached.push('DEPLOYED');
    }
  }

  // VERIFIED: a user-visible behaviour observed by ChainVerify (not by the agent).
  if (deployed) {
    const regress = ['B6', 'DEP1', 'DEP4'].map((id) => find(results, id)).find((r) => r?.status === 'FAIL');
    if (regress) {
      block('VERIFIED', `${regress.checkId} failed: ${regress.detail ?? 'the deployed site did not respond correctly'}`);
    } else if (observedPass(s8)) {
      reached.push('VERIFIED');
    } else {
      block(
        'VERIFIED',
        'No user-visible check was observed by ChainVerify (S8 requires an entry point named in the job description and a deployUrl).',
      );
    }
  }

  const status = reached[reached.length - 1];
  return {
    status,
    reached,
    blocked,
    flags: { stale: false, invalidReceipt: receipt.submitted && !receipt.accepted },
    deploy,
  };
}
