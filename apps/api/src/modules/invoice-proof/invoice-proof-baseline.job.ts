import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import { InvoiceProofIntelligenceService } from './invoice-proof-intelligence.service.js';

/** Minimum invoice-history rows an organization needs before baselines are computed. */
export const BASELINE_MIN_HISTORY_ROWS = 3;
/** Nightly run time, UTC (SwarmSync schedule was cron `0 3 * * *`). */
export const BASELINE_RUN_HOUR_UTC = 3;

export interface BaselineJobResult {
  organizations: number;
  vendorsUpdated: number;
  failedOrganizations: number;
}

/**
 * Enabled by default only in production. `INVOICE_PROOF_BASELINE_JOB_ENABLED=true|false`
 * (also `1|0`) overrides either way.
 */
export function isBaselineJobEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.INVOICE_PROOF_BASELINE_JOB_ENABLED?.trim().toLowerCase();
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  return env.NODE_ENV === 'production';
}

/** Milliseconds from `now` until the next HH:00:00 UTC strictly after `now`. */
export function msUntilNextRun(now: Date, hourUtc: number = BASELINE_RUN_HOUR_UTC): number {
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUtc, 0, 0, 0),
  );
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}

/**
 * Nightly recompute of per-vendor statistical baselines (`org_vendor_baselines`) for every
 * organization with invoice history. Without it `checkStatisticalAnomalies` has no data and
 * STATISTICAL_ANOMALY findings can never fire. Upserts are idempotent, so overlapping runs
 * from several API instances are harmless.
 */
@Injectable()
export class InvoiceProofBaselineJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InvoiceProofBaselineJob.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly intelligence: InvoiceProofIntelligenceService,
  ) {}

  onModuleInit(): void {
    if (!isBaselineJobEnabled()) {
      this.logger.log(
        'Baseline recompute job disabled (set INVOICE_PROOF_BASELINE_JOB_ENABLED=true to enable).',
      );
      return;
    }
    this.scheduleNext();
  }

  onModuleDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private scheduleNext(): void {
    const delay = msUntilNextRun(new Date());
    this.logger.log(
      `Baseline recompute scheduled in ${Math.round(delay / 60000)} min (${BASELINE_RUN_HOUR_UTC}:00 UTC daily).`,
    );
    this.timer = setTimeout(() => {
      void this.runOnce()
        .catch((err: unknown) =>
          this.logger.error(`Baseline recompute failed: ${err instanceof Error ? err.message : String(err)}`),
        )
        .finally(() => this.scheduleNext());
    }, delay);
    // Never keep the process alive just for the nightly job.
    this.timer.unref();
  }

  async runOnce(): Promise<BaselineJobResult> {
    if (this.running) {
      this.logger.warn('Baseline recompute already running; skipping overlapping run.');
      return { organizations: 0, vendorsUpdated: 0, failedOrganizations: 0 };
    }
    this.running = true;
    try {
      const groups = await this.prisma.orgInvoiceHistory.groupBy({
        by: ['organizationId'],
        _count: { id: true },
        having: { id: { _count: { gte: BASELINE_MIN_HISTORY_ROWS } } },
      });

      let vendorsUpdated = 0;
      let failedOrganizations = 0;
      for (const group of groups) {
        try {
          vendorsUpdated += await this.intelligence.recomputeBaselines(group.organizationId);
        } catch (err: unknown) {
          failedOrganizations++;
          this.logger.error(
            `Baseline recompute failed for organization ${group.organizationId}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }

      const result: BaselineJobResult = {
        organizations: groups.length,
        vendorsUpdated,
        failedOrganizations,
      };
      this.logger.log(
        `InvoiceProof baselines updated: ${vendorsUpdated} vendors across ${groups.length} organizations (${failedOrganizations} failed).`,
      );
      return result;
    } finally {
      this.running = false;
    }
  }
}
