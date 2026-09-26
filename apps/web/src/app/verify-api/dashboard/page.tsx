'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  Copy,
  Check,
  Trash2,
  Plus,
  X,
  RefreshCw,
  Key,
  Activity,
  Clock,
  CheckCircle,
  Zap,
  Download,
} from 'lucide-react';

import { useAuthStore } from '@/stores/auth-store';
import { ensureAuthTokenAsync } from '@/lib/auth';
import { DEFAULT_API_BASE } from '@/lib/constants';
import { pickProofEntitlement, type ProofEntitlements } from '@/lib/proof-entitlements';
import ProductNav from '@/components/proof/ProductNav';
import ProductFooter from '@/components/proof/ProductFooter';

import '../verify-api.css';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  status: string;
}

interface NewApiKey extends ApiKey {
  api_key: string;
}

type ProofStatus = 'PASSED' | 'NEEDS_REVIEW' | 'FAILED';
type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

interface VerifyRecord {
  id: string;
  shortId?: string;
  createdAt: string;
  status: ProofStatus;
  riskLevel: RiskLevel;
  sourceType?: string;
  product: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function planLabel(slug: string): string {
  const map: Record<string, string> = {
    'verifyapi-free': 'Free',
    'verifyapi-build': 'Build',
    'verifyapi-scale': 'Scale',
    'verifyapi-production': 'Production',
  };
  return map[slug] ?? slug;
}

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

function maskKey(prefix: string): string {
  return `${prefix}••••••••`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

async function downloadProofJson(apiBase: string, proofId: string): Promise<void> {
  const res = await fetch(`${apiBase}/api/proof/${proofId}/export/json`);
  if (!res.ok) throw new Error(`Export failed (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `proof-${proofId}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function normalizeVerifyRecord(raw: Record<string, unknown>): VerifyRecord {
  const verification =
    raw.verification && typeof raw.verification === 'object'
      ? (raw.verification as Record<string, unknown>)
      : null;
  const id = String(raw.id ?? raw.proof_id ?? raw.verification_id ?? '');
  const rawStatus = String(
    verification?.verification_status ?? raw.status ?? raw.proof_status ?? 'NEEDS_REVIEW',
  ).toUpperCase();
  const rawRiskLevel = String(
    verification?.risk_level ?? raw.riskLevel ?? raw.risk_level ?? 'MEDIUM',
  ).toUpperCase();
  const status: ProofStatus =
    rawStatus === 'PASSED' || rawStatus === 'FAILED' || rawStatus === 'NEEDS_REVIEW'
      ? rawStatus
      : 'NEEDS_REVIEW';
  const riskLevel: RiskLevel =
    rawRiskLevel === 'LOW' ||
    rawRiskLevel === 'MEDIUM' ||
    rawRiskLevel === 'HIGH' ||
    rawRiskLevel === 'CRITICAL'
      ? rawRiskLevel
      : 'MEDIUM';

  return {
    id,
    shortId: id ? id.slice(0, 8) : undefined,
    createdAt: String(raw.createdAt ?? raw.created_at ?? new Date().toISOString()),
    status,
    riskLevel,
    sourceType: String(raw.sourceType ?? raw.source_type ?? raw.product ?? 'verify-api'),
    product: String(raw.product ?? 'verify-api'),
  };
}

// ── Skeleton helpers ──────────────────────────────────────────────────────────

function SkeletonRow({ cols }: { cols: number }) {
  return (
    <tr className="border-b border-white/5">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 animate-pulse rounded bg-white/10" style={{ width: i === 0 ? '10rem' : '4rem' }} />
        </td>
      ))}
    </tr>
  );
}

function ExportableRow({ rec, apiBase }: { rec: VerifyRecord; apiBase: string }) {
  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState<string | null>(null);

  async function handleExport() {
    setExporting(true);
    setExportErr(null);
    try {
      await downloadProofJson(apiBase, rec.id);
    } catch (err) {
      setExportErr(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  return (
    <tr className="border-b border-white/5 transition hover:bg-white/3">
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
      <td className="px-4 py-3 text-white/50 text-xs">{rec.sourceType ?? '—'}</td>
      <td className="px-4 py-3">
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting}
          title="Export proof as JSON"
          className="flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-white/60 transition hover:border-[#7C5CFF]/50 hover:text-white disabled:opacity-40"
        >
          <Download className="h-3 w-3" />
          {exporting ? '...' : 'JSON'}
        </button>
        {exportErr && (
          <span className="mt-1 block text-xs text-red-400">{exportErr}</span>
        )}
      </td>
    </tr>
  );
}

// ── Create Key Modal ──────────────────────────────────────────────────────────

interface CreateKeyModalProps {
  onClose: () => void;
  onCreated: (key: NewApiKey) => void;
  token: string;
}

function CreateKeyModal({ onClose, onCreated, token }: CreateKeyModalProps) {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError(null);
    try {
      // /v1/auth/keys mints a routing (sk-ss-...) key — VerifyApiAuthGuard only accepts
      // ssk_live_... keys minted via /v1/swarmscore/keys (SwarmScoreApiKeysService).
      const res = await fetch(`${DEFAULT_API_BASE}/v1/swarmscore/keys`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { message?: string };
        throw new Error(body.message ?? 'Failed to create key');
      }
      const created = await res.json() as NewApiKey;
      onCreated(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create key');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="relative mx-4 w-full max-w-md rounded-2xl border border-white/15 bg-[#0A0C14] p-6 shadow-2xl">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-md p-1 text-white/40 transition hover:text-white"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        <h2 className="mb-1 text-lg font-semibold">Create API Key</h2>
        <p className="mb-5 text-sm text-white/50">Give your key a memorable name to identify it later.</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="key-name" className="mb-1.5 block text-sm font-medium text-white/70">
              Key name
            </label>
            <input
              id="key-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Production backend"
              maxLength={80}
              required
              className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-white/30 outline-none transition focus:border-[#7C5CFF]/60 focus:ring-1 focus:ring-[#7C5CFF]/40"
            />
          </div>

          {error && (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !name.trim()}
            className="w-full rounded-lg bg-[#7C5CFF] py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
          >
            {loading ? 'Creating...' : 'Create key'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Key Created Banner ────────────────────────────────────────────────────────

interface KeyCreatedBannerProps {
  apiKey: string;
  onDismiss: () => void;
}

function KeyCreatedBanner({ apiKey, onDismiss }: KeyCreatedBannerProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="mb-6 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-emerald-400">
          <Check className="h-4 w-4" /> Key created — copy it now, it will not be shown again
        </span>
        <button onClick={onDismiss} className="text-white/40 transition hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex items-center gap-2">
        <code className="flex-1 overflow-x-auto rounded-md bg-black/30 px-3 py-2 font-mono text-xs text-white/90">
          {apiKey}
        </code>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 rounded-md border border-white/15 bg-white/5 px-3 py-2 text-xs text-white/70 transition hover:bg-white/10 hover:text-white"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function VerifyAPIDashboard() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const { user, token, setAuth, clearAuth } = useAuthStore();

  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [records, setRecords] = useState<VerifyRecord[]>([]);
  const [entitlements, setEntitlements] = useState<ProofEntitlements | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newKeyBanner, setNewKeyBanner] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'loading') return;

    let cancelled = false;

    async function resolveToken() {
      const sessionToken = session?.accessToken;
      const existingToken = token ?? sessionToken ?? null;

      if (existingToken) {
        if (!cancelled) setAuthToken(existingToken);
        return;
      }

      if (!session) {
        if (!cancelled) {
          setAuthToken(null);
          clearAuth();
          router.replace('/login?callbackUrl=/verify-api/dashboard');
        }
        return;
      }

      const exchangedToken = await ensureAuthTokenAsync();
      if (cancelled) return;

      if (!exchangedToken) {
        setAuthToken(null);
        clearAuth();
        router.replace('/login?callbackUrl=/verify-api/dashboard');
        return;
      }

      setAuthToken(exchangedToken);
      const sessionUser = session.user;
      if (sessionUser?.email) {
        setAuth(
          {
            id: sessionUser.id || sessionUser.email,
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
  }, [status, session, token, setAuth, clearAuth, router]);

  const fetchData = useCallback(async () => {
    if (!authToken) return;
    setLoading(true);
    setError(null);
    try {
      const [keysRes, proofRes, entRes] = await Promise.all([
        // /v1/swarmscore/keys — same endpoint the create/revoke calls use below.
        // /v1/auth/keys is the unrelated Smart Routing key service (sk-ss-... keys).
        fetch(`${DEFAULT_API_BASE}/v1/swarmscore/keys`, {
          headers: { Authorization: `Bearer ${authToken}` },
        }),
        fetch(`${DEFAULT_API_BASE}/api/proof?product=verify-api`, {
          headers: { Authorization: `Bearer ${authToken}` },
        }),
        fetch(`${DEFAULT_API_BASE}/billing/proof/entitlements`, {
          headers: { Authorization: `Bearer ${authToken}` },
        }),
      ]);

      if ([keysRes.status, proofRes.status, entRes.status].some((code) => code === 401 || code === 403)) {
        setAuthToken(null);
        clearAuth();
        router.replace('/login?callbackUrl=/verify-api/dashboard');
        return;
      }

      if (keysRes.ok) {
        const data = await keysRes.json() as ApiKey[];
        setKeys(Array.isArray(data) ? data : []);
      }

      if (proofRes.ok) {
        const data = await proofRes.json() as { data?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
        const rows = Array.isArray(data) ? data : Array.isArray(data.data) ? data.data : [];
        setRecords(rows.map(normalizeVerifyRecord).slice(0, 20));
      }

      if (entRes.ok) {
        const data: unknown = await entRes.json();
        setEntitlements(
          pickProofEntitlement(data, 'VERIFY_API', { plan: 'verifyapi-free', runsUsed: 0, runsLimit: 500 }),
        );
      } else {
        setEntitlements({ plan: 'verifyapi-free', runsUsed: 0, runsLimit: 500 });
      }
    } catch {
      setError('Unable to load data. Try refreshing.');
    } finally {
      setLoading(false);
    }
  }, [authToken, clearAuth, router]);

  useEffect(() => {
    if (authToken) fetchData();
  }, [authToken, fetchData]);

  async function handleRevoke(id: string) {
    if (!authToken || !confirm('Revoke this key? Any requests using it will immediately fail.')) return;
    setRevokingId(id);
    try {
      const res = await fetch(`${DEFAULT_API_BASE}/v1/swarmscore/keys/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) throw new Error('Revoke failed');
      setKeys((prev) => prev.filter((k) => k.id !== id));
    } catch {
      alert('Failed to revoke key. Please try again.');
    } finally {
      setRevokingId(null);
    }
  }

  function handleKeyCreated(key: NewApiKey) {
    setKeys((prev) => [key, ...prev]);
    setNewKeyBanner(key.api_key);
    setShowCreateModal(false);
  }

  // Stats
  const totalRequests = records.length;
  const passedCount = records.filter((r) => r.status === 'PASSED').length;
  const successRate = totalRequests > 0 ? Math.round((passedCount / totalRequests) * 100) : 0;
  const usedPct = entitlements
    ? Math.min(100, Math.round((entitlements.runsUsed / entitlements.runsLimit) * 100))
    : 0;

  if (status === 'loading' || (!authToken && !session)) return null; // redirect in progress

  return (
    <div className="min-h-screen bg-[#03050A] text-white">
      <ProductNav currentProduct="verify-api" />

      {showCreateModal && authToken && (
        <CreateKeyModal
          token={authToken}
          onClose={() => setShowCreateModal(false)}
          onCreated={handleKeyCreated}
        />
      )}

      <main className="mx-auto max-w-7xl px-4 pb-24 pt-24 sm:px-6">
        {/* Header */}
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">VerifyAPI Dashboard</h1>
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

        {/* New key banner */}
        {newKeyBanner && (
          <KeyCreatedBanner apiKey={newKeyBanner} onDismiss={() => setNewKeyBanner(null)} />
        )}

        {/* Usage meter */}
        {entitlements && (
          <div className="mb-6 rounded-xl border border-white/10 bg-white/3 p-5">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="text-white/60">API requests this month</span>
              <span className="font-semibold">
                {entitlements.runsUsed.toLocaleString()}{' '}
                <span className="text-white/40">/ {entitlements.runsLimit.toLocaleString()} requests</span>
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
        <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-3">
          {loading ? (
            [1, 2, 3].map((i) => (
              <div key={i} className="rounded-xl border border-white/10 bg-white/3 p-5">
                <div className="mb-3 h-3 w-20 animate-pulse rounded bg-white/10" />
                <div className="h-7 w-16 animate-pulse rounded bg-white/10" />
              </div>
            ))
          ) : (
            <>
              <div className="rounded-xl border border-white/10 bg-white/3 p-5">
                <p className="mb-1 flex items-center gap-1.5 text-xs text-white/50">
                  <Activity className="h-3.5 w-3.5" /> Total requests
                </p>
                <p className="text-2xl font-bold">{totalRequests}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/3 p-5">
                <p className="mb-1 flex items-center gap-1.5 text-xs text-white/50">
                  <CheckCircle className="h-3.5 w-3.5 text-emerald-400" /> Success rate
                </p>
                <p className="text-2xl font-bold text-emerald-400">{successRate}%</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/3 col-span-2 sm:col-span-1 p-5">
                <p className="mb-1 flex items-center gap-1.5 text-xs text-white/50">
                  <Key className="h-3.5 w-3.5" /> Active keys
                </p>
                <p className="text-2xl font-bold">{keys.filter((k) => k.status !== 'REVOKED').length}</p>
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

        {/* API Keys section */}
        <div className="mb-8 rounded-xl border border-white/10 bg-white/3">
          <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
            <h2 className="font-semibold">API Keys</h2>
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-1.5 rounded-lg bg-[#7C5CFF] px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90"
            >
              <Plus className="h-3.5 w-3.5" />
              New key
            </button>
          </div>

          {loading ? (
            <div className="divide-y divide-white/5">
              {[1, 2].map((i) => (
                <div key={i} className="flex items-center justify-between px-5 py-4">
                  <div className="space-y-1.5">
                    <div className="h-4 w-32 animate-pulse rounded bg-white/10" />
                    <div className="h-3 w-40 animate-pulse rounded bg-white/10" />
                  </div>
                  <div className="h-7 w-16 animate-pulse rounded bg-white/10" />
                </div>
              ))}
            </div>
          ) : keys.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-5 py-10 text-center">
              <Key className="h-8 w-8 text-white/20" />
              <p className="text-sm text-white/50">No API keys yet.</p>
              <button
                onClick={() => setShowCreateModal(true)}
                className="rounded-lg bg-[#7C5CFF] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
              >
                Create your first key
              </button>
            </div>
          ) : (
            <div className="divide-y divide-white/5">
              {keys.map((key) => (
                <div key={key.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                  <div>
                    <p className="font-medium text-sm">{key.name}</p>
                    <div className="mt-0.5 flex items-center gap-2">
                      <code className="font-mono text-xs text-white/50">{maskKey(key.key_prefix)}</code>
                      <span className="text-xs text-white/30">· Created {formatDate(key.created_at)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        key.status === 'ACTIVE'
                          ? 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30'
                          : 'bg-red-500/15 text-red-400 ring-1 ring-red-500/30'
                      }`}
                    >
                      {key.status}
                    </span>
                    {key.status !== 'REVOKED' && (
                      <button
                        onClick={() => handleRevoke(key.id)}
                        disabled={revokingId === key.id}
                        title="Revoke key"
                        className="flex items-center gap-1 rounded-md border border-red-500/20 px-2 py-1 text-xs text-red-400 transition hover:bg-red-500/10 disabled:opacity-40"
                      >
                        <Trash2 className="h-3 w-3" />
                        {revokingId === key.id ? 'Revoking...' : 'Revoke'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quick start code block */}
        <div className="mb-8 rounded-xl border border-white/10 bg-white/3 p-5">
          <h2 className="mb-3 font-semibold">Quick Start</h2>
          <p className="mb-3 text-sm text-white/50">
            POST any AI output and get back a pass/fail verdict with a proof ID.
          </p>
          <div className="overflow-x-auto rounded-lg bg-[#070810] p-4">
            <pre className="font-mono text-xs leading-relaxed text-white/80">
{`curl -X POST https://api.swarmsync.ai/api/verify \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "source_type": "api_output",
    "task": "content_review",
    "output": {
      "content": "The AI-generated output to verify"
    },
    "rules": ["required_fields_present"]
  }'

# Response
{
  "verification_status": "passed",
  "proof_id": "generated-per-run",
  "risk_level": "low",
  "confidence": 0.94
}`}
            </pre>
          </div>
        </div>

        {/* Recent verifications table */}
        <div className="rounded-xl border border-white/10 bg-white/3">
          <div className="border-b border-white/10 px-5 py-4">
            <h2 className="font-semibold">Recent Verifications</h2>
            <p className="mt-0.5 text-xs text-white/40">Last 20 verification runs</p>
          </div>

          {loading ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-white/10">
                    {['Proof ID', 'Date', 'Status', 'Risk Level', 'Source Type', ''].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/40">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[1, 2, 3, 4, 5].map((i) => <SkeletonRow key={i} cols={6} />)}
                </tbody>
              </table>
            </div>
          ) : records.length === 0 ? (
            <div className="flex flex-col items-center gap-4 px-5 py-16 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/5">
                <Zap className="h-7 w-7 text-white/30" />
              </div>
              <p className="text-white/50">No account verification runs yet.</p>
              <p className="max-w-sm text-xs leading-5 text-white/30">
                Use your API key above for account records. No-key sandbox runs stay anonymous and
                show their proof ID on the result screen.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-white/10">
                    {['Proof ID', 'Date', 'Status', 'Risk Level', 'Source Type', ''].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/40">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {records.map((rec) => (
                    <ExportableRow key={rec.id} rec={rec} apiBase={DEFAULT_API_BASE} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      <ProductFooter currentProduct="verify-api" />
    </div>
  );
}
