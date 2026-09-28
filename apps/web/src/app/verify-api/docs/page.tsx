import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'VerifyAPI Docs | Chain Verify',
  description:
    'Developer documentation for VerifyAPI authentication, verification runs, proof records, and proof exports.',
  alternates: { canonical: 'https://chainverify.org/verify-api/docs' },
};

const endpoints = [
  {
    method: 'POST',
    path: '/api/verify',
    auth: 'Required',
    summary:
      'Submit model output, rules, and optional evidence. Returns a verification ID, proof ID, status, confidence, risk level, issues, and proof metadata.',
  },
  {
    method: 'POST',
    path: '/api/verify/demo',
    auth: 'Public sandbox',
    summary:
      'Runs the same verification shape for demos and product trials without requiring credentials. Use it for examples, not production traffic.',
  },
  {
    method: 'GET',
    path: '/api/verify/:id',
    auth: 'Scoped lookup',
    summary:
      'Fetch a saved verification run with status, risk level, confidence, issues, checks performed, and timestamps. Authenticated production records are scoped to the caller organization; sandbox records are retrievable as anonymous demo records.',
  },
  {
    method: 'GET',
    path: '/api/proof/:id',
    auth: 'Scoped lookup',
    summary:
      'Fetch the proof record for a verification, including evidence, timeline, final decision, proof metadata, and linked verification summary. Production records are scoped to the caller organization.',
  },
  {
    method: 'GET',
    path: '/api/proof/:id/verify',
    auth: 'Public (single-record spot-check)',
    summary:
      'Recomputes this one proof record\'s own hash and checks an optional signature. This is a fast single-record check only — it confirms the record itself was not altered after creation, but does not confirm its place in the wider chain is unbroken. Use GET /api/proof/chain/verify for that.',
  },
  {
    method: 'GET',
    path: '/api/proof/chain/verify',
    auth: 'Required',
    summary:
      "Walks your organization's full proof chain back to genesis (or from an optional startProofId), independently re-checking every record against the actual current hash of the record before it. Reports the first tampering break found, if any — this is the check that certifies chain-wide integrity, not the single-record /verify endpoint above.",
  },
  {
    method: 'GET',
    path: '/api/proof/:id/export/pdf',
    auth: 'Scoped lookup',
    summary:
      'Download a PDF proof report for auditors, customers, or internal records in the caller organization or anonymous sandbox scope.',
  },
  {
    method: 'GET',
    path: '/api/proof/:id/export/json',
    auth: 'Scoped lookup',
    summary:
      'Download the full proof record as structured JSON for archives and downstream systems in the caller organization or anonymous sandbox scope.',
  },
];

export default function VerifyApiDocsPage() {
  return (
    <main className="min-h-screen bg-[#03050a] text-white">
      <section className="border-b border-white/10 bg-[radial-gradient(circle_at_top_right,rgba(124,92,255,0.22),transparent_34rem)]">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-16 md:px-10 lg:py-20">
          <div className="max-w-3xl">
            <p className="mb-4 font-mono text-xs uppercase tracking-[0.22em] text-cyan-200">
              VerifyAPI developer docs
            </p>
            <h1 className="font-[var(--font-display)] text-4xl font-semibold leading-tight md:text-6xl">
              Verify AI outputs and retrieve proof records.
            </h1>
            <p className="mt-6 text-lg leading-8 text-slate-300">
              VerifyAPI accepts structured model output, evaluates it against named rules and
              supplied evidence, then returns a retrievable verification and proof record.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-6xl gap-6 px-6 py-12 md:px-10 lg:grid-cols-[0.85fr_1.15fr]">
        <div className="rounded-lg border border-white/10 bg-white/[0.04] p-6">
          <h2 className="font-[var(--font-display)] text-2xl font-semibold">Authentication</h2>
          <p className="mt-4 text-sm leading-6 text-slate-300">
            Production verification requires an authenticated Chain Verify principal. Send JSON and one
            supported credential header:
          </p>
          <pre className="mt-5 overflow-x-auto rounded-md border border-white/10 bg-black/50 p-4 font-mono text-xs leading-6 text-cyan-100">
            {`Content-Type: application/json
Authorization: Bearer <jwt_access_token>

# Agent/service accounts can use any of:
Authorization: Bearer <service_account_api_key>
Authorization: ApiKey <service_account_api_key>
x-api-key: <service_account_api_key>
x-agent-api-key: <agent_api_key>`}
          </pre>
          <p className="mt-4 text-sm leading-6 text-slate-400">
            Contact{' '}
            <a href="mailto:proof@chainverify.org" className="text-cyan-200 underline underline-offset-2">
              proof@chainverify.org
            </a>{' '}
            to provision or rotate an API key. Keep production calls on{' '}
            <code className="rounded bg-white/10 px-1.5 py-0.5 text-cyan-100">
              POST /api/verify
            </code>
            .
          </p>
        </div>

        <div className="rounded-lg border border-cyan-200/20 bg-cyan-200/[0.05] p-6">
          <h2 className="font-[var(--font-display)] text-2xl font-semibold">
            Minimal authenticated request
          </h2>
          <pre className="mt-5 overflow-x-auto rounded-md border border-white/10 bg-black/60 p-4 font-mono text-xs leading-6 text-slate-100">
            {`POST /api/verify
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json

{
  "source_type": "api_output",
  "task": "invoice_extraction",
  "output": {
    "vendor_name": "Acme Cloud Services",
    "amount_total": 8450,
    "invoice_number": "INV-10492"
  },
  "rules": [
    "vendor_name_present",
    "amount_total_present",
    "missing_po_check"
  ],
  "evidence": [
    { "expected_total": 8450 }
  ]
}`}
          </pre>
          <p className="mt-4 text-sm leading-6 text-slate-400">
            For no-key demos, use{' '}
            <code className="rounded bg-white/10 px-1.5 py-0.5 text-cyan-100">
              POST /api/verify/demo
            </code>{' '}
            as the sandbox endpoint.
          </p>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-6 pb-16 md:px-10">
        <div className="mb-6 flex flex-col justify-between gap-3 md:flex-row md:items-end">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.22em] text-violet-200">
              Endpoints
            </p>
            <h2 className="mt-2 font-[var(--font-display)] text-3xl font-semibold">
              Verification and proof API surface
            </h2>
          </div>
          <p className="max-w-xl text-sm leading-6 text-slate-400">
            Store the returned <code className="text-cyan-100">verification_id</code> and{' '}
            <code className="text-cyan-100">proof_id</code>. They are the lookup keys for history,
            proof retrieval, chain checks, and exports.
          </p>
        </div>

        <div className="grid gap-3">
          {endpoints.map((endpoint) => (
            <article
              key={`${endpoint.method} ${endpoint.path}`}
              className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.035] p-5 md:grid-cols-[8rem_1fr_9rem]"
            >
              <div className="font-mono text-sm font-semibold text-cyan-100">{endpoint.method}</div>
              <div>
                <code className="font-mono text-sm text-white">{endpoint.path}</code>
                <p className="mt-2 text-sm leading-6 text-slate-300">{endpoint.summary}</p>
              </div>
              <div className="text-left font-mono text-xs uppercase tracking-[0.16em] text-slate-400 md:text-right">
                {endpoint.auth}
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
