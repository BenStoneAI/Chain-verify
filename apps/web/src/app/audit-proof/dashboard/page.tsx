'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import {
  Download,
  FileText,
  Shield,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  Clock,
  RefreshCw,
} from 'lucide-react';

import { useAuthStore } from '@/stores/auth-store';
import { DEFAULT_API_BASE } from '@/lib/constants';
import { parseProofListPayload } from '@/lib/proof-list';
import { downloadProofExport } from '@/lib/proof-export';
import { pickProofEntitlement, type ProofEntitlements } from '@/lib/proof-entitlements';
import ProductNav from '@/components/proof/ProductNav';
import ProductFooter from '@/components/proof/ProductFooter';

import '../audit-proof.css';

// ── Types ─────────────────────────────────────────────────────────────────────

type ProofStatus = 'PASSED' | 'NEEDS_REVIEW' | 'FAILED';
type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

interface ProofRecord {
  id: string;
  shortId: string;
  createdAt: string;
  status: ProofStatus;
  riskLevel: RiskLevel;
  confidencePct: number;
  subject?: string;
  product: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusBadge(status: ProofStatus) {
  const map: Record<ProofStatus, { label: string; cls: string }> = {
    PASSED: { label: 'Passed', cls: 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30' },
    NEEDS_REVIEW: { label: 'Needs Review', cls: 'bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30' },
    FAILED: { label: 'Failed', cls: 'bg-red-500/15 text-red-400 ring-1 ring-red-500/30' },
  };
  const { label, cls } = map[status];
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

function riskBadge(risk: RiskLevel) {
  const map: Record<RiskLevel, { label: string; cls: string }> = {
    LOW: { label: 'Low', cls: 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30' },
    MEDIUM: { label: 'Medium', cls: 'bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30' },
    HIGH: { label: 'High', cls: 'bg-red-500/15 text-red-400 ring-1 ring-red-500/30' },
    CRITICAL: { label: 'Critical', cls: 'bg-red-600/20 text-red-300 ring-1 ring-red-600/40 font-bold' },
  };
  const { label, cls } = map[risk];
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

function planLabel(slug: string): string {
  const map: Record<string, string> = {
    'auditproof-pilot': 'Pilot',
    'auditproof-comply': 'Comply',
    'auditproof-govern': 'Govern',
    'auditproof-certify': 'Certify',
  };
  return map[slug] ?? slug;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr className="border-b border-white/5">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 animate-pulse rounded bg-white/10" style={{ width: i === 1 ? '7rem' : i === 6 ? '5rem' : '4rem' }} />
        </td>
      ))}
    </tr>
  );
}

function StatCardSkeleton() {
  return (
    <div className="rounded-xl border border-white/10 bg-white/3 p-5">
      <div className="mb-3 h-3 w-20 animate-pulse rounded bg-white/10" />
      <div className="h-7 w-16 animate-pulse rounded bg-white/10" />
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AuditProofDashboard() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const { user, token } = useAuthStore();

  const authToken = token ?? (session as any)?.accessToken ?? null;

  const [records, setRecords] = useState<ProofRecord[]>([]);
  const [entitlements, setEntitlements] = useState<ProofEntitlements | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);

  // Auth gate — runs on client after hydration; accepts Zustand token OR NextAuth session
  useEffect(() => {
    if (status === 'loading') return;
    if (!authToken && !session) {
      router.replace('/login?callbackUrl=/audit-proof/dashboard');
    }
  }, [status, session, authToken, router]);

  const fetchData = useCallback(async () => {
    if (!authToken) return;
    setLoading(true);
    setError(null);
    try {
      const [proofRes, entRes] = await Promise.all([
        fetch(`${DEFAULT_API_BASE}/api/proof?product=audit-proof`, {
          headers: { Authorization: `Bearer ${authToken}` },
        }),
        fetch(`${DEFAULT_API_BASE}/billing/proof/entitlements`, {
          headers: { Authorization: `Bearer ${authToken}` },
        }),
      ]);

      if (proofRes.ok) {
        const data = await proofRes.json();
        setRecords(parseProofListPayload<ProofRecord>(data));
      }

      if (entRes.ok) {
        const data: unknown = await entRes.json();
        setEntitlements(
          pickProofEntitlement(data, 'AUDIT_PROOF', { plan: 'auditproof-pilot', runsUsed: 0, runsLimit: 100 }),
        );
      } else {
        // Graceful degradation — entitlements optional
        setEntitlements({ plan: 'auditproof-pilot', runsUsed: 0, runsLimit: 100 });
      }
    } catch {
      setError('Unable to load data. Try refreshing.');
    } finally {
      setLoading(false);
    }
  }, [authToken]);

  useEffect(() => {
    if (authToken) fetchData();
  }, [authToken, fetchData]);

  async function handleExport(id: string, format: 'pdf' | 'json') {
    if (!authToken) return;
    setExportingId(`${id}-${format}`);
    try {
      await downloadProofExport({
        proofId: id,
        format,
        apiBase: DEFAULT_API_BASE,
        filenamePrefix: 'audit-proof',
        headers: { Authorization: `Bearer ${authToken}` },
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Export failed. Please try again.');
    } finally {
      setExportingId(null);
    }
  }

  // Stats derived from records
  const totalRuns = records.length;
  const passedRuns = records.filter((r) => r.status === 'PASSED').length;
  const passRate = totalRuns > 0 ? Math.round((passedRuns / totalRuns) * 100) : 0;
  const avgConfidence =
    totalRuns > 0
      ? Math.round(records.reduce((sum, r) => sum + r.confidencePct, 0) / totalRuns)
      : 0;
  const flagsRaised = records.filter((r) => r.status !== 'PASSED').length;

  const usedPct = entitlements
    ? entitlements.runsLimit > 0
      ? Math.min(100, Math.round((entitlements.runsUsed / entitlements.runsLimit) * 100))
      : 0
    : 0;

  if (status === 'loading' || (!authToken && !session)) return null; // redirect in progress

  return (
    <div className="min-h-screen bg-[#03050A] text-white">
      <ProductNav currentProduct="audit-proof" />

      <main className="mx-auto max-w-7xl px-4 pb-24 pt-24 sm:px-6">
        {/* Header */}
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">AuditProof Dashboard</h1>
            <p className="mt-1 text-sm text-white/50">
              {user?.displayName ?? user?.email ?? 'Your account'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {entitlements && (
              <span className="rounded-full border border-[#7C5CFF]/40 bg-[#7C5CFF]/10 px-3 py-1 text-xs font-semibold text-[#7C5CFF]">
                {planLabel(entitlements.plan)} plan
              </span>
            )}
            <button
              onClick={() => fetchData()}
              disabled={loading}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white/70 transition hover:bg-white/10 disabled:opacity-40"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        {/* Usage meter */}
        {entitlements && (
          <div className="mb-6 rounded-xl border border-white/10 bg-white/3 p-5">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="text-white/60">Runs used this month</span>
              <span className="font-semibold">
                {entitlements.runsUsed.toLocaleString()}{' '}
                <span className="text-white/40">/ {entitlements.runsLimit.toLocaleString()}</span>
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className={`h-full rounded-full transition-all duration-500 ${usedPct >= 90 ? 'bg-red-500' : usedPct >= 70 ? 'bg-amber-500' : 'bg-[#7C5CFF]'}`}
                style={{ width: `${usedPct}%` }}
              />
            </div>
          </div>
        )}

        {/* Stats strip */}
        <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {loading ? (
            [1, 2, 3, 4].map((i) => <StatCardSkeleton key={i} />)
          ) : (
            <>
              <div className="rounded-xl border border-white/10 bg-white/3 p-5">
                <p className="mb-1 flex items-center gap-1.5 text-xs text-white/50">
                  <FileText className="h-3.5 w-3.5" /> Total runs
                </p>
                <p className="text-2xl font-bold">{totalRuns}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/3 p-5">
                <p className="mb-1 flex items-center gap-1.5 text-xs text-white/50">
                  <TrendingUp className="h-3.5 w-3.5" /> Pass rate
                </p>
                <p className="text-2xl font-bold">{passRate}%</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/3 p-5">
                <p className="mb-1 flex items-center gap-1.5 text-xs text-white/50">
                  <Shield className="h-3.5 w-3.5" /> Avg confidence
                </p>
                <p className="text-2xl font-bold">{avgConfidence}%</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/3 p-5">
                <p className="mb-1 flex items-center gap-1.5 text-xs text-white/50">
                  <AlertTriangle className="h-3.5 w-3.5" /> Flags raised
                </p>
                <p className="text-2xl font-bold">{flagsRaised}</p>
              </div>
            </>
          )}
        </div>

        {/* Error banner */}
        {error && (
          <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Proof records table */}
        <div className="rounded-xl border border-white/10 bg-white/3">
          <div className="border-b border-white/10 px-5 py-4">
            <h2 className="font-semibold">Proof Records</h2>
          </div>

          {loading ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-white/10">
                    {['Proof ID', 'Date', 'Status', 'Risk Level', 'Confidence', 'Actions'].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/40">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[1, 2, 3, 4, 5].map((i) => <SkeletonRow key={i} />)}
                </tbody>
              </table>
            </div>
          ) : records.length === 0 ? (
            <div className="flex flex-col items-center gap-4 px-5 py-16 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/5">
                <CheckCircle className="h-7 w-7 text-white/30" />
              </div>
              <p className="text-white/50">No account proof records yet.</p>
              <p className="max-w-sm text-xs leading-5 text-white/35">
                Anonymous demo proof IDs are shown on the result screen. Saved history appears here
                for logged-in account records.
              </p>
              <Link
                href="/audit-proof#control-report"
                className="rounded-lg bg-[#7C5CFF] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
              >
                Create your first AI control report
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-white/10">
                    {['Proof ID', 'Date', 'Status', 'Risk Level', 'Confidence', 'Actions'].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/40">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {records.map((rec) => (
                    <tr key={rec.id} className="border-b border-white/5 transition hover:bg-white/3">
                      <td className="px-4 py-3 font-mono text-xs text-white/70">
                        {rec.shortId ?? rec.id.slice(0, 8)}...
                      </td>
                      <td className="px-4 py-3 text-white/60">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3 text-white/30" />
                          {formatDate(rec.createdAt)}
                        </span>
                      </td>
                      <td className="px-4 py-3">{statusBadge(rec.status)}</td>
                      <td className="px-4 py-3">{riskBadge(rec.riskLevel)}</td>
                      <td className="px-4 py-3">
                        <span className={`font-semibold ${rec.confidencePct >= 80 ? 'text-emerald-400' : rec.confidencePct >= 60 ? 'text-amber-400' : 'text-red-400'}`}>
                          {rec.confidencePct}%
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleExport(rec.id, 'pdf')}
                            disabled={exportingId === `${rec.id}-pdf`}
                            title="Download PDF"
                            className="flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-white/60 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
                          >
                            <Download className="h-3 w-3" />
                            {exportingId === `${rec.id}-pdf` ? '...' : 'PDF'}
                          </button>
                          <button
                            onClick={() => handleExport(rec.id, 'json')}
                            disabled={exportingId === `${rec.id}-json`}
                            title="Download JSON"
                            className="flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-white/60 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
                          >
                            <Download className="h-3 w-3" />
                            {exportingId === `${rec.id}-json` ? '...' : 'JSON'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      <ProductFooter currentProduct="audit-proof" />
    </div>
  );
}
