// Canonical evidence-normalization layer — FieldValue state model.
//
// A FieldValue wraps every extracted field so downstream controls can tell the
// difference between "checked and clean", "field absent", and "field present but
// uninterpretable". This is the core mechanism that stops messy customer input
// from silently returning "clean" just because a column name did not match.
//
// Semantics:
//   - value !== null            → usable value
//   - source: 'absent'          → no matching field was found in the input
//   - source: 'unknown'         → a field likely exists but could not be confidently
//                                 interpreted (e.g. unparseable amount). NEVER coerce
//                                 silently to 0 / '' / null — set a reason instead.

export type FieldSource = 'exact' | 'alias' | 'fuzzy' | 'derived' | 'llm' | 'absent' | 'unknown';

export type FieldValue<T> = {
  value: T | null;
  rawValue?: unknown;
  confidence: number;
  source: FieldSource;
  normalizedFrom?: string;
  reason?: string;
};

export type PresentOpts = {
  rawValue?: unknown;
  confidence?: number;
  normalizedFrom?: string;
  reason?: string;
};

/** Construct a usable FieldValue. Confidence defaults by source if not supplied. */
export function present<T>(value: T, source: FieldSource, opts: PresentOpts = {}): FieldValue<T> {
  const defaultConfidence: Record<FieldSource, number> = {
    exact: 1,
    alias: 0.95,
    fuzzy: 0.7,
    derived: 0.85,
    llm: 0.6,
    absent: 0,
    unknown: 0,
  };
  return {
    value,
    rawValue: opts.rawValue,
    confidence: opts.confidence ?? defaultConfidence[source],
    source,
    normalizedFrom: opts.normalizedFrom,
    reason: opts.reason,
  };
}

/** Construct an absent FieldValue — no matching field was found. */
export function absent<T>(reason?: string): FieldValue<T> {
  return {
    value: null,
    confidence: 0,
    source: 'absent',
    reason: reason ?? 'No matching field found in input',
  };
}

/**
 * Construct an unknown FieldValue — a field was present but could not be
 * confidently interpreted (e.g. an amount that did not parse to a number).
 * The raw value is preserved so the reason can reference it.
 */
export function unknownField<T>(rawValue: unknown, reason: string): FieldValue<T> {
  return {
    value: null,
    rawValue,
    confidence: 0,
    source: 'unknown',
    reason,
  };
}

/** True when a FieldValue carries a usable, non-null value. */
export function isUsable<T>(fv: FieldValue<T> | undefined): fv is FieldValue<T> & { value: T } {
  return !!fv && fv.value !== null && fv.value !== undefined;
}
