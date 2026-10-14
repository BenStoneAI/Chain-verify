'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { errorMessage, InvoiceProofApiError, invoiceProofApi } from '@/lib/invoice-proof/client';
import type { InvoiceProofUsage, ProofRecordSummary, ScanSummary } from '@/lib/invoice-proof/types';

import { DashboardStats } from './DashboardStats';
import { ProofRecordsTable } from './ProofRecordsTable';
import { ScanHistoryTable } from './ScanHistoryTable';
import { UsageMeter } from './UsageMeter';
import { useInvoiceProofSession } from './useInvoiceProofSession';

export function InvoiceProofDashboard() {
  const { apiKey, signOut } = useInvoiceProofSession();
  const [scans, setScans] = useState<ScanSummary[]>([]);
  const [usage, setUsage] = useState<InvoiceProofUsage | null>(null);
  const [proofs, setProofs] = useState<ProofRecordSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextScans, nextUsage, nextProofs] = await Promise.all([
        invoiceProofApi.listScans(apiKey),
        invoiceProofApi.getUsage(apiKey).catch(() => null),
        invoiceProofApi.listProofRecords(apiKey).catch(() => [] as ProofRecordSummary[]),
      ]);
      setScans(nextScans);
      setUsage(nextUsage);
      setProofs(nextProofs);
    } catch (err) {
      if (err instanceof InvoiceProofApiError && (err.status === 401 || err.status === 403)) {
        signOut('That API key was not accepted. Check the key and try again.');
        return;
      }
      setError(errorMessage(err, 'Dashboard could not load. Try refreshing.'));
    } finally {
      setLoading(false);
    }
  }, [apiKey, signOut]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <header className="ipa-head">
        <div>
          <p className="ipa-eyebrow">InvoiceProof</p>
          <h1 className="ipa-title">Dashboard</h1>
          <p className="ipa-sub">Scan history, usage, and proof exports for your organization.</p>
        </div>
        <div className="ipa-actions">
          <Link className="ipa-btn ipa-btn-primary" href="/invoice-proof/scan">
            New scan
          </Link>
          <Link className="ipa-btn" href="/invoice-proof/settings/data">
            Data and integrations
          </Link>
          <button type="button" className="ipa-btn" onClick={() => void load()} disabled={loading}>
            {loading ? 'Loading...' : 'Refresh'}
          </button>
          <button type="button" className="ipa-btn" onClick={() => signOut()}>
            Sign out
          </button>
        </div>
      </header>

      {error ? (
        <p className="ipa-alert ipa-alert-error" role="alert">
          {error}
        </p>
      ) : null}

      {usage ? <UsageMeter usage={usage} /> : null}
      <DashboardStats scans={scans} />

      <section className="ipa-card" aria-labelledby="ipa-history">
        <h2 id="ipa-history">Scan history</h2>
        {loading ? (
          <p className="ipa-muted" aria-live="polite">Loading scans...</p>
        ) : scans.length === 0 ? (
          <div className="ipa-empty">
            <p className="ipa-muted">No scans yet. Run your first invoice scan and it will appear here.</p>
            <Link className="ipa-btn ipa-btn-primary" href="/invoice-proof/scan">
              Start invoice scan
            </Link>
          </div>
        ) : (
          <ScanHistoryTable scans={scans} />
        )}
      </section>

      {proofs.length > 0 ? (
        <section className="ipa-card" aria-labelledby="ipa-proofs">
          <h2 id="ipa-proofs">Proof records</h2>
          <ProofRecordsTable apiKey={apiKey} records={proofs} />
        </section>
      ) : null}
    </>
  );
}
