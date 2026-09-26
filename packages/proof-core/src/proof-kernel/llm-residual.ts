// Proof-kernel LLM residual review layer (Prompt2 section 5).
//
// This layer runs AFTER the deterministic controls and is STRICTLY ADDITIVE. It
// exists only to surface what pattern-based controls cannot: ambiguous prose
// extraction, document-classification gaps, semantic contradiction detection,
// evidence summarization, citation-backed residual findings, and next-action
// explanation. It MUST NOT replace, re-run, or override any deterministic control.
//
// HARD ENFORCEMENT RULES (do not relax):
//   1. NO-OP BY DEFAULT — if no LlmClient is injected or `enabled === false`, this
//      returns {findings: [], invoked: false}. Tests therefore run fully offline.
//   2. CITATION REQUIRED — every residual finding MUST cite at least one
//      evidenceRef. A residual finding that fails parsing/validation OR carries ZERO
//      evidenceRefs is NEVER allowed to surface as a hard 'failed'. It is dropped,
//      or (when a controlId + message survive) downgraded to status
//      'needs_more_evidence'. The LLM can NEVER assert a hard failure without a cite.
//   3. NO DETERMINISTIC OVERLAP — residual findings whose controlId already fired a
//      deterministic result are deduplicated out. The LLM cannot restate or contest
//      a control the kernel already decided.
//   4. modelConfidence is CAPTURED but NEVER authoritative — final confidence is
//      computed deterministically downstream (see final-confidence.ts). The value
//      here is advisory metadata only.

import type { ClassifiedEvidence } from '../ingestion/evidence-input.js';
import type { ControlResult, EvidenceRef, ProofFinding, ProofProduct, Severity } from './types.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type LlmResidualInput = {
  product: ProofProduct;
  /** The ingested, classified evidence documents. */
  canonicalEvidence: ClassifiedEvidence[];
  /** Deterministic control results that have ALREADY fired (the source of truth). */
  deterministicResults: ControlResult[];
  /** Control ids that were skipped (so the LLM knows which gaps to look at). */
  skippedControlIds: string[];
  /** Verbatim source passages the LLM may cite. */
  sourcePassages: { documentId: string; passage: string }[];
};

export type LlmResidualFinding = {
  controlId: string;
  severity: Severity;
  message: string;
  evidenceRefs: EvidenceRef[];
  recommendedAction: string;
  /** Advisory model self-confidence (0–1). NEVER used as final confidence. */
  modelConfidence?: number;
};

/** Injectable LLM transport. The kernel never imports a concrete client. */
export interface LlmClient {
  complete(prompt: string): Promise<string>;
}

export type ResidualOptions = {
  /** Inject a client to enable the layer. Null/undefined ⇒ no-op. */
  client?: LlmClient | null;
  /** Explicit kill-switch. `false` forces a no-op even if a client is present. */
  enabled?: boolean;
};

export type RunLlmResidualResult = {
  findings: ProofFinding[];
  /** Raw model output, surfaced for debugging/audit. Absent on no-op. */
  raw?: string;
  /** True only when a client was actually invoked. */
  invoked: boolean;
};

// ---------------------------------------------------------------------------
// Test helper — a deterministic LlmClient that returns a fixed response.
// ---------------------------------------------------------------------------

/**
 * Build an LlmClient that always returns `responseJson`. Lets tests exercise the
 * parse/enforcement path offline with no real model.
 */
export function mockLlmClient(responseJson: string): LlmClient {
  return {
    complete: async () => responseJson,
  };
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

/** Summarize an evidence document compactly for the prompt. */
function describeEvidence(e: ClassifiedEvidence): string {
  const parts = [`documentId=${e.rawFingerprint}`, `type=${e.documentType}`];
  if (e.filename) parts.push(`filename=${e.filename}`);
  if (e.rows && e.rows.length > 0) parts.push(`rows=${e.rows.length}`);
  if (typeof e.text === 'string' && e.text.trim()) {
    parts.push(`text="${e.text.replace(/\s+/g, ' ').trim().slice(0, 400)}"`);
  }
  return `- ${parts.join(' ')}`;
}

/** Summarize the deterministic findings already fired, so the LLM won't repeat them. */
function describeDeterministic(results: ControlResult[]): string {
  const lines: string[] = [];
  for (const r of results) {
    if (r.status === 'failed') {
      lines.push(`- ${r.controlId} (FAILED, ${r.severity}): ${r.message ?? ''}`.trim());
    } else if (r.status === 'passed') {
      lines.push(`- ${r.controlId} (PASSED)`);
    }
  }
  return lines.length > 0 ? lines.join('\n') : '(none)';
}

/**
 * Build the strict residual prompt. It includes the canonical evidence, the
 * deterministic findings, the skipped controls, the citable source passages, and
 * the contract: do NOT repeat deterministic findings, and cite a passage for every
 * finding. The output contract is a strict JSON object.
 */
export function buildResidualPrompt(input: LlmResidualInput): string {
  const evidence = input.canonicalEvidence.map(describeEvidence).join('\n') || '(none)';
  const deterministic = describeDeterministic(input.deterministicResults);
  const skipped =
    input.skippedControlIds.length > 0 ? input.skippedControlIds.join(', ') : '(none)';
  const passages =
    input.sourcePassages.length > 0
      ? input.sourcePassages
          .map(
            (p, i) =>
              `[${i}] documentId=${p.documentId} :: ${p.passage.replace(/\s+/g, ' ').trim()}`,
          )
          .join('\n')
      : '(none)';

  return [
    `You are the RESIDUAL review layer for the "${input.product}" proof product.`,
    `Deterministic controls have ALREADY run and are authoritative. Your job is NOT to`,
    `re-decide them. You only surface things pattern-based controls cannot catch:`,
    `ambiguous prose, classification gaps, semantic contradictions, and summaries.`,
    ``,
    `## Canonical evidence`,
    evidence,
    ``,
    `## Deterministic findings already fired (DO NOT REPEAT THESE controlIds)`,
    deterministic,
    ``,
    `## Skipped controls (gaps you may comment on)`,
    skipped,
    ``,
    `## Citable source passages (cite by documentId; quote the passage)`,
    passages,
    ``,
    `## STRICT RULES`,
    `1. Every finding MUST cite at least one evidenceRef whose documentId matches one`,
    `   of the documents/passages above and whose sourcePassage quotes the evidence.`,
    `2. Do NOT emit a finding for a controlId already listed under deterministic`,
    `   findings.`,
    `3. If you cannot cite evidence for a concern, OMIT it. Never fabricate a citation.`,
    `4. modelConfidence is advisory only; it will not set the final confidence.`,
    ``,
    `## OUTPUT — return ONLY this JSON, no prose:`,
    `{"findings":[{"controlId":"<id>","severity":"critical|high|medium|low",`,
    `"message":"<text>","evidenceRefs":[{"documentId":"<id>","documentType":"<type>",`,
    `"sourcePassage":"<quote>"}],"recommendedAction":"<text>","modelConfidence":<0-1>}]}`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Defensive JSON parsing + enforcement
// ---------------------------------------------------------------------------

const VALID_SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low'];

function coerceSeverity(v: unknown): Severity {
  return typeof v === 'string' && (VALID_SEVERITIES as string[]).includes(v)
    ? (v as Severity)
    : 'medium';
}

function coerceString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function coerceModelConfidence(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  return Math.max(0, Math.min(1, v));
}

/** Coerce a raw evidenceRef object into a typed EvidenceRef, or null if unusable. */
function coerceEvidenceRef(v: unknown): EvidenceRef | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const documentId = coerceString(o.documentId);
  // A citation with no documentId is not a citation.
  if (!documentId) return null;
  const ref: EvidenceRef = {
    documentId,
    documentType: coerceString(o.documentType) || 'unknown',
  };
  if (typeof o.filename === 'string') ref.filename = o.filename;
  if (typeof o.field === 'string') ref.field = o.field;
  if (typeof o.rawValue === 'string') ref.rawValue = o.rawValue;
  if (typeof o.normalizedValue === 'string') ref.normalizedValue = o.normalizedValue;
  if (typeof o.lineNumber === 'number') ref.lineNumber = o.lineNumber;
  if (typeof o.sectionHeading === 'string') ref.sectionHeading = o.sectionHeading;
  if (typeof o.sourcePassage === 'string') ref.sourcePassage = o.sourcePassage;
  return ref;
}

/**
 * Parse the model's JSON response defensively. Never throws — a malformed response
 * yields an empty finding list. Accepts either a bare array or an object with a
 * `findings` array, and tolerates leading/trailing prose by extracting the first
 * JSON block.
 */
export function parseResidualResponse(raw: string): LlmResidualFinding[] {
  const json = extractJson(raw);
  if (json === null) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }

  const rawFindings: unknown[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { findings?: unknown }).findings)
      ? (parsed as { findings: unknown[] }).findings
      : [];

  const out: LlmResidualFinding[] = [];
  for (const rf of rawFindings) {
    if (!rf || typeof rf !== 'object') continue;
    const o = rf as Record<string, unknown>;
    const controlId = coerceString(o.controlId);
    const message = coerceString(o.message);
    // A finding with neither a controlId nor a message is meaningless.
    if (!controlId && !message) continue;

    const refsRaw = Array.isArray(o.evidenceRefs) ? o.evidenceRefs : [];
    const evidenceRefs = refsRaw.map(coerceEvidenceRef).filter((r): r is EvidenceRef => r !== null);

    out.push({
      controlId: controlId || 'LLM-RESIDUAL',
      severity: coerceSeverity(o.severity),
      message,
      evidenceRefs,
      recommendedAction: coerceString(o.recommendedAction),
      modelConfidence: coerceModelConfidence(o.modelConfidence),
    });
  }
  return out;
}

/** Extract the first balanced JSON object/array from arbitrary text, or null. */
function extractJson(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Fast path: the whole string is JSON.
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    return trimmed;
  }
  // Otherwise scan for the first balanced { ... } block.
  const start = trimmed.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return trimmed.slice(start, i + 1);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Enforcement: residual finding → ProofFinding (citation-gated)
// ---------------------------------------------------------------------------

/**
 * Deterministic id for a residual finding: namespaced under `residual_`, keyed by
 * controlId + position so identical inputs yield identical ids across runs.
 */
function residualFindingId(f: LlmResidualFinding, index: number): string {
  return `residual_${f.controlId}_${index}`;
}

/**
 * Convert validated LlmResidualFindings into kernel ProofFindings while ENFORCING
 * the citation rule:
 *   - finding WITH ≥1 evidenceRef  → ProofFinding with the LLM's status
 *     ('failed' downgraded to the same severity it claimed, but only because it is
 *     cited). A cited residual failure is a real finding.
 *   - finding WITHOUT any evidenceRef → it CANNOT be a hard 'failed'. If a message
 *     survives, it is downgraded to status 'needs_more_evidence' (severity floored to
 *     'low' so it can never trip a hard-fail gate). Otherwise it is dropped.
 *
 * Findings whose controlId already appears in the deterministic results are
 * dropped (no overlap with controls the kernel already decided).
 */
export function enforceResidualFindings(
  residual: LlmResidualFinding[],
  deterministicResults: ControlResult[],
): ProofFinding[] {
  const deterministicIds = new Set(deterministicResults.map((r) => r.controlId));
  const out: ProofFinding[] = [];

  residual.forEach((f, index) => {
    // Rule 3 — never restate a control the kernel already decided.
    if (f.controlId && deterministicIds.has(f.controlId)) return;

    if (f.evidenceRefs.length > 0) {
      // Cited: allowed to be a real finding (failed/warning) at its claimed severity.
      out.push({
        id: residualFindingId(f, index),
        controlId: f.controlId,
        severity: f.severity,
        status: 'failed',
        message: f.message || `Residual reviewer flagged ${f.controlId}.`,
        evidenceRefs: f.evidenceRefs,
        recommendedAction:
          f.recommendedAction || 'Review the cited passage and confirm before acceptance.',
      });
      return;
    }

    // Uncited: cannot be a hard failure. Downgrade to needs_more_evidence if there is
    // a usable message; otherwise drop entirely.
    if (!f.message) return;
    out.push({
      id: residualFindingId(f, index),
      controlId: f.controlId,
      // Floor severity so an uncited residual can never dominate confidence.
      severity: 'low',
      status: 'needs_more_evidence',
      message: f.message,
      evidenceRefs: [],
      recommendedAction:
        f.recommendedAction ||
        'Provide supporting evidence so this residual concern can be confirmed or cleared.',
    });
  });

  return out;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Run the residual layer. No-op (invoked:false) unless a client is injected and not
 * disabled. All enforcement rules above are applied to the model output before any
 * finding is returned.
 */
export async function runLlmResidual(
  input: LlmResidualInput,
  opts: ResidualOptions = {},
): Promise<RunLlmResidualResult> {
  const enabled = opts.enabled !== false;
  const client = opts.client;
  if (!enabled || !client) {
    return { findings: [], invoked: false };
  }

  const prompt = buildResidualPrompt(input);

  let raw: string;
  try {
    raw = await client.complete(prompt);
  } catch {
    // A failing model never blocks the deterministic report.
    return { findings: [], invoked: true };
  }

  const residual = parseResidualResponse(raw);
  const findings = enforceResidualFindings(residual, input.deterministicResults);
  return { findings, raw, invoked: true };
}
