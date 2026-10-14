import type { DocumentScanResponse } from '@/lib/invoice-proof/types';

export interface ExtractionReviewProps {
  document: DocumentScanResponse;
}

export function ExtractionReview({ document }: ExtractionReviewProps) {
  const extraction = document.extraction;

  if (document.status === 'SCANNED') {
    if (!extraction) return null;
    return (
      <p className="ipa-faint">
        Extracted from the document ({extraction.pageCount} page{extraction.pageCount === 1 ? '' : 's'},{' '}
        {Math.round((extraction.confidence ?? 0) * 100)}% confidence) and scanned.
      </p>
    );
  }

  if (document.status === 'NEEDS_REVIEW' && extraction) {
    const rows: Array<[string, string | number | undefined]> = [
      ['Vendor', extraction.fields.vendor],
      ['Invoice #', extraction.fields.invoiceNo],
      ['Date', extraction.fields.invoiceDate],
      ['Amount', extraction.fields.amount],
      ['PO', extraction.fields.po],
    ];
    return (
      <section className="ipa-card" aria-label="Extraction needs review">
        <p className="ipa-alert ipa-alert-warn">
          Needs review: low-confidence extraction ({Math.round((extraction.confidence ?? 0) * 100)}%)
        </p>
        {document.message ? <p className="ipa-muted">{document.message}</p> : null}
        <dl className="ipa-dl">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value ?? '-'}</dd>
            </div>
          ))}
        </dl>
        {extraction.warnings?.length ? (
          <ul className="ipa-faint">
            {extraction.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        ) : null}
        <p className="ipa-faint">
          Correct the fields and submit them on the &quot;Paste CSV / JSON&quot; tab to run the scan.
        </p>
      </section>
    );
  }

  return <p className="ipa-alert ipa-alert-warn">{document.message ?? 'Could not process this document.'}</p>;
}
