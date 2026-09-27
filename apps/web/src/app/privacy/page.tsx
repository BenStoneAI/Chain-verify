import type { Metadata } from 'next';

import StandardPageShell from '@/components/brand/StandardPageShell';

export const metadata: Metadata = {
  title: 'Privacy Policy | ChainVerify',
  description: 'ChainVerify privacy policy covering website, product, verification, and payment-related information.',
  alternates: { canonical: 'https://chainverify.org/privacy' },
};

export default function PrivacyPage() {
  return (
    <StandardPageShell
      eyebrow="PRIVACY"
      title="Privacy Policy"
      intro="Effective September 27, 2026. This policy explains the categories of information ChainVerify may process when you visit the site, use a ChainVerify product, contact us, or purchase a plan."
    >
      <section className="cv-standard-section">
        <h2>Information we may collect</h2>
        <ul>
          <li><strong>Contact and account information:</strong> name, business email, organization, and related support or onboarding details.</li>
          <li><strong>Transaction information:</strong> plan, purchase status, billing contact details, and transaction identifiers supplied by our payment provider.</li>
          <li><strong>Product and verification data:</strong> inputs, outputs, evidence, metadata, proof IDs, logs, timestamps, and other information you submit to a ChainVerify workflow.</li>
          <li><strong>Technical information:</strong> IP address, browser or device information, request metadata, and service logs used to operate, secure, and troubleshoot the service.</li>
          <li><strong>Communications:</strong> messages and attachments you choose to send to us.</li>
        </ul>
      </section>

      <section className="cv-standard-section">
        <h2>How we use information</h2>
        <ul>
          <li>Provide, operate, maintain, and improve ChainVerify products.</li>
          <li>Run requested verification workflows and produce proof records.</li>
          <li>Process purchases, identify entitlements, and provide support.</li>
          <li>Detect abuse, investigate security issues, and protect the service.</li>
          <li>Comply with applicable legal obligations and enforce service terms.</li>
        </ul>
      </section>

      <section className="cv-standard-section">
        <h2>Payments and service providers</h2>
        <p>
          Supported purchases use Stripe-hosted Checkout. Stripe processes payment credentials under its own privacy and security terms. ChainVerify does not need full payment-card numbers to operate the service. We may also use infrastructure, hosting, database, observability, email, and other service providers as necessary to operate ChainVerify.
        </p>
      </section>

      <section className="cv-standard-section">
        <h2>Sharing and sale of personal information</h2>
        <p>
          ChainVerify does not sell personal information. We may disclose information to service providers that process it on our behalf, when required by law, to protect rights or security, or as part of a corporate transaction such as a merger, financing, or acquisition.
        </p>
      </section>

      <section className="cv-standard-section">
        <h2>Retention</h2>
        <p>
          Retention varies by product, plan, legal requirement, and operational need. Product pages may describe specific proof-record retention periods for particular paid plans. Other records are retained only as long as reasonably necessary for the purposes described in this policy.
        </p>
      </section>

      <section className="cv-standard-section">
        <h2>Your choices and requests</h2>
        <p>
          You may contact us to request access, correction, or deletion of personal information, subject to applicable law and legitimate retention requirements. Send privacy requests to <a href="mailto:proof@chainverify.org?subject=ChainVerify%20Privacy%20Request">proof@chainverify.org</a> with “Privacy Request” in the subject line.
        </p>
      </section>

      <section className="cv-standard-section">
        <h2>Security</h2>
        <p>
          We use reasonable technical and organizational measures designed to protect information. No internet service can guarantee absolute security. See the <a href="/security">Security page</a> for additional information.
        </p>
      </section>

      <section className="cv-standard-section">
        <h2>Children</h2>
        <p>
          ChainVerify is a business-facing service and is not directed to children under 13. We do not knowingly seek personal information from children under 13.
        </p>
      </section>

      <section className="cv-standard-section">
        <h2>Changes and contact</h2>
        <p>
          We may update this policy as the service changes. The effective date above will be revised when material updates are published. Questions can be sent to <a href="mailto:proof@chainverify.org?subject=ChainVerify%20Privacy">proof@chainverify.org</a>.
        </p>
      </section>
    </StandardPageShell>
  );
}
