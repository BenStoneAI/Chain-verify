import { describe, expect, it } from 'vitest';
import { renderPurchaseWelcomeEmail, type PurchaseWelcomeEmailInput } from './purchase-welcome-email.js';

const base: PurchaseWelcomeEmailInput = {
  to: 'buyer@example.com',
  orgName: 'ChainVerify E2E Test',
  productName: 'Agent Gate',
  planName: 'Agent Gate Build',
  monthlyLimit: 5000,
  welcomeUrl: 'https://www.chainverify.org/agent-gate/welcome?plan=agent-gate-build&session_id=cs_live_abc',
  docsUrl: 'https://www.chainverify.org/agent-gate/docs',
  supportEmail: 'proof@chainverify.org',
};

describe('renderPurchaseWelcomeEmail', () => {
  it('puts the absolute https logo with explicit dimensions at the top of the email', () => {
    const { html } = renderPurchaseWelcomeEmail(base);
    expect(html).toMatch(
      /<img src="https:\/\/www\.chainverify\.org\/chainverify-logo-horizontal\.png" alt="ChainVerify" width="\d+" height="\d+"/,
    );
    expect(html.indexOf('<img')).toBeLessThan(html.indexOf('Your Agent Gate Build plan is active'));
    expect(html).not.toContain('data:image');
    expect(html).not.toContain('.svg');
  });

  it('includes plan, monthly limit, welcome URL, docs and the reply line in html and text', () => {
    const { subject, html, text } = renderPurchaseWelcomeEmail(base);
    expect(subject).toContain('Agent Gate Build');
    for (const body of [html, text]) {
      expect(body).toContain('Your Agent Gate Build plan is active');
      expect(body).toContain('5,000');
      expect(body).toContain('Just reply to this email');
      expect(body).toContain('ChainVerify — independent proof for AI work');
    }
    expect(html).toContain('href="https://www.chainverify.org/agent-gate/welcome?plan=agent-gate-build&amp;session_id=cs_live_abc"');
    expect(html).toContain('Open your welcome page');
    expect(html).toContain('href="https://www.chainverify.org/agent-gate/docs"');
    expect(text).toContain('https://www.chainverify.org/agent-gate/welcome?plan=agent-gate-build&session_id=cs_live_abc');
    expect(text).toContain('https://www.chainverify.org/agent-gate/docs');
    expect(text.length).toBeGreaterThan(100);
  });

  it('is a table-based layout no wider than 600px', () => {
    const { html } = renderPurchaseWelcomeEmail(base);
    expect(html).toContain('max-width:600px');
    expect(html).toContain('<table');
  });

  it('escapes HTML in every interpolated value', () => {
    const { html } = renderPurchaseWelcomeEmail({
      ...base,
      orgName: '<script>alert(1)</script> & "Co"',
      planName: 'Plan <b>X</b>',
      supportEmail: 'a"><img src=x@e.com',
      welcomeUrl: 'https://www.chainverify.org/x?a=1&b="2"',
    });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>X</b>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;Co&quot;');
    expect(html).not.toContain('"><img src=x');
    expect(html).toContain('a=1&amp;b=&quot;2&quot;');
  });

  it('never lists an address in the body; replies go through the reply-to header', () => {
    const { html, text } = renderPurchaseWelcomeEmail({ ...base, supportEmail: 'private-inbox@example.com' });
    expect(html).not.toContain('private-inbox@example.com');
    expect(text).not.toContain('private-inbox@example.com');
    expect(text).toContain('Just reply to this email');
  });

  it('keeps header-injection characters out of the subject', () => {
    const { subject } = renderPurchaseWelcomeEmail({ ...base, planName: 'Evil\r\nBcc: x@y.z' });
    expect(subject).not.toMatch(/[\r\n]/);
  });

  it('never contains an API key or key material', () => {
    const { html, text, subject } = renderPurchaseWelcomeEmail(base);
    for (const part of [html, text, subject]) {
      expect(part).not.toContain('ag_live_');
      expect(part).not.toMatch(/apiKeyHash|sha256/i);
    }
  });

  it('tells Agent Gate buyers the key is shown once and the claim link lasts 24 hours', () => {
    const { html, text } = renderPurchaseWelcomeEmail(base);
    for (const body of [html, text]) {
      expect(body).toContain('shown once on the welcome page');
      expect(body).toContain('24 hours');
    }
  });

  it('omits the key notice for other products and the limit line when there is no limit', () => {
    const { html, text } = renderPurchaseWelcomeEmail({
      ...base,
      productName: 'InvoiceProof',
      planName: 'InvoiceProof Verify',
      monthlyLimit: null,
    });
    for (const body of [html, text]) {
      expect(body).not.toContain('24 hours');
      expect(body).not.toContain('Included usage');
    }
  });

  it('labels InvoiceProof limits as invoices', () => {
    const { text } = renderPurchaseWelcomeEmail({ ...base, productName: 'InvoiceProof', planName: 'InvoiceProof Verify', monthlyLimit: 500 });
    expect(text).toContain('500 invoices per month');
  });
});
