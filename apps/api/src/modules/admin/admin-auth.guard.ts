import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import { sha256Hex } from '../../common/utils/api-key-hash.js';

/**
 * Guards every /api/admin/* route behind a single shared platform-level admin
 * credential (AdminIdentity) — a master key, not a per-user login. Reads
 * `x-admin-key`, hashes it the same way every API-key credential in this
 * codebase is hashed (see sha256Hex), and looks it up against
 * AdminIdentity.apiKeyHash. On success it attaches the identity to the
 * request as `req.admin` for controllers/services to record on the audit
 * trail; on failure (missing header, unknown hash, or revoked key) it throws
 * 401 without leaking which case applied.
 */
@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const rawKey = String(request?.headers?.['x-admin-key'] ?? '').trim();
    if (!rawKey) {
      throw new UnauthorizedException('Missing x-admin-key header');
    }

    const apiKeyHash = sha256Hex(rawKey);
    const identity = await this.prisma.adminIdentity.findFirst({
      where: { apiKeyHash, active: true },
    });
    if (!identity) {
      throw new UnauthorizedException('Invalid or revoked admin key');
    }

    // Mirrors ApiKeyIdentityAdapter's lastUsedAt bookkeeping for customer keys.
    await this.prisma.adminIdentity.update({
      where: { id: identity.id },
      data: { lastUsedAt: new Date() },
    });

    request.admin = identity;
    return true;
  }
}
