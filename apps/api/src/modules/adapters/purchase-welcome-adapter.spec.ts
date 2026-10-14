import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import nodemailer from 'nodemailer';
import { SmtpOutboundEmailAdapter } from './adapters.module.js';

const input = {
  to: 'buyer@example.com',
  orgName: 'ChainVerify E2E Test',
  productName: 'Agent Gate',
  planName: 'Agent Gate Build',
  monthlyLimit: 5000,
  welcomeUrl: 'https://www.chainverify.org/agent-gate/welcome?plan=agent-gate-build&session_id=cs_live_abc',
  docsUrl: 'https://www.chainverify.org/agent-gate/docs',
  supportEmail: 'proof@chainverify.org',
};

const ENV_KEYS = ['BREVO_API_KEY', 'SMTP_HOST', 'EMAIL_FROM_ADDRESS', 'EMAIL_FROM_NAME', 'EMAIL_REPLY_TO'] as const;

describe('SmtpOutboundEmailAdapter.sendPurchaseWelcome', () => {
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

  it('with no transport configured logs once and throws so the caller can release its claim', async () => {
    const create = vi.spyOn(nodemailer, 'createTransport');
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as any;
    const adapter = new SmtpOutboundEmailAdapter();
    const warn = vi.spyOn((adapter as any).logger, 'warn').mockImplementation(() => undefined);
    await expect(adapter.sendPurchaseWelcome(input)).rejects.toThrow('Email transport not configured');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe('Brevo REST transport', () => {
    it('posts the rendered email to the Brevo API with defaults', async () => {
      process.env.BREVO_API_KEY = 'xkeysib-test-key';
      const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ messageId: '<1@x>' }), { status: 201 }));
      globalThis.fetch = fetchMock as any;
      const create = vi.spyOn(nodemailer, 'createTransport');

      await new SmtpOutboundEmailAdapter().sendPurchaseWelcome(input);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.brevo.com/v3/smtp/email');
      expect(init.method).toBe('POST');
      expect(init.headers).toEqual({
        'api-key': 'xkeysib-test-key',
        'content-type': 'application/json',
        accept: 'application/json',
      });
      const body = JSON.parse(init.body);
      expect(body.sender).toEqual({ email: 'welcome@chainverify.org', name: 'ChainVerify' });
      expect(body.to).toEqual([{ email: 'buyer@example.com' }]);
      expect(body.replyTo).toEqual({ email: 'proof@chainverify.org' });
      expect(body.subject).toBe('Welcome to Agent Gate — your Agent Gate Build plan is active');
      expect(body.htmlContent).toContain('chainverify-logo-horizontal.png');
      expect(body.htmlContent).not.toContain('ag_live_');
      expect(body.textContent).toContain('Open your welcome page');
      expect(create).not.toHaveBeenCalled();
    });

    it('honours EMAIL_FROM_ADDRESS, EMAIL_FROM_NAME and EMAIL_REPLY_TO', async () => {
      process.env.BREVO_API_KEY = 'k';
      process.env.EMAIL_FROM_ADDRESS = 'hello@example.org';
      process.env.EMAIL_FROM_NAME = 'Example';
      process.env.EMAIL_REPLY_TO = 'reply@example.org';
      const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }));
      globalThis.fetch = fetchMock as any;
      await new SmtpOutboundEmailAdapter().sendPurchaseWelcome(input);
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.sender).toEqual({ email: 'hello@example.org', name: 'Example' });
      expect(body.replyTo).toEqual({ email: 'reply@example.org' });
    });

    it('takes precedence over SMTP when both are configured', async () => {
      process.env.BREVO_API_KEY = 'k';
      process.env.SMTP_HOST = 'smtp.example.test';
      globalThis.fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 201 })) as any;
      const create = vi.spyOn(nodemailer, 'createTransport');
      await new SmtpOutboundEmailAdapter().sendPurchaseWelcome(input);
      expect(create).not.toHaveBeenCalled();
    });

    it('throws with the status and Brevo message (truncated) on a non-2xx response, without leaking the key', async () => {
      process.env.BREVO_API_KEY = 'xkeysib-secret';
      const long = 'x'.repeat(500);
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ code: 'unauthorized', message: long }), { status: 401 })) as any;
      const err = await new SmtpOutboundEmailAdapter().sendPurchaseWelcome(input).catch((e) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toContain('401');
      expect(err.message).toContain('x'.repeat(200));
      expect(err.message).not.toContain('x'.repeat(201));
      expect(err.message).not.toContain('xkeysib-secret');
    });

    it('still throws with the status when the error body is not JSON', async () => {
      process.env.BREVO_API_KEY = 'k';
      globalThis.fetch = vi.fn().mockResolvedValue(new Response('<html>bad gateway</html>', { status: 502 })) as any;
      await expect(new SmtpOutboundEmailAdapter().sendPurchaseWelcome(input)).rejects.toThrow('502');
    });

    it('propagates network failures', async () => {
      process.env.BREVO_API_KEY = 'k';
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('network down')) as any;
      await expect(new SmtpOutboundEmailAdapter().sendPurchaseWelcome(input)).rejects.toThrow('network down');
    });
  });

  describe('SMTP transport', () => {
    it('sends an html + text message with the logo and reply-to support', async () => {
      process.env.SMTP_HOST = 'smtp.example.test';
      const sendMail = vi.fn().mockResolvedValue({});
      vi.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail } as any);
      await new SmtpOutboundEmailAdapter().sendPurchaseWelcome(input);
      expect(sendMail).toHaveBeenCalledTimes(1);
      const mail = sendMail.mock.calls[0][0];
      expect(mail.to).toBe('buyer@example.com');
      expect(mail.replyTo).toBe('proof@chainverify.org');
      expect(mail.html).toContain('chainverify-logo-horizontal.png');
      expect(mail.text).toContain('Open your welcome page');
      expect(mail.html).not.toContain('ag_live_');
    });

    it('uses EMAIL_REPLY_TO when set', async () => {
      process.env.SMTP_HOST = 'smtp.example.test';
      process.env.EMAIL_REPLY_TO = 'reply@example.org';
      const sendMail = vi.fn().mockResolvedValue({});
      vi.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail } as any);
      await new SmtpOutboundEmailAdapter().sendPurchaseWelcome(input);
      expect(sendMail.mock.calls[0][0].replyTo).toBe('reply@example.org');
    });
  });
});
