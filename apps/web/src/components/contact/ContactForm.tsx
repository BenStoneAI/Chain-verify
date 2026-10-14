'use client';

import { FormEvent, useState } from 'react';

import { resolveProofApiBase } from '@/lib/proof-api';

import {
  CONTACT_FALLBACK_ERROR,
  CONTACT_LIMITS,
  CONTACT_TOPIC_OPTIONS,
  type ContactStatus,
  type ContactTopic,
} from './contact-form-config';
import './contact-form.css';

export interface ContactFormProps {
  /** Pre-selects the topic, e.g. when linked from a security or sales page. */
  defaultTopic?: ContactTopic;
}

export function ContactForm({ defaultTopic = 'sales' }: ContactFormProps) {
  const [status, setStatus] = useState<ContactStatus>('idle');
  const [message, setMessage] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === 'sending') return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const field = (key: string) => String(data.get(key) ?? '');

    setStatus('sending');
    setMessage('');
    try {
      const response = await fetch(`${resolveProofApiBase()}/api/contact`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: field('name').trim(),
          email: field('email').trim(),
          company: field('company').trim() || undefined,
          topic: field('topic'),
          message: field('message').trim(),
          website: field('website'),
        }),
      });
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(
          response.status === 400
            ? 'Please check every field and try again.'
            : response.status === 429
              ? 'Too many messages from this connection. Please try again in a few minutes.'
              : CONTACT_FALLBACK_ERROR,
        );
      }
      form.reset();
      setStatus('success');
      setMessage('Thanks. Your message was sent and we will reply to the email address you gave us.');
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : CONTACT_FALLBACK_ERROR);
    }
  }

  const sending = status === 'sending';

  return (
    <form className="cv-contact-form" onSubmit={submit} aria-busy={sending}>
      <div className="cv-contact-field">
        <label htmlFor="contact-name">Your name</label>
        <input id="contact-name" name="name" type="text" required maxLength={CONTACT_LIMITS.name} autoComplete="name" disabled={sending} />
      </div>
      <div className="cv-contact-field">
        <label htmlFor="contact-email">Your email</label>
        <input id="contact-email" name="email" type="email" required maxLength={CONTACT_LIMITS.email} autoComplete="email" disabled={sending} />
        <small>We reply to this address. It is never shown publicly.</small>
      </div>
      <div className="cv-contact-field">
        <label htmlFor="contact-company">Company <span>(optional)</span></label>
        <input id="contact-company" name="company" type="text" maxLength={CONTACT_LIMITS.company} autoComplete="organization" disabled={sending} />
      </div>
      <div className="cv-contact-field">
        <label htmlFor="contact-topic">Topic</label>
        <select id="contact-topic" name="topic" required defaultValue={defaultTopic} disabled={sending}>
          {CONTACT_TOPIC_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>
      <div className="cv-contact-field cv-contact-wide">
        <label htmlFor="contact-message">Message</label>
        <textarea
          id="contact-message"
          name="message"
          required
          rows={7}
          minLength={CONTACT_LIMITS.messageMin}
          maxLength={CONTACT_LIMITS.messageMax}
          disabled={sending}
        />
        <small>Include the product, plan, and any proof ID or request ID. Do not send passwords, API keys, or card numbers.</small>
      </div>
      <div className="cv-contact-trap" aria-hidden="true">
        <label htmlFor="contact-website">Leave this field empty</label>
        <input id="contact-website" name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>
      <button type="submit" className="cv-contact-submit" disabled={sending}>
        {sending ? 'Sending…' : 'Send message'}
      </button>
      <p
        className={`cv-contact-status${status === 'error' ? ' is-error' : ''}${status === 'success' ? ' is-success' : ''}`}
        role={status === 'error' ? 'alert' : 'status'}
        aria-live="polite"
      >
        {message}
      </p>
    </form>
  );
}

export default ContactForm;
