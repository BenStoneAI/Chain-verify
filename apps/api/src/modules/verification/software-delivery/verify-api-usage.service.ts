import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';

export const SOFTWARE_DELIVERY_USAGE_PRODUCT = 'software_delivery';

@Injectable()
export class VerifyApiUsageService {
  constructor(private readonly prisma: PrismaService) {}

  currentPeriodKey(date = new Date()): string {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  async getMonthlyCount(orgId: string, product: string, periodKey = this.currentPeriodKey()): Promise<number> {
    const row = await this.prisma.verifyApiUsage.findUnique({
      where: { orgId_product_periodKey: { orgId, product, periodKey } },
    });
    return row?.count ?? 0;
  }

  async increment(orgId: string, product: string): Promise<number> {
    const periodKey = this.currentPeriodKey();
    const row = await this.prisma.verifyApiUsage.upsert({
      where: { orgId_product_periodKey: { orgId, product, periodKey } },
      create: { orgId, product, periodKey, count: 1 },
      update: { count: { increment: 1 } },
    });
    return row.count;
  }

  async assertWithinLimit(orgId: string, product: string, limit: number | null): Promise<void> {
    if (limit === null) return;
    const used = await this.getMonthlyCount(orgId, product);
    if (used >= limit) {
      throw new HttpException(
        `Monthly software delivery verification limit reached (${used}/${limit}). Upgrade your Agent Gate plan for higher limits.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /**
   * Atomically claim one unit of monthly quota and enforce the limit in a single
   * step. The previous flow (assertWithinLimit → verify → increment) had a
   * check-then-act race: concurrent requests could each pass the check before
   * any incremented, overshooting the limit by the request concurrency (HKO L2).
   * Here the atomic upsert increments first and the returned count is the
   * authority — exactly `limit` requests succeed, the rest get a 429.
   */
  async reserve(orgId: string, product: string, limit: number | null): Promise<number> {
    const used = await this.increment(orgId, product);
    if (limit !== null && used > limit) {
      throw new HttpException(
        `Monthly software delivery verification limit reached (${limit}/${limit}). Upgrade your Agent Gate plan for higher limits.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return used;
  }
}
