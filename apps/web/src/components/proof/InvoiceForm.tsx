'use client';

import { useState } from 'react';
import Link from 'next/link';

import { downloadJSONBlob, downloadPDFPrint } from '@/lib/proof-export';
import { PROOF_VERIFY_DEMO_PATH, resolveProofApiBase } from '@/lib/proof-api';
import { ProofCheckoutButton } from '@/components/proof/ProofCheckoutButton';

export interface InvoiceFormFields {
  vendor_name: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  amount_total: string;
  currency: string;
  tax_amount: string;
  line_items: string;
  payment_terms: string;
  purchase_order_number: string;
  bank_or_payment_details: string;
  prior_bank_or_payment_details: string;
  customer_name: string;
  flag_duplicate_invoice: boolean;
}

interface VerifyResult {
  verification_id: string;
  proof_id: string;
  verification_status: 'passed' | 'needs_review' | 'failed' | 'blocked';
  confidence: number;
  risk_level: 'low' | 'medium' | 'high' | 'critical';
  issues_found: string[];
  recommended_action: 'approved' | 'human_review' | 'blocked';
}

const EMPTY_FORM: InvoiceFormFields = {
  vendor_name: '',
  invoice_number: '',
  invoice_date: '',
  due_date: '',
  amount_total: '',
  currency: 'USD',
  tax_amount: '',
  line_items: '',
  payment_terms: '',
  purchase_order_number: '',
  bank_or_payment_details: '',
  prior_bank_or_payment_details: '',
  customer_name: '',
  flag_duplicate_invoice: false,
};

/**
 * Pre-filled sample invoice for first-time users, so the form isn't blank.
 *
 * It models a realistic mid-size AP invoice that intentionally omits a PO
 * number and uses a round-dollar total ($14,500) — the kinds of signals
 * InvoiceProof's fraud engine looks for. Note: this public demo runs the
 * field-presence verification tier, so the on-screen verdict reflects data
 * completeness rather than the full fraud-rule engine.
 *
 * "Sample Industrial Supply Co." is a clearly fictional vendor name.
 */
const SAMPLE_FORM: InvoiceFormFields = {
  vendor_name: 'Sample Industrial Supply Co.',
  invoice_number: 'INV-SAMPLE-001',
  invoice_date: '2026-06-01',
  due_date: '2026-07-01',
  amount_total: '14500',
  currency: 'USD',
  tax_amount: '',
  line_items:
    '[{"description":"Heavy-duty conveyor belts (qty 5)","qty":5,"unit_price":2800,"total":14000},{"description":"Shipping & handling","qty":1,"unit_price":500,"total":500}]',
  payment_terms: 'Net 30',
  purchase_order_number: '',
  bank_or_payment_details: '',
  prior_bank_or_payment_details: '',
  customer_name: '',
  flag_duplicate_invoice: false,
};

const STATUS_CONFIG = {
  passed: {
    label: 'Passed',
    bg: 'bg-emerald-500/15',
    border: 'border-emerald-500/30',
    text: 'text-emerald-400',
    dot: 'bg-emerald-400',
  },
  needs_review: {
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
  blocked: {
    label: 'Blocked',
    bg: 'bg-red-500/15',
    border: 'border-red-500/30',
    text: 'text-red-400',
    dot: 'bg-red-400',
  },
} as const;

const RISK_LABELS: Record<string, string> = {
  low: 'Low Risk',
  medium: 'Medium Risk',
  high: 'High Risk',
  critical: 'Critical Risk',
};

const ACTION_LABELS: Record<string, string> = {
  approved: 'Approve for payment',
  human_review: 'Hold for human review',
  blocked: 'Block — do not pay',
};

const LABEL_CLASS = 'block text-xs font-medium text-white/60 mb-1.5';
const INPUT_CLASS =
  'w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-white/25 outline-none transition-colors duration-150 focus:border-[#FFB45C]/60 focus:ring-1 focus:ring-[#FFB45C]/40';
const TEXTAREA_CLASS =
  'w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-white/25 outline-none transition-colors duration-150 focus:border-[#FFB45C]/60 focus:ring-1 focus:ring-[#FFB45C]/40 resize-none';

export function buildInvoiceVerificationPayload(form: InvoiceFormFields) {
  const rules = [
    'required_fields_present',
    'invoice_number_present',
    'vendor_name_present',
    'amount_total_present',
    'due_date_present',
    ...(form.purchase_order_number.trim() ? ['missing_po_check'] : []),
    'duplicate_invoice_check',
    'vendor_name_mismatch',
    'invoice_amount_mismatch',
    'tax_fee_inconsistency',
    'payment_term_changes',
    'bank_detail_changes',
    'suspicious_vendor_change',
    'line_item_math_error',
    'prior_invoice_comparison',
  ];

  return {
    source_type: 'api_output',
    task: 'invoice_extraction',
    output: {
      vendor_name: form.vendor_name.trim(),
      invoice_number: form.invoice_number.trim(),
      invoice_date: form.invoice_date,
      due_date: form.due_date,
      amount_total: Number(form.amount_total),
      currency: form.currency,
      tax_amount: form.tax_amount ? Number(form.tax_amount) : 0,
      payment_terms: form.payment_terms.trim() || undefined,
      purchase_order_number: form.purchase_order_number.trim() || undefined,
      bank_or_payment_details: form.bank_or_payment_details.trim() || undefined,
      customer_name: form.customer_name.trim() || undefined,
      ...(form.flag_duplicate_invoice ? { duplicate_invoice: true } : {}),
      ...(form.line_items.trim() ? { line_items: form.line_items.trim() } : {}),
    },
    evidence: form.prior_bank_or_payment_details.trim()
      ? [
          {
            prior_bank_or_payment_details: form.prior_bank_or_payment_details.trim(),
            vendor_master_bank_details: form.prior_bank_or_payment_details.trim(),
          },
        ]
      : undefined,
    rules,
  };
}

export function InvoiceForm() {
  const [form, setForm] = useState<InvoiceFormFields>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof InvoiceFormFields, string>>>({});
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [jsonLoading, setJsonLoading] = useState(false);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [actionTaken, setActionTaken] = useState<'hold' | 'approve' | 'escalate' | null>(null);

  function handleExport(currentResult: VerifyResult, format: 'json' | 'pdf') {
    const setLoadingState = format === 'pdf' ? setPdfLoading : setJsonLoading;
    const setErrorState = format === 'pdf' ? setPdfError : setJsonError;
    setLoadingState(true);
    setErrorState(null);
    try {
      if (format === 'json') {
        downloadJSONBlob(currentResult, `invoice-proof-${currentResult.proof_id}`);
      } else {
        downloadPDFPrint(currentResult, 'InvoiceProof Report');
      }
    } catch (err) {
      setErrorState(
        err instanceof Error ? err.message : `Failed to download ${format.toUpperCase()}.`,
      );
    } finally {
      setLoadingState(false);
    }
  }

  function set(field: keyof InvoiceFormFields) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
      if (errors[field]) {
        setErrors((prev) => ({ ...prev, [field]: undefined }));
      }
    };
  }

  function validate(): boolean {
    const next: Partial<Record<keyof InvoiceFormFields, string>> = {};
    if (!form.vendor_name.trim()) next.vendor_name = 'Vendor name is required.';
    if (!form.invoice_number.trim()) next.invoice_number = 'Invoice number is required.';
    if (!form.invoice_date) next.invoice_date = 'Invoice date is required.';
    if (!form.due_date) next.due_date = 'Due date is required.';
    if (!form.amount_total.trim()) {
      next.amount_total = 'Invoice total is required.';
    } else if (isNaN(Number(form.amount_total)) || Number(form.amount_total) < 0) {
      next.amount_total = 'Must be a valid number.';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitError(null);
    setResult(null);
    if (!validate()) return;

    setLoading(true);
    try {
      const apiBase = resolveProofApiBase();

      const payload = buildInvoiceVerificationPayload(form);

      const res = await fetch(`${apiBase}${PROOF_VERIFY_DEMO_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.error('Verification API error:', res.status, text);
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

  const statusCfg = result
    ? (STATUS_CONFIG[result.verification_status as keyof typeof STATUS_CONFIG] ??
      STATUS_CONFIG.failed)
    : null;

  return (
    <div className="w-full max-w-2xl mx-auto">
      {/* Sample invoice loader */}
      <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-white/40">
          Fill in your invoice fields below, or load a sample to see how the scanner works.
        </p>
        <button
          type="button"
          onClick={() => {
            setForm(SAMPLE_FORM);
            setErrors({});
            setResult(null);
            setSubmitError(null);
            setActionTaken(null);
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#FFB45C]/40 bg-[#FFB45C]/10 px-3 py-1.5 text-xs font-semibold text-[#FFD7A6] hover:bg-[#FFB45C]/20 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FFB45C] focus-visible:ring-offset-2 focus-visible:ring-offset-[#03050A]"
          aria-label="Load a sample invoice to try the scanner"
        >
          <svg viewBox="0 0 14 14" fill="none" className="w-3.5 h-3.5" aria-hidden="true">
            <path
              d="M2 7h10M7 3l4 4-4 4"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Load sample invoice
        </button>
      </div>

      <form
        onSubmit={handleSubmit}
        noValidate
        aria-label="Invoice verification form"
        className="space-y-5"
      >
        {/* Row 1: Vendor + Invoice Number */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="ip-vendor_name" className={LABEL_CLASS}>
              Vendor name{' '}
              <span className="text-red-400" aria-hidden="true">
                *
              </span>
            </label>
            <input
              id="ip-vendor_name"
              type="text"
              autoComplete="organization"
              placeholder="Acme Corp"
              value={form.vendor_name}
              onChange={set('vendor_name')}
              aria-required="true"
              aria-describedby={errors.vendor_name ? 'ip-err-vendor_name' : undefined}
              aria-invalid={!!errors.vendor_name}
              className={INPUT_CLASS}
            />
            {errors.vendor_name && (
              <p id="ip-err-vendor_name" role="alert" className="mt-1 text-xs text-red-400">
                {errors.vendor_name}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="ip-invoice_number" className={LABEL_CLASS}>
              Invoice number{' '}
              <span className="text-red-400" aria-hidden="true">
                *
              </span>
            </label>
            <input
              id="ip-invoice_number"
              type="text"
              placeholder="INV-10492"
              value={form.invoice_number}
              onChange={set('invoice_number')}
              aria-required="true"
              aria-describedby={errors.invoice_number ? 'ip-err-invoice_number' : undefined}
              aria-invalid={!!errors.invoice_number}
              className={INPUT_CLASS}
            />
            {errors.invoice_number && (
              <p id="ip-err-invoice_number" role="alert" className="mt-1 text-xs text-red-400">
                {errors.invoice_number}
              </p>
            )}
          </div>
        </div>

        {/* Row 2: Dates */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="ip-invoice_date" className={LABEL_CLASS}>
              Invoice date{' '}
              <span className="text-red-400" aria-hidden="true">
                *
              </span>
            </label>
            <input
              id="ip-invoice_date"
              type="date"
              value={form.invoice_date}
              onChange={set('invoice_date')}
              aria-required="true"
              aria-describedby={errors.invoice_date ? 'ip-err-invoice_date' : undefined}
              aria-invalid={!!errors.invoice_date}
              className={INPUT_CLASS}
            />
            {errors.invoice_date && (
              <p id="ip-err-invoice_date" role="alert" className="mt-1 text-xs text-red-400">
                {errors.invoice_date}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="ip-due_date" className={LABEL_CLASS}>
              Due date{' '}
              <span className="text-red-400" aria-hidden="true">
                *
              </span>
            </label>
            <input
              id="ip-due_date"
              type="date"
              value={form.due_date}
              onChange={set('due_date')}
              aria-required="true"
              aria-describedby={errors.due_date ? 'ip-err-due_date' : undefined}
              aria-invalid={!!errors.due_date}
              className={INPUT_CLASS}
            />
            {errors.due_date && (
              <p id="ip-err-due_date" role="alert" className="mt-1 text-xs text-red-400">
                {errors.due_date}
              </p>
            )}
          </div>
        </div>

        {/* Row 3: Amount + Currency */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="ip-amount_total" className={LABEL_CLASS}>
              Invoice total{' '}
              <span className="text-red-400" aria-hidden="true">
                *
              </span>
            </label>
            <input
              id="ip-amount_total"
              type="number"
              min="0"
              step="0.01"
              placeholder="8450.00"
              value={form.amount_total}
              onChange={set('amount_total')}
              aria-required="true"
              aria-describedby={errors.amount_total ? 'ip-err-amount_total' : undefined}
              aria-invalid={!!errors.amount_total}
              className={INPUT_CLASS}
            />
            {errors.amount_total && (
              <p id="ip-err-amount_total" role="alert" className="mt-1 text-xs text-red-400">
                {errors.amount_total}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="ip-currency" className={LABEL_CLASS}>
              Currency
            </label>
            <select
              id="ip-currency"
              value={form.currency}
              onChange={set('currency')}
              className={INPUT_CLASS}
            >
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
              <option value="CAD">CAD</option>
              <option value="AUD">AUD</option>
            </select>
          </div>
        </div>

        {/* Row 4: Tax + PO Number */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="ip-tax_amount" className={LABEL_CLASS}>
              Tax amount <span className="text-white/30 font-normal">(optional)</span>
            </label>
            <input
              id="ip-tax_amount"
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={form.tax_amount}
              onChange={set('tax_amount')}
              className={INPUT_CLASS}
            />
          </div>

          <div>
            <label htmlFor="ip-purchase_order_number" className={LABEL_CLASS}>
              PO number <span className="text-white/30 font-normal">(optional)</span>
            </label>
            <input
              id="ip-purchase_order_number"
              type="text"
              placeholder="PO-2026-001"
              value={form.purchase_order_number}
              onChange={set('purchase_order_number')}
              className={INPUT_CLASS}
            />
          </div>
        </div>

        {/* Row 5: Payment Terms + Customer Name */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="ip-payment_terms" className={LABEL_CLASS}>
              Payment terms <span className="text-white/30 font-normal">(optional)</span>
            </label>
            <input
              id="ip-payment_terms"
              type="text"
              placeholder="Net 30"
              value={form.payment_terms}
              onChange={set('payment_terms')}
              className={INPUT_CLASS}
            />
          </div>

          <div>
            <label htmlFor="ip-customer_name" className={LABEL_CLASS}>
              Customer name <span className="text-white/30 font-normal">(optional)</span>
            </label>
            <input
              id="ip-customer_name"
              type="text"
              placeholder="Your company name"
              value={form.customer_name}
              onChange={set('customer_name')}
              className={INPUT_CLASS}
            />
          </div>
        </div>

        {/* Full-width: Bank / payment details */}
        <div>
          <label htmlFor="ip-bank_or_payment_details" className={LABEL_CLASS}>
            Current bank or payment details{' '}
            <span className="text-white/30 font-normal">(optional)</span>
          </label>
          <textarea
            id="ip-bank_or_payment_details"
            rows={2}
            placeholder="New routing number, account number, IBAN, SWIFT, etc."
            value={form.bank_or_payment_details}
            onChange={set('bank_or_payment_details')}
            className={TEXTAREA_CLASS}
          />
        </div>

        <div>
          <label htmlFor="ip-prior_bank_or_payment_details" className={LABEL_CLASS}>
            Vendor master / prior payment details{' '}
            <span className="text-white/30 font-normal">(optional)</span>
          </label>
          <textarea
            id="ip-prior_bank_or_payment_details"
            rows={2}
            placeholder="Prior routing/account details from vendor master or last paid invoice"
            value={form.prior_bank_or_payment_details}
            onChange={set('prior_bank_or_payment_details')}
            className={TEXTAREA_CLASS}
          />
        </div>

        {/* Full-width: Line items */}
        <div>
          <label htmlFor="ip-line_items" className={LABEL_CLASS}>
            Line items{' '}
            <span className="text-white/30 font-normal">(optional — JSON or comma-separated)</span>
          </label>
          <textarea
            id="ip-line_items"
            rows={3}
            placeholder={'[{"description":"Cloud hosting","qty":1,"unit_price":7000,"total":7000}]'}
            value={form.line_items}
            onChange={set('line_items')}
            className={TEXTAREA_CLASS}
          />
        </div>

        <label className="flex items-start gap-2 text-xs text-white/50 cursor-pointer">
          <input
            type="checkbox"
            checked={form.flag_duplicate_invoice}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, flag_duplicate_invoice: e.target.checked }))
            }
            className="mt-0.5 rounded border-white/20"
          />
          <span>
            Flag as duplicate invoice risk (demo scenario C — matches marketing reel blocked flow)
          </span>
        </label>

        {/* Submit */}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-[#FFB45C] px-6 py-3 text-sm font-semibold text-[#170b02] transition-opacity duration-150 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FFB45C] focus-visible:ring-offset-2 focus-visible:ring-offset-[#03050A] disabled:cursor-not-allowed disabled:opacity-60"
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
              Running invoice checks...
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

      {/* Result card */}
      {result && statusCfg && (
        <div
          role="region"
          aria-label="Verification result"
          className="mt-6 rounded-xl border border-white/10 bg-white/5 p-6 space-y-4"
        >
          {/* Status badge */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <span
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${statusCfg.bg} ${statusCfg.border} ${statusCfg.text}`}
            >
              <span className={`h-2 w-2 rounded-full ${statusCfg.dot}`} aria-hidden="true" />
              {statusCfg.label}
            </span>
            <span className="text-xs text-white/40">
              Risk:{' '}
              <span className="text-white/70 font-medium">
                {RISK_LABELS[result.risk_level] ?? result.risk_level}
              </span>
            </span>
          </div>

          {/* Confidence */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-white/40 shrink-0">Confidence</span>
            <div
              className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden"
              aria-hidden="true"
            >
              <div
                className="h-full rounded-full bg-[#FFB45C]"
                style={{ width: `${Math.round(result.confidence * 100)}%` }}
              />
            </div>
            <span className="text-xs text-white/60 font-medium shrink-0">
              {Math.round(result.confidence * 100)}%
            </span>
          </div>

          {/* Evidence disclaimer */}
          <div className="rounded-lg border border-white/8 bg-white/3 px-4 py-2.5 text-xs text-white/40">
            Demo results reflect field-presence checks only. Risk differentiation (vendor history,
            bank-detail changes, duplicate detection) requires submitting an{' '}
            <code className="text-white/60">evidence</code> array via the API.{' '}
            <a href="/agent-gate" className="text-[#FFB45C] hover:underline">
              Learn more →
            </a>
          </div>

          {/* Low-confidence warning */}
          {Math.round(result.confidence * 100) < 60 && (
            <div
              role="alert"
              className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-300"
            >
              <p className="font-medium text-yellow-400 mb-0.5">
                Low confidence — additional review recommended
              </p>
              <p className="text-xs text-yellow-300/70">
                The verification engine could not confirm all checks from the submitted data alone.
                Provide additional evidence or review manually before processing.
              </p>
            </div>
          )}

          {/* Recommended action */}
          <div className="rounded-lg border border-white/8 bg-white/3 px-4 py-3">
            <p className="text-xs text-white/40 mb-0.5">Recommended action</p>
            <p className="text-sm font-medium text-white">
              {ACTION_LABELS[result.recommended_action] ?? result.recommended_action}
            </p>
          </div>

          {/* Workflow action buttons */}
          <div className="rounded-xl border border-white/10 bg-white/3 px-5 py-4 space-y-3">
            <p className="text-xs font-medium text-white/40">Invoice action</p>
            <div
              className="flex flex-wrap gap-2"
              role="group"
              aria-label="Invoice workflow actions"
            >
              <button
                type="button"
                onClick={() => setActionTaken('hold')}
                aria-pressed={actionTaken === 'hold'}
                className={[
                  'rounded-lg px-4 py-2 text-sm font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[#03050A]',
                  actionTaken === 'hold'
                    ? 'bg-amber-500 text-white focus-visible:ring-amber-500'
                    : 'border border-amber-500/40 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 focus-visible:ring-amber-500',
                ].join(' ')}
              >
                Hold for Review
              </button>
              <button
                type="button"
                onClick={() => setActionTaken('approve')}
                aria-pressed={actionTaken === 'approve'}
                className={[
                  'rounded-lg px-4 py-2 text-sm font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[#03050A]',
                  actionTaken === 'approve'
                    ? 'bg-emerald-600 text-white focus-visible:ring-emerald-500'
                    : 'border border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 focus-visible:ring-emerald-500',
                ].join(' ')}
              >
                Approve
              </button>
              <button
                type="button"
                onClick={() => setActionTaken('escalate')}
                aria-pressed={actionTaken === 'escalate'}
                className={[
                  'rounded-lg px-4 py-2 text-sm font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[#03050A]',
                  actionTaken === 'escalate'
                    ? 'bg-red-600 text-white focus-visible:ring-red-500'
                    : 'border border-red-500/40 bg-red-500/10 text-red-400 hover:bg-red-500/20 focus-visible:ring-red-500',
                ].join(' ')}
              >
                Escalate
              </button>
            </div>
            {actionTaken && (
              <p role="status" aria-live="polite" className="text-xs text-white/50">
                Action:{' '}
                <span className="font-medium text-white/70">
                  {actionTaken === 'hold'
                    ? 'Hold for Review'
                    : actionTaken === 'approve'
                      ? 'Approve'
                      : 'Escalate'}
                </span>{' '}
                — selected.
              </p>
            )}
          </div>

          {/* Issues found */}
          {result.issues_found.length > 0 && (
            <div>
              <p className="text-xs font-medium text-white/40 mb-2">
                Issues found · {result.issues_found.length}
              </p>
              <ul className="space-y-1.5" aria-label="Issues found">
                {result.issues_found.map((issue, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-white/70">
                    <span
                      className="mt-0.5 h-4 w-4 shrink-0 rounded-full bg-yellow-500/15 text-yellow-400 flex items-center justify-center text-[10px] font-bold"
                      aria-hidden="true"
                    >
                      !
                    </span>
                    {issue}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Proof ID */}
          <div className="border-t border-white/8 pt-4 flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-xs text-white/40 mb-0.5">Proof ID</p>
              <p className="font-mono text-xs text-white/60 break-all">{result.proof_id}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-white/40 mb-0.5">Verification ID</p>
              <p className="font-mono text-xs text-white/60 break-all">{result.verification_id}</p>
            </div>
          </div>

          {/* Export actions */}
          <div className="border-t border-white/8 pt-3 flex items-center gap-3 flex-wrap">
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
              className="bg-[#FFB45C] text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-[#6b4fe0] disabled:opacity-50 transition-colors duration-150"
            >
              {pdfLoading ? 'Preparing PDF...' : 'Download PDF'}
            </button>
            {(jsonError || pdfError) && (
              <span className="text-xs text-amber-300">{jsonError ?? pdfError}</span>
            )}
          </div>

          {/* Reset */}
          <div className="border-t border-white/8 pt-3">
            <button
              type="button"
              onClick={() => {
                setResult(null);
                setForm(EMPTY_FORM);
                setSubmitError(null);
                setActionTaken(null);
              }}
              className="text-sm text-white/40 hover:text-white/70 transition-colors duration-150 underline underline-offset-2"
            >
              Verify another invoice
            </button>
          </div>
        </div>
      )}

      {/* Pilot CTA — shown after any scan result renders */}
      {result && (
        <div
          role="region"
          aria-label="Upgrade to InvoiceProof Pilot"
          className="mt-6 rounded-xl border border-[#FFB45C]/30 bg-gradient-to-br from-[#FFB45C]/10 to-[#FFB45C]/5 px-6 py-5 space-y-4"
        >
          <div>
            <p className="text-[10px] font-bold tracking-widest uppercase text-[#FFD7A6] mb-1">
              Ready to protect your AP queue?
            </p>
            <h3 className="text-base font-bold text-white leading-snug">
              Run 100 invoices/month
            </h3>
            <p className="mt-1 text-sm text-white/55">
              Batch scanning, vendor-master cross-checks, bank-change alerts, and a full audit
              trail — all in the managed Pilot.
            </p>
          </div>
          <div className="flex flex-wrap gap-3 items-center">
            <ProofCheckoutButton
              product="invoice-proof"
              planSlug="invoiceproof-pilot"
              className="inline-flex items-center justify-center rounded-lg bg-[#FFB45C] px-5 py-2.5 text-sm font-bold text-white shadow-[0_6px_20px_rgba(124,92,255,0.30)] hover:bg-[#6b4ef2] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FFB45C] focus-visible:ring-offset-2 focus-visible:ring-offset-[#03050A] cursor-pointer"
            >
              Start Pilot — $750
            </ProofCheckoutButton>
            <Link
              href="#pricing"
              className="inline-flex items-center justify-center rounded-lg border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-semibold text-white/70 hover:bg-white/10 hover:text-white transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-2 focus-visible:ring-offset-[#03050A]"
            >
              Start Verify — $1,500/mo
            </Link>
          </div>
          <p className="text-[11px] text-white/35">
            Pilot fee credited back on conversion to a monthly subscription.
          </p>
        </div>
      )}
    </div>
  );
}

export default InvoiceForm;
