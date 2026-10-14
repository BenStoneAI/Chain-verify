import { resolveProofApiBase } from '@/lib/proof-api';

import type {
  ApprovalDecision,
  ErpConnection,
  ImportKind,
  ImportResult,
  InvoiceProofUsage,
  ProofRecordSummary,
  RiskLevel,
  ScanReviewPayload,
  ScanSummary,
} from './types';

export class InvoiceProofApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'InvoiceProofApiError';
  }
}

const IMPORT_PATHS: Record<ImportKind, string> = {
  vendor: '/api/invoice-proof/vendor-master/bulk',
  po: '/api/invoice-proof/po-register/bulk',
  payment: '/api/invoice-proof/payment-history/bulk',
};

const RISK_LEVELS: readonly RiskLevel[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

function normalizeRisk(value: unknown): RiskLevel {
  const upper = typeof value === 'string' ? value.toUpperCase() : '';
  return (RISK_LEVELS as readonly string[]).includes(upper) ? (upper as RiskLevel) : 'LOW';
}

async function apiFetch(key: string, path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${resolveProofApiBase()}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`,
      ...(init?.headers ?? {}),
    },
  });
  if (res.ok) return res;

  let message = `Request failed (${res.status})`;
  try {
    const body = (await res.json()) as { message?: string | string[] };
    if (Array.isArray(body.message)) message = body.message.join(', ');
    else if (body.message) message = body.message;
  } catch {
    // body was not JSON; keep the generic message
  }
  throw new InvoiceProofApiError(message, res.status);
}

async function apiJson<T>(key: string, path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(key, path, init);
  return (await res.json()) as T;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export const invoiceProofApi = {
  async listScans(key: string): Promise<ScanSummary[]> {
    const rows = await apiJson<unknown>(key, '/api/invoice-proof/scans');
    if (!Array.isArray(rows)) return [];
    return rows.map((raw) => {
      const row = asRecord(raw);
      return {
        id: String(row.id ?? ''),
        invoiceCount: Number(row.invoiceCount ?? 0),
        findingCount: Number(row.findingCount ?? 0),
        criticalCount: Number(row.criticalCount ?? 0),
        riskLevel: normalizeRisk(row.riskLevel),
        createdAt: String(row.createdAt ?? ''),
      };
    });
  },

  async getUsage(key: string): Promise<InvoiceProofUsage> {
    const row = asRecord(await apiJson<unknown>(key, '/api/usage?product=invoice-proof'));
    return {
      plan: String(row.plan ?? 'free'),
      used: Number(row.used ?? 0),
      limit: typeof row.limit === 'number' ? row.limit : null,
    };
  },

  async listProofRecords(key: string): Promise<ProofRecordSummary[]> {
    const payload = asRecord(await apiJson<unknown>(key, '/api/proof?product=invoice-proof&limit=50'));
    const rows = Array.isArray(payload.data) ? payload.data : [];
    return rows.map((raw) => {
      const row = asRecord(raw);
      return {
        id: String(row.id ?? ''),
        subject: typeof row.subject === 'string' ? row.subject : null,
        summary: typeof row.summary === 'string' ? row.summary : null,
        riskLevel: normalizeRisk(row.riskLevel),
        issuesFound: Number(row.issuesFound ?? 0),
        createdAt: String(row.createdAt ?? ''),
      };
    });
  },

  getReview(key: string, scanId: string): Promise<ScanReviewPayload> {
    return apiJson<ScanReviewPayload>(key, `/api/invoice-proof/review/${encodeURIComponent(scanId)}`);
  },

  async decideApproval(
    key: string,
    scanId: string,
    approvalId: string,
    decision: ApprovalDecision,
  ): Promise<void> {
    await apiFetch(
      key,
      `/api/invoice-proof/review/${encodeURIComponent(scanId)}/approvals/${encodeURIComponent(approvalId)}`,
      { method: 'POST', body: JSON.stringify({ decision }) },
    );
  },

  async importCsv(key: string, kind: ImportKind, csv: string): Promise<ImportResult> {
    const row = asRecord(
      await apiJson<unknown>(key, IMPORT_PATHS[kind], { method: 'POST', body: JSON.stringify({ csv }) }),
    );
    return { imported: Number(row.imported ?? 0) };
  },

  async listErpConnections(key: string): Promise<ErpConnection[]> {
    const rows = await apiJson<unknown>(key, '/api/invoice-proof/erp/connections');
    return Array.isArray(rows) ? (rows as ErpConnection[]) : [];
  },

  async startErpConnect(key: string, provider: string): Promise<{ authUrl?: string; message?: string }> {
    const row = asRecord(
      await apiJson<unknown>(key, `/api/invoice-proof/erp/connect/${encodeURIComponent(provider)}`, {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    );
    return {
      authUrl: typeof row.authUrl === 'string' ? row.authUrl : undefined,
      message: typeof row.message === 'string' ? row.message : undefined,
    };
  },

  /** Downloads a proof export. Chain Verify exposes /api/proof/:id/export/{pdf|json}. */
  async downloadProofExport(key: string, proofId: string, format: 'pdf' | 'json'): Promise<void> {
    const res = await apiFetch(key, `/api/proof/${encodeURIComponent(proofId)}/export/${format}`, {
      headers: { 'content-type': 'application/octet-stream' },
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `invoice-proof-${proofId}.${format}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  },
};

export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}
