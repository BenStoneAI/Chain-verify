'use client';

import { useState } from 'react';

import { DEFAULT_API_BASE, AUTH_TOKEN_KEY } from '@/lib/constants';
import { PROOF_VERIFY_AUTH_PATH, PROOF_VERIFY_DEMO_PATH, resolveProofApiBase } from '@/lib/proof-api';
import { ProofCheckoutButton } from '@/components/proof/ProofCheckoutButton';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SoftwareTier = 'BASIC' | 'STANDARD' | 'THOROUGH';

type SoftwareJobType =
  | 'BUG_FIX'
  | 'DEPLOY_UPDATE'
  | 'WRITE_TESTS'
  | 'MIGRATE_DATA'
  | 'BUILD_INTEGRATION'
  | 'NEW_FEATURE'
  | 'CODE_REVIEW';

type DeployPlatform = 'NETLIFY' | 'RENDER' | 'VERCEL' | 'RAILWAY' | 'OTHER';

interface SoftwareDeliveryResult {
  verification_status: string;
  confidence: number;
  proof_id: string;
  tier_run: string;
  job_type: string;
  escalated: boolean;
  escalation_reason: string | null;
  summary: string;
  checks_passed: number;
  checks_failed: number;
  checks_warning: number;
  checks_skipped: number;
  issues_found: Array<{
    check_id: string;
    check_name: string;
    status: string;
    detail: string | null;
  }>;
  recommended_action: string;
  results: Array<{
    check_id: string;
    check_name: string;
    status: string;
    detail: string | null;
    duration_ms: number | null;
    evidence: unknown;
  }>;
}

interface ApiErrorShape {
  message?: string;
  errors?: string[];
  details?: string[];
  statusCode?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TIER_LABELS: Record<SoftwareTier, string> = {
  BASIC: 'Basic',
  STANDARD: 'Standard',
  THOROUGH: 'Thorough',
};

const JOB_TYPE_LABELS: Record<SoftwareJobType, string> = {
  BUG_FIX: 'Bug fix',
  DEPLOY_UPDATE: 'Deploy update',
  WRITE_TESTS: 'Write tests',
  MIGRATE_DATA: 'Migrate data',
  BUILD_INTEGRATION: 'Build integration',
  NEW_FEATURE: 'New feature',
  CODE_REVIEW: 'Code review',
};

const DEPLOY_PLATFORM_LABELS: Record<DeployPlatform, string> = {
  NETLIFY: 'Netlify',
  RENDER: 'Render',
  VERCEL: 'Vercel',
  RAILWAY: 'Railway',
  OTHER: 'Other',
};

const STATUS_CONFIG: Record<string, { label: string; bg: string; border: string; text: string; dot: string }> = {
  passed: {
    label: 'Passed',
    bg: 'bg-emerald-500/15',
    border: 'border-emerald-500/30',
    text: 'text-emerald-400',
    dot: 'bg-emerald-400',
  },
  'needs-review': {
    label: 'Needs Review',
    bg: 'bg-yellow-500/15',
    border: 'border-yellow-500/30',
    text: 'text-yellow-400',
    dot: 'bg-yellow-400',
  },
  failed: {
    label: 'Failed',
    bg: 'bg-red-500/15',
    border: 'border-red-500/30',
    text: 'text-red-400',
    dot: 'bg-red-400',
  },
  escalated: {
    label: 'Escalated',
    bg: 'bg-red-500/15',
    border: 'border-red-500/30',
    text: 'text-red-400',
    dot: 'bg-red-400',
  },
};

const ACTION_LABELS: Record<string, string> = {
  approved: 'Approved',
  human_review: 'Hold for human review',
  blocked: 'Blocked',
};

const CHECK_STATUS_COLOR: Record<string, string> = {
  passed: 'text-emerald-400',
  failed: 'text-red-400',
  warning: 'text-yellow-400',
  skipped: 'text-white/30',
};

// ---------------------------------------------------------------------------
// Document delivery result type (demo endpoint, no auth required)
// ---------------------------------------------------------------------------

interface DocumentDeliveryResult {
  verification_status: string;
  risk_level: string;
  issues_found: string[];
  recommended_action: string;
  proof_id?: string;
  verification_id?: string;
  confidence?: number;
}

// ---------------------------------------------------------------------------
// Shared style tokens (match AgentGateSandbox)
// ---------------------------------------------------------------------------

const LABEL_CLASS = 'block text-xs font-medium text-white/60 mb-1.5';
const INPUT_CLASS =
  'w-full rounded-lg border border-white/10 bg-[#0B0E1C] px-3 py-2.5 text-sm text-white placeholder-white/25 outline-none transition-colors duration-150 focus:border-[#7C5CFF]/60 focus:ring-1 focus:ring-[#7C5CFF]/40';
const SELECT_CLASS =
  'w-full rounded-lg border border-white/10 bg-[#0B0E1C] px-3 py-2.5 text-sm text-white outline-none transition-colors duration-150 focus:border-[#7C5CFF]/60 focus:ring-1 focus:ring-[#7C5CFF]/40';
const TEXTAREA_CLASS =
  'w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-white/25 outline-none transition-colors duration-150 focus:border-[#7C5CFF]/60 focus:ring-1 focus:ring-[#7C5CFF]/40 resize-y font-mono';
const SECTION_TITLE_CLASS = 'text-xs font-semibold text-white/40 uppercase tracking-widest mb-3';

// ---------------------------------------------------------------------------
// Spinner (reused from AgentGateSandbox pattern)
// ---------------------------------------------------------------------------

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Field-level error display
// ---------------------------------------------------------------------------

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-1 text-xs text-red-400">
      {message}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function SoftwareDeliveryForm() {
  // Sub-tab: 'git' = existing GitHub SHA form; 'document' = new document delivery form
  const [deliverySubTab, setDeliverySubTab] = useState<'git' | 'document'>('document');

  // ---------------------------------------------------------------------------
  // Document delivery state
  // ---------------------------------------------------------------------------
  const [deliveryStatement, setDeliveryStatement] = useState('');
  const [integrationScope, setIntegrationScope] = useState('');
  const [docLoading, setDocLoading] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);
  const [docResult, setDocResult] = useState<DocumentDeliveryResult | null>(null);

  async function handleDocumentSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setDocError(null);
    setDocResult(null);

    if (!deliveryStatement.trim()) {
      setDocError('Delivery statement is required.');
      return;
    }

    setDocLoading(true);
    try {
      const apiBase = resolveProofApiBase();
      const body: Record<string, unknown> = {
        source_type: 'software_delivery',
        output: {
          delivery_statement: deliveryStatement.trim(),
          ...(integrationScope.trim() ? { integration_scope: integrationScope.trim() } : {}),
        },
      };

      const res = await fetch(`${apiBase}${PROOF_VERIFY_DEMO_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { message?: string };
        throw new Error(data?.message ?? `Verification failed (HTTP ${res.status}).`);
      }

      const data = await res.json() as DocumentDeliveryResult;
      setDocResult(data);
    } catch (err) {
      setDocError(err instanceof Error ? err.message : 'An unexpected error occurred. Please try again.');
    } finally {
      setDocLoading(false);
    }
  }

  // Resolve token client-side — same pattern as console/proof/page.tsx
  function resolveToken(): string | null {
    return typeof window !== 'undefined' ? localStorage.getItem(AUTH_TOKEN_KEY) : null;
  }

  // ---------------------------------------------------------------------------
  // Required fields state
  // ---------------------------------------------------------------------------
  const [repoOwner, setRepoOwner] = useState('');
  const [repoName, setRepoName] = useState('');
  const [beforeSha, setBeforeSha] = useState('');
  const [afterSha, setAfterSha] = useState('');
  const [jobStartedAt, setJobStartedAt] = useState('');
  const [tier, setTier] = useState<SoftwareTier>('STANDARD');
  const [jobType, setJobType] = useState<SoftwareJobType>('NEW_FEATURE');

  // ---------------------------------------------------------------------------
  // Optional / advanced fields state
  // ---------------------------------------------------------------------------
  const [jobDescription, setJobDescription] = useState('');
  const [aiReport, setAiReport] = useState('');
  const [deployUrl, setDeployUrl] = useState('');
  const [deployPlatform, setDeployPlatform] = useState<DeployPlatform | ''>('');
  const [prNumber, setPrNumber] = useState('');
  const [jobValueUsd, setJobValueUsd] = useState('');
  const [diffSize, setDiffSize] = useState('');

  // Provider creds (never persisted — password inputs, cleared on reset)
  const [netlifyToken, setNetlifyToken] = useState('');
  const [netlifySiteId, setNetlifySiteId] = useState('');
  const [renderToken, setRenderToken] = useState('');
  const [renderServiceId, setRenderServiceId] = useState('');
  const [vercelToken, setVercelToken] = useState('');
  const [vercelProjectId, setVercelProjectId] = useState('');
  const [vercelTeamId, setVercelTeamId] = useState('');
  const [railwayToken, setRailwayToken] = useState('');
  const [railwayServiceId, setRailwayServiceId] = useState('');

  // Sentry creds (never persisted)
  const [sentryOrgSlug, setSentryOrgSlug] = useState('');
  const [sentryProjectSlug, setSentryProjectSlug] = useState('');
  const [sentryAuthToken, setSentryAuthToken] = useState('');
  const [sentryEnvironment, setSentryEnvironment] = useState('');

  // Performance fields
  const [performanceBaselineP95Ms, setPerformanceBaselineP95Ms] = useState('');
  const [performanceProbePaths, setPerformanceProbePaths] = useState('');

  // ---------------------------------------------------------------------------
  // UI state
  // ---------------------------------------------------------------------------
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SoftwareDeliveryResult | null>(null);
  const [errorType, setErrorType] = useState<'auth' | 'validation' | 'quota' | 'generic' | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string[]>([]);

  // Per-field validation errors shown below each field after a 400
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function clearErrors() {
    setErrorType(null);
    setErrorMessage(null);
    setErrorDetails([]);
    setFieldErrors({});
  }

  function reset() {
    clearErrors();
    setResult(null);
    setRepoOwner('');
    setRepoName('');
    setBeforeSha('');
    setAfterSha('');
    setJobStartedAt('');
    setTier('STANDARD');
    setJobType('NEW_FEATURE');
    setJobDescription('');
    setAiReport('');
    setDeployUrl('');
    setDeployPlatform('');
    setPrNumber('');
    setJobValueUsd('');
    setDiffSize('');
    setNetlifyToken('');
    setNetlifySiteId('');
    setRenderToken('');
    setRenderServiceId('');
    setVercelToken('');
    setVercelProjectId('');
    setVercelTeamId('');
    setRailwayToken('');
    setRailwayServiceId('');
    setSentryOrgSlug('');
    setSentryProjectSlug('');
    setSentryAuthToken('');
    setSentryEnvironment('');
    setPerformanceBaselineP95Ms('');
    setPerformanceProbePaths('');
    setAdvancedOpen(false);
  }

  // ---------------------------------------------------------------------------
  // Build DTO output object — only include optional fields when non-empty
  // ---------------------------------------------------------------------------
  function buildOutput(): Record<string, unknown> {
    const output: Record<string, unknown> = {
      repoOwner,
      repoName,
      beforeSha,
      afterSha,
      // Convert datetime-local value (YYYY-MM-DDTHH:MM) to full ISO 8601
      jobStartedAt: jobStartedAt ? new Date(jobStartedAt).toISOString() : '',
      tier,
      jobType,
    };

    if (jobDescription.trim()) output.jobDescription = jobDescription.trim();
    if (aiReport.trim()) output.aiReport = aiReport.trim();
    if (deployUrl.trim()) output.deployUrl = deployUrl.trim();
    if (deployPlatform) output.deployPlatform = deployPlatform;
    if (prNumber.trim()) { const pr = parseInt(prNumber, 10); if (Number.isFinite(pr)) output.prNumber = pr; }
    if (jobValueUsd.trim()) { const jv = parseFloat(jobValueUsd); if (Number.isFinite(jv)) output.jobValueUsd = jv; }
    if (diffSize.trim()) { const ds = parseInt(diffSize, 10); if (Number.isFinite(ds)) output.diffSize = ds; }

    // Provider credentials — never persisted client-side; send only when filled
    if (netlifyToken.trim()) output.netlifyToken = netlifyToken.trim();
    if (netlifySiteId.trim()) output.netlifySiteId = netlifySiteId.trim();
    if (renderToken.trim()) output.renderToken = renderToken.trim();
    if (renderServiceId.trim()) output.renderServiceId = renderServiceId.trim();
    if (vercelToken.trim()) output.vercelToken = vercelToken.trim();
    if (vercelProjectId.trim()) output.vercelProjectId = vercelProjectId.trim();
    if (vercelTeamId.trim()) output.vercelTeamId = vercelTeamId.trim();
    if (railwayToken.trim()) output.railwayToken = railwayToken.trim();
    if (railwayServiceId.trim()) output.railwayServiceId = railwayServiceId.trim();

    // Sentry
    if (sentryOrgSlug.trim()) output.sentryOrgSlug = sentryOrgSlug.trim();
    if (sentryProjectSlug.trim()) output.sentryProjectSlug = sentryProjectSlug.trim();
    if (sentryAuthToken.trim()) output.sentryAuthToken = sentryAuthToken.trim();
    if (sentryEnvironment.trim()) output.sentryEnvironment = sentryEnvironment.trim();

    // Performance
    if (performanceBaselineP95Ms.trim())
      output.performanceBaselineP95Ms = parseFloat(performanceBaselineP95Ms);
    if (performanceProbePaths.trim()) {
      output.performanceProbePaths = performanceProbePaths
        .split('\n')
        .map((p) => p.trim())
        .filter(Boolean);
    }

    return output;
  }

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------
  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    clearErrors();
    setResult(null);

    const token = resolveToken();
    if (!token) {
      setErrorType('auth');
      setErrorMessage('Sign in to run software-delivery verification');
      return;
    }

    setLoading(true);
    try {
      const body = {
        source_type: 'software_delivery',
        output: buildOutput(),
        rules: ['auto'],
      };

      const res = await fetch(`${DEFAULT_API_BASE}${PROOF_VERIFY_AUTH_PATH}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      if (res.status === 401) {
        setErrorType('auth');
        setErrorMessage('Sign in to run software-delivery verification');
        return;
      }

      if (res.status === 429) {
        let msg = 'Monthly verification limit reached. Upgrade to run more verifications.';
        try {
          const data = await res.json() as { message?: string };
          if (data?.message) msg = data.message;
        } catch {
          // keep default message
        }
        setErrorType('quota');
        setErrorMessage(msg);
        return;
      }

      if (res.status === 400) {
        let parsed: ApiErrorShape = {};
        try {
          parsed = await res.json() as ApiErrorShape;
        } catch {
          // use defaults
        }
        const details = parsed.details ?? parsed.errors ?? [];
        setErrorType('validation');
        setErrorMessage(parsed.message ?? 'Invalid software_delivery payload');
        setErrorDetails(details);
        return;
      }

      if (!res.ok) {
        let msg = `Verification failed (HTTP ${res.status}). Please try again.`;
        try {
          const data = await res.json() as { message?: string };
          if (data?.message) msg = data.message;
        } catch {
          // keep default message
        }
        setErrorType('generic');
        setErrorMessage(msg);
        return;
      }

      const data = await res.json() as SoftwareDeliveryResult;
      setResult(data);
    } catch (err) {
      setErrorType('generic');
      setErrorMessage(
        err instanceof Error ? err.message : 'An unexpected error occurred. Please try again.',
      );
    } finally {
      setLoading(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Guard: no token yet (hydration is async)
  // ---------------------------------------------------------------------------
  const noToken = errorType === 'auth';
  const statusCfg = result ? (STATUS_CONFIG[result.verification_status] ?? STATUS_CONFIG['needs-review']) : null;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="w-full max-w-2xl mx-auto">

      {/* Sub-tab: Git-based / Document delivery */}
      <div
        role="tablist"
        aria-label="Delivery verification method"
        className="flex gap-1 mb-6 rounded-lg bg-white/5 p-1"
      >
        <button
          type="button"
          role="tab"
          aria-selected={deliverySubTab === 'git'}
          aria-controls="sd-panel-git"
          id="sd-tab-git"
          onClick={() => setDeliverySubTab('git')}
          className={`flex-1 rounded-md px-3 py-2 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C5CFF]/60 ${
            deliverySubTab === 'git'
              ? 'bg-[#7C5CFF] text-white shadow-sm'
              : 'text-white/50 hover:text-white/80'
          }`}
        >
          Git-based
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={deliverySubTab === 'document'}
          aria-controls="sd-panel-document"
          id="sd-tab-document"
          onClick={() => setDeliverySubTab('document')}
          className={`flex-1 rounded-md px-3 py-2 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C5CFF]/60 ${
            deliverySubTab === 'document'
              ? 'bg-[#7C5CFF] text-white shadow-sm'
              : 'text-white/50 hover:text-white/80'
          }`}
        >
          Document delivery
        </button>
      </div>

      {/* ── Document delivery panel ── */}
      {deliverySubTab === 'document' && (
        <div
          role="tabpanel"
          id="sd-panel-document"
          aria-labelledby="sd-tab-document"
        >
          <form
            onSubmit={handleDocumentSubmit}
            noValidate
            aria-label="Document delivery verification form"
            className="space-y-5"
          >
            <div>
              <label htmlFor="sd-doc-delivery" className={LABEL_CLASS}>
                Delivery statement{' '}
                <span className="text-red-400" aria-hidden="true">*</span>
              </label>
              <textarea
                id="sd-doc-delivery"
                rows={8}
                value={deliveryStatement}
                onChange={(e) => {
                  setDeliveryStatement(e.target.value);
                  if (docError) setDocError(null);
                }}
                placeholder="Paste your vendor's delivery document, completion report, or handoff statement here…"
                aria-required="true"
                aria-invalid={!!docError && !deliveryStatement.trim()}
                className={TEXTAREA_CLASS}
              />
              {docError && !deliveryStatement.trim() && (
                <p role="alert" className="mt-1 text-xs text-red-400">{docError}</p>
              )}
            </div>

            <div>
              <label htmlFor="sd-doc-requirements" className={LABEL_CLASS}>
                Requirements document{' '}
                <span className="text-white/30 font-normal">(optional)</span>
              </label>
              <textarea
                id="sd-doc-requirements"
                rows={4}
                value={integrationScope}
                onChange={(e) => setIntegrationScope(e.target.value)}
                placeholder="Paste the original requirements or acceptance criteria to compare against…"
                className={TEXTAREA_CLASS}
              />
            </div>

            <button
              type="submit"
              disabled={docLoading}
              className="w-full rounded-lg bg-[#7C5CFF] px-6 py-3 text-sm font-semibold text-white transition-opacity duration-150 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C5CFF] focus-visible:ring-offset-2 focus-visible:ring-offset-[#03050A] disabled:cursor-not-allowed disabled:opacity-60"
              aria-busy={docLoading}
            >
              {docLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <Spinner />
                  Running verification…
                </span>
              ) : (
                'Verify delivery document'
              )}
            </button>
          </form>

          {/* Document delivery error */}
          {docError && deliveryStatement.trim() && (
            <div
              role="alert"
              className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 px-5 py-4 text-sm text-red-300"
            >
              <p className="font-medium text-red-400 mb-1">Verification failed</p>
              <p>{docError}</p>
            </div>
          )}

          {/* Document delivery result */}
          {docResult && (() => {
            const st = docResult.verification_status?.toLowerCase().replace('_', '-') ?? '';
            const cfg = STATUS_CONFIG[st] ?? STATUS_CONFIG['needs-review'];
            return (
              <div role="region" aria-label="Document delivery verification result" className="mt-6 space-y-4">
                <div className={`rounded-xl border p-5 flex items-start gap-4 ${cfg.bg} ${cfg.border}`}>
                  <span className={`mt-0.5 h-3 w-3 shrink-0 rounded-full ${cfg.dot}`} aria-hidden="true" />
                  <div className="min-w-0 w-full">
                    <div className="flex items-center gap-3 flex-wrap mb-2">
                      <span className={`text-sm font-semibold ${cfg.text}`}>{cfg.label}</span>
                      {docResult.risk_level && (
                        <span className="text-xs text-white/40">
                          Risk: <span className="text-white/60 font-medium">{docResult.risk_level}</span>
                        </span>
                      )}
                      {docResult.confidence != null && (
                        <span className="text-xs text-white/40">
                          Confidence: <span className="text-white/60 font-medium">{Math.round(docResult.confidence * 100)}%</span>
                        </span>
                      )}
                    </div>
                    {docResult.recommended_action && (
                      <p className="text-sm text-white/60">
                        Action: <span className="font-medium text-white/80">{ACTION_LABELS[docResult.recommended_action] ?? docResult.recommended_action}</span>
                      </p>
                    )}
                    {docResult.issues_found?.length > 0 && (
                      <ul className="mt-2 space-y-1" aria-label="Issues found">
                        {docResult.issues_found.map((issue, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs text-white/60">
                            <span className="mt-0.5 text-yellow-400 font-bold shrink-0" aria-hidden="true">!</span>
                            {issue}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
                {docResult.proof_id && (
                  <div className="rounded-xl border border-white/10 bg-[#0B0E1C] px-4 py-3">
                    <p className="text-xs text-white/40">
                      Proof ID: <span className="font-mono text-white/60">{docResult.proof_id}</span>
                    </p>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => { setDocResult(null); setDeliveryStatement(''); setIntegrationScope(''); setDocError(null); }}
                  className="text-sm text-white/40 hover:text-white/70 transition-colors duration-150 underline underline-offset-2"
                >
                  Run another verification
                </button>
              </div>
            );
          })()}
        </div>
      )}

      {/* ── Git-based panel ── */}
      {deliverySubTab === 'git' && (
      <div
        role="tabpanel"
        id="sd-panel-git"
        aria-labelledby="sd-tab-git"
      >

      {/* 401 banner when user is not signed in */}
      {noToken && (
        <div
          role="alert"
          className="mb-5 rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-5 py-4 text-sm text-yellow-300"
        >
          <p className="font-medium text-yellow-400 mb-1">Authentication required</p>
          <p>{errorMessage}</p>
          <a
            href="/agent-gate"
            className="mt-2 inline-block text-sm text-[#7C5CFF] hover:opacity-80 underline underline-offset-2"
          >
            Sign in →
          </a>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        noValidate
        aria-label="Software delivery verification form"
        className="space-y-5"
      >
        {/* ------------------------------------------------------------------ */}
        {/* Required fields                                                       */}
        {/* ------------------------------------------------------------------ */}
        <fieldset className="space-y-4">
          <legend className={SECTION_TITLE_CLASS}>Repository</legend>

          <div className="grid grid-cols-2 gap-4">
            {/* repoOwner */}
            <div>
              <label htmlFor="sd-repo-owner" className={LABEL_CLASS}>
                Repo owner{' '}
                <span className="text-red-400" aria-hidden="true">*</span>
              </label>
              <input
                id="sd-repo-owner"
                type="text"
                value={repoOwner}
                onChange={(e) => setRepoOwner(e.target.value)}
                placeholder="octocat"
                required
                aria-required="true"
                aria-describedby={fieldErrors.repoOwner ? 'sd-err-owner' : undefined}
                aria-invalid={!!fieldErrors.repoOwner}
                className={INPUT_CLASS}
              />
              <FieldError id="sd-err-owner" message={fieldErrors.repoOwner} />
            </div>

            {/* repoName */}
            <div>
              <label htmlFor="sd-repo-name" className={LABEL_CLASS}>
                Repo name{' '}
                <span className="text-red-400" aria-hidden="true">*</span>
              </label>
              <input
                id="sd-repo-name"
                type="text"
                value={repoName}
                onChange={(e) => setRepoName(e.target.value)}
                placeholder="hello-world"
                required
                aria-required="true"
                aria-describedby={fieldErrors.repoName ? 'sd-err-name' : undefined}
                aria-invalid={!!fieldErrors.repoName}
                className={INPUT_CLASS}
              />
              <FieldError id="sd-err-name" message={fieldErrors.repoName} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* beforeSha */}
            <div>
              <label htmlFor="sd-before-sha" className={LABEL_CLASS}>
                Before SHA{' '}
                <span className="text-red-400" aria-hidden="true">*</span>
              </label>
              <input
                id="sd-before-sha"
                type="text"
                value={beforeSha}
                onChange={(e) => setBeforeSha(e.target.value)}
                placeholder="abc123f"
                required
                aria-required="true"
                aria-describedby={fieldErrors.beforeSha ? 'sd-err-before' : undefined}
                aria-invalid={!!fieldErrors.beforeSha}
                className={INPUT_CLASS}
              />
              <FieldError id="sd-err-before" message={fieldErrors.beforeSha} />
            </div>

            {/* afterSha */}
            <div>
              <label htmlFor="sd-after-sha" className={LABEL_CLASS}>
                After SHA{' '}
                <span className="text-red-400" aria-hidden="true">*</span>
              </label>
              <input
                id="sd-after-sha"
                type="text"
                value={afterSha}
                onChange={(e) => setAfterSha(e.target.value)}
                placeholder="def456a"
                required
                aria-required="true"
                aria-describedby={fieldErrors.afterSha ? 'sd-err-after' : undefined}
                aria-invalid={!!fieldErrors.afterSha}
                className={INPUT_CLASS}
              />
              <FieldError id="sd-err-after" message={fieldErrors.afterSha} />
            </div>
          </div>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className={SECTION_TITLE_CLASS}>Job details</legend>

          {/* jobStartedAt — datetime-local; converted to ISO 8601 on submit */}
          <div>
            <label htmlFor="sd-job-started" className={LABEL_CLASS}>
              Job started at{' '}
              <span className="text-red-400" aria-hidden="true">*</span>
            </label>
            <input
              id="sd-job-started"
              type="datetime-local"
              value={jobStartedAt}
              onChange={(e) => setJobStartedAt(e.target.value)}
              required
              aria-required="true"
              aria-describedby={fieldErrors.jobStartedAt ? 'sd-err-started' : undefined}
              aria-invalid={!!fieldErrors.jobStartedAt}
              className={INPUT_CLASS}
            />
            <FieldError id="sd-err-started" message={fieldErrors.jobStartedAt} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* tier */}
            <div>
              <label htmlFor="sd-tier" className={LABEL_CLASS}>
                Verification tier{' '}
                <span className="text-red-400" aria-hidden="true">*</span>
              </label>
              <select
                id="sd-tier"
                value={tier}
                onChange={(e) => setTier(e.target.value as SoftwareTier)}
                aria-required="true"
                className={SELECT_CLASS}
              >
                {(Object.keys(TIER_LABELS) as SoftwareTier[]).map((key) => (
                  <option key={key} value={key}>
                    {TIER_LABELS[key]}
                  </option>
                ))}
              </select>
            </div>

            {/* jobType */}
            <div>
              <label htmlFor="sd-job-type" className={LABEL_CLASS}>
                Job type{' '}
                <span className="text-red-400" aria-hidden="true">*</span>
              </label>
              <select
                id="sd-job-type"
                value={jobType}
                onChange={(e) => setJobType(e.target.value as SoftwareJobType)}
                aria-required="true"
                className={SELECT_CLASS}
              >
                {(Object.keys(JOB_TYPE_LABELS) as SoftwareJobType[]).map((key) => (
                  <option key={key} value={key}>
                    {JOB_TYPE_LABELS[key]}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </fieldset>

        {/* ------------------------------------------------------------------ */}
        {/* Advanced / Evidence sources (collapsible)                            */}
        {/* ------------------------------------------------------------------ */}
        <div className="rounded-xl border border-white/10 overflow-hidden">
          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            aria-expanded={advancedOpen}
            aria-controls="sd-advanced-panel"
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-white/60 hover:text-white/80 hover:bg-white/5 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C5CFF]/60 focus-visible:ring-inset"
          >
            <span>Advanced / Evidence sources</span>
            <svg
              className={`h-4 w-4 transition-transform duration-200 ${advancedOpen ? 'rotate-180' : ''}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>

          {advancedOpen && (
            <div
              id="sd-advanced-panel"
              role="region"
              aria-label="Advanced evidence sources"
              className="px-4 pb-5 pt-2 space-y-5 border-t border-white/10"
            >
              {/* General optional fields */}
              <fieldset className="space-y-4">
                <legend className={SECTION_TITLE_CLASS}>General</legend>

                <div>
                  <label htmlFor="sd-job-desc" className={LABEL_CLASS}>
                    Job description
                  </label>
                  <textarea
                    id="sd-job-desc"
                    rows={3}
                    value={jobDescription}
                    onChange={(e) => setJobDescription(e.target.value)}
                    placeholder="Describe what this job did…"
                    className={TEXTAREA_CLASS}
                  />
                </div>

                <div>
                  <label htmlFor="sd-ai-report" className={LABEL_CLASS}>
                    AI report
                  </label>
                  <textarea
                    id="sd-ai-report"
                    rows={3}
                    value={aiReport}
                    onChange={(e) => setAiReport(e.target.value)}
                    placeholder="Paste AI-generated job summary or analysis…"
                    className={TEXTAREA_CLASS}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="sd-pr-number" className={LABEL_CLASS}>
                      PR number
                    </label>
                    <input
                      id="sd-pr-number"
                      type="number"
                      min={1}
                      value={prNumber}
                      onChange={(e) => setPrNumber(e.target.value)}
                      placeholder="42"
                      className={INPUT_CLASS}
                    />
                  </div>
                  <div>
                    <label htmlFor="sd-diff-size" className={LABEL_CLASS}>
                      Diff size (lines)
                    </label>
                    <input
                      id="sd-diff-size"
                      type="number"
                      min={0}
                      value={diffSize}
                      onChange={(e) => setDiffSize(e.target.value)}
                      placeholder="250"
                      className={INPUT_CLASS}
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="sd-job-value" className={LABEL_CLASS}>
                    Job value (USD)
                  </label>
                  <input
                    id="sd-job-value"
                    type="number"
                    min={0}
                    max={1000000}
                    step="0.01"
                    value={jobValueUsd}
                    onChange={(e) => setJobValueUsd(e.target.value)}
                    placeholder="500"
                    className={INPUT_CLASS}
                  />
                </div>
              </fieldset>

              {/* Deploy info */}
              <fieldset className="space-y-4">
                <legend className={SECTION_TITLE_CLASS}>Deployment</legend>

                <div>
                  <label htmlFor="sd-deploy-url" className={LABEL_CLASS}>
                    Deploy URL
                  </label>
                  <input
                    id="sd-deploy-url"
                    type="url"
                    value={deployUrl}
                    onChange={(e) => setDeployUrl(e.target.value)}
                    placeholder="https://example.netlify.app"
                    className={INPUT_CLASS}
                  />
                </div>

                <div>
                  <label htmlFor="sd-deploy-platform" className={LABEL_CLASS}>
                    Deploy platform
                  </label>
                  <select
                    id="sd-deploy-platform"
                    value={deployPlatform}
                    onChange={(e) => setDeployPlatform(e.target.value as DeployPlatform | '')}
                    className={SELECT_CLASS}
                  >
                    <option value="">— Select platform —</option>
                    {(Object.keys(DEPLOY_PLATFORM_LABELS) as DeployPlatform[]).map((key) => (
                      <option key={key} value={key}>
                        {DEPLOY_PLATFORM_LABELS[key]}
                      </option>
                    ))}
                  </select>
                </div>
              </fieldset>

              {/* Provider credentials */}
              <fieldset className="space-y-4">
                <legend className={SECTION_TITLE_CLASS}>
                  Provider credentials{' '}
                  <span className="normal-case font-normal text-white/25">(never stored)</span>
                </legend>

                {/* Netlify */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="sd-netlify-token" className={LABEL_CLASS}>
                      Netlify token
                    </label>
                    <input
                      id="sd-netlify-token"
                      type="password"
                      autoComplete="off"
                      value={netlifyToken}
                      onChange={(e) => setNetlifyToken(e.target.value)}
                      placeholder="••••••••"
                      className={INPUT_CLASS}
                    />
                  </div>
                  <div>
                    <label htmlFor="sd-netlify-site" className={LABEL_CLASS}>
                      Netlify site ID
                    </label>
                    <input
                      id="sd-netlify-site"
                      type="text"
                      value={netlifySiteId}
                      onChange={(e) => setNetlifySiteId(e.target.value)}
                      placeholder="dda03034-…"
                      className={INPUT_CLASS}
                    />
                  </div>
                </div>

                {/* Render */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="sd-render-token" className={LABEL_CLASS}>
                      Render token
                    </label>
                    <input
                      id="sd-render-token"
                      type="password"
                      autoComplete="off"
                      value={renderToken}
                      onChange={(e) => setRenderToken(e.target.value)}
                      placeholder="••••••••"
                      className={INPUT_CLASS}
                    />
                  </div>
                  <div>
                    <label htmlFor="sd-render-service" className={LABEL_CLASS}>
                      Render service ID
                    </label>
                    <input
                      id="sd-render-service"
                      type="text"
                      value={renderServiceId}
                      onChange={(e) => setRenderServiceId(e.target.value)}
                      placeholder="srv-…"
                      className={INPUT_CLASS}
                    />
                  </div>
                </div>

                {/* Vercel */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="sd-vercel-token" className={LABEL_CLASS}>
                      Vercel token
                    </label>
                    <input
                      id="sd-vercel-token"
                      type="password"
                      autoComplete="off"
                      value={vercelToken}
                      onChange={(e) => setVercelToken(e.target.value)}
                      placeholder="••••••••"
                      className={INPUT_CLASS}
                    />
                  </div>
                  <div>
                    <label htmlFor="sd-vercel-project" className={LABEL_CLASS}>
                      Vercel project ID
                    </label>
                    <input
                      id="sd-vercel-project"
                      type="text"
                      value={vercelProjectId}
                      onChange={(e) => setVercelProjectId(e.target.value)}
                      placeholder="prj_…"
                      className={INPUT_CLASS}
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="sd-vercel-team" className={LABEL_CLASS}>
                    Vercel team ID
                  </label>
                  <input
                    id="sd-vercel-team"
                    type="text"
                    value={vercelTeamId}
                    onChange={(e) => setVercelTeamId(e.target.value)}
                    placeholder="team_…"
                    className={INPUT_CLASS}
                  />
                </div>

                {/* Railway */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="sd-railway-token" className={LABEL_CLASS}>
                      Railway token
                    </label>
                    <input
                      id="sd-railway-token"
                      type="password"
                      autoComplete="off"
                      value={railwayToken}
                      onChange={(e) => setRailwayToken(e.target.value)}
                      placeholder="••••••••"
                      className={INPUT_CLASS}
                    />
                  </div>
                  <div>
                    <label htmlFor="sd-railway-service" className={LABEL_CLASS}>
                      Railway service ID
                    </label>
                    <input
                      id="sd-railway-service"
                      type="text"
                      value={railwayServiceId}
                      onChange={(e) => setRailwayServiceId(e.target.value)}
                      placeholder="service-…"
                      className={INPUT_CLASS}
                    />
                  </div>
                </div>
              </fieldset>

              {/* Sentry */}
              <fieldset className="space-y-4">
                <legend className={SECTION_TITLE_CLASS}>
                  Sentry{' '}
                  <span className="normal-case font-normal text-white/25">(never stored)</span>
                </legend>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="sd-sentry-org" className={LABEL_CLASS}>
                      Org slug
                    </label>
                    <input
                      id="sd-sentry-org"
                      type="text"
                      value={sentryOrgSlug}
                      onChange={(e) => setSentryOrgSlug(e.target.value)}
                      placeholder="my-org"
                      className={INPUT_CLASS}
                    />
                  </div>
                  <div>
                    <label htmlFor="sd-sentry-project" className={LABEL_CLASS}>
                      Project slug
                    </label>
                    <input
                      id="sd-sentry-project"
                      type="text"
                      value={sentryProjectSlug}
                      onChange={(e) => setSentryProjectSlug(e.target.value)}
                      placeholder="my-project"
                      className={INPUT_CLASS}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="sd-sentry-token" className={LABEL_CLASS}>
                      Auth token
                    </label>
                    <input
                      id="sd-sentry-token"
                      type="password"
                      autoComplete="off"
                      value={sentryAuthToken}
                      onChange={(e) => setSentryAuthToken(e.target.value)}
                      placeholder="••••••••"
                      className={INPUT_CLASS}
                    />
                  </div>
                  <div>
                    <label htmlFor="sd-sentry-env" className={LABEL_CLASS}>
                      Environment
                    </label>
                    <input
                      id="sd-sentry-env"
                      type="text"
                      value={sentryEnvironment}
                      onChange={(e) => setSentryEnvironment(e.target.value)}
                      placeholder="production"
                      className={INPUT_CLASS}
                    />
                  </div>
                </div>
              </fieldset>

              {/* Performance */}
              <fieldset className="space-y-4">
                <legend className={SECTION_TITLE_CLASS}>Performance</legend>
                <div>
                  <label htmlFor="sd-p95" className={LABEL_CLASS}>
                    Baseline P95 latency (ms)
                  </label>
                  <input
                    id="sd-p95"
                    type="number"
                    min={0}
                    value={performanceBaselineP95Ms}
                    onChange={(e) => setPerformanceBaselineP95Ms(e.target.value)}
                    placeholder="200"
                    className={INPUT_CLASS}
                  />
                </div>
                <div>
                  <label htmlFor="sd-probe-paths" className={LABEL_CLASS}>
                    Probe paths{' '}
                    <span className="text-white/30 font-normal">(one per line)</span>
                  </label>
                  <textarea
                    id="sd-probe-paths"
                    rows={3}
                    value={performanceProbePaths}
                    onChange={(e) => setPerformanceProbePaths(e.target.value)}
                    placeholder={'/api/health\n/api/agents'}
                    className={TEXTAREA_CLASS}
                  />
                </div>
              </fieldset>
            </div>
          )}
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={loading || noToken}
          className="w-full rounded-lg bg-[#7C5CFF] px-6 py-3 text-sm font-semibold text-white transition-opacity duration-150 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C5CFF] focus-visible:ring-offset-2 focus-visible:ring-offset-[#03050A] disabled:cursor-not-allowed disabled:opacity-60"
          aria-busy={loading}
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <Spinner />
              Running verification…
            </span>
          ) : (
            'Run software-delivery verification'
          )}
        </button>
      </form>

      {/* -------------------------------------------------------------------- */}
      {/* Error states                                                           */}
      {/* -------------------------------------------------------------------- */}

      {/* Validation (400) */}
      {errorType === 'validation' && (
        <div
          role="alert"
          className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 px-5 py-4 text-sm text-red-300"
        >
          <p className="font-medium text-red-400 mb-2">{errorMessage}</p>
          {errorDetails.length > 0 && (
            <ul className="space-y-1 list-disc list-inside">
              {errorDetails.map((d, i) => (
                <li key={i} className="text-xs text-red-300">
                  {d}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Quota (429) */}
      {errorType === 'quota' && (
        <div
          role="alert"
          className="mt-6 rounded-xl border border-amber-500/30 bg-amber-500/10 px-5 py-4 text-sm text-amber-300"
        >
          <p className="font-medium text-amber-400 mb-1">Verification quota reached</p>
          <p>{errorMessage}</p>
          <ProofCheckoutButton
            product="verify-api"
            planSlug="agent-gate-build"
            className="mt-2 inline-block text-sm text-[#7C5CFF] hover:opacity-80 underline underline-offset-2"
          >
            Upgrade plan →
          </ProofCheckoutButton>
        </div>
      )}

      {/* Generic error */}
      {errorType === 'generic' && (
        <div
          role="alert"
          className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 px-5 py-4 text-sm text-red-300"
        >
          <p className="font-medium text-red-400 mb-1">Verification failed</p>
          <p>{errorMessage}</p>
        </div>
      )}

      {/* -------------------------------------------------------------------- */}
      {/* Success result                                                         */}
      {/* -------------------------------------------------------------------- */}
      {result && statusCfg && (
        <div role="region" aria-label="Software delivery verification result" className="mt-6 space-y-4">
          {/* Status summary card */}
          <div
            className={`rounded-xl border p-5 flex items-start gap-4 ${statusCfg.bg} ${statusCfg.border}`}
          >
            <span
              className={`mt-0.5 h-3 w-3 shrink-0 rounded-full ${statusCfg.dot}`}
              aria-hidden="true"
            />
            <div className="min-w-0 w-full">
              <div className="flex items-center gap-3 flex-wrap mb-2">
                <span className={`text-sm font-semibold ${statusCfg.text}`}>{statusCfg.label}</span>
                <span className="text-xs text-white/40">
                  Confidence:{' '}
                  <span className="text-white/60 font-medium">
                    {Math.round(result.confidence * 100)}%
                  </span>
                </span>
                <span className="text-xs text-white/40">
                  Tier:{' '}
                  <span className="text-white/60 font-medium">{result.tier_run}</span>
                </span>
                <span className="text-xs text-white/40">
                  Job type:{' '}
                  <span className="text-white/60 font-medium">{result.job_type}</span>
                </span>
              </div>

              {result.summary && (
                <p className="text-sm text-white/70 mb-2">{result.summary}</p>
              )}

              <p className="text-sm text-white/60">
                Action:{' '}
                <span className="font-medium text-white/80">
                  {ACTION_LABELS[result.recommended_action] ?? result.recommended_action}
                </span>
              </p>

              {/* Check counts */}
              <div className="mt-3 flex flex-wrap gap-4 text-xs">
                <span className="text-emerald-400">
                  {result.checks_passed} passed
                </span>
                {result.checks_failed > 0 && (
                  <span className="text-red-400">{result.checks_failed} failed</span>
                )}
                {result.checks_warning > 0 && (
                  <span className="text-yellow-400">{result.checks_warning} warnings</span>
                )}
                {result.checks_skipped > 0 && (
                  <span className="text-white/30">{result.checks_skipped} skipped</span>
                )}
              </div>

              {/* Escalation notice */}
              {result.escalated && (
                <div className="mt-3 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-300">
                  <span className="font-medium text-red-400">Escalated</span>
                  {result.escalation_reason && (
                    <span className="ml-2 text-red-300/80">{result.escalation_reason}</span>
                  )}
                </div>
              )}

              {/* Issues found */}
              {result.issues_found.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-medium text-white/40 mb-1.5">Issues found</p>
                  <ul className="space-y-1" aria-label="Issues found">
                    {result.issues_found.map((issue, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-white/60">
                        <span
                          className={`mt-0.5 font-bold shrink-0 ${CHECK_STATUS_COLOR[issue.status] ?? 'text-white/40'}`}
                          aria-hidden="true"
                        >
                          !
                        </span>
                        <span>
                          <span className="font-medium">{issue.check_name}</span>
                          {issue.detail && (
                            <span className="ml-1 text-white/40">— {issue.detail}</span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>

          {/* All check results table */}
          {result.results.length > 0 && (
            <div className="rounded-xl border border-white/10 bg-[#0B0E1C] overflow-hidden">
              <div className="px-4 py-2.5 border-b border-white/8">
                <span className="text-xs font-medium text-white/40">Check results</span>
              </div>
              <ul aria-label="All check results" className="divide-y divide-white/5">
                {result.results.map((r, i) => (
                  <li key={i} className="px-4 py-3 flex items-start gap-3">
                    <span
                      className={`mt-0.5 text-xs font-semibold uppercase shrink-0 ${CHECK_STATUS_COLOR[r.status] ?? 'text-white/40'}`}
                    >
                      {r.status}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs text-white/70 font-medium">{r.check_name}</p>
                      {r.detail && (
                        <p className="text-xs text-white/40 mt-0.5">{r.detail}</p>
                      )}
                    </div>
                    {r.duration_ms != null && (
                      <span className="ml-auto text-xs text-white/25 shrink-0">
                        {r.duration_ms}ms
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Proof ID */}
          <div className="rounded-xl border border-white/10 bg-[#0B0E1C] px-4 py-3 space-y-1">
            <p className="text-xs text-white/40">
              Proof ID:{' '}
              <span className="font-mono text-white/60">{result.proof_id}</span>
            </p>
          </div>

          {/* Reset */}
          <button
            type="button"
            onClick={reset}
            className="text-sm text-white/40 hover:text-white/70 transition-colors duration-150 underline underline-offset-2"
          >
            Run another verification
          </button>
        </div>
      )}

      </div>
      )} {/* end git-based panel */}

    </div>
  );
}

export default SoftwareDeliveryForm;
