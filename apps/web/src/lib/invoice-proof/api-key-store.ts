/**
 * Browser-side holder for the customer's Chain Verify API key.
 *
 * Follows the existing admin surface (app/admin/AdminKeyGate.tsx): the key lives in
 * sessionStorage only (never localStorage) so it clears when the tab closes.
 * sessionStorage is readable by page scripts, so it is not an httpOnly cookie.
 */
export const INVOICE_PROOF_KEY_STORAGE = 'cv_invoiceproof_key';

export function readStoredKey(): string | null {
  try {
    const value = window.sessionStorage.getItem(INVOICE_PROOF_KEY_STORAGE);
    return value && value.trim() ? value : null;
  } catch {
    return null;
  }
}

export function writeStoredKey(key: string): void {
  try {
    window.sessionStorage.setItem(INVOICE_PROOF_KEY_STORAGE, key);
  } catch {
    // sessionStorage unavailable (private mode); the key stays in memory for this view only.
  }
}

export function clearStoredKey(): void {
  try {
    window.sessionStorage.removeItem(INVOICE_PROOF_KEY_STORAGE);
  } catch {
    // ignore
  }
}
