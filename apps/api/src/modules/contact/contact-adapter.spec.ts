import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import nodemailer from 'nodemailer';

import { SmtpOutboundEmailAdapter } from '../adapters/adapters.module.js';
import { renderContactEmail } from './contact-email.js';

const input = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  company: 'Analytical Engines',
  topic: 'security' as const,
  message: 'Found an issue.\nSecond line with <b>markup</b> & "quotes".',
  submittedAt: new Date('2026-10-14T12:00:00.000Z'),
};

const ENV_KEYS = ['BREVO_API_KEY', 'SMTP_HOST', 'EMAIL_FROM_ADDRESS', 'EMAIL_FROM_NAME', 'EMAIL_REPLY_TO', 'CONTACT_INBOX'] as const;

describe('SmtpOutboundEmailAdapter.sendContactMessage', () => {
  const saved: Record<string, string | undefined> = {};
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    globalThis.fetch = realFetch;
  });

  it('throws without any transport and does not call the network', async () => {
    process.env.CONTACT_INBOX = 'inbox@owner.example';
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as any;
    const adapter = new SmtpOutboundEmailAdapter();
    vi.spyOn((adapter as any).logger, 'warn').mockImplementation(() => undefined);
    await expect(adapter.sendContactMessage(input)).rejects.toThrow('Email transport not configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws when no recipient is configured', async () => {
    process.env.BREVO_API_KEY = 'k';
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as any;
    const adapter = new SmtpOutboundEmailAdapter();
    vi.spyOn((adapter as any).logger, 'warn').mockImplementation(() => undefined);
    await expect(adapter.sendContactMessage(input)).rejects.toThrow('Contact recipient not configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts to Brevo with the inbox as recipient, the visitor as replyTo and the contact subject', async () => {
    process.env.BREVO_API_KEY = 'xkeysib-test';
    process.env.CONTACT_INBOX = 'inbox@owner.example';
    process.env.EMAIL_REPLY_TO = 'other@owner.example';
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }));
    globalThis.fetch = fetchMock as any;

    await new SmtpOutboundEmailAdapter().sendContactMessage(input);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    const body = JSON.parse(init.body);
    expect(body.to).toEqual([{ email: 'inbox@owner.example' }]);
    expect(body.replyTo).toEqual({ email: 'ada@example.com', name: 'Ada Lovelace' });
    expect(body.sender).toEqual({ email: 'welcome@chainverify.org', name: 'ChainVerify' });
    expect(body.subject).toBe('[ChainVerify contact] security — Ada Lovelace');
    expect(body.textContent).toContain('Submitted at: 2026-10-14T12:00:00.000Z');
    expect(body.textContent).toContain('Company: Analytical Engines');
    expect(body.htmlContent).toContain('&lt;b&gt;markup&lt;/b&gt; &amp; &quot;quotes&quot;');
    expect(body.htmlContent).not.toContain('<b>markup</b>');
  });

  it('falls back to EMAIL_REPLY_TO when CONTACT_INBOX is unset', async () => {
    process.env.BREVO_API_KEY = 'k';
    process.env.EMAIL_REPLY_TO = 'reply@owner.example';
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }));
    globalThis.fetch = fetchMock as any;
    await new SmtpOutboundEmailAdapter().sendContactMessage(input);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).to).toEqual([{ email: 'reply@owner.example' }]);
  });

  it('strips header-injection characters from the subject', async () => {
    process.env.BREVO_API_KEY = 'k';
    process.env.CONTACT_INBOX = 'inbox@owner.example';
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }));
    globalThis.fetch = fetchMock as any;
    await new SmtpOutboundEmailAdapter().sendContactMessage({
      ...input,
      name: 'Eve\r\nBcc: attacker@evil.example\u2028X',
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.subject).not.toMatch(/[\r\n\u2028]/);
    expect(body.replyTo.name).not.toMatch(/[\r\n\u2028]/);
  });

  it('throws a status-only error on a non-2xx Brevo response without echoing the body or key', async () => {
    process.env.BREVO_API_KEY = 'xkeysib-secret';
    process.env.CONTACT_INBOX = 'inbox@owner.example';
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ message: 'bad recipient inbox@owner.example' }), { status: 400 })) as any;
    const err = await new SmtpOutboundEmailAdapter().sendContactMessage(input).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Brevo send failed: HTTP 400');
    expect(err.message).not.toContain('inbox@owner.example');
    expect(err.message).not.toContain('xkeysib-secret');
  });

  it('sends through SMTP when only SMTP is configured', async () => {
    process.env.SMTP_HOST = 'smtp.example.test';
    process.env.CONTACT_INBOX = 'inbox@owner.example';
    const sendMail = vi.fn().mockResolvedValue({});
    vi.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail } as any);
    await new SmtpOutboundEmailAdapter().sendContactMessage(input);
    const mail = sendMail.mock.calls[0][0];
    expect(mail.to).toBe('inbox@owner.example');
    expect(mail.replyTo).toBe('ada@example.com');
    expect(mail.subject).toBe('[ChainVerify contact] security — Ada Lovelace');
  });
});

describe('renderContactEmail', () => {
  it('includes every field in both text and html', () => {
    const { text, html } = renderContactEmail(input);
    for (const body of [text, html]) {
      expect(body).toContain('Ada Lovelace');
      expect(body).toContain('ada@example.com');
      expect(body).toContain('Analytical Engines');
      expect(body).toContain('security');
      expect(body).toContain('2026-10-14T12:00:00.000Z');
    }
  });
});
