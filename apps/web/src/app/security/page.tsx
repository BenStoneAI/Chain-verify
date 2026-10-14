import type { Metadata } from 'next';

import StandardPageShell from '@/components/brand/StandardPageShell';

export const metadata: Metadata = {
  title: 'Security | ChainVerify',
  description: 'ChainVerify security practices, payment security, and vulnerability reporting information.',
  alternates: { canonical: 'https://chainverify.org/security' },
};

export default function SecurityPage() {
  return (
    <StandardPageShell
      eyebrow="SECURITY"
      title="Security is part of the proof layer."
      intro="ChainVerify is designed for workflows where evidence, reviewability, and trustworthy system behavior matter. We use practical safeguards to reduce risk across the website, API, and payment flow."
    >
      <section className="cv-standard-section">
        <h2>Core practices</h2>
        <ul>
          <li>HTTPS/TLS is used for the public website and supported API traffic.</li>
          <li>Access to production systems and administrative functions is limited to authorized operators and service accounts.</li>
          <li>Secrets and credentials should not be embedded in customer-submitted content or public requests.</li>
          <li>Verification records are designed to preserve traceability through identifiers, timestamps, and structured evidence.</li>
          <li>Security controls are reviewed as the product and infrastructure evolve.</li>
        </ul>
      </section>

      <section className="cv-standard-section">
        <h2>Payments</h2>
        <p>
          ChainVerify uses Stripe-hosted Checkout for supported purchases. Payment-card entry is handled by Stripe rather than by ChainVerify's own checkout form. ChainVerify may receive transaction and billing metadata needed to identify a purchase, but does not need full card numbers to operate the service.
        </p>
      </section>

      <section className="cv-standard-section">
        <h2>Responsible disclosure</h2>
        <p>
          If you believe you found a security issue, report it through the <a href="/contact">contact form</a> and choose “Security report” as the topic. Include enough detail to reproduce the issue, the affected URL or endpoint, and the potential impact.
        </p>
        <p>
          Please do not access data that is not yours, degrade service availability, run destructive testing, or publicly disclose an unresolved issue before we have had a reasonable opportunity to investigate.
        </p>
      </section>

      <section className="cv-standard-section">
        <h2>No certification claim</h2>
        <p>
          This page describes general security practices. It does not claim that ChainVerify is certified under SOC 2, ISO 27001, PCI DSS, or any other framework unless a separate current document expressly says so.
        </p>
      </section>
    </StandardPageShell>
  );
}
