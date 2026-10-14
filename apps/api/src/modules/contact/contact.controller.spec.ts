import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ContactController } from './contact.controller.js';

const INBOX = 'private-inbox@owner.example';

const valid = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  company: 'Analytical Engines',
  topic: 'sales',
  message: 'We would like a pilot of Agent Gate for our delivery pipeline.',
  website: '',
};

function build(send = vi.fn().mockResolvedValue(undefined)) {
  const controller = new ContactController({ sendContactMessage: send } as never);
  return { controller, send };
}

describe('ContactController.submit', () => {
  beforeEach(() => {
    process.env.CONTACT_INBOX = INBOX;
  });

  it('sends a valid submission once with the visitor as the reply address', async () => {
    const { controller, send } = build();
    const result = await controller.submit({ ...valid });
    expect(result).toEqual({ ok: true });
    expect(send).toHaveBeenCalledTimes(1);
    const arg = send.mock.calls[0][0];
    expect(arg).toMatchObject({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      company: 'Analytical Engines',
      topic: 'sales',
    });
    expect(arg.submittedAt).toBeInstanceOf(Date);
  });

  it('accepts a submission without a company', async () => {
    const { controller, send } = build();
    const { company: _company, ...rest } = valid;
    await expect(controller.submit(rest)).resolves.toEqual({ ok: true });
    expect(send.mock.calls[0][0].company).toBeUndefined();
  });

  it('short-circuits with 200 ok and sends nothing when the honeypot is filled', async () => {
    const { controller, send } = build();
    const result = await controller.submit({ ...valid, website: 'https://spam.example' });
    expect(result).toEqual({ ok: true });
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    ['bad email', { email: 'not-an-email' }],
    ['email over 200 chars', { email: `${'a'.repeat(195)}@x.io` }],
    ['short message', { message: 'too short' }],
    ['message over 5000 chars', { message: 'x'.repeat(5001) }],
    ['unknown topic', { topic: 'billing' }],
    ['empty name', { name: '' }],
    ['name over 100 chars', { name: 'n'.repeat(101) }],
    ['company over 120 chars', { company: 'c'.repeat(121) }],
    ['non-string message', { message: 12345678901 }],
  ])('rejects %s with 400 and sends nothing', async (_label, patch) => {
    const { controller, send } = build();
    await expect(controller.submit({ ...valid, ...patch })).rejects.toBeInstanceOf(BadRequestException);
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects an empty or non-object body with 400', async () => {
    const { controller, send } = build();
    await expect(controller.submit(undefined)).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.submit('hello')).rejects.toBeInstanceOf(BadRequestException);
    expect(send).not.toHaveBeenCalled();
  });

  it('maps a send failure to 503 with the fixed message and never exposes the inbox', async () => {
    const send = vi.fn().mockRejectedValue(new Error(`Brevo rejected recipient ${INBOX}`));
    const { controller } = build(send);
    const err = await controller.submit({ ...valid }).catch((e) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect(err.getStatus()).toBe(503);
    expect(err.getResponse()).toEqual({ message: 'Message could not be sent. Please try again shortly.' });
    expect(JSON.stringify(err.getResponse())).not.toContain(INBOX);
  });

  it('logs only the topic on failure: no message body, name, email or inbox', async () => {
    const send = vi.fn().mockRejectedValue(new Error(`boom ${INBOX}`));
    const { controller } = build(send);
    const warn = vi.spyOn((controller as any).logger, 'warn').mockImplementation(() => undefined);
    await controller.submit({ ...valid }).catch(() => undefined);
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = String(warn.mock.calls[0][0]);
    expect(logged).toContain('sales');
    for (const secret of [INBOX, valid.message, valid.name, valid.email, valid.company]) {
      expect(logged).not.toContain(secret);
    }
  });

  it('never returns the inbox address on success', async () => {
    const { controller } = build();
    const result = await controller.submit({ ...valid });
    expect(JSON.stringify(result)).not.toContain(INBOX);
  });
});
