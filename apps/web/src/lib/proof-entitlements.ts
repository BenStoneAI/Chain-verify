export interface ProofEntitlements {
  plan: string;
  runsUsed: number;
  runsLimit: number;
  [key: string]: unknown;
}

export function pickProofEntitlement(
  payload: unknown,
  product: string,
  fallback: ProofEntitlements,
): ProofEntitlements {
  const candidates: unknown[] = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object'
      ? [
          (payload as Record<string, unknown>)[product],
          (payload as Record<string, unknown>).entitlements,
          (payload as Record<string, unknown>).data,
        ]
      : [];
  const flattened = candidates.flatMap((value) => Array.isArray(value) ? value : value ? [value] : []);
  const match = flattened.find((value) => {
    if (!value || typeof value !== 'object') return false;
    const row = value as Record<string, unknown>;
    return row.product === product || row.productCode === product || row.slug === product;
  }) ?? flattened[0];
  if (!match || typeof match !== 'object') return fallback;
  const row = match as Record<string, unknown>;
  return {
    ...fallback,
    ...row,
    plan: String(row.plan ?? row.planSlug ?? fallback.plan),
    runsUsed: Number(row.runsUsed ?? row.used ?? fallback.runsUsed),
    runsLimit: Number(row.runsLimit ?? row.limit ?? fallback.runsLimit),
  };
}
