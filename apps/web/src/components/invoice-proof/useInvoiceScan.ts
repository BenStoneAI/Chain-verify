'use client';

import { useCallback, useState } from 'react';

import { readStoredKey } from '@/lib/invoice-proof/api-key-store';
import { errorMessage } from '@/lib/invoice-proof/client';
import type { DocumentScanResponse, ScanResponse } from '@/lib/invoice-proof/types';

export type ScanSource = 'text' | 'pdf' | 'url';

const ENDPOINTS: Record<ScanSource, string> = {
  text: '/api/scan/invoices',
  pdf: '/api/scan/invoices/pdf',
  url: '/api/scan/invoices/url',
};

const FALLBACK_ERRORS: Record<ScanSource, string> = {
  text: 'Scan failed',
  pdf: 'Upload failed',
  url: 'URL scan failed',
};

export interface InvoiceScanState {
  loading: boolean;
  error: string | null;
  /** Set when the API gated the request (free scan used or quota reached). */
  upgradeUrl: string | null;
  result: ScanResponse | null;
  document: DocumentScanResponse | null;
}

const IDLE: InvoiceScanState = { loading: false, error: null, upgradeUrl: null, result: null, document: null };

export function useInvoiceScan() {
  const [state, setState] = useState<InvoiceScanState>(IDLE);

  const reset = useCallback(() => setState(IDLE), []);

  const run = useCallback(async (source: ScanSource, payload: string | File) => {
    setState({ ...IDLE, loading: true });
    try {
      const headers: Record<string, string> = {};
      const key = readStoredKey();
      if (key) headers.Authorization = `Bearer ${key}`;

      let body: BodyInit;
      if (payload instanceof File) {
        const form = new FormData();
        form.append('file', payload, payload.name);
        body = form;
      } else {
        headers['Content-Type'] = 'application/json';
        body =
          source === 'url'
            ? JSON.stringify({ url: payload })
            : JSON.stringify({ text: payload, useSessionHistory: true });
      }

      const res = await fetch(ENDPOINTS[source], { method: 'POST', headers, body });
      const data = (await res.json()) as ScanResponse & DocumentScanResponse;

      if (res.status === 402 || res.status === 403) {
        setState({
          ...IDLE,
          error: data.message ?? data.error ?? 'You have used your free InvoiceProof scan.',
          upgradeUrl: data.upgradeUrl ?? '/invoice-proof#plans',
        });
        return;
      }
      if (!res.ok && data.status !== 'NEEDS_REVIEW') {
        throw new Error(data.message ?? data.error ?? `${FALLBACK_ERRORS[source]} (${res.status})`);
      }

      if (source === 'text') {
        setState({ ...IDLE, result: data });
      } else {
        const scanned = data.status === 'SCANNED' && data.scan ? data.scan : null;
        setState({ ...IDLE, document: data, result: scanned });
      }
    } catch (err) {
      setState({ ...IDLE, error: errorMessage(err, FALLBACK_ERRORS[source]) });
    }
  }, []);

  return { state, run, reset };
}
