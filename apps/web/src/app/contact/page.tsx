import type { Metadata } from 'next';

import ContactForm from '@/components/contact/ContactForm';
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
      intro="Questions about Agent Gate, AuditProof, InvoiceProof, a pilot, billing, security, or privacy? Send us a message with the form below and include the product or workflow you are asking about."
    >
      <ContactForm />

      <div className="cv-standard-grid">
        <article>
          <h2>General & sales</h2>
          <p>Product questions, pricing, pilots, implementation, and partnership inquiries. Choose “Sales and pilots”.</p>
        </article>
        <article>
          <h2>Support</h2>
          <p>Include your product, plan, organization name, and a short description of the issue. Do not send passwords, API keys, or full payment-card information.</p>
        </article>
        <article>
          <h2>Security & privacy</h2>
          <p>For a security report choose “Security report”. For a privacy request choose “Privacy or other” and start your message with “Privacy Request”.</p>
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
