import { randomBytes } from 'node:crypto';

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../database/prisma.service.js';
import { sha256Hex } from '../../common/utils/api-key-hash.js';

// Marks keys minted through the admin panel as customer-facing, org-scoped
// ApiIdentity keys — distinct from the cv_admin_ prefix used for AdminIdentity
// keys (see apps/api/scripts/create-admin-key.ts).
const ORG_API_KEY_PREFIX = 'cv_live_';

const DEFAULT_AUDIT_LOG_PAGE_SIZE = 50;
const MAX_AUDIT_LOG_PAGE_SIZE = 200;

// Every ApiIdentity read that can flow back into an API response must use
// this select — apiKeyHash must never leave the server, even as a hash (it's
// the sole credential check; leaking it is equivalent to leaking the key).
const API_IDENTITY_SAFE_SELECT = {
  id: true,
  organizationId: true,
  label: true,
  active: true,
  lastUsedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

function requireReason(reason: string | undefined | null): string {
  const trimmed = (reason ?? '').trim();
  if (!trimmed) {
    throw new BadRequestException('A non-empty reason is required for this action.');
  }
  return trimmed;
}

function startOfCurrentMonthUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Backs every /api/admin/* route. Every mutation here runs inside a single
 * `$transaction` alongside its AdminAuditLog write (via recordAuditLog), so a
 * mutation can never commit without a matching audit entry — if the audit
 * insert fails, Prisma rolls the whole transaction back.
 */
@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  private async recordAuditLog(
    tx: Prisma.TransactionClient,
    adminIdentityId: string,
    action: string,
    reason: string,
    metadata: Record<string, unknown> = {},
  ) {
    return tx.adminAuditLog.create({
      data: {
        adminIdentityId,
        action,
        reason: requireReason(reason),
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }

  /** Orgs with their active API key count and this-month usage per product. */
  async listOrganizations() {
    const periodStart = startOfCurrentMonthUtc();
    const orgs = await this.prisma.organization.findMany({ orderBy: { createdAt: 'desc' } });

    return Promise.all(
      orgs.map(async (org) => {
        const [activeApiKeyCount, usageByProduct] = await Promise.all([
          this.prisma.apiIdentity.count({ where: { organizationId: org.id, active: true } }),
          this.prisma.verificationRun.groupBy({
            by: ['product'],
            where: { orgId: org.id, createdAt: { gte: periodStart } },
            _count: { _all: true },
          }),
        ]);

        return {
          id: org.id,
          name: org.name,
          slug: org.slug,
          createdAt: org.createdAt,
          activeApiKeyCount,
          usageThisMonth: usageByProduct.map((row) => ({
            product: row.product,
            count: row._count._all,
          })),
        };
      }),
    );
  }

  async createOrganization(name: string, slug: string, reason: string, adminIdentityId: string) {
    // Validate the reason up front — fail before touching the database at
    // all, rather than relying on transaction rollback for basic input
    // validation.
    const trimmedReason = requireReason(reason);
    const trimmedName = (name ?? '').trim();
    const trimmedSlug = (slug ?? '').trim().toLowerCase();
    if (!trimmedName) throw new BadRequestException('name is required');
    if (!/^[a-z0-9-]+$/.test(trimmedSlug)) {
      throw new BadRequestException('slug must contain only lowercase letters, numbers, and hyphens');
    }

    const existing = await this.prisma.organization.findUnique({ where: { slug: trimmedSlug } });
    if (existing) {
      throw new BadRequestException(`Organization slug "${trimmedSlug}" is already in use`);
    }

    return this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({ data: { name: trimmedName, slug: trimmedSlug } });
      await this.recordAuditLog(tx, adminIdentityId, 'CREATE_ORG', trimmedReason, {
        organizationId: org.id,
        name: trimmedName,
        slug: trimmedSlug,
      });
      return org;
    });
  }

  /**
   * Mints a new customer-facing API key. The raw key is returned exactly
   * once, in this response — only its hash is ever persisted, so it cannot
   * be recovered or displayed again after this call returns.
   */
  async createApiKey(organizationId: string, label: string, reason: string, adminIdentityId: string) {
    const trimmedReason = requireReason(reason);
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId } });
    if (!org) throw new NotFoundException(`Organization ${organizationId} not found`);

    const trimmedLabel = (label ?? '').trim() || null;
    const rawKey = `${ORG_API_KEY_PREFIX}${randomBytes(32).toString('hex')}`;
    const apiKeyHash = sha256Hex(rawKey);

    const created = await this.prisma.$transaction(async (tx) => {
      const identity = await tx.apiIdentity.create({
        data: { organizationId, label: trimmedLabel, apiKeyHash },
      });
      await this.recordAuditLog(tx, adminIdentityId, 'CREATE_API_KEY', trimmedReason, {
        organizationId,
        apiIdentityId: identity.id,
        label: trimmedLabel,
      });
      return identity;
    });

    return {
      id: created.id,
      organizationId: created.organizationId,
      label: created.label,
      active: created.active,
      createdAt: created.createdAt,
      // Shown exactly once — never persisted in plaintext, never returned by
      // any other endpoint. The caller must copy it now.
      apiKey: rawKey,
      warning: 'This key will not be shown again. Store it securely now.',
    };
  }

  async revokeApiKey(apiIdentityId: string, reason: string, adminIdentityId: string) {
    const trimmedReason = requireReason(reason);
    const identity = await this.prisma.apiIdentity.findUnique({
      where: { id: apiIdentityId },
      select: API_IDENTITY_SAFE_SELECT,
    });
    if (!identity) throw new NotFoundException(`API key ${apiIdentityId} not found`);

    // Idempotent: revoking an already-revoked key is a no-op, not an error,
    // and does not write a duplicate audit entry.
    if (!identity.active) return identity;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.apiIdentity.update({
        where: { id: apiIdentityId },
        data: { active: false },
        select: API_IDENTITY_SAFE_SELECT,
      });
      await this.recordAuditLog(tx, adminIdentityId, 'REVOKE_API_KEY', trimmedReason, {
        organizationId: identity.organizationId,
        apiIdentityId,
      });
      return updated;
    });
  }

  /** Label, active state, last-used, and created-at only — never the key or its hash. */
  async listApiKeys(organizationId: string) {
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId } });
    if (!org) throw new NotFoundException(`Organization ${organizationId} not found`);

    return this.prisma.apiIdentity.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      select: API_IDENTITY_SAFE_SELECT,
    });
  }

  /** "Is anything on fire" landing view. */
  async getOverview() {
    const periodStart = startOfCurrentMonthUtc();
    const [totalOrganizations, totalActiveApiKeys, verificationRunsThisMonth, orgIdRows, usageOrgIdRows, recentAuditLog] =
      await Promise.all([
        this.prisma.organization.count(),
        this.prisma.apiIdentity.count({ where: { active: true } }),
        this.prisma.verificationRun.count({ where: { createdAt: { gte: periodStart } } }),
        this.prisma.organization.findMany({ select: { id: true } }),
        this.prisma.verificationRun.findMany({ distinct: ['orgId'], select: { orgId: true } }),
        this.prisma.adminAuditLog.findMany({
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: { adminIdentity: { select: { label: true } } },
        }),
      ]);

    // Dormant = a real organization with zero verification runs ever (not just
    // this month). The 'anonymous' sentinel orgId used by unauthenticated runs
    // never matches a real Organization.id, so it can't distort this count.
    const orgIdSet = new Set(orgIdRows.map((row) => row.id));
    const orgsWithUsage = new Set(usageOrgIdRows.map((row) => row.orgId).filter((id) => orgIdSet.has(id)));
    const dormantOrganizations = Math.max(totalOrganizations - orgsWithUsage.size, 0);

    return {
      totalOrganizations,
      totalActiveApiKeys,
      verificationRunsThisMonth,
      dormantOrganizations,
      recentAuditLog: recentAuditLog.map((entry) => ({
        id: entry.id,
        action: entry.action,
        reason: entry.reason,
        createdAt: entry.createdAt,
        adminLabel: entry.adminIdentity.label,
      })),
    };
  }

  async getAuditLog(limit?: number, cursor?: string) {
    const take = Math.min(Math.max(limit ?? DEFAULT_AUDIT_LOG_PAGE_SIZE, 1), MAX_AUDIT_LOG_PAGE_SIZE);

    const rows = await this.prisma.adminAuditLog.findMany({
      take: take + 1,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { createdAt: 'desc' },
      include: { adminIdentity: { select: { label: true } } },
    });

    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;

    return {
      items: page.map((entry) => ({
        id: entry.id,
        action: entry.action,
        reason: entry.reason,
        metadata: entry.metadata,
        createdAt: entry.createdAt,
        adminLabel: entry.adminIdentity.label,
      })),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }
}
