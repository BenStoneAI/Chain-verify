import type { Metadata } from 'next';

import StandardPageShell from '@/components/brand/StandardPageShell';

export const metadata: Metadata = {
  title: 'Contact | ChainVerify',
  description: 'Contact ChainVerify for product questions, pilots, support, security, or privacy inquiries.',
  alternates: { canonical: 'https://chainverify.org/contact' },
};

export default function ContactPage() {
  return (
    <StandardPageShell
      eyebrow="CONTACT"
      title="Talk to ChainVerify."
      intro="Questions about VerifyAPI, AuditProof, InvoiceProof, a pilot, billing, security, or privacy? Use the address below and include the product or workflow you are asking about."
    >
      <div className="cv-standard-grid">
        <article>
          <h2>General & sales</h2>
          <p>Product questions, pricing, pilots, implementation, and partnership inquiries.</p>
          <a className="cv-standard-link" href="mailto:proof@chainverify.org?subject=ChainVerify%20inquiry">
            proof@chainverify.org
          </a>
        </article>
        <article>
          <h2>Support</h2>
          <p>Include your product, plan, organization name, and a short description of the issue. Do not email passwords, API keys, or full payment-card information.</p>
          <a className="cv-standard-link" href="mailto:proof@chainverify.org?subject=ChainVerify%20support">
            Email support
          </a>
        </article>
        <article>
          <h2>Security & privacy</h2>
          <p>For a security report or privacy request, put “Security” or “Privacy” in the subject line so it can be triaged appropriately.</p>
          <a className="cv-standard-link" href="mailto:proof@chainverify.org?subject=ChainVerify%20Security%20or%20Privacy">
            Send a security or privacy inquiry
          </a>
        </article>
      </div>

      <section className="cv-standard-section">
        <h2>What to include</h2>
        <ul>
          <li>Your name and organization.</li>
          <li>The ChainVerify product you are using or evaluating.</li>
          <li>A concise description of the question or issue.</li>
          <li>For technical issues, the relevant proof ID, request ID, or timestamp when available.</li>
        </ul>
      </section>
    </StandardPageShell>
  );
}
