'use client';

import { FormEvent, useState } from 'react';

import { resolveProofApiBase } from '@/lib/proof-api';
import type { ProofProductSlug } from '@/lib/stripe-payment-links';

export interface PurchaseActivationFormProps {
  product: ProofProductSlug;
  planSlug: string;
  sessionId: string;
  /**
   * When provided, the form hands control back to the caller after a successful
   * activation instead of showing its own confirmation (Agent Gate resumes
   * automated provisioning this way).
   */
  onActivated?: (activationId: string) => void;
  submitLabel?: string;
}

export function PurchaseActivationForm({
  product,
  planSlug,
  sessionId,
  onActivated,
  submitLabel = 'Verify payment & activate',
}: PurchaseActivationFormProps) {
  const [companyName, setCompanyName] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [state, setState] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [activationId, setActivationId] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === 'submitting') return;

    setState('submitting');
    setMessage('');

    try {
      const response = await fetch(`${resolveProofApiBase()}/api/billing/proof/activate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          product,
          planSlug,
          sessionId,
          companyName,
          contactName,
          contactEmail,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; activationId?: string; message?: string; error?: string }
        | null;

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.message || payload?.error || 'Activation could not be verified.');
      }

      setActivationId(payload.activationId || '');
      setState('success');
      onActivated?.(payload.activationId || '');
      setMessage(
        'Your Stripe payment was verified and your activation request was recorded. We’ll use the checkout email to connect the purchase to your ChainVerify access.',
      );
    } catch (error) {
      setState('error');
      setMessage(
        error instanceof Error
          ? error.message
          : 'Activation could not be completed. Check the email and try again.',
      );
    }
  }

  if (state === 'success') {
    return (
      <div className="pm-activation-success" role="status">
        <div className="pm-activation-check">✓</div>
        <div>
          <h2>Purchase verified.</h2>
          <p>{message}</p>
          {activationId ? <code>Activation reference: {activationId}</code> : null}
        </div>
      </div>
    );
  }

  return (
    <form className="pm-activation-form" onSubmit={submit}>
      <div className="pm-activation-field">
        <label htmlFor="company-name">Company or organization</label>
        <input
          id="company-name"
          name="companyName"
          value={companyName}
          onChange={(event) => setCompanyName(event.target.value)}
          autoComplete="organization"
          maxLength={200}
          required
        />
      </div>

      <div className="pm-activation-field">
        <label htmlFor="contact-name">Your name <span>optional</span></label>
        <input
          id="contact-name"
          name="contactName"
          value={contactName}
          onChange={(event) => setContactName(event.target.value)}
          autoComplete="name"
          maxLength={160}
        />
      </div>

      <div className="pm-activation-field">
        <label htmlFor="contact-email">Stripe checkout email</label>
        <input
          id="contact-email"
          name="contactEmail"
          type="email"
          value={contactEmail}
          onChange={(event) => setContactEmail(event.target.value)}
          autoComplete="email"
          required
        />
        <small>Use the same email address entered during Stripe checkout.</small>
      </div>

      <button className="pm-btn pm-btn-primary pm-activation-submit" type="submit" disabled={state === 'submitting'}>
        {state === 'submitting' ? 'Verifying purchase…' : submitLabel}
      </button>

      {state === 'error' ? <p className="pm-activation-error" role="alert">{message}</p> : null}
    </form>
  );
}

export default PurchaseActivationForm;
