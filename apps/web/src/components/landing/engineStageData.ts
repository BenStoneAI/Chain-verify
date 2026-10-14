export interface EngineStage {
  tabLabel: string;
  tag: string;
  title: string;
  desc: string;
  metric: string;
  hudStage: string;
  hudStatus: string;
}

/** Illustrative pipeline walkthrough; hashes and counts are examples. */
export const engineStages: readonly EngineStage[] = [
  {
    tabLabel: '01 · Collect Evidence',
    tag: 'STAGE 01 · COLLECT THE EVIDENCE',
    title: 'Capture the claim and underlying artifacts together.',
    desc: 'Instead of trusting an AI completion message, ChainVerify ingests the raw LLM payload, commit SHA, test logs, or invoice document into a normalized verification envelope before any downstream action occurs.',
    metric: 'Envelope Hash · sha256_91c4a…',
    hudStage: 'STAGE 01 / 05',
    hudStatus: '✓ EVIDENCE ATTACHED',
  },
  {
    tabLabel: '02 · Policy & CI Rules',
    tag: 'STAGE 02 · POLICY & CI RULES',
    title: 'Evaluate against deterministic rules and test suites.',
    desc: 'Every claim is checked against your required CI status, test coverage thresholds, schema contracts, and acceptance rules.',
    metric: 'Rules Evaluated · 49 / 49 Passed',
    hudStage: 'STAGE 02 / 05',
    hudStatus: '✓ 49 RULES VERIFIED',
  },
  {
    tabLabel: '03 · Anomaly Scan',
    tag: 'STAGE 03 · ANOMALY & FAKE-WORK SCAN',
    title: 'Detect stubbed tests, bypassed checks, or duplicate invoices.',
    desc: 'Automated risk heuristics flag mocked assertions, missing build artifacts, vendor bank changes, and PO mismatches before approval.',
    metric: 'Risk Signals · 0 Anomalies Flagged',
    hudStage: 'STAGE 03 / 05',
    hudStatus: '✓ ZERO RISK FLAGS',
  },
  {
    tabLabel: '04 · Human Sign-Off',
    tag: 'STAGE 04 · HUMAN SIGN-OFF',
    title: 'Bind human oversight directly to the evidence bundle.',
    desc: 'When a reviewer approves, holds, or escalates, their identity and timestamp are recorded alongside the exact evidence inspected.',
    metric: 'Reviewer · Recorded & Timestamped',
    hudStage: 'STAGE 04 / 05',
    hudStatus: '✓ HUMAN REVIEW RECORDED',
  },
  {
    tabLabel: '05 · Immutable Proof ID',
    tag: 'STAGE 05 · IMMUTABLE PROOF ID',
    title: 'Export a defensible Proof ID for audits and release gates.',
    desc: 'Retain the structured JSON verdict and Proof ID (cv_8f3e2…) for 90 days to 7 years depending on your plan tier.',
    metric: 'Issued · Proof ID cv_8f3e2…',
    hudStage: 'STAGE 05 / 05',
    hudStatus: '✓ PROOF ID ISSUED',
  },
];
