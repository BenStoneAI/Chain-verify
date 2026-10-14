'use client';

import Link from 'next/link';
import { useState } from 'react';

import { errorMessage, InvoiceProofApiError, invoiceProofApi } from '@/lib/invoice-proof/client';
import type { ImportKind } from '@/lib/invoice-proof/types';

import { CsvImportSection } from './CsvImportSection';
import { useInvoiceProofSession } from './useInvoiceProofSession';

const SECTIONS: Array<{ kind: ImportKind; title: string; placeholder: string; button: string }> = [
  {
    kind: 'vendor',
    title: 'Vendor master',
    placeholder: 'vendorName,city,state,bankRoutingNumber,bankAccountLast4',
    button: 'Import vendors',
  },
  {
    kind: 'po',
    title: 'Open PO register',
    placeholder: 'poNumber,vendorName,authorizedAmount',
    button: 'Import POs',
  },
  {
    kind: 'payment',
    title: 'Payment history',
    placeholder: 'invoiceNo,vendor,amount,poNumber,paidAt',
    button: 'Import payment history',
  },
];

const KIND_LABELS: Record<ImportKind, string> = {
  vendor: 'Vendor',
  po: 'PO',
  payment: 'Payment history',
};

export function DataImportPanel() {
  const { apiKey, signOut } = useInvoiceProofSession();
  const [values, setValues] = useState<Record<ImportKind, string>>({ vendor: '', po: '', payment: '' });
  const [busy, setBusy] = useState<ImportKind | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  async function runImport(kind: ImportKind) {
    setBusy(kind);
    setStatus(null);
    try {
      const result = await invoiceProofApi.importCsv(apiKey, kind, values[kind]);
      setStatus({ ok: true, text: `${KIND_LABELS[kind]} import complete: ${result.imported} rows.` });
    } catch (err) {
      if (err instanceof InvoiceProofApiError && (err.status === 401 || err.status === 403)) {
        signOut('That API key was not accepted. Check the key and try again.');
        return;
      }
      setStatus({ ok: false, text: errorMessage(err, 'Import failed.') });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <header>
        <p className="ipa-eyebrow">InvoiceProof</p>
        <h1 className="ipa-title">Data bootstrap</h1>
        <p className="ipa-sub">
          Upload CSV exports of your vendor master, open POs, and payment history so scans have full
          context from day one.
        </p>
      </header>

      {SECTIONS.map((section) => (
        <CsvImportSection
          key={section.kind}
          title={section.title}
          placeholder={section.placeholder}
          buttonLabel={section.button}
          value={values[section.kind]}
          busy={busy === section.kind}
          onChange={(next) => setValues((prev) => ({ ...prev, [section.kind]: next }))}
          onImport={() => void runImport(section.kind)}
        />
      ))}

      {status ? (
        <p className={`ipa-alert ${status.ok ? 'ipa-alert-ok' : 'ipa-alert-error'}`} role="status">
          {status.text}
        </p>
      ) : null}

      <div className="ipa-actions">
        <Link href="/invoice-proof/settings/integrations" className="ipa-link">
          ERP integrations
        </Link>
        <Link href="/invoice-proof/dashboard" className="ipa-link">
          Back to dashboard
        </Link>
      </div>
    </>
  );
}
