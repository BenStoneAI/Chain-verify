import { AGENT_GATE_NAME } from './productName';

export interface FlowStep {
  num: string;
  title: string;
  body: string;
}

export interface FaqEntry {
  question: string;
  answer: string;
  openByDefault: boolean;
}

export const flowSteps: readonly FlowStep[] = [
  { num: '01', title: 'Send the work.', body: 'Submit the output, delivery claim, invoice, or evidence bundle you need to trust.' },
  { num: '02', title: 'Run the checks.', body: 'ChainVerify evaluates the relevant evidence, rules, risk signals, and review context.' },
  { num: '03', title: 'Keep the proof.', body: 'Use the structured result and proof record to approve, hold, reject, or escalate.' },
];

export const faqEntries: readonly FaqEntry[] = [
  {
    question: 'Do I need an account before checkout?',
    answer: 'No. Paid plans open a secure Stripe-hosted checkout first. You can create or connect your ChainVerify account after purchase.',
    openByDefault: true,
  },
  {
    question: `Can I try ${AGENT_GATE_NAME} before paying?`,
    answer: `Yes. Use the sandbox on the ${AGENT_GATE_NAME} page to see the proof structure and backend-generated result before choosing a paid plan.`,
    openByDefault: true,
  },
  {
    question: `What does ${AGENT_GATE_NAME} actually verify?`,
    answer: 'It runs 49 repository, CI, deploy, security, and test checks against the delivery claim and evidence you submit, returning per-check evidence.',
    openByDefault: false,
  },
  {
    question: 'Is a VERIFIED result a guarantee?',
    answer: 'No. It is a structured verification result based on the supplied evidence and configured checks, designed to make review more defensible.',
    openByDefault: false,
  },
];
