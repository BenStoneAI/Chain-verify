import type { Metadata } from 'next';

import ProductMarketingLayout from '@/components/proof/ProductMarketingLayout';
import { AgentGateSandbox } from '@/components/proof/AgentGateSandbox';

export const metadata: Metadata = {
  title: 'Agent Gate — Verify software delivery before release | ChainVerify',
  description:
    'Agent Gate runs 49 repository, CI, deploy, security, and test checks on a software delivery, with per-check evidence and a signed proof record, before teams approve or release AI-generated work.',
  alternates: { canonical: 'https://chainverify.org/agent-gate' },
  keywords: [
    'Agent Gate',
    'software delivery verification',
    'AI-generated code verification',
    'CI/CD verification',
    'deployment verification',
    'software delivery proof',
  ],
};

export default function AgentGatePage() {
  return (
    <ProductMarketingLayout
      product="verify-api"
      eyebrow="Agent Gate · software delivery verification"
      headline={<>AI said the work is done. <span className="accent">Now prove it.</span></>}
      lede="Agent Gate checks commits, diffs, CI, deployments, security, and tests against the delivery claim, so you can accept or release AI-generated work with evidence."
      primaryPlanSlug="agent-gate-build"
      primaryCta="Start Build — $99/mo"
      secondaryCta="Try the sandbox"
      secondaryHref="#proof"
      startPrice="Paid plans start at $99/mo"
      quickFacts={[
        { label: 'Best for', value: 'Engineering & product', detail: 'Teams approving AI-generated output and software delivery.' },
        { label: 'Input', value: 'Claims + evidence', detail: 'Delivery statements, diffs, CI and deploy references, tests, logs, and artifacts.' },
        { label: 'Output', value: 'Verdict + proof ID', detail: '49 checks with per-check evidence, confidence, and a signed proof record.' },
      ]}
      benefitsTitle="Answer the three questions every AI delivery creates."
      benefits={[
        { title: 'Did the work happen?', body: 'Compare the claim against the actual commits, branches, changed files, and delivery evidence behind it.' },
        { title: 'Does it actually work?', body: 'Check builds, tests, CI results, and deployments instead of trusting a completion message.' },
        { title: 'Is it safe to approve?', body: 'Surface hardcoded secrets, dependency and lock-file issues, skipped tests, unprotected routes, and fake-work patterns before users rely on the result.' },
      ]}
      proofTitle="Try a real verification before you buy."
      proofCopy="The sandbox calls the ChainVerify backend and returns a backend-generated proof ID, verification status, and structured result."
      proofVisual={<AgentGateSandbox />}
      steps={[
        { title: 'Send the claim.', body: 'Submit the delivery statement with the repository, commit, and evidence that matter.' },
        { title: 'Run independent checks.', body: 'ChainVerify runs repository, CI, deploy, security, and test checks against the supplied evidence.' },
        { title: 'Keep the proof.', body: 'Receive per-check results with evidence, confidence, and a signed proof ID you can retain or export.' },
      ]}
      plansTitle="Pick the verification volume you actually need."
      plansCopy="Fewer choices, clear limits, and the same proof model at every paid tier."
      plans={[
        {
          slug: 'agent-gate-build',
          name: 'Build',
          price: '$99',
          cadence: '/mo',
          description: 'For prototypes and smaller production workflows.',
          features: ['5,000 runs / month', 'Proof ID every run', '90-day retention'],
          cta: 'Start Build — $99/mo',
        },
        {
          slug: 'agent-gate-scale',
          name: 'Scale',
          price: '$499',
          cadence: '/mo',
          description: 'For active products with steady verification volume.',
          features: ['50,000 runs / month', 'Proof ID every run', '3-year retention'],
          featured: true,
          cta: 'Start Scale — $499/mo',
        },
        {
          slug: 'agent-gate-production',
          name: 'Production',
          price: '$1,200',
          cadence: '/mo',
          description: 'For high-volume teams that need longer-lived evidence.',
          features: ['250,000 runs / month', 'Proof ID every run', '7-year retention'],
          cta: 'Start Production — $1,200/mo',
        },
        {
          name: 'Enterprise',
          price: 'Custom',
          description: 'For custom volume, contracts, deployment, and support.',
          features: ['Custom limits', 'Commercial terms', 'Implementation support'],
          cta: 'Talk to us',
          href: 'mailto:proof@chainverify.org',
        },
      ]}
      faqs={[
        { q: 'Do I need an account before checkout?', a: 'No. Paid plans open a secure Stripe-hosted checkout first. You can create or connect your ChainVerify account after purchase.' },
        { q: 'Can I try Agent Gate before paying?', a: 'Yes. Use the sandbox on this page to see the proof structure and backend-generated result before choosing a paid plan.' },
        { q: 'What does Agent Gate actually verify?', a: 'It runs 49 repository, CI, deploy, security, and test checks against the delivery claim and the evidence you supply, and records per-check evidence in a signed proof record. The strength of a verdict depends on the evidence supplied.' },
        { q: 'Is a VERIFIED result a guarantee?', a: 'No. It is a structured verification result based on the supplied evidence and configured checks. It is designed to make review more defensible, not replace engineering judgment.' },
      ]}
      finalTitle="Make proof part of the release process."
      finalCopy="Stop accepting AI completion messages as evidence. Run the checks, keep the proof record, and approve with something you can defend."
    />
  );
}
