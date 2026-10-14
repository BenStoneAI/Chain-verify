/**
 * Critical-evidence assessment and the self-reported confidence cap.
 *
 * Two kinds of evidence decide whether a delivery really happened: that tests
 * were EXECUTED, and what is DEPLOYED. When one of them is in scope for this
 * run (the delivery claims it, or the tier/job type requires it) but nothing
 * other than the delivering agent vouches for it, overall confidence is capped
 * and the reason is stated in plain words. The cap only ever lowers the
 * engine's own score.
 */
import type { CheckResult } from '../software-delivery.types.js';
import { summarizeDeployEvidence } from './deploy.js';
import { isObserved, type Provenance } from './provenance.js';
import type { ReceiptValidation } from './receipt.js';

export type CriticalEvidenceCategory = 'TESTS_EXECUTED' | 'DEPLOY_STATE';

export interface CriticalEvidenceAssessment {
  category: CriticalEvidenceCategory;
  /** The delivery claims it, or the requested checks/job type depend on it. */
  inScope: boolean;
  /** Someone other than the delivering agent produced an outcome for it. */
  observed: boolean;
  strongestProvenance: Provenance | null;
  /** Only claims exist (AI report, untrusted receipt, unconfirmed deployUrl). */
  selfReportedOnly: boolean;
  sources: string[];
  /** Plain-words explanation when in scope and not observed. */
  reason: string | null;
}

export interface CriticalEvidenceInput {
  checkList: string[];
  results: CheckResult[];
  jobType: string;
  aiReport?: string;
  deployUrl?: string;
  deployPlatform?: string;
  afterSha: string;
  receipt: ReceiptValidation;
}

const TEST_CLAIM =
  /\btests?\b.{0,40}\b(pass(?:ed|es|ing)?|green|succe\w+|ran|run|executed)\b|\b(pass(?:ed|es|ing)?|ran|executed)\b.{0,30}\btests?\b|\btest suite\b/i;
const DEPLOY_CLAIM = /\bdeploy(?:ed|ment|ing)?\b|\bgo(?:ne)? live\b|\bpushed to prod/i;

function outcome(r: CheckResult | undefined): boolean {
  return r !== undefined && (r.status === 'PASS' || r.status === 'FAIL') && isObserved(r.provenance);
}

const STRENGTH: Provenance[] = [
  'OBSERVED_BY_AGENT_GATE',
  'OBSERVED_BY_REMOTE_PROVIDER',
  'OBSERVED_BY_CHAINVERIFY',
  'DERIVED',
  'SUBMITTED_BY_CUSTOMER',
  'SELF_REPORTED',
];

function strongest(list: Provenance[]): Provenance | null {
  for (const p of STRENGTH) if (list.includes(p)) return p;
  return null;
}

export function assessCriticalEvidence(input: CriticalEvidenceInput): CriticalEvidenceAssessment[] {
  const byId = (id: string) => input.results.find((r) => r.checkId === id);
  const has = (id: string) => input.checkList.includes(id);

  // ---- tests executed
  const s2 = byId('S2');
  const s9 = byId('S9');
  const testSources: string[] = [];
  const testProv: Provenance[] = [];
  if (input.receipt.accepted && input.receipt.observedTests.length > 0) {
    testSources.push('Validated Agent Gate receipt');
    testProv.push('OBSERVED_BY_AGENT_GATE');
  }
  if (outcome(s2)) {
    testSources.push(`S2 ${s2?.status} (CI test check)`);
    testProv.push(s2?.provenance as Provenance);
  }
  if (outcome(s9)) {
    testSources.push(`S9 ${s9?.status} (CI run on the delivery commit)`);
    testProv.push(s9?.provenance as Provenance);
  }
  const testsClaimed = Boolean(input.aiReport && TEST_CLAIM.test(input.aiReport));
  if (testsClaimed) testProv.push('SELF_REPORTED');
  if (input.receipt.submitted && !input.receipt.accepted) testProv.push('SUBMITTED_BY_CUSTOMER');
  const testsInScope =
    has('S2') ||
    input.jobType === 'WRITE_TESTS' ||
    testsClaimed ||
    input.receipt.submitted;
  const testsObserved = testProv.some((p) => isObserved(p));

  const tests: CriticalEvidenceAssessment = {
    category: 'TESTS_EXECUTED',
    inScope: testsInScope,
    observed: testsObserved,
    strongestProvenance: strongest(testProv),
    selfReportedOnly: !testsObserved && testProv.length > 0,
    sources: testSources,
    reason: null,
  };
  if (testsInScope && !testsObserved) {
    const claimed = testsClaimed
      ? 'The delivery says tests passed, but'
      : input.receipt.submitted
        ? 'An Agent Gate receipt was submitted, but it was not accepted as evidence, and'
        : 'Test execution is expected for this run, but';
    tests.reason = `${claimed} no CI result for this exact commit and no validated Agent Gate receipt confirm that tests were executed.`;
  }

  // ---- deploy state
  const deploy = summarizeDeployEvidence(input.results, input.afterSha);
  const deployClaimed = Boolean(input.aiReport && DEPLOY_CLAIM.test(input.aiReport));
  const deployInScope =
    Boolean(input.deployPlatform) || input.jobType === 'DEPLOY_UPDATE' || deployClaimed;
  const deployProv: Provenance[] = [];
  const deploySources: string[] = [];
  const providerResult = byId('DEP3') ?? byId('S10');
  if (deploy.observed && providerResult) {
    deployProv.push(providerResult.provenance ?? 'OBSERVED_BY_REMOTE_PROVIDER');
    deploySources.push(`${providerResult.checkId} ${providerResult.status} (deployment provider)`);
  }
  if (input.deployUrl || deployClaimed) deployProv.push('SELF_REPORTED');
  const deployObserved = deployProv.some((p) => isObserved(p));
  const deployAssessment: CriticalEvidenceAssessment = {
    category: 'DEPLOY_STATE',
    inScope: deployInScope,
    observed: deployObserved,
    strongestProvenance: strongest(deployProv),
    selfReportedOnly: !deployObserved && deployProv.length > 0,
    sources: deploySources,
    reason: null,
  };
  if (deployInScope && !deployObserved) {
    deployAssessment.reason =
      'Deployment is part of this delivery, but no deployment provider confirmed which commit is live.';
  }

  return [tests, deployAssessment];
}

export interface ConfidenceCapResult {
  confidence: number;
  /** The cap condition holds (critical evidence is in scope and unobserved). */
  applies: boolean;
  /** The cap actually lowered the engine's confidence. */
  lowered: boolean;
  reason: string | null;
}

export function applyConfidenceCap(
  engineConfidence: number,
  assessments: CriticalEvidenceAssessment[],
  cap: number,
): ConfidenceCapResult {
  const gaps = assessments.filter((a) => a.inScope && !a.observed && a.reason);
  if (gaps.length === 0) {
    return { confidence: engineConfidence, applies: false, lowered: false, reason: null };
  }
  const confidence = Math.min(engineConfidence, cap);
  return {
    confidence: Math.round(confidence * 100) / 100,
    applies: true,
    lowered: confidence < engineConfidence,
    reason: `Confidence is capped at ${cap}. ${gaps.map((g) => g.reason).join(' ')}`,
  };
}
