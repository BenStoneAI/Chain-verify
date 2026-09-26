'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useSession } from 'next-auth/react';

import { AUTH_TOKEN_KEY } from '@/lib/constants';
import { resolveProofApiBase } from '@/lib/proof-api';
import { useAuthStore } from '@/stores/auth-store';

interface ApiKeyData {
  key?: string;
  apiKey?: string;
  id?: string;
  message?: string;
}

interface UsageData {
  used?: number;
  limit?: number;
  plan?: string;
  period_end?: string;
}

function VerifyApiWelcomeInner() {
  const params = useSearchParams();
  const planSlug = params.get('plan') ?? undefined;
  const router = useRouter();
  const { data: session, status } = useSession();
  const { token: zustandToken } = useAuthStore();

  const [token, setToken] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [keyLoading, setKeyLoading] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [usage, setUsage] = useState<UsageData | null>(null);

  // BUG-013 + BUG-016: resolve token reactively after hydration; redirect if unauthenticated
  useEffect(() => {
    if (status === 'loading') return;
    const localToken = typeof window !== 'undefined' ? localStorage.getItem(AUTH_TOKEN_KEY) : null;
    const resolved = zustandToken ?? localToken ?? (session as any)?.accessToken ?? null;
    setToken(resolved);
    setAuthChecked(true);
    if (!resolved && !session) {
      router.replace('/login?callbackUrl=/verify-api/welcome');
    }
  }, [status, session, zustandToken, router]);

  useEffect(() => {
    if (!token) return;
    fetch(`${resolveProofApiBase()}/api/usage?product=verify-api`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: UsageData | null) => d && setUsage(d))
      .catch(() => {});
  }, [token]);

  async function generateApiKey() {
    if (!token) {
      setKeyError('Sign in to generate an API key.');
      return;
    }
    setKeyLoading(true);
    setKeyError(null);
    try {
      const res = await fetch(`${resolveProofApiBase()}/api/v1/keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: 'VerifyAPI default',
          type: 'agent-market',
          description: 'Default key for VerifyAPI calls',
          scopes: ['verify-api:write', 'proof:read'],
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message ?? `Error ${res.status}`);
      }
      const data = (await res.json()) as ApiKeyData;
      setApiKey(data.key ?? data.apiKey ?? null);
    } catch (err) {
      setKeyError(err instanceof Error ? err.message : 'Key generation failed');
    } finally {
      setKeyLoading(false);
    }
  }

  async function copyKey() {
    if (!apiKey) return;
    await navigator.clipboard.writeText(apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const planLabel = planSlug
    ? planSlug.replace('verify-api-', '').replace(/^\w/, (c) => c.toUpperCase())
    : 'Free';

  // Don't render the key-generation UI until auth resolution is complete (BUG-013 / BUG-016)
  if (!authChecked) return null;

  return (
    <main className="mx-auto max-w-2xl px-4 py-20 text-white">
      {/* Header */}
      <div className="mb-10 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-[#7C5CFF]/30 bg-[#7C5CFF]/10 px-3 py-1 text-xs text-[#7C5CFF] mb-4">
          VerifyAPI — {planLabel} Plan Active
        </div>
        <h1 className="text-3xl font-display font-bold">Your API key</h1>
        <p className="mt-3 text-white/60 text-sm">
          Add your key to requests as{' '}
          <code className="rounded bg-white/10 px-1.5 py-0.5 text-[#7C5CFF]">
            Authorization: Bearer &lt;key&gt;
          </code>
        </p>
      </div>

      {/* Usage meter (if data available) */}
      {usage && (
        <div className="mb-8 rounded-xl border border-white/10 bg-white/5 p-5 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-white/60">Runs this period</span>
            <span className="font-medium text-white">
              {usage.used ?? 0}
              {usage.limit != null ? ` / ${usage.limit}` : ''}
            </span>
          </div>
          {usage.limit != null && (
            <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-[#7C5CFF]"
                style={{ width: `${Math.min(100, ((usage.used ?? 0) / usage.limit) * 100)}%` }}
              />
            </div>
          )}
          {usage.period_end && (
            <p className="text-xs text-white/30">
              Period ends {new Date(usage.period_end).toLocaleDateString()}
            </p>
          )}
        </div>
      )}

      {/* Key generation / display */}
      {(!token && !session) ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-6 text-center">
          <p className="text-sm text-amber-300 mb-4">Sign in to generate your API key.</p>
          <Link
            href={`/login?redirect=${encodeURIComponent('/verify-api/welcome')}`}
            className="inline-flex items-center justify-center rounded-lg bg-[#7C5CFF] px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90"
          >
            Sign in
          </Link>
        </div>
      ) : apiKey ? (
        <div className="rounded-xl border border-white/10 bg-white/5 p-5 space-y-3">
          <p className="text-xs text-white/50 uppercase tracking-wide">Your API key</p>
          <div className="flex items-center gap-3">
            <code className="flex-1 truncate rounded-lg bg-white/5 px-4 py-2.5 text-sm font-mono text-emerald-400 border border-white/10">
              {apiKey}
            </code>
            <button
              onClick={copyKey}
              className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white/70 hover:bg-white/10 transition"
            >
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          </div>
          <p className="text-xs text-amber-400/80">Save this key — it won&apos;t be shown again.</p>
        </div>
      ) : (
        <div className="text-center">
          {keyError && <p className="mb-4 text-sm text-red-400">{keyError}</p>}
          <button
            onClick={generateApiKey}
            disabled={keyLoading}
            className="rounded-lg bg-[#7C5CFF] px-6 py-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {keyLoading ? 'Generating…' : 'Generate API key'}
          </button>
        </div>
      )}

      {/* Quickstart */}
      <div className="mt-10 rounded-xl border border-white/10 bg-white/5 p-6 space-y-4">
        <p className="text-sm font-medium text-white/80">Quickstart</p>
        <pre className="overflow-x-auto rounded-lg bg-black/40 p-4 text-xs text-[#7C5CFF]/90 border border-white/5">
          {`curl -X POST https://api.swarmsync.ai/api/verify \\
  -H "Authorization: Bearer <your-key>" \\
  -H "Content-Type: application/json" \\
  -d '{ "source_type": "api_output", "task": "invoice_extraction", "output": { "vendor_name": "Acme Corp", "amount_total": 8450 } }'`}
        </pre>

        <ul className="space-y-2">
          {[
            { href: '/verify-api/docs', label: 'Full quickstart guide' },
            { href: '/console/settings/api-keys', label: 'Manage API keys' },
            { href: '/console/proof/usage', label: 'View quota & usage' },
            { href: '/verify-api', label: 'API reference' },
          ].map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="flex items-center gap-2 text-sm text-[#7C5CFF] hover:opacity-80"
              >
                <span className="text-white/40">→</span>
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-8 text-center">
        <Link
          href="/console/proof"
          className="text-sm text-white/40 hover:text-white/70 transition"
        >
          Go to Proof Dashboard →
        </Link>
      </div>
    </main>
  );
}

export default function VerifyApiWelcomePage() {
  return (
    <Suspense fallback={<main className="py-24 text-center text-white/50">Loading…</main>}>
      <VerifyApiWelcomeInner />
    </Suspense>
  );
}
