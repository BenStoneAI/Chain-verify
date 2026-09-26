export async function ensureAuthTokenAsync(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem('agent-market-token');
}
