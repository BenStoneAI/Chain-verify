import { Injectable, Logger } from '@nestjs/common';

export interface AiIssue {
  rule: string;
  severity: 'warning' | 'critical';
  message: string;
  source?: string;
  recommended_action?: string;
}

export interface AiAnalysisResult {
  issues: AiIssue[];
  ai_summary: string;
  risk_assessment: 'low' | 'medium' | 'high';
  /** When true the LLM call failed and the caller must treat the result as unavailable. */
  llm_unavailable?: true;
}

// Sentinel returned on LLM errors (network, auth, quota, timeout) or missing API key.
// The controller inspects `llm_unavailable` and returns 503 / needs_review
// instead of allowing a false-pass through.
export const AI_UNAVAILABLE: AiAnalysisResult = {
  issues: [],
  ai_summary: '',
  risk_assessment: 'low',
  llm_unavailable: true,
};

const SYSTEM_PROMPT = `You are a fraud-detection and verification analyst. Analyze the submitted payload for semantic issues,
fraud signals, logical inconsistencies, and risk factors.

Respond ONLY with valid JSON in this exact shape:
{
  "issues": [
    {
      "rule": "string",
      "severity": "warning|critical",
      "message": "string",
      "source": "string — cite the exact section, field, or document where the issue was found",
      "recommended_action": "string — specific corrective step (not just 'review')"
    }
  ],
  "ai_summary": "one sentence plain-english summary of findings",
  "risk_assessment": "low|medium|high"
}

Rules:
- Return an empty issues array if the submission looks clean.
- severity "critical" = a confirmed fraud pattern that should BLOCK payment — e.g. bank detail changes, watchlist
  matches, payment redirection attempts, or amount anomalies >3x normal. A "critical" issue must push
  risk_assessment to "high" and the overall recommendation should be "blocked".
- severity "warning" = suspicious or incomplete but not conclusive; may escalate for review.
- Keep each message under 160 characters.
- Do not invent issues; only flag what is genuinely problematic in the data.
- When ANY critical issue is present, set risk_assessment to "high".
- "source" is required on every finding — cite the document name, section, or field path.
- "recommended_action" is required on every finding — provide a specific, actionable step.`;

function buildUserPrompt(task: string | undefined, output: unknown): string {
  // Audit documents need more context than invoices — truncate based on task type
  const charLimit = task === 'audit_proof' ? 12000 : 6000;
  const outputJson = JSON.stringify(output, null, 2).slice(0, charLimit);
  const today = new Date().toISOString().split('T')[0]; // e.g. "2026-06-01"

  switch (task) {
    case 'audit_proof':
      return `You are a senior internal audit analyst reviewing submitted documents, policies, and events.

COMPLETENESS RULE: You MUST evaluate EVERY document or event present in the payload. Even if no issues are
found in a document, return a finding for it with status 'no issues'. Never omit a submitted document.

SEVERITY RULES — apply these strictly:
- Materialized financial incident (loss, fraud, unauthorized transfer confirmed): CRITICAL
- A risk register entry with status=Materialized, Occurred, Confirmed, or any language indicating the risk has ALREADY HAPPENED (not 'may happen') is CRITICAL regardless of dollar amount. Name the specific entry by ID and describe what occurred. Rule: 'materialized_incident'.
- 3 or more unowned HIGH risks present simultaneously: CRITICAL
- Missing CEO, CFO, or VP signature on a governance or procurement policy: CRITICAL
- SOD violation where AP Clerk (or equivalent low-trust role) has bank account modification access: CRITICAL
- Any open issue with direct financial exposure (unresolved, no owner, no remediation date): HIGH
- Missing banking-change authorization procedure or approval workflow: HIGH
- Lapsed policy review date older than 3 years from today: HIGH
- Single unowned HIGH risk or ambiguous ownership: MEDIUM
- Minor documentation gap, missing metadata, or cosmetic policy deficiency: LOW
- Blank or skipped procedural step in a financial control workflow (e.g., Step N: [blank], Step N: TBD, Step N: N/A) where a banking, payment, or approval action was expected: CRITICAL. Rule: 'blank_control_step'.

RISK CALIBRATION — MANDATORY: If the document contains any materialized security incident (a risk that has already occurred, not merely a future possibility), any unowned HIGH risk, or any past-due mitigation with no recorded completion, set risk_assessment to "high". Do NOT return risk_assessment "medium" in these cases — a materialized incident or unowned HIGH risk is never medium severity.

CONFIDENCE CALIBRATION: When a document has 4 or more significant gaps (missing controls, absent requirements, blank steps, critical SOD violations), set risk_assessment='high'. Do NOT reduce confidence when finding many problems — a document with many gaps means HIGH certainty of issues, not low certainty.

SEGREGATION OF DUTIES (SOD) RULE: When a finding involves an employee or role having conflicting duties
(e.g., both creating and approving payments, requesting and approving bank account changes, or initiating
and verifying transactions), label the finding rule as "segregation_of_duties_violation" and include the
exact phrase "Segregation of Duties Violation" in the message.

CITATION RULE: Every finding MUST include a "source" field citing the specific section, paragraph,
document name, or field within the submitted payload where the issue was identified. Do not return a
finding without a source citation. Example source: "Procurement Policy v2.1, Section 4.2, Approval Matrix".

REMEDIATION RULE: Every finding MUST include a "recommended_action" field with a specific, actionable
corrective step — not just "review" or "investigate". Examples of acceptable remediation:
  - "Update Procurement Policy Section 4.2 to require CFO counter-signature for all purchases over $10,000 and obtain CEO signature on the revised policy before next board cycle."
  - "Revoke AP Clerk's access to bank account modification in the banking portal and assign that function to Treasury Manager role only."
  - "Schedule formal policy review by [date], assign owner [role], and record sign-off in the policy register."

Check for all of the following:
- Does the output_produced logically follow from the input_used and task_performed?
- Is the stated business_risk level appropriate for the described activity?
- If human_approval_required is true, is a human_approver recorded?
- Are governance policies missing required executive signatures?
- Are any SOD conflicts present (single person/role controlling end-to-end financial transactions)?
- Are policy review dates current (within 3 years)?
- Are there open risks with no owner or remediation plan? When risk register entries lack an assigned owner, list EACH entry by its ID (e.g., RR-001, RR-002) as individual findings. Do NOT aggregate into a single generic statement.
- For every risk register entry, does the mitigation have a target completion date that has ALREADY PASSED without a recorded completion? List each overdue item by ID. Rule: 'past_due_mitigation'. Severity: HIGH.
- Are banking or payment change procedures documented and approved?
- Are there any red flags (vague descriptions, implausible claims, missing context)?
- For vendor onboarding/setup procedures, explicitly check: (a) insurance certificate requirement with enforcement gate — missing is HIGH; (b) credit check removal or made optional — CRITICAL; (c) documented annual vendor review cycle — missing is HIGH; (d) dual-control gap: single person can both approve a new vendor AND process their first invoice — CRITICAL SOD violation; (e) W-9/tax document requirement before payment — missing is HIGH. Each gap is its own finding.

ENFORCEMENT: If you return any finding without a non-empty recommended_action, your response is invalid. EVERY issue object in the issues array must have recommended_action set to a specific corrective action.

SECTION CITATION RULE: Do NOT cite specific section numbers (e.g. "Section 4", "Section 7.2") in
your analysis findings or messages. Describe findings in plain language referring to the document
name and topic area (e.g. "the vendor approval procedure", "the banking controls policy"). Section
references within the submitted document are self-referential and must not appear as cited sources
in your findings array.

Payload:
${outputJson}`;

    case 'agent_activity':
      return `Audit this AI agent activity record for semantic issues.

Check:
- Does the output_produced logically follow from the input_used and task_performed?
- Is the stated business_risk level appropriate for the described activity?
- If human_approval_required is true, is a human_approver recorded?
- Are there any red flags (vague descriptions, implausible claims, missing context)?

Payload:
${outputJson}`;

    case 'invoice_extraction':
      return `Audit this invoice data for fraud signals and inconsistencies.

DATE CONTEXT — MANDATORY: Today's date is ${today}. Any invoice dated on or before ${today} is a historical
document and is NOT future-dated. Do NOT flag a 2025 or 2026 date as "future_dated_invoice" unless the
invoice date is strictly AFTER ${today}. Only apply rule "future_dated_invoice" when invoice_date > ${today}.
Invoices dated in 2024, 2025, or early 2026 are normal historical invoices.

BUSINESS EMAIL RULE: Standard business email addresses used as AP workflow inboxes (invoices@company.com, ap@company.com, accounting@company.com, payments@company.com) are NOT PII and must NOT be flagged as PII leaks. Only flag email addresses as suspicious when they are personal free-email accounts (gmail.com, hotmail.com, yahoo.com) used as payment destination or appearing in a vendor bank-change context.

CONFIDENCE CALIBRATION FOR BEC/FRAUD VERDICT: When fraud signals are detected, your confidence value
should reflect certainty about the FAILURE verdict, not about passing. Known BEC fraud signals that
INCREASE confidence in a FAIL verdict (do not reduce it):
- Payee name change or vendor name change compared to prior records
- Bank account number change within 30 days of invoice date
- Urgency language ("urgent transfer", "wire today", "immediate payment", "overdue — pay now")
- First occurrence from a new vendor (no prior invoice history in the payload)
- Round dollar amounts above $5,000 with no line-item breakdown
A document with 2+ of these BEC signals should return confidence >= 0.85 for the FAIL/critical verdict.
A clean invoice with no fraud signals should return confidence >= 0.88 for the PASS verdict.
DO NOT invert confidence — a document with multiple fraud signals must NOT return high confidence for passing.

CRITICAL-severity checks (use severity "critical" for any of these — they must block payment):
1. BANK ACCOUNT / PAYMENT DETAIL CHANGE: Flag CRITICAL if any of the following are present or implied:
   - Bank account number, IBAN, sort code, routing number, or BIC/SWIFT changed compared to prior invoices
   - Any field or note saying "bank changed", "new account", "updated payment details", "please use new bank",
     "payment method update", or similar phrasing
   - Payment destination differs from the vendor's previously known account
   Rule name: "bank_detail_change"
2. VENDOR WATCHLIST / FRAUD FLAG: Flag CRITICAL if:
   - The vendor name, ID, or any associated field contains "watchlist", "blacklist", "fraud", "flagged", or
     "suspended"
   - The vendor is explicitly marked as high-risk, blocked, or under investigation in any field
   Rule name: "vendor_watchlist_match"
3. RECENT PAYMENT DETAIL CHANGE (within 30 days): Flag CRITICAL if bank or payment details were changed
   fewer than 30 days before the invoice date or payment due date. This is a primary Business Email
   Compromise (BEC) indicator.
   Rule name: "recent_bank_change"
4. AMOUNT ANOMALY: Flag CRITICAL if the invoice amount is significantly larger than typical for this vendor
   — specifically if the amount is more than 3x any previously recorded invoice amount for the same vendor,
   or if there are fields indicating it is unusually large relative to historical data.
   IMPORTANT: Only flag this rule if the payload itself contains prior invoice history or an explicit
   "typical amount" / "historical_avg" field. Do NOT invent a historical baseline — if no prior amounts
   are present in the data, do NOT flag amount_anomaly.
   Rule name: "amount_anomaly"

5. MISSING PURCHASE ORDER (rule: "missing_po"): If po_number is null, empty, missing, "N/A", or "VERBAL" AND the invoice amount exceeds $2,499 (or any po_required_threshold value explicitly present in the payload), flag as severity "critical". A large invoice with no PO number and no documented written approval override represents a CRITICAL procurement control failure. If an explicit verbal_approval or emergency_approval field is present, downgrade to "warning" severity but still flag.
6. VENDOR ADDRESS MISMATCH (rule: "vendor_address_mismatch"): If the payload contains vendor_address_on_file AND the current invoice has any vendor address field (billing_address, remit_to, vendor_address, etc.), compare them. Any mismatch in city, state, country, or street is a HIGH finding. If the address change is combined with a Gmail or free-email domain, a bank account change, or urgency language, escalate to CRITICAL. Rule name: "vendor_address_mismatch".

WARNING-severity checks (use severity "warning"):
7. URGENCY / PRESSURE LANGUAGE: Flag WARNING if the invoice requests same-day or next-day payment,
   contains phrases like "urgent", "immediate payment required", "overdue — pay now", or otherwise
   pressures fast payment with no established prior relationship evident in the data.
   Rule name: "urgency_pressure"

8. DUPLICATE INVOICE CHECK (rule: "duplicate_invoice"): If the payload contains ANY of these fields — prior_invoice_number, prior_payment, duplicate_of, prior_invoice_date, prior_invoice_amount — compare them against the current invoice. Specifically:
   - If prior_invoice_number matches or is near-identical to the current invoice_number: CRITICAL.
   - If prior_invoice_amount is within $50 of the current invoice amount AND the vendor is the same: flag as CRITICAL with rule "duplicate_invoice".
   - If prior_invoice_paid_date exists and is within 90 days of the current invoice date with the same amount: CRITICAL.
   This rule must fire even if no other signals are present. A duplicate invoice is always CRITICAL.

Standard checks (warning or critical as appropriate):
- ARITHMETIC RECOMPUTATION (rule: "math_error"): Explicitly recompute all arithmetic using this exact procedure:
  1. Sum all positive line item amounts to get subtotal.
  2. Subtract any credit, discount, rebate, or adjustment line items (credits REDUCE the total; if a credit is present, the net = subtotal - credit_amount, never subtotal + credit_amount).
  3. Add freight, shipping, and tax amounts.
  4. Round both your computed total and the stated invoice total to 2 decimal places before comparing.
  5. If round(computed) ≠ round(stated), flag as severity "critical" with rule "math_error" and state: "Computed total: $X.XX. Stated total: $Y.YY. Difference: $Z.ZZ." Do not flag if the difference is under $0.02 (rounding tolerance).
  6. Specifically check credit direction: if a line item is labeled "credit", "rebate", "discount", or "adjustment" and appears to have been ADDED rather than SUBTRACTED from the subtotal, flag as math_error with message explaining the direction error.
- Are tax amounts proportional to the subtotal?
- Are payment terms and due dates internally consistent?
- Are there duplicate or near-duplicate line items?

Payload:
${outputJson}`;

    case 'software_delivery':
      return `You are a software delivery acceptance analyst. Evaluate whether this delivery meets the
contract requirements stated in the payload. Compare the delivery evidence field-by-field against
any contract_scope, requirements, or acceptance_criteria fields present.

CONFIDENCE MEANING — MANDATORY RULE: The confidence field here means: how confident are we that this delivery is ACCEPTABLE and meets all stated requirements? This is NOT confidence in the failure verdict.
- If the delivery has ANY CRITICAL findings (staging not production, version mismatch, open defects, auth scope change, sync direction mismatch): set confidence to 0.15. Not 0.85. Not 0.88. Exactly 0.15 or lower.
- If the delivery has HIGH findings only (no CRITICAL): set confidence to 0.30.
- If the delivery has WARNING findings only: set confidence to 0.65.
- If the delivery is clean with no findings: set confidence >= 0.88.
DO NOT set confidence to 0.85 or 0.88 when the delivery has CRITICAL failures — that directly contradicts the meaning of this field and will mislead the buyer into accepting a bad delivery.

REQUIREMENT-BY-REQUIREMENT EVALUATION — apply ALL of the following checks explicitly:

ENVIRONMENT CHECK (rule: "staging_not_production"): Fire ONLY when the DEPLOYMENT TARGET or
DEPLOYMENT ENVIRONMENT of the delivery itself is staging, QA, UAT, or pre-production — meaning the
system is deployed to a non-production environment when production deployment was required.
Do NOT fire this rule when "staging" appears only in rollback targets, contingency plans, prior
environments, comparison references, or rollback URLs. Only fire when deployment_report.environment,
deployment_target, or the primary deployment claim in delivery_statement explicitly states the active
deployment is to a staging/QA/UAT/test environment rather than production.

INCOMPLETE DELIVERABLE (rule: "incomplete_deliverable"): If any requirement in the requirements
traceability section has status "PARTIAL", "⚠ PARTIAL", or notes describing it as "X% complete",
"will finish in a patch", "will complete in next sprint", "planned for later", "not yet delivered",
or any language indicating the requirement is NOT fully delivered at time of submission, flag it
as severity "critical". A delivery claiming milestone payment cannot have partially-satisfied
requirements. Quote the specific requirement ID and its stated status.

SYNC DIRECTION CHECK (rule: "sync_direction_mismatch"): If the contract or requirements specify
bidirectional sync (e.g., "bidirectional", "two-way sync", "sync in both directions") but the
delivery evidence shows one direction is incomplete, not yet delivered, or described as "X% complete"
while the other direction is live — this is NOT bidirectional sync and is a CRITICAL finding.
"80% complete" or "will finish in January patch" for one direction means that direction is NOT
delivered; bidirectional sync requires BOTH directions fully operational.

VERSION CHECK (rule: "version_mismatch"): Compare the delivered API version, software version, or
build version against the required version from the contract_scope or requirements. Any version
mismatch — even a minor patch difference when an exact version was specified — is a CRITICAL finding
that must be flagged as severity "critical". Cite both the delivered version and the required version
in your message. Scan EVERY requirement ID in the requirements traceability section for version-related
language — do not assume the overall delivery summary captures all version mismatches. If the
traceability section lists a requirement with a version specifier and the delivered version differs,
emit one separate finding per mismatched requirement even if a broader summary exists.

OPEN DEFECTS CHECK (rule: "open_critical_defects_at_delivery"): If release_notes, defect_list, or
any field contains P1 or P2 defects, bugs, or issues that are marked as still-open, in-progress,
unresolved, or not-fixed at delivery time, this is a CRITICAL finding. A delivery signed off with
open P2 or higher defects cannot be accepted.

AUTH METHOD CHANGE CHECK (rule: "unauthorized_auth_scope_change"): If change_log, delivery_statement,
deployment_report, or release_notes shows that the authentication method was ACTUALLY CHANGED in the
delivery (e.g., from OAuth2 to API keys, from API key to basic auth, or any change to auth scope,
token type, or authentication mechanism) without that change being in the original contract scope or
requirements, this is a HIGH finding that must be flagged as severity "critical".
IMPORTANT: Do NOT fire this rule based on the integration_scope or requirements field alone. Those
fields contain contract language and warning text (e.g. "NO API key substitution is permitted without
written contract amendment") that DESCRIBES what is forbidden — it is not evidence that a change
occurred. Only fire this rule when delivery evidence (delivery_statement, deployment_report,
release_notes, change_log) shows the auth method was actually changed. If delivery_statement or
deployment_report contains explicit language like "OAuth 2.0 delivered", "authentication: delivered",
"OAuth implemented as specified", or "auth method: OAuth 2.0", do NOT flag this rule.

RESPONSE SCHEMA WHEN PROBLEMS FOUND: When any of the above findings are detected, the risk_assessment
must be "high" and the issues must include a recommended_action of "blocked" for critical findings.

For each finding, cite the EXACT field name and value from the payload that triggered it in the
"source" field (e.g., "deployment_report.environment: 'staging'").

Evaluate EVERY field present. Do not omit findings for fields you detect as problematic.

Payload:
${outputJson}`;

    default:
      return `Verify this submission for issues, inconsistencies, or missing required information.

Check:
- Are required fields present and non-empty?
- Are there internal contradictions in the data?
- Are there any suspicious or anomalous values?

Payload:
${outputJson}`;
  }
}

// Provider identifier used only for server-side logging (never returned to callers,
// never contains secret values).
type AiProvider = 'swarmsync-routing';

// A flat (non-discriminated) result shape is used deliberately: under this project's
// "strict": false tsconfig, TypeScript does not narrow a discriminated union
// (`{ ok: true; result } | { ok: false; status? }`) across statements the way it does
// under strict mode. Keeping every field present (optional) on one type sidesteps that
// and is checked explicitly (`ok && result`) at each call site.
interface ProviderCallResult {
  ok: boolean;
  result?: AiAnalysisResult;
  status?: number;
}

// SWARMSYNC_ROUTING_BASE_ENDPOINT is documented as "POST <url>" (a human-readable
// method+URL pair, not a bare path) — strip a leading HTTP-method token if present.
// Falls back to SWARMSYNC_ROUTING_BASE_URL + /chat/completions (the router's
// documented OpenAI-compatible route) when the endpoint var is unset or unparsable.
function resolveSwarmSyncRoutingUrl(): string {
  const endpoint = (process.env['SWARMSYNC_ROUTING_BASE_ENDPOINT'] ?? '').trim();
  const endpointMatch = endpoint.match(/https?:\/\/\S+/);
  if (endpointMatch) return endpointMatch[0];
  const baseUrl = (process.env['SWARMSYNC_ROUTING_BASE_URL'] ?? '').replace(/\/+$/, '');
  return baseUrl ? `${baseUrl}/chat/completions` : '';
}

function parseAiResponseBody(data: unknown): AiAnalysisResult {
  const parsed =
    (JSON.parse(
      ((data as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message
        ?.content) ?? '{}',
    ) as Partial<AiAnalysisResult>) ?? {};

  const issues: AiIssue[] = (parsed.issues ?? [])
    .filter(
      (i): i is AiIssue =>
        typeof i === 'object' &&
        i !== null &&
        typeof i.rule === 'string' &&
        typeof i.message === 'string' &&
        (i.severity === 'warning' || i.severity === 'critical'),
    )
    .map((i) => ({
      rule: i.rule,
      severity: i.severity,
      message: i.message,
      ...(typeof i.source === 'string' && i.source.length > 0 ? { source: i.source } : {}),
      ...(typeof i.recommended_action === 'string' && i.recommended_action.length > 0
        ? { recommended_action: i.recommended_action }
        : {}),
    }))
    .slice(0, 10);

  const risk_assessment =
    parsed.risk_assessment === 'high' || parsed.risk_assessment === 'medium' || parsed.risk_assessment === 'low'
      ? parsed.risk_assessment
      : 'low';

  return {
    issues,
    ai_summary: typeof parsed.ai_summary === 'string' ? parsed.ai_summary.slice(0, 300) : '',
    risk_assessment,
  };
}

@Injectable()
export class AiAnalysisService {
  private readonly logger = new Logger(AiAnalysisService.name);
  // SwarmSync's own Router V2 (owned by this org — not a third-party AI vendor key).
  // OpenAI-compatible POST /v1/chat/completions; model 'auto' lets the router pick the
  // best model for the request, including its high_stakes_audit routing dimension that
  // specifically targets Audit-Proof/Invoice-Proof/Verify-API traffic like this.
  private readonly apiKey = process.env['SWARMSYNC_ROUTING_API'] ?? '';
  private readonly baseUrl = resolveSwarmSyncRoutingUrl();
  private readonly model = 'auto';
  private readonly maxTokens = 1200;

  isConfigured(): boolean {
    return this.apiKey.length > 0 && this.baseUrl.length > 0;
  }

  async analyze(task: string | undefined, output: unknown): Promise<AiAnalysisResult> {
    if (!this.isConfigured()) {
      // Fail-closed: no SwarmSync routing key/URL configured means we cannot verify —
      // return AI_UNAVAILABLE so the controller returns 503 rather than a false-pass
      // (PRB-LLM-FAIL-OPEN).
      this.logger.error(
        'SWARMSYNC_ROUTING_API / SWARMSYNC_ROUTING_BASE_URL is not set — AI analysis ' +
          'unavailable (fail-closed).',
      );
      return AI_UNAVAILABLE;
    }

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt(task, output) },
    ];

    const direct = await this.callSwarmSyncRouting(messages);
    if (direct.ok && direct.result) {
      this.logger.log('AI analysis succeeded via provider=swarmsync-routing');
      return direct.result;
    }

    this.logger.error('AI analysis failed on all available providers — returning AI_UNAVAILABLE (fail-closed)');
    return AI_UNAVAILABLE;
  }

  private async callSwarmSyncRouting(
    messages: Array<{ role: string; content: string }>,
  ): Promise<ProviderCallResult> {
    return this.callProvider('swarmsync-routing', this.baseUrl, {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    }, this.model, messages);
  }

  private async callProvider(
    provider: AiProvider,
    url: string,
    headers: Record<string, string>,
    model: string,
    messages: Array<{ role: string; content: string }>,
  ): Promise<ProviderCallResult> {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          response_format: { type: 'json_object' },
          messages,
          max_tokens: this.maxTokens,
        }),
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        const body = await res.text();
        this.logger.error(
          `${provider} AI analysis error ${res.status}: ${body.slice(0, 300)}`,
        );
        return { ok: false, result: undefined, status: res.status };
      }

      const data = await res.json();
      const result = parseAiResponseBody(data);
      return { ok: true, result, status: res.status };
    } catch (err) {
      this.logger.error(`${provider} AI analysis request failed: ${String(err)}`);
      return { ok: false, result: undefined, status: undefined };
    }
  }
}
