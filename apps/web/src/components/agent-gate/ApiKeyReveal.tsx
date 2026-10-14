'use client';

import Link from 'next/link';

import type { KeyState } from '@/lib/agentGateProvisioning';

import { CopyButton } from './CopyButton';

export interface ApiKeyRevealProps {
  keyState: KeyState;
  /** Prefix the server reported for an already-issued key (from provision-status). */
  knownKeyPrefix?: string;
  onReveal: () => void;
}

function prefixLabel(prefix: string | null | undefined): string {
  return prefix ? ` (${prefix}…)` : '';
}

function reload(): void {
  window.location.reload();
}

/** The one-time API key panel. The plaintext key lives only in `keyState` (React memory). */
export function ApiKeyReveal({ keyState, knownKeyPrefix, onReveal }: ApiKeyRevealProps) {
  switch (keyState.kind) {
    case 'idle':
    case 'claiming':
      return (
        <div className="ag-panel">
          <h2>Your API key</h2>
          <p className="ag-note">
            Your key is shown once. Reveal it when you are ready to store it in a password manager
            or secret store.
            {knownKeyPrefix
              ? ` A key starting ${knownKeyPrefix}… exists for this purchase; if it was already shown, it cannot be shown again.`
              : ''}
          </p>
          <div className="ag-actions">
            <button
              type="button"
              className="pm-btn pm-btn-primary"
              onClick={onReveal}
              disabled={keyState.kind === 'claiming'}
              aria-busy={keyState.kind === 'claiming'}
            >
              {keyState.kind === 'claiming' ? 'Revealing…' : 'Reveal API key'}
            </button>
          </div>
        </div>
      );

    case 'revealed':
      return (
        <div className="ag-panel ag-panel-warning">
          <h2>Your API key</h2>
          <label className="ag-note" htmlFor="ag-api-key">
            Agent Gate API key
          </label>
          <div className="ag-field-row">
            <input
              id="ag-api-key"
              className="ag-key-input"
              type="text"
              readOnly
              value={keyState.apiKey}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-1p-ignore="true"
              data-lpignore="true"
              onFocus={(event) => event.currentTarget.select()}
            />
            <CopyButton text={keyState.apiKey} label="Copy API key" className="pm-btn pm-btn-primary" />
          </div>
          <p className="ag-note ag-warn" role="alert">
            Copy this key now. For security, Chain Verify will not display it again.
          </p>
        </div>
      );

    case 'already_issued':
      return (
        <div className="ag-panel" role="status">
          <h2>Your API key</h2>
          <p className="ag-note">
            A key was already issued for this purchase{prefixLabel(keyState.keyPrefix ?? knownKeyPrefix)}.
            Keys cannot be shown again.
          </p>
          <p className="ag-note">
            Reloading this page is safe: it never creates another key. If you no longer have the
            key, <Link className="ag-link" href="/contact">contact support</Link> to have it replaced.
          </p>
        </div>
      );

    case 'expired':
      return (
        <div className="ag-panel ag-panel-error" role="alert">
          <h2>Your API key</h2>
          <p className="ag-note">
            The window to reveal the key for this purchase has expired, and keys cannot be shown
            again. <Link className="ag-link" href="/contact">Contact support</Link> to have a
            replacement key issued.
          </p>
        </div>
      );

    case 'cleared':
      return (
        <div className="ag-panel" role="status">
          <h2>Your API key</h2>
          <p className="ag-note">
            The key is no longer displayed and cannot be shown again. If you did not save it,{' '}
            <Link className="ag-link" href="/contact">contact support</Link> for a replacement.
          </p>
        </div>
      );

    case 'error':
      return (
        <div className="ag-panel ag-panel-error" role="alert">
          <h2>Your API key</h2>
          <p className="ag-note">{keyState.message}</p>
          <p className="ag-note">
            Nothing was displayed. Reload this page to try again. If a key was already issued it
            cannot be shown again, and reloading will never create a second one.
          </p>
          <div className="ag-actions">
            <button type="button" className="pm-btn pm-btn-secondary" onClick={reload}>
              Reload page
            </button>
            <Link className="pm-btn pm-btn-secondary" href="/contact">
              Contact support
            </Link>
          </div>
        </div>
      );
  }
}

export default ApiKeyReveal;
