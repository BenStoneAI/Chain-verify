import { AGENT_GATE_NAME } from './productName';

export interface ProofRecord {
  tabLabel: string;
  verdict: string;
  claim: string;
  evidence: string;
  checks: string;
  human: string;
  id: string;
}

/** Illustrative records for the hero card; not live customer evidence. */
export const proofRecords: readonly ProofRecord[] = [
  {
    tabLabel: AGENT_GATE_NAME,
    verdict: '✓ VERIFIED',
    claim: 'Captured · Software delivery',
    evidence: 'Attached · CI + unit tests',
    checks: 'Passed (49 / 49 checks)',
    human: 'Recorded',
    id: 'Proof ID cv_8f3e2…',
  },
  {
    tabLabel: 'AuditProof',
    verdict: '✓ VERIFIED',
    claim: 'Captured · Agent tool trace',
    evidence: 'Attached · Policy context',
    checks: 'Passed (Governance rules)',
    human: 'Recorded · Oversight sign-off',
    id: 'Proof ID cv_4a9c1…',
  },
  {
    tabLabel: 'InvoiceProof',
    verdict: '✓ VERIFIED',
    claim: 'Captured · Vendor invoice',
    evidence: 'Attached · PO + math check',
    checks: 'Passed (0 duplicate flags)',
    human: 'Recorded · AP approval',
    id: 'Proof ID cv_7d1b9…',
  },
];
