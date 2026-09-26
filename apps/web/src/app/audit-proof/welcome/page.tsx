'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

import { resolveProofApiBase } from '@/lib/proof-api';

function AuditIntakeInner() {
  const params = useSearchParams();
  const sessionId = params.get('session_id');
  const planSlug = params.get('plan') ?? 'auditproof-pilot';

  const [form, setForm] = useState({
    companyName: '',
    workflowName: '',
    contactEmail: '',
    contactName: '',
    agentCount: '',
    notes: '',
  });
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    try {
      // Fire-and-forget to ops — best-effort; failure is non-blocking. This is
      // a lead-capture form, not a live audit run — see recordPilotIntake in
      // verify-api.controller.ts for why the endpoint is named pilot-intake.
      const res = await fetch(`${resolveProofApiBase()}/api/proof/pilot-intake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, sessionId, planSlug }),
      });
      if (!res.ok) {
        throw new Error(`Intake failed (HTTP ${res.status})`);
      }
      setSubmitted(true);
    } catch {
      setSubmitError('Submission failed — please email support@swarmsync.ai with your details.');
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <main className="mx-auto max-w-xl px-4 py-24 text-white">
        <div className="mx-auto mb-8 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20 ring-1 ring-emerald-500/40">
          <svg className="h-8 w-8 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-center text-3xl font-display font-bold">Intake complete!</h1>
        <p className="mt-4 text-center text-white/60 text-sm">
          Our team will reach out within 1 business day to schedule your AuditProof kickoff.
        </p>
        <div className="mt-8 flex flex-col items-center gap-3">
          <Link
            href="/audit-proof/dashboard"
            className="inline-flex items-center justify-center rounded-lg bg-[#7C5CFF] px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90"
          >
            Go to Proof Dashboard
          </Link>
          <Link href="/audit-proof" className="text-sm text-white/40 hover:text-white/70">
            Back to AuditProof
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl px-4 py-20 text-white">
      {/* Header */}
      <div className="mb-10 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-[#7C5CFF]/30 bg-[#7C5CFF]/10 px-3 py-1 text-xs text-[#7C5CFF] mb-4">
          AuditProof Pilot — Activated
        </div>
        <h1 className="text-3xl font-display font-bold">Complete your pilot intake</h1>
        <p className="mt-3 text-white/60 text-sm">
          Tell us about your AI workflows so we can configure your first audit run.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Company */}
        <div>
          <label className="block text-sm font-medium text-white/80 mb-1.5">
            Company / Organisation <span className="text-red-400">*</span>
          </label>
          <input
            name="companyName"
            required
            value={form.companyName}
            onChange={handleChange}
            placeholder="Acme Corp"
            className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/30 outline-none focus:border-[#7C5CFF]/60 focus:ring-1 focus:ring-[#7C5CFF]/40"
          />
        </div>

        {/* Workflow name */}
        <div>
          <label className="block text-sm font-medium text-white/80 mb-1.5">
            Primary workflow to audit <span className="text-red-400">*</span>
          </label>
          <input
            name="workflowName"
            required
            value={form.workflowName}
            onChange={handleChange}
            placeholder="e.g. Invoice approval pipeline, Customer onboarding agent"
            className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/30 outline-none focus:border-[#7C5CFF]/60 focus:ring-1 focus:ring-[#7C5CFF]/40"
          />
        </div>

        {/* Agent count */}
        <div>
          <label className="block text-sm font-medium text-white/80 mb-1.5">
            Approximate number of AI agents / automations
          </label>
          <select
            name="agentCount"
            value={form.agentCount}
            onChange={handleChange}
            className="w-full rounded-lg border border-white/10 bg-[#0a0a12] px-4 py-2.5 text-sm text-white outline-none focus:border-[#7C5CFF]/60"
          >
            <option value="">Select range</option>
            <option value="1-5">1 – 5</option>
            <option value="6-20">6 – 20</option>
            <option value="21-50">21 – 50</option>
            <option value="50+">50+</option>
          </select>
        </div>

        {/* Contact name */}
        <div>
          <label className="block text-sm font-medium text-white/80 mb-1.5">
            Your name <span className="text-red-400">*</span>
          </label>
          <input
            name="contactName"
            required
            value={form.contactName}
            onChange={handleChange}
            placeholder="Jane Smith"
            className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/30 outline-none focus:border-[#7C5CFF]/60 focus:ring-1 focus:ring-[#7C5CFF]/40"
          />
        </div>

        {/* Contact email */}
        <div>
          <label className="block text-sm font-medium text-white/80 mb-1.5">
            Contact email <span className="text-red-400">*</span>
          </label>
          <input
            name="contactEmail"
            type="email"
            required
            value={form.contactEmail}
            onChange={handleChange}
            placeholder="jane@acme.com"
            className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/30 outline-none focus:border-[#7C5CFF]/60 focus:ring-1 focus:ring-[#7C5CFF]/40"
          />
        </div>

        {/* Notes */}
        <div>
          <label className="block text-sm font-medium text-white/80 mb-1.5">
            Anything else we should know?
          </label>
          <textarea
            name="notes"
            value={form.notes}
            onChange={handleChange}
            rows={3}
            placeholder="Compliance requirements, risk areas, integration stack…"
            className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/30 outline-none focus:border-[#7C5CFF]/60 focus:ring-1 focus:ring-[#7C5CFF]/40 resize-none"
          />
        </div>

        {submitError && (
          <p className="text-sm text-red-400">{submitError}</p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-[#7C5CFF] py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? 'Submitting…' : 'Submit pilot intake'}
        </button>
      </form>

      <p className="mt-6 text-center text-xs text-white/30">
        Our team will reach out within 1 business day.
      </p>
    </main>
  );
}

export default function AuditProofWelcomePage() {
  return (
    <Suspense fallback={<main className="py-24 text-center text-white/50">Loading…</main>}>
      <AuditIntakeInner />
    </Suspense>
  );
}
