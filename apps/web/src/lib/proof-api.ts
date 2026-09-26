const DEFAULT_DEVELOPMENT_API_BASE = 'http://localhost:3001';
const DEFAULT_PRODUCTION_API_BASE = 'https://chain-verify-api.onrender.com';
const APP_HOSTS = new Set(['chainverify.org', 'www.chainverify.org']);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

function alignLocalApiHostWithBrowser(configured: string): string {
  if (typeof window === 'undefined') return configured;

  try {
    const url = new URL(configured);
    if (!LOCAL_HOSTS.has(url.hostname) || !LOCAL_HOSTS.has(window.location.hostname)) {
      return configured;
    }

    if (url.hostname !== window.location.hostname) {
      url.hostname = window.location.hostname;
    }

    return url.toString().replace(/\/$/, '');
  } catch {
    return configured;
  }
}

export function resolveProofApiBase(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim().replace(/\/$/, '');
  if (!configured) {
    return process.env.NODE_ENV === 'development'
      ? alignLocalApiHostWithBrowser(DEFAULT_DEVELOPMENT_API_BASE)
      : DEFAULT_PRODUCTION_API_BASE;
  }

  try {
    const url = new URL(configured);
    if (APP_HOSTS.has(url.hostname)) return DEFAULT_PRODUCTION_API_BASE;
    return alignLocalApiHostWithBrowser(configured);
  } catch {
    return DEFAULT_PRODUCTION_API_BASE;
  }
}

export const PROOF_VERIFY_DEMO_PATH = '/api/verify/demo';
export const PROOF_VERIFY_AUTH_PATH = '/api/verify';
