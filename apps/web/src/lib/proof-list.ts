export function parseProofListPayload<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    for (const key of ['data', 'records', 'proofs', 'items']) {
      if (Array.isArray(record[key])) return record[key] as T[];
    }
  }
  return [];
}
