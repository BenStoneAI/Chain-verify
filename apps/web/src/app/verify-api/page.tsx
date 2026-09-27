import type { Metadata } from 'next';

import ProductMarketingLayout from '@/components/proof/ProductMarketingLayout';
import { VerifyAPISandbox } from '@/components/proof/VerifyAPISandbox';

export const metadata: Metadata = {
  title: 'VerifyAPI — Verify AI-generated work before release | ChainVerify',
  description:
    'Independent checks on AI output, commits, builds, tests, CI, security, and software-delivery claims before teams approve or release work.',
  alternates: { canonical: 'https://chainverify.org/verify-api' },
  keywords: [
    'AI verification API',
    'software delivery verification',
    'AI-generated code verification',
    'CI/CD verification',
    'software delivery proof',
  ],
};

export default function VerifyApiPage() {
  return (
    <ProductMarketingLayout
      product="verify-api"
      eyebrow="VerifyAPI · software delivery verification"
      headline={<>AI said the work is done. <span className="accent">Now prove it.</span></>}
      lede="Independent checks on commits, builds, tests, CI, security, and fake-work patterns before you accept or release AI-generated deliveries."
      primaryPlanSlug="verify-api-build"
      primaryCta="Start Build — $99/mo"
      secondaryCta="Try the sandbox"
      secondaryHref="#proof"
      startPrice="Paid plans start at $99/mo"
      quickFacts={[
        { label: 'Best for', value: 'Engineering & product', detail: 'Teams approving AI-generated output and software delivery.' },
        { label: 'Input', value: 'Claims + evidence', detail: 'LLM output, delivery statements, rules, logs, tests, and artifacts.' },
        { label: 'Output', value: 'Verdict + proof ID', detail: 'Issues, confidence, evidence summary, and a reviewable record.' },
      ]}
      benefitsTitle="Answer the three questions every AI delivery creates."
      benefits={[
        { title: 'Did the work happen?', body: 'Verify commits, branches, delivery evidence, and the actual artifact behind the claim.' },
        { title: 'Does it actually work?', body: 'Run checks against builds, tests, acceptance criteria, and evidence instead of trusting a completion message.' },
        { title: 'Is it safe to approve?', body: 'Surface security, CI, scope, and fake-work patterns before users or buyers rely on the result.' },
      ]}
      proofTitle="Try a real verification before you buy."
      proofCopy="The sandbox calls the ChainVerify backend and returns a backend-generated proof ID, verification status, and structured result."
      proofVisual={<VerifyAPISandbox />}
      steps={[
        { title: 'Send the claim.', body: 'Submit AI output or a software-delivery statement with the rules and evidence that matter.' },
        { title: 'Run independent checks.', body: 'ChainVerify evaluates the supplied evidence, risk signals, policies, tests, and acceptance criteria.' },
        { title: 'Keep the proof.', body: 'Receive a structured verdict with issues, confidence, and a proof ID you can retain or export.' },
      ]}
      plansTitle="Pick the verification volume you actually need."
      plansCopy="Fewer choices, clear limits, and the same proof model at every paid tier."
      plans={[
        {
          slug: 'verify-api-build',
          name: 'Build',
          price: '$99',
          cadence: '/mo',
          description: 'For prototypes and smaller production workflows.',
          features: ['5,000 runs / month', 'Proof ID every run', '90-day retention'],
          cta: 'Start Build — $99/mo',
        },
        {
          slug: 'verify-api-scale',
          name: 'Scale',
          price: '$499',
          cadence: '/mo',
          description: 'For active products with steady verification volume.',
          features: ['50,000 runs / month', 'Proof ID every run', '3-year retention'],
          featured: true,
          cta: 'Start Scale — $499/mo',
        },
        {
          slug: 'verify-api-production',
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
        { q: 'Can I try VerifyAPI before paying?', a: 'Yes. Use the sandbox on this page to see the proof structure and backend-generated result before choosing a paid plan.' },
        { q: 'What does VerifyAPI actually verify?', a: 'It checks the claim and evidence you submit against rules, acceptance criteria, delivery signals, tests, CI, and other supported risk checks. The strength of a verdict depends on the evidence supplied.' },
        { q: 'Is a VERIFIED result a guarantee?', a: 'No. It is a structured verification result based on the supplied evidence and configured checks. It is designed to make review more defensible, not replace engineering judgment.' },
      ]}
      finalTitle="Make proof part of the release process."
      finalCopy="Stop accepting AI completion messages as evidence. Run the checks, keep the proof record, and approve with something you can defend."
    />
  );
}
