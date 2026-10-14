'use client';

import { useState, type FormEvent } from 'react';

import { postVendorPortal } from '@/lib/invoice-proof/vendor-portal';

export interface VendorPortalFormProps {
  orgSlug: string;
  token: string;
}

type Step = 'form' | 'otp-sent' | 'done';

export function VendorPortalForm({ orgSlug, token }: VendorPortalFormProps) {
  const [routing, setRouting] = useState('');
  const [last4, setLast4] = useState('');
  const [address, setAddress] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<Step>('form');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const base = `${encodeURIComponent(orgSlug)}/${encodeURIComponent(token)}`;

  async function guarded(action: () => Promise<void>, fallback: string) {
    setLoading(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : fallback);
    } finally {
      setLoading(false);
    }
  }

  function requestOtp() {
    void guarded(async () => {
      await postVendorPortal(`${base}/request-otp`);
      setStep('otp-sent');
    }, 'Failed to send verification code');
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void guarded(async () => {
      await postVendorPortal(base, {
        bankRoutingNumber: routing,
        bankAccountLast4: last4,
        remitAddress: address,
        otpCode: otp.trim(),
      });
      setStep('done');
    }, 'Submit failed');
  }

  return (
    <div className="ipa-gate">
      <form className="ipa-card ipa-gate-card" onSubmit={submit} aria-labelledby="ipa-vp-title">
        <p className="ipa-eyebrow">InvoiceProof</p>
        <h1 id="ipa-vp-title">Vendor banking verification</h1>

        {step === 'done' ? (
          <p className="ipa-alert ipa-alert-ok" role="status">
            Banking details submitted and verified successfully.
          </p>
        ) : (
          <>
            <p className="ipa-sub">
              Update your remittance details below. We will email a one-time code to the address on
              file for your vendor record to confirm the change.
            </p>
            <div className="ipa-field">
              <label className="ipa-label" htmlFor="ipa-vp-routing">Bank routing number</label>
              <input id="ipa-vp-routing" className="ipa-input" required autoComplete="off" value={routing} onChange={(e) => setRouting(e.target.value)} />
            </div>
            <div className="ipa-field">
              <label className="ipa-label" htmlFor="ipa-vp-last4">Account last 4</label>
              <input id="ipa-vp-last4" className="ipa-input" autoComplete="off" maxLength={4} value={last4} onChange={(e) => setLast4(e.target.value)} />
            </div>
            <div className="ipa-field">
              <label className="ipa-label" htmlFor="ipa-vp-address">Remit address</label>
              <input id="ipa-vp-address" className="ipa-input" autoComplete="street-address" value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>

            {step === 'form' ? (
              <button type="button" className="ipa-btn" onClick={requestOtp} disabled={loading || !routing}>
                {loading ? 'Sending...' : 'Send me a one-time code'}
              </button>
            ) : (
              <>
                <p className="ipa-alert ipa-alert-ok">
                  A 6-digit verification code was sent to the email address on file. Enter it to confirm the change.
                </p>
                <div className="ipa-field">
                  <label className="ipa-label" htmlFor="ipa-vp-otp">Verification code</label>
                  <input
                    id="ipa-vp-otp"
                    className="ipa-input ipa-input-otp"
                    required
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  />
                </div>
                <button type="submit" className="ipa-btn ipa-btn-primary" disabled={loading || otp.length !== 6}>
                  {loading ? 'Verifying...' : 'Verify and submit bank change'}
                </button>
                <button type="button" className="ipa-btn ipa-btn-sm" onClick={requestOtp} disabled={loading}>
                  Resend code
                </button>
              </>
            )}
          </>
        )}

        {error ? (
          <p className="ipa-alert ipa-alert-error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </div>
  );
}
