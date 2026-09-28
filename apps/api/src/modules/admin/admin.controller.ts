import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import type { AdminIdentity } from '@prisma/client';

import { AdminAuthGuard } from './admin-auth.guard.js';
import { AdminService } from './admin.service.js';
import { CurrentAdmin } from './current-admin.decorator.js';

interface CreateOrganizationBody {
  name?: string;
  slug?: string;
  reason?: string;
}

interface CreateApiKeyBody {
  label?: string;
  reason?: string;
}

interface RevokeApiKeyBody {
  reason?: string;
}

/**
 * Platform-internal admin backend. Every route requires a valid `x-admin-key`
 * header (AdminAuthGuard) — this is a single shared master credential, not a
 * multi-user login system (see CLAUDE.md: no general user auth in this repo).
 * Not exposed to customers; there is no Swagger setup in this repo to exclude
 * these routes from (see apps/api/src/main.ts).
 */
@Controller('admin')
@UseGuards(AdminAuthGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('overview')
  getOverview() {
    return this.admin.getOverview();
  }

  @Get('orgs')
  listOrganizations() {
    return this.admin.listOrganizations();
  }

  @Post('orgs')
  createOrganization(@Body() body: CreateOrganizationBody, @CurrentAdmin() admin: AdminIdentity) {
    return this.admin.createOrganization(body.name ?? '', body.slug ?? '', body.reason ?? '', admin.id);
  }

  @Get('orgs/:orgId/api-keys')
  listApiKeys(@Param('orgId') orgId: string) {
    return this.admin.listApiKeys(orgId);
  }

  @Post('orgs/:orgId/api-keys')
  createApiKey(
    @Param('orgId') orgId: string,
    @Body() body: CreateApiKeyBody,
    @CurrentAdmin() admin: AdminIdentity,
  ) {
    return this.admin.createApiKey(orgId, body.label ?? '', body.reason ?? '', admin.id);
  }

  @Delete('api-keys/:apiIdentityId')
  revokeApiKey(
    @Param('apiIdentityId') apiIdentityId: string,
    @Body() body: RevokeApiKeyBody,
    @CurrentAdmin() admin: AdminIdentity,
  ) {
    return this.admin.revokeApiKey(apiIdentityId, body.reason ?? '', admin.id);
  }

  @Get('audit-log')
  getAuditLog(@Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    return this.admin.getAuditLog(limit ? Number(limit) : undefined, cursor);
  }
}
