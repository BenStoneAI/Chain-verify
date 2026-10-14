import type { Metadata } from 'next';

import ProductMarketingLayout from '@/components/proof/ProductMarketingLayout';

export const metadata: Metadata = {
  title: 'AuditProof — Independent proof records for AI work | ChainVerify',
  description:
    'Capture AI agent activity, human oversight, policy context, and structured evidence that clients, investors, auditors, and governance teams can review.',
  alternates: { canonical: 'https://chainverify.org/audit-proof' },
  keywords: ['AI audit trail','AI governance evidence','EU AI Act Article 12','AI agent audit','AI proof record'],
};

function AuditProofSample() {
  const rows = [
    ['Agent identity verified','Identity check · passed'],
    ['Input / output pair captured','Evidence linked · passed'],
    ['Human approval recorded','Approval timestamp · passed'],
    ['Policy rules checked','8 of 8 rules · passed'],
    ['Proof record prepared','Export-ready sample state'],
  ];
  return (
    <div className="pm-demo-card">
      <div className="pm-proof-shell-top"><span><i/><i/><i/></span><b>AuditProof · illustrative record</b><em>VERIFIED</em></div>
      <div className="pm-demo-list">
        {rows.map(([title,detail]) => (
          <div key={title}><i>✓</i><span><b>{title}</b><small>{detail}</small></span></div>
        ))}
      </div>
    </div>
  );
}

export default function AuditProofPage() {
  return (
    <ProductMarketingLayout
      product="audit-proof"
      eyebrow="AuditProof · evidence for AI work"
      headline={<>Show your AI work is <span className="accent">real.</span></>}
      lede="When a client, investor, auditor, or regulator asks how your AI did the work, hand them an independent proof record — not your word for it."
      primaryPlanSlug="auditproof-pilot"
      primaryCta="Start pilot — $2,500"
      secondaryCta="See a proof record"
      secondaryHref="#proof"
      startPrice="Managed pilot · $2,500 one-time"
      quickFacts={[
        { label: 'Best for', value: 'AI vendors & governance', detail: 'Teams that need evidence of what ran, what happened, and who signed off.' },
        { label: 'Captures', value: 'Execution + oversight', detail: 'Inputs, outputs, approvals, timestamps, policy context, and risk signals.' },
        { label: 'Output', value: 'Reviewable proof record', detail: 'Structured evidence you can retain, export, and hand to a reviewer.' },
      ]}
      benefitsTitle="Give reviewers the evidence they actually ask for."
      benefits={[
        { title: 'What the agent did', body: 'Capture the workflow trace, input/output context, timestamps, and evidence behind the result.' },
        { title: 'Who approved it', body: 'Record human oversight and reviewer sign-off when supplied, rather than leaving approval outside the audit trail.' },
        { title: 'What you can hand over', body: 'Package the evidence into a structured proof record for clients, investors, auditors, and governance teams.' },
      ]}
      proofTitle="A proof record that reads like evidence, not marketing."
      proofCopy="AuditProof organizes the supplied execution evidence, oversight context, and policy checks into a reviewable record. Framework references support evidence mapping; they are not legal certification."
      proofVisual={<AuditProofSample />}
      steps={[
        { title: 'Capture the run.', body: 'Submit agent execution logs, outputs, approvals, and policy context through the supported intake workflow.' },
        { title: 'Cross-check the evidence.', body: 'ChainVerify evaluates identity, input/output capture, oversight, risk, and configured policy evidence.' },
        { title: 'Hand over the record.', body: 'Generate a structured proof record that can be retained and exported for external or internal review.' },
      ]}
      plansTitle="Start with proof, then scale governance."
      plansCopy="The pilot is the fastest way to validate your workflow. Move to a monthly plan when the evidence process is repeatable."
      plans={[
        {
          slug: 'auditproof-pilot',
          name: 'Pilot',
          price: '$2,500',
          cadence: ' one-time',
          description: 'Prove the workflow before committing to a recurring program.',
          features: ['Up to 100 proof runs', 'Managed setup', 'Structured evidence package'],
          cta: 'Start Pilot — $2,500',
        },
        {
          slug: 'auditproof-comply',
          name: 'Comply',
          price: '$1,800',
          cadence: '/mo',
          description: 'For repeatable evidence capture in an active AI operation.',
          features: ['500 runs / month', 'Proof ID per run', '12-month retention'],
          cta: 'Start Comply — $1,800/mo',
        },
        {
          slug: 'auditproof-govern',
          name: 'Govern',
          price: '$4,500',
          cadence: '/mo',
          description: 'For teams that need governance workflows around higher AI volume.',
          features: ['2,000 runs / month', 'API + webhook access', '36-month retention'],
          featured: true,
          cta: 'Start Govern — $4,500/mo',
        },
        {
          slug: 'auditproof-certify',
          name: 'Certify',
          price: '$9,000',
          cadence: '/mo',
          description: 'For high-volume evidence programs and long-lived governance records.',
          features: ['10,000 runs / month', 'Board-ready reporting', '84-month retention'],
          cta: 'Start Certify — $9,000/mo',
        },
      ]}
      faqs={[
        { q: 'Do I need an account before paying?', a: 'No. The purchase CTA opens Stripe-hosted checkout directly. After purchase, continue setup with the same business email you used at checkout.' },
        { q: 'Does AuditProof certify EU AI Act compliance?', a: 'No. AuditProof is designed to support logging, evidence organization, and review workflows. Regulatory references are orientation and evidence-mapping support, not legal certification.' },
        { q: 'What if I only need a focused EU AI Act sprint?', a: 'A focused EU AI Act Sprint is available as a one-time engagement for teams that need a concentrated evidence-readiness project. Use the contact form at /contact for scoping.' },
        { q: 'Can we start smaller?', a: 'Yes. The managed Pilot is intentionally the first step so you can prove the evidence flow before moving to a recurring governance tier.' },
      ]}
      finalTitle="When someone asks how the AI did the work, have the record ready."
      finalCopy="Capture the activity, oversight, and evidence while the work happens instead of rebuilding the story after the fact."
    />
  );
}
