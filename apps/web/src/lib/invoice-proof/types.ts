export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface ScanSummary {
  id: string;
  invoiceCount: number;
  findingCount: number;
  criticalCount: number;
  riskLevel: RiskLevel;
  createdAt: string;
}

export interface ProofRecordSummary {
  id: string;
  subject?: string | null;
  summary?: string | null;
  riskLevel: RiskLevel;
  issuesFound: number;
  createdAt: string;
}

export interface InvoiceProofUsage {
  plan: string;
  used: number;
  /** null means the plan has no fixed monthly cap. */
  limit: number | null;
}

export type ApprovalStatus = 'PENDING_REVIEW' | 'APPROVED' | 'BLOCKED';
export type ApprovalDecision = 'APPROVED' | 'BLOCKED';

export interface ApprovalItem {
  id: string;
  findingPattern: string;
  findingDetail: string;
  invoiceNo?: string | null;
  vendor?: string | null;
  status: ApprovalStatus;
}

export interface ScanReviewPayload {
  scan: {
    id: string;
    riskLevel?: RiskLevel;
    findingCount?: number;
    invoiceCount?: number;
    proofRecordId?: string | null;
  };
  approvals: ApprovalItem[];
}

export interface ErpConnection {
  id: string;
  provider: string;
  lastSyncAt?: string | null;
  lastSyncStatus?: string | null;
}

export type ImportKind = 'vendor' | 'po' | 'payment';

export interface ImportResult {
  imported: number;
}

export interface FindingSummary {
  severity: string;
  pattern: string;
  detail: string;
}

export interface ScanResponse {
  rowCount?: number;
  findingCount?: number;
  findings?: FindingSummary[];
  scanId?: string;
  riskLevel?: string;
  freeScanConsumed?: boolean;
  upgradeUrl?: string;
  message?: string;
  error?: string;
}

export interface ExtractedFields {
  vendor?: string;
  invoiceNo?: string;
  invoiceDate?: string;
  amount?: number;
  po?: string;
}

export interface PdfExtraction {
  status: string;
  confidence: number;
  fields: ExtractedFields;
  warnings: string[];
  pageCount: number;
}

export interface DocumentScanResponse {
  status?: string;
  message?: string;
  extraction?: PdfExtraction | null;
  scan?: ScanResponse | null;
  upgradeUrl?: string;
  error?: string;
}
