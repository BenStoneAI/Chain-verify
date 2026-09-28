import { resolveProofApiBase } from '@/lib/proof-api';

export const ADMIN_KEY_STORAGE_KEY = 'cv_admin_key';

export interface AdminUsageByProduct {
  product: string;
  count: number;
}

export interface AdminOrganization {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  activeApiKeyCount: number;
  usageThisMonth: AdminUsageByProduct[];
}

export interface AdminAuditEntry {
  id: string;
  action: string;
  reason: string;
  createdAt: string;
  adminLabel: string;
  metadata?: Record<string, unknown>;
}

export interface AdminOverview {
  totalOrganizations: number;
  totalActiveApiKeys: number;
  verificationRunsThisMonth: number;
  zeroUsageOrganizations: number;
  recentAuditLog: AdminAuditEntry[];
}

export interface AdminApiKey {
  id: string;
  label: string | null;
  active: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface CreatedAdminApiKey extends AdminApiKey {
  organizationId: string;
  apiKey: string;
  warning: string;
}

export interface AdminAuditLogPage {
  items: AdminAuditEntry[];
  nextCursor: string | null;
}

export class AdminApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'AdminApiError';
  }
}

/**
 * Every /api/admin/* call goes through here: it prefixes the base URL, sends
 * the admin key as `x-admin-key`, and normalizes error handling so callers
 * only have to handle AdminApiError. A 401 always means "the stored key is
 * bad" — callers should clear it and show the key-entry gate again.
 */
async function adminFetch<T>(key: string, path: string, init?: RequestInit): Promise<T> {
  const base = resolveProofApiBase();
  const res = await fetch(`${base}/api/admin${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-admin-key': key,
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { message?: string | string[] };
      if (Array.isArray(body.message)) message = body.message.join(', ');
      else if (body.message) message = body.message;
    } catch {
      // response body wasn't JSON — keep the generic message
    }
    throw new AdminApiError(message, res.status);
  }

  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const adminApi = {
  getOverview: (key: string) => adminFetch<AdminOverview>(key, '/overview'),
  listOrganizations: (key: string) => adminFetch<AdminOrganization[]>(key, '/orgs'),
  createOrganization: (key: string, name: string, slug: string, reason: string) =>
    adminFetch<AdminOrganization>(key, '/orgs', {
      method: 'POST',
      body: JSON.stringify({ name, slug, reason }),
    }),
  listApiKeys: (key: string, organizationId: string) =>
    adminFetch<AdminApiKey[]>(key, `/orgs/${encodeURIComponent(organizationId)}/api-keys`),
  createApiKey: (key: string, organizationId: string, label: string, reason: string) =>
    adminFetch<CreatedAdminApiKey>(key, `/orgs/${encodeURIComponent(organizationId)}/api-keys`, {
      method: 'POST',
      body: JSON.stringify({ label, reason }),
    }),
  revokeApiKey: (key: string, apiIdentityId: string, reason: string) =>
    adminFetch<AdminApiKey>(key, `/api-keys/${encodeURIComponent(apiIdentityId)}`, {
      method: 'DELETE',
      body: JSON.stringify({ reason }),
    }),
  getAuditLog: (key: string, cursor?: string | null) =>
    adminFetch<AdminAuditLogPage>(key, `/audit-log${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),
};
