'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import {
  Download,
  FileText,
  AlertTriangle,
  CheckCircle,
  Clock,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';

import { useAuthStore } from '@/stores/auth-store';
import { ensureAuthTokenAsync } from '@/lib/auth';
import { DEFAULT_API_BASE } from '@/lib/constants';
import { parseProofListPayload } from '@/lib/proof-list';
import { downloadProofExport } from '@/lib/proof-export';
import { pickProofEntitlement, type ProofEntitlements } from '@/lib/proof-entitlements';
import ProductNav from '@/components/proof/ProductNav';
import ProductFooter from '@/components/proof/ProductFooter';

import '../invoice-proof.css';

// ── Types ─────────────────────────────────────────────────────────────────────

type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

interface InvoiceRecord {
  id: string;
  shortId?: string;
  createdAt: string;
  riskLevel: RiskLevel;
  issuesFound: number;
  subject?: string; // vendor name derived from proof subject
  product: string;
}

type DashboardState = 'loading' | 'ready' | 'empty' | 'unauthenticated' | 'error';

// ── Helpers ───────────────────────────────────────────────────────────────────

function riskBadge(risk: RiskLevel) {
  const map: Record<RiskLevel, { label: string; cls: string }> = {
    LOW: { label: 'Low', cls: 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30' },
    MEDIUM: { label: 'Medium', cls: 'bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30' },
    HIGH: { label: 'High', cls: 'bg-red-500/15 text-red-400 ring-1 ring-red-500/30' },
    CRITICAL: {
      label: 'Critical',
      cls: 'bg-red-600/20 text-red-300 ring-1 ring-red-600/40 font-bold',
    },
  };
  const entry = map[risk] ?? map['LOW'];
  const { label, cls } = entry;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}
    >
      {label}
    </span>
  );
}

function planLabel(slug: string): string {
  const map: Record<string, string> = {
    'invoiceproof-pilot': 'Pilot',
    'invoiceproof-verify': 'Verify',
    'invoiceproof-protect': 'Protect',
    'invoiceproof-govern': 'Govern',
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
          <div
            className="h-4 animate-pulse rounded bg-white/10"
            style={{ width: i === 1 ? '7rem' : i === 3 ? '9rem' : '4rem' }}
          />
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

export default function InvoiceProofDashboard() {
  const { data: session, status } = useSession();
  const { user, token, setAuth, clearAuth } = useAuthStore();

  const [records, setRecords] = useState<InvoiceRecord[]>([]);
  const [entitlements, setEntitlements] = useState<ProofEntitlements | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [dashboardState, setDashboardState] = useState<DashboardState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'loading') return;

    let cancelled = false;

    async function resolveToken() {
      setDashboardState('loading');

      const sessionToken = (session as any)?.accessToken as string | undefined;
      const existingToken = token ?? sessionToken ?? null;

      if (existingToken) {
        if (!cancelled) setAuthToken(existingToken);
        return;
      }

      if (!session) {
        if (!cancelled) {
          setAuthToken(null);
          clearAuth();
          setDashboardState('unauthenticated');
        }
        return;
      }

      const exchangedToken = await ensureAuthTokenAsync();
      if (cancelled) return;

      if (!exchangedToken) {
        setAuthToken(null);
        clearAuth();
        setDashboardState('unauthenticated');
        return;
      }

      setAuthToken(exchangedToken);
      const sessionUser = session.user;
      if (sessionUser?.email) {
        setAuth(
          {
            id: (sessionUser as any).id || sessionUser.email,
            email: sessionUser.email,
            displayName: sessionUser.name || sessionUser.email,
          },
          exchangedToken,
        );
      }
    }

    void resolveToken();

    return () => {
      cancelled = true;
    };
  }, [status, session, token, setAuth, clearAuth]);

  const fetchData = useCallback(async () => {
    if (!authToken) {
      setDashboardState('unauthenticated');
      return;
    }

    setDashboardState('loading');
    setError(null);
    try {
      const [scansRes, legacyRes, entRes] = await Promise.all([
        fetch(`${DEFAULT_API_BASE}/invoice-proof/scans`, {
          headers: { Authorization: `Bearer ${authToken}` },
        }),
        fetch(`${DEFAULT_API_BASE}/api/proof?product=invoice-proof`, {
          headers: { Authorization: `Bearer ${authToken}` },
        }),
        fetch(`${DEFAULT_API_BASE}/billing/proof/entitlements`, {
          headers: { Authorization: `Bearer ${authToken}` },
        }),
      ]);

      if ([scansRes.status, legacyRes.status, entRes.status].some((code) => code === 401 || code === 403)) {
        setAuthToken(null);
        clearAuth();
        setDashboardState('unauthenticated');
        return;
      }

      let nextRecords: InvoiceRecord[] = [];

      if (scansRes.ok) {
        const scans = (await scansRes.json()) as Array<{
          id: string;
          createdAt: string;
          riskLevel: RiskLevel;
          findingCount: number;
          invoiceCount: number;
        }>;
        nextRecords = scans.map((s) => ({
            id: s.id,
            shortId: s.id?.slice(0, 8),
            createdAt: s.createdAt,
            riskLevel: s.riskLevel,
            issuesFound: s.findingCount,
            product: 'invoice-proof',
            subject: `${s.invoiceCount} invoice${s.invoiceCount === 1 ? '' : 's'}`,
          }));
      } else if (legacyRes.ok) {
        const data = await legacyRes.json();
        nextRecords = parseProofListPayload<InvoiceRecord>(data).map((record) => ({
            ...record,
            shortId: record.shortId ?? record.id.slice(0, 8),
          }));
      } else {
        const detail = await scansRes.text().catch(() => '');
        throw new Error(`Dashboard API failed: ${scansRes.status} ${detail}`.trim());
      }

      if (entRes.ok) {
        const data: unknown = await entRes.json();
        setEntitlements(
          pickProofEntitlement(data, 'INVOICE_PROOF', { plan: 'invoiceproof-pilot', runsUsed: 0, runsLimit: 100 }),
        );
      } else {
        setEntitlements({ plan: 'invoiceproof-pilot', runsUsed: 0, runsLimit: 100 });
      }

      setRecords(nextRecords);
      setDashboardState(nextRecords.length === 0 ? 'empty' : 'ready');

      if (process.env.NODE_ENV !== 'production') {
        console.info('[InvoiceProof Dashboard]', {
          hasSession: Boolean(session),
          scansStatus: scansRes.status,
          legacyStatus: legacyRes.status,
          entitlementStatus: entRes.status,
          invoiceCount: nextRecords.length,
        });
      }
    } catch (err) {
      console.error('[InvoiceProof Dashboard] failed to load', err);
      setRecords([]);
      setError('Dashboard could not load. Try refreshing. If this keeps happening, check the dashboard API logs.');
      setDashboardState('error');
    }
  }, [authToken, session, clearAuth]);

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
        filenamePrefix: 'invoice-proof',
        headers: { Authorization: `Bearer ${authToken}` },
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Export failed. Please try again.');
    } finally {
      setExportingId(null);
    }
  }

  // Derived stats
  const total = records.length;
  const highRiskCount = records.filter(
    (r) => r.riskLevel === 'HIGH' || r.riskLevel === 'CRITICAL',
  ).length;
  const warningsCount = records.filter((r) => r.riskLevel === 'MEDIUM').length;
  const passedCount = records.filter((r) => r.riskLevel === 'LOW').length;

  const usedPct = entitlements
    ? entitlements.runsLimit > 0
      ? Math.min(100, Math.round((entitlements.runsUsed / entitlements.runsLimit) * 100))
      : 0
    : 0;

  const loading = dashboardState === 'loading';
  const isEmpty = dashboardState === 'empty';
  const isUnauthenticated = dashboardState === 'unauthenticated';
  const isError = dashboardState === 'error';

  return (
    <div className="min-h-screen bg-[#03050A] text-white">
      <ProductNav currentProduct="invoice-proof" />

      <main className="mx-auto max-w-7xl px-4 pb-24 pt-24 sm:px-6">
        {/* Header */}
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">InvoiceProof Dashboard</h1>
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
              <span className="text-white/60">Invoices processed this month</span>
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
                  <FileText className="h-3.5 w-3.5" /> Total invoices
                </p>
                <p className="text-2xl font-bold">{total}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/3 p-5">
                <p className="mb-1 flex items-center gap-1.5 text-xs text-white/50">
                  <AlertTriangle className="h-3.5 w-3.5 text-red-400" /> High risk
                </p>
                <p className="text-2xl font-bold text-red-400">{highRiskCount}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/3 p-5">
                <p className="mb-1 flex items-center gap-1.5 text-xs text-white/50">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-400" /> Warnings
                </p>
                <p className="text-2xl font-bold text-amber-400">{warningsCount}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/3 p-5">
                <p className="mb-1 flex items-center gap-1.5 text-xs text-white/50">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" /> Passed
                </p>
                <p className="text-2xl font-bold text-emerald-400">{passedCount}</p>
              </div>
            </>
          )}
        </div>

        {isUnauthenticated && (
          <div className="mb-6 rounded-xl border border-[#7C5CFF]/30 bg-[#7C5CFF]/10 px-5 py-4 text-sm text-white/80">
            <p className="font-semibold text-white">Please sign in to view your InvoiceProof dashboard.</p>
            <Link
              href="/login?callbackUrl=/invoice-proof/dashboard"
              className="mt-3 inline-flex rounded-lg bg-[#7C5CFF] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
            >
              Sign in
            </Link>
          </div>
        )}

        {/* Error banner */}
        {isError && error && (
          <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            <p className="font-semibold text-red-300">Dashboard could not load.</p>
            <p className="mt-1">{error}</p>
            <button
              onClick={() => fetchData()}
              className="mt-3 rounded-lg border border-red-400/30 px-3 py-1.5 text-sm text-red-200 transition hover:bg-red-500/10"
            >
              Retry
            </button>
          </div>
        )}

        {/* Invoice history table */}
        <div className="rounded-xl border border-white/10 bg-white/3">
          <div className="border-b border-white/10 px-5 py-4">
            <h2 className="font-semibold">Invoice History</h2>
          </div>

          {loading ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-white/10">
                    {['Proof ID', 'Date', 'Vendor', 'Risk Level', 'Issues Found', 'Actions'].map(
                      (h) => (
                        <th
                          key={h}
                          className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/40"
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {[1, 2, 3, 4, 5].map((i) => (
                    <SkeletonRow key={i} />
                  ))}
                </tbody>
              </table>
            </div>
          ) : isUnauthenticated ? (
            <div className="flex flex-col items-center gap-4 px-5 py-16 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/5">
                <ShieldCheck className="h-7 w-7 text-white/30" />
              </div>
              <p className="text-white/70">Please sign in to view your InvoiceProof dashboard.</p>
              <Link
                href="/login?callbackUrl=/invoice-proof/dashboard"
                className="rounded-lg bg-[#7C5CFF] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
              >
                Sign in
              </Link>
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center gap-4 px-5 py-16 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500/10">
                <AlertTriangle className="h-7 w-7 text-red-300" />
              </div>
              <p className="text-white/70">Dashboard could not load.</p>
              <p className="max-w-sm text-xs leading-5 text-white/35">
                Try refreshing. If this keeps happening, check the dashboard API logs.
              </p>
              <button
                onClick={() => fetchData()}
                className="rounded-lg bg-[#7C5CFF] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
              >
                Retry
              </button>
            </div>
          ) : isEmpty ? (
            <div className="flex flex-col items-center gap-4 px-5 py-16 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/5">
                <CheckCircle className="h-7 w-7 text-white/30" />
              </div>
              <p className="text-white/70">No invoice proofs yet.</p>
              <p className="max-w-sm text-xs leading-5 text-white/35">
                Run your first invoice scan and your proof history will appear here.
              </p>
              <Link
                href="/invoice-proof"
                className="rounded-lg bg-[#7C5CFF] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
              >
                Start invoice scan
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-white/10">
                    {['Proof ID', 'Date', 'Vendor', 'Risk Level', 'Issues Found', 'Actions'].map(
                      (h) => (
                        <th
                          key={h}
                          className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/40"
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {records.map((rec) => (
                    <tr
                      key={rec.id}
                      className="border-b border-white/5 transition hover:bg-white/3"
                    >
                      <td className="px-4 py-3 font-mono text-xs text-white/70">
                        {rec.shortId ?? rec.id?.slice(0, 8) ?? '—'}...
                      </td>
                      <td className="px-4 py-3 text-white/60">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3 text-white/30" />
                          {formatDate(rec.createdAt)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-white/80">
                        {rec.subject ?? <span className="text-white/30">—</span>}
                      </td>
                      <td className="px-4 py-3">{riskBadge(rec.riskLevel)}</td>
                      <td className="px-4 py-3">
                        {rec.issuesFound > 0 ? (
                          <span className="font-semibold text-amber-400">{rec.issuesFound}</span>
                        ) : (
                          <span className="text-emerald-400">0</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/invoice-proof/review/${rec.id}`}
                            className="rounded-md border border-white/10 px-2 py-1 text-xs text-white/60 transition hover:bg-white/10 hover:text-white"
                          >
                            Review
                          </Link>
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

      <ProductFooter currentProduct="invoice-proof" />
    </div>
  );
}
