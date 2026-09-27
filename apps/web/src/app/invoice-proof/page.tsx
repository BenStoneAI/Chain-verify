import type { Metadata } from 'next';

import InvoiceForm from '@/components/proof/InvoiceForm';
import ProductMarketingLayout from '@/components/proof/ProductMarketingLayout';

export const metadata: Metadata = {
  title: 'InvoiceProof — Catch invoice risk before payment | ChainVerify',
  description:
    'Detect duplicate invoices, bank-change risk, PO mismatches, and payment anomalies before money moves, then keep a structured proof record for review.',
  alternates: { canonical: 'https://chainverify.org/invoice-proof' },
  keywords: ['invoice fraud detection','duplicate invoice detection','bank change fraud','AP fraud prevention','invoice verification'],
};

export default function InvoiceProofPage() {
  return (
    <ProductMarketingLayout
      product="invoice-proof"
      eyebrow="InvoiceProof · pre-payment verification"
      headline={<>Catch invoice risk <span className="accent">before you pay.</span></>}
      lede="Detect duplicate invoices, bank-change fraud, PO mismatches, and payment anomalies before money moves — then keep structured evidence your controller or auditor can review."
      primaryPlanSlug="invoiceproof-pilot"
      primaryCta="Start pilot — $750"
      secondaryCta="Test an invoice"
      secondaryHref="#proof"
      startPrice="Managed pilot · $750 one-time"
      quickFacts={[
        { label: 'Best for', value: 'Finance & AP teams', detail: 'Controllers, CFOs, AP teams, and internal audit reviewing payment risk.' },
        { label: 'Checks', value: 'Duplicate + vendor + PO', detail: 'Invoice history, math, vendor changes, purchase-order context, and payment anomalies.' },
        { label: 'Output', value: 'Risk verdict + proof', detail: 'Structured findings and a proof record your finance team can review.' },
      ]}
      benefitsTitle="Move the risk check in front of the payment."
      benefits={[
        { title: 'Duplicate invoices', body: 'Flag exact or modified duplicates when enough history or payment-register context is supplied.' },
        { title: 'Vendor and bank changes', body: 'Surface vendor-domain, remittance, and bank-detail changes that deserve human review before payment.' },
        { title: 'PO and amount mismatches', body: 'Check supplied PO context, line-item math, quantities, totals, and approval signals for inconsistencies.' },
      ]}
      proofTitle="Test invoice verification on the actual workflow."
      proofCopy="Run a single invoice check to see how ChainVerify structures risk findings, math checks, and proof output before you choose a plan."
      proofVisual={<InvoiceForm />}
      steps={[
        { title: 'Submit the invoice.', body: 'Upload or enter invoice data with the vendor, PO, payment-register, or prior-invoice context you have.' },
        { title: 'Cross-check the risk.', body: 'ChainVerify evaluates duplicates, vendor changes, math, PO context, and supported payment-risk signals.' },
        { title: 'Review before payment.', body: 'Use the verdict and structured proof record as evidence for the controller or AP reviewer before money moves.' },
      ]}
      plansTitle="Start with a pilot. Scale only when the control works."
      plansCopy="The pilot gives you a bounded proof-of-value before you move recurring invoice volume into the workflow."
      plans={[
        {
          slug: 'invoiceproof-pilot',
          name: 'Pilot',
          price: '$750',
          cadence: ' one-time',
          description: 'A managed first pass for teams validating invoice verification.',
          features: ['100 invoices', 'Proof record per run', 'Managed pilot setup'],
          cta: 'Start Pilot — $750',
        },
        {
          slug: 'invoiceproof-verify',
          name: 'Verify',
          price: '$1,500',
          cadence: '/mo',
          description: 'For smaller AP teams running recurring pre-payment checks.',
          features: ['500 invoices / month', 'Duplicate + math checks', 'Vendor-change flags'],
          cta: 'Start Verify — $1,500/mo',
        },
        {
          slug: 'invoiceproof-protect',
          name: 'Protect',
          price: '$3,500',
          cadence: '/mo',
          description: 'For active AP operations with more payment volume and review needs.',
          features: ['2,500 invoices / month', 'Structured proof records', 'Expanded recurring volume'],
          featured: true,
          cta: 'Start Protect — $3,500/mo',
        },
        {
          slug: 'invoiceproof-govern',
          name: 'Govern',
          price: '$7,500',
          cadence: '/mo',
          description: 'For higher-volume finance teams that need invoice verification as a governed control.',
          features: ['10,000 invoices / month', 'Structured review evidence', 'High-volume verification'],
          cta: 'Start Govern — $7,500/mo',
        },
      ]}
      faqs={[
        { q: 'Do I need an account before checkout?', a: 'No. The paid CTA opens a Stripe-hosted checkout directly. Account setup happens after the purchase instead of blocking the payment step.' },
        { q: 'Does InvoiceProof authorize payment?', a: 'No. It flags risk and organizes evidence for finance review. It does not replace your payment approval policy or controller judgment.' },
        { q: 'What does bank-change detection need?', a: 'It works best when you supply prior invoice or vendor banking context so ChainVerify has something reliable to compare the submitted invoice against.' },
        { q: 'Can I test it before buying?', a: 'Yes. Use the invoice test on this page to see the workflow and output structure before starting the managed pilot.' },
      ]}
      finalTitle="Stop invoice risk before the wire goes out."
      finalCopy="Put duplicate, vendor, PO, and payment-anomaly checks in the review path before money moves."
    />
  );
}
