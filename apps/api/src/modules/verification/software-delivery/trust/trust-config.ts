/**
 * Environment-driven trust configuration for the Agent Gate trust layer.
 * Read at call time (not import time) so a deploy-time env change or a test
 * override takes effect without re-importing modules.
 *
 *   AGENT_GATE_TRUSTED_RECEIPT_KEYS      comma-separated hex Ed25519 public keys
 *   AGENT_GATE_RECEIPT_MAX_AGE_HOURS     default 24
 *   AGENT_GATE_EVIDENCE_MAX_AGE_HOURS    default 24
 *   AGENT_GATE_SELF_REPORTED_CONFIDENCE_CAP  default 0.6 (0..1)
 */
export const DEFAULT_RECEIPT_MAX_AGE_HOURS = 24;
export const DEFAULT_EVIDENCE_MAX_AGE_HOURS = 24;

/** Overall-confidence ceiling when critical evidence is only self-reported or absent. */
export const SELF_REPORTED_CONFIDENCE_CAP = 0.6;

function positiveNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function receiptMaxAgeHours(env: NodeJS.ProcessEnv = process.env): number {
  return positiveNumber(env['AGENT_GATE_RECEIPT_MAX_AGE_HOURS'], DEFAULT_RECEIPT_MAX_AGE_HOURS);
}

export function evidenceMaxAgeHours(env: NodeJS.ProcessEnv = process.env): number {
  return positiveNumber(env['AGENT_GATE_EVIDENCE_MAX_AGE_HOURS'], DEFAULT_EVIDENCE_MAX_AGE_HOURS);
}

export function selfReportedConfidenceCap(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env['AGENT_GATE_SELF_REPORTED_CONFIDENCE_CAP'];
  if (raw === undefined || raw.trim() === '') return SELF_REPORTED_CONFIDENCE_CAP;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : SELF_REPORTED_CONFIDENCE_CAP;
}
