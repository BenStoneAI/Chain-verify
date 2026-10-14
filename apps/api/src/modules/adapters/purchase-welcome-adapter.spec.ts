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

describe('SmtpOutboundEmailAdapter.sendPurchaseWelcome', () => {
  const saved = process.env.SMTP_HOST;
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => {
    if (saved === undefined) delete process.env.SMTP_HOST;
    else process.env.SMTP_HOST = saved;
  });

  it('with no SMTP configured logs once and returns without throwing or opening a transport', async () => {
    delete process.env.SMTP_HOST;
    const create = vi.spyOn(nodemailer, 'createTransport');
    const adapter = new SmtpOutboundEmailAdapter();
    const warn = vi.spyOn((adapter as any).logger, 'warn').mockImplementation(() => undefined);
    await expect(adapter.sendPurchaseWelcome(input)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
  });

  it('with SMTP configured sends an html + text message with the logo and reply-to support', async () => {
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
});
