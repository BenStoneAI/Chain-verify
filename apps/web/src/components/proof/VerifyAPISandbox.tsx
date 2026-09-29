'use client';

import { useState } from 'react';

import { downloadJSONBlob, downloadPDFPrint } from '@/lib/proof-export';
import { PROOF_VERIFY_DEMO_PATH, resolveProofApiBase } from '@/lib/proof-api';
import { SoftwareDeliveryForm } from '@/components/proof/SoftwareDeliveryForm';

interface VerifyResult {
  verification_id: string;
  proof_id: string;
  verification_status: 'passed' | 'needs_review' | 'failed';
  confidence: number;
  risk_level: 'low' | 'medium' | 'high';
  issues_found: string[];
  recommended_action: 'approved' | 'human_review' | 'blocked';
}

export type VerificationType =
  | 'invoice_extraction'
  | 'agent_activity'
  | 'api_output'
  | 'document'
  | 'workflow_event';

const TYPE_LABELS: Record<VerificationType, string> = {
  invoice_extraction: 'Invoice extraction',
  agent_activity: 'Agent activity',
  api_output: 'API output',
  document: 'Document',
  workflow_event: 'Workflow event',
};

const STATUS_CONFIG = {
  passed: {
    label: 'Passed',
    bg: 'bg-emerald-500/15',
    border: 'border-emerald-500/30',
    text: 'text-emerald-400',
    dot: 'bg-emerald-400',
    summary: 'All checks cleared. This output is safe to use downstream.',
  },
  needs_review: {
    label: 'Needs Review',
    bg: 'bg-yellow-500/15',
    border: 'border-yellow-500/30',
    text: 'text-yellow-400',
    dot: 'bg-yellow-400',
    summary: 'One or more checks flagged. A human reviewer should inspect this output.',
  },
  failed: {
    label: 'Failed',
    bg: 'bg-red-500/15',
    border: 'border-red-500/30',
    text: 'text-red-400',
    dot: 'bg-red-400',
    summary: 'This output failed verification. Do not release it downstream.',
  },
} as const;

const RISK_LABELS: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

const ACTION_LABELS: Record<string, string> = {
  approved: 'Approved',
  human_review: 'Hold for human review',
  blocked: 'Blocked',
};

const LABEL_CLASS = 'block text-xs font-medium text-white/60 mb-1.5';
const SELECT_CLASS =
  'w-full rounded-lg border border-white/10 bg-[#0B0E1C] px-3 py-2.5 text-sm text-white outline-none transition-colors duration-150 focus:border-[#00E5FF]/60 focus:ring-1 focus:ring-[#00E5FF]/40';

const RULES_BY_TYPE: Record<VerificationType, string[]> = {
  invoice_extraction: [
    'required_fields_present',
    'vendor_name_present',
    'amount_total_present',
    'invoice_number_present',
    'due_date_present',
    'missing_po_check',
  ],
  agent_activity: [
    'agent_identity_present',
    'workflow_name_present',
    'task_description_present',
    'input_output_pair_present',
    'timestamp_integrity_check',
    'human_approval_check',
    'risk_level_check',
  ],
  api_output: ['required_fields_present'],
  document: ['required_fields_present'],
  workflow_event: [
    'agent_identity_present',
    'workflow_name_present',
    'timestamp_integrity_check',
  ],
};

export function buildVerifyApiSandboxPayload(content: string, verType: VerificationType) {
  let parsedPayload: Record<string, unknown> | null = null;
  let parsedOutput: unknown;
  try {
    const maybeObj = JSON.parse(content.trim());
    if (maybeObj !== null && typeof maybeObj === 'object' && !Array.isArray(maybeObj)) {
      parsedPayload = maybeObj as Record<string, unknown>;
      parsedOutput = parsedPayload.output !== undefined ? parsedPayload.output : parsedPayload;
    } else {
      parsedOutput = { content: content.trim() };
    }
  } catch {
    parsedOutput = { content: content.trim() };
  }

  return {
    source_type:
      typeof parsedPayload?.source_type === 'string' ? parsedPayload.source_type : 'api_output',
    task: typeof parsedPayload?.task === 'string' ? parsedPayload.task : verType,
    output: parsedOutput,
    ...(parsedPayload && 'evidence' in parsedPayload ? { evidence: parsedPayload.evidence } : {}),
    rules: Array.isArray(parsedPayload?.rules)
      ? parsedPayload.rules
      : (RULES_BY_TYPE[verType] ?? ['required_fields_present']),
  };
}

// Which top-level mode is active. 'freeform' uses the existing demo path;
// 'software_delivery' renders SoftwareDeliveryForm on the authenticated path.
// 'software_delivery' is kept as a string literal here — NOT added to the
// VerificationType union — so the freeform demo path remains unchanged.
type SandboxMode = 'freeform' | 'software_delivery';

const SANDBOX_MODE_LABELS: Record<SandboxMode, string> = {
  freeform: 'Freeform demo',
  software_delivery: 'Software delivery',
};

export function VerifyAPISandbox() {
  const [sandboxMode, setSandboxMode] = useState<SandboxMode>('freeform');

  const [content, setContent] = useState('');
  const [verType, setVerType] = useState<VerificationType>('api_output');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [jsonLoading, setJsonLoading] = useState(false);
  const [jsonError, setJsonError] = useState<string | null>(null);

  function handleExport(currentResult: VerifyResult, format: 'json' | 'pdf') {
    const setLoadingState = format === 'pdf' ? setPdfLoading : setJsonLoading;
    const setErrorState = format === 'pdf' ? setPdfError : setJsonError;
    setLoadingState(true);
    setErrorState(null);
    try {
      if (format === 'json') {
        downloadJSONBlob(currentResult, `verify-api-proof-${currentResult.proof_id}`);
      } else {
        downloadPDFPrint(currentResult, 'VerifyAPI Proof Report');
      }
    } catch (err) {
      setErrorState(err instanceof Error ? err.message : `Failed to download ${format.toUpperCase()}.`);
    } finally {
      setLoadingState(false);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitError(null);
    setResult(null);
    setContentError(null);

    if (!content.trim()) {
      setContentError('Paste some AI output to verify.');
      return;
    }

    setLoading(true);
    try {
      const apiBase = resolveProofApiBase();

      const payload = buildVerifyApiSandboxPayload(content, verType);

      const res = await fetch(`${apiBase}${PROOF_VERIFY_DEMO_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        console.error('Verification API error:', res.status);
        throw new Error(`Verification failed. Please try again (HTTP ${res.status}).`);
      }

      const data: VerifyResult = await res.json();
      setResult(data);
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : 'An unexpected error occurred. Please try again.',
      );
    } finally {
      setLoading(false);
    }
  }

  const statusCfg = result ? STATUS_CONFIG[result.verification_status] : null;

  const resultJson = result
    ? JSON.stringify(
        {
          verification_id: result.verification_id,
          proof_id: result.proof_id,
          verification_status: result.verification_status,
          confidence: result.confidence,
          risk_level: result.risk_level,
          issues_found: result.issues_found,
          recommended_action: result.recommended_action,
        },
        null,
        2,
      )
    : null;

  return (
    <div className="w-full max-w-2xl mx-auto">
      {/* Sandbox mode tabs — 'software_delivery' is a separate branch that posts
          to the authenticated endpoint; it is NOT part of VerificationType. */}
      <div
        role="tablist"
        aria-label="Sandbox mode"
        className="flex gap-1 mb-6 rounded-lg bg-white/5 p-1"
      >
        {(Object.keys(SANDBOX_MODE_LABELS) as SandboxMode[]).map((mode) => (
          <button
            key={mode}
            type="button"
            role="tab"
            aria-selected={sandboxMode === mode}
            aria-controls={`sandbox-panel-${mode}`}
            id={`sandbox-tab-${mode}`}
            onClick={() => setSandboxMode(mode)}
            className={`flex-1 rounded-md px-3 py-2 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00E5FF]/60 ${
              sandboxMode === mode
                ? 'bg-[#00E5FF] text-white shadow-sm'
                : 'text-white/50 hover:text-white/80'
            }`}
          >
            {SANDBOX_MODE_LABELS[mode]}
          </button>
        ))}
      </div>

      {/* Software delivery branch — authenticated, posts to PROOF_VERIFY_AUTH_PATH */}
      {sandboxMode === 'software_delivery' && (
        <div
          role="tabpanel"
          id="sandbox-panel-software_delivery"
          aria-labelledby="sandbox-tab-software_delivery"
        >
          <SoftwareDeliveryForm />
        </div>
      )}

      {/* Freeform demo branch — existing logic, demo endpoint, no auth required */}
      {sandboxMode === 'freeform' && (
        <div
          role="tabpanel"
          id="sandbox-panel-freeform"
          aria-labelledby="sandbox-tab-freeform"
        >
      <form
        onSubmit={handleSubmit}
        noValidate
        aria-label="API output verification sandbox"
        className="space-y-5"
      >
        {/* Verification type */}
        <div>
          <label htmlFor="vs-type" className={LABEL_CLASS}>
            Verification type
          </label>
          <select
            id="vs-type"
            value={verType}
            onChange={(e) => setVerType(e.target.value as VerificationType)}
            className={SELECT_CLASS}
          >
            {(Object.keys(TYPE_LABELS) as VerificationType[]).map((key) => (
              <option key={key} value={key}>
                {TYPE_LABELS[key]}
              </option>
            ))}
          </select>
        </div>

        {/* Content textarea */}
        <div>
          <label htmlFor="vs-content" className={LABEL_CLASS}>
            Paste your AI output <span className="text-white/30 font-normal">(JSON or text)</span>{' '}
            <span className="text-red-400" aria-hidden="true">
              *
            </span>
          </label>
          <textarea
            id="vs-content"
            rows={8}
            placeholder={
              verType === 'invoice_extraction'
                ? '{"vendor_name":"Acme Corp","invoice_number":"INV-10492","amount_total":8450,"currency":"USD"}'
                : verType === 'agent_activity'
                  ? '{"agent":"GPT-4o","task":"Reviewed invoice","output":"approved","confidence":0.97}'
                  : 'Paste JSON output or plain text to verify…'
            }
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              if (contentError) setContentError(null);
            }}
            aria-required="true"
            aria-describedby={contentError ? 'vs-err-content' : undefined}
            aria-invalid={!!contentError}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-white/25 outline-none transition-colors duration-150 focus:border-[#00E5FF]/60 focus:ring-1 focus:ring-[#00E5FF]/40 resize-none font-mono"
          />
          {contentError && (
            <p id="vs-err-content" role="alert" className="mt-1 text-xs text-red-400">
              {contentError}
            </p>
          )}
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-[#00E5FF] px-6 py-3 text-sm font-semibold text-white transition-opacity duration-150 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00E5FF] focus-visible:ring-offset-2 focus-visible:ring-offset-[#03050A] disabled:cursor-not-allowed disabled:opacity-60"
          aria-busy={loading}
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <svg
                className="h-4 w-4 animate-spin"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                />
              </svg>
              Running verification…
            </span>
          ) : (
            'Run verification'
          )}
        </button>
      </form>

      {/* Error state */}
      {submitError && (
        <div
          role="alert"
          className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 px-5 py-4 text-sm text-red-300"
        >
          <p className="font-medium text-red-400 mb-1">Verification failed</p>
          <p>{submitError}</p>
        </div>
      )}

      {/* Result */}
      {result && statusCfg && resultJson && (
        <div role="region" aria-label="Verification result" className="mt-6 space-y-4">
          {/* Human-friendly summary */}
          <div
            className={`rounded-xl border p-5 flex items-start gap-4 ${statusCfg.bg} ${statusCfg.border}`}
          >
            <span
              className={`mt-0.5 h-3 w-3 shrink-0 rounded-full ${statusCfg.dot}`}
              aria-hidden="true"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-3 flex-wrap mb-1">
                <span className={`text-sm font-semibold ${statusCfg.text}`}>{statusCfg.label}</span>
                <span className="text-xs text-white/40">
                  Risk:{' '}
                  <span className="text-white/60 font-medium">
                    {RISK_LABELS[result.risk_level] ?? result.risk_level}
                  </span>
                </span>
                <span className="text-xs text-white/40">
                  Confidence:{' '}
                  <span className="text-white/60 font-medium">
                    {Math.round(result.confidence * 100)}%
                  </span>
                </span>
              </div>
              <p className="text-sm text-white/70">{statusCfg.summary}</p>
              <p className="text-sm text-white/60 mt-1">
                Action:{' '}
                <span className="font-medium text-white/80">
                  {ACTION_LABELS[result.recommended_action] ?? result.recommended_action}
                </span>
              </p>
              {result.issues_found.length > 0 && (
                <ul className="mt-2 space-y-1" aria-label="Issues found">
                  {result.issues_found.map((issue, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-white/60">
                      <span
                        className="mt-0.5 text-yellow-400 font-bold shrink-0"
                        aria-hidden="true"
                      >
                        !
                      </span>
                      {issue}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* JSON result block */}
          <div className="rounded-xl border border-white/10 bg-[#0B0E1C] overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/8">
              <span className="text-xs font-medium text-white/40">Response JSON</span>
              <span className="text-xs text-white/25 font-mono">POST /api/verify/demo</span>
            </div>
            <pre
              className="px-4 py-4 text-xs text-white/70 font-mono overflow-x-auto leading-relaxed whitespace-pre"
              aria-label="Verification result JSON"
            >
              {resultJson}
            </pre>
          </div>

          {/* Export actions */}
          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={() => handleExport(result, 'json')}
              disabled={jsonLoading}
              className="border border-white/12 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-white/8 disabled:opacity-50 transition-colors duration-150"
            >
              {jsonLoading ? 'Downloading JSON...' : 'Download JSON'}
            </button>
            <button
              type="button"
              onClick={() => handleExport(result, 'pdf')}
              disabled={pdfLoading}
              className="bg-[#00E5FF] text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-[#7650D8] disabled:opacity-50 transition-colors duration-150"
            >
              {pdfLoading ? 'Preparing PDF...' : 'Download PDF'}
            </button>
            {(jsonError || pdfError) && (
              <span className="text-xs text-amber-300">{jsonError ?? pdfError}</span>
            )}
          </div>

          {/* Reset */}
          <button
            type="button"
            onClick={() => {
              setResult(null);
              setContent('');
              setSubmitError(null);
            }}
            className="text-sm text-white/40 hover:text-white/70 transition-colors duration-150 underline underline-offset-2"
          >
            Run another verification
          </button>

          {/* Retrieve hint */}
          <p className="text-xs text-white/30 px-1">
            Retrieve this result anytime:{' '}
            <span className="font-mono text-white/50">
              GET https://chain-verify-api.onrender.com/api/verify/{result.verification_id}
            </span>
          </p>
        </div>
      )}
        </div>
      )}
    </div>
  );
}

export default VerifyAPISandbox;
