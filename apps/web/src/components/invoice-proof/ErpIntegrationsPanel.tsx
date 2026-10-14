'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { errorMessage, InvoiceProofApiError, invoiceProofApi } from '@/lib/invoice-proof/client';
import type { ErpConnection } from '@/lib/invoice-proof/types';

import { ErpProviderRow } from './ErpProviderRow';
import { useInvoiceProofSession } from './useInvoiceProofSession';

interface ProviderDef {
  id: string;
  label: string;
  status: string;
  /** Providers without an OAuth scaffold cannot start the connect flow. */
  oauth: boolean;
}

const PROVIDERS: ProviderDef[] = [
  { id: 'quickbooks', label: 'QuickBooks', status: 'OAuth scaffold. Sandbox credentials required.', oauth: true },
  { id: 'xero', label: 'Xero', status: 'OAuth scaffold. Sandbox credentials required.', oauth: true },
  { id: 'sage', label: 'Sage', status: 'OAuth scaffold. Sandbox credentials required.', oauth: true },
  { id: 'netsuite', label: 'NetSuite', status: 'Requires manual API key setup. Not available.', oauth: false },
  { id: 'billdotcom', label: 'Bill.com', status: 'Requires manual API key setup. Not available.', oauth: false },
];

export function ErpIntegrationsPanel() {
  const { apiKey, signOut } = useInvoiceProofSession();
  const [connections, setConnections] = useState<ErpConnection[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const handleError = useCallback(
    (err: unknown, fallback: string) => {
      if (err instanceof InvoiceProofApiError && (err.status === 401 || err.status === 403)) {
        signOut('That API key was not accepted. Check the key and try again.');
        return;
      }
      setMessage(errorMessage(err, fallback));
    },
    [signOut],
  );

  useEffect(() => {
    invoiceProofApi
      .listErpConnections(apiKey)
      .then(setConnections)
      .catch((err: unknown) => handleError(err, 'Could not load ERP connections.'));
  }, [apiKey, handleError]);

  async function connect(provider: ProviderDef) {
    setMessage(null);
    try {
      const result = await invoiceProofApi.startErpConnect(apiKey, provider.id);
      if (result.authUrl) {
        window.location.href = result.authUrl;
        return;
      }
      setMessage(result.message ?? 'Connection initiated. Live data import is not enabled yet.');
    } catch (err) {
      handleError(err, `Could not start the ${provider.label} connection.`);
    }
  }

  return (
    <>
      <header>
        <p className="ipa-eyebrow">InvoiceProof</p>
        <h1 className="ipa-title">ERP integrations</h1>
        <p className="ipa-sub">
          Authorize your ERP so vendor master and payment history sync can activate without
          re-authorizing when it launches. No data is imported from any provider today. Use the{' '}
          <Link href="/invoice-proof/settings/data" className="ipa-link">
            CSV data bootstrap
          </Link>{' '}
          to seed vendor and payment context now.
        </p>
      </header>

      <ul className="ipa-list">
        {PROVIDERS.map((provider) => (
          <ErpProviderRow
            key={provider.id}
            label={provider.label}
            statusText={provider.status}
            canConnect={provider.oauth}
            connection={connections.find((c) => c.provider.toLowerCase() === provider.id)}
            onConnect={() => void connect(provider)}
          />
        ))}
      </ul>

      {message ? (
        <p className="ipa-alert" role="status">
          {message}
        </p>
      ) : null}

      <Link href="/invoice-proof/dashboard" className="ipa-link">
        Back to dashboard
      </Link>
    </>
  );
}
