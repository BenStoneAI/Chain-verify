'use client';

import { useState } from 'react';

import { errorMessage, invoiceProofApi } from '@/lib/invoice-proof/client';
import type { ProofRecordSummary } from '@/lib/invoice-proof/types';

import { RiskBadge } from './RiskBadge';

export interface ProofRecordsTableProps {
  apiKey: string;
  records: ProofRecordSummary[];
}

export function ProofRecordsTable({ apiKey, records }: ProofRecordsTableProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function download(id: string, format: 'pdf' | 'json') {
    setBusy(`${id}-${format}`);
    setError(null);
    try {
      await invoiceProofApi.downloadProofExport(apiKey, id, format);
    } catch (err) {
      setError(errorMessage(err, 'Export failed. Please try again.'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {error ? (
        <p className="ipa-alert ipa-alert-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="ipa-table-wrap">
        <table className="ipa-table">
          <caption className="ipa-sr-only">Invoice proof records</caption>
          <thead>
            <tr>
              <th scope="col">Proof</th>
              <th scope="col">Subject</th>
              <th scope="col">Risk</th>
              <th scope="col">Issues</th>
              <th scope="col">Export</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <tr key={record.id}>
                <td className="ipa-mono">{record.id.slice(0, 8)}</td>
                <td>{record.subject ?? record.summary ?? '-'}</td>
                <td>
                  <RiskBadge risk={record.riskLevel} />
                </td>
                <td>{record.issuesFound}</td>
                <td>
                  <div className="ipa-actions">
                    {(['pdf', 'json'] as const).map((format) => (
                      <button
                        key={format}
                        type="button"
                        className="ipa-btn ipa-btn-sm"
                        disabled={busy === `${record.id}-${format}`}
                        onClick={() => void download(record.id, format)}
                      >
                        {busy === `${record.id}-${format}` ? '...' : format.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
