import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BASELINE_MIN_HISTORY_ROWS,
  InvoiceProofBaselineJob,
  isBaselineJobEnabled,
  msUntilNextRun,
} from './invoice-proof-baseline.job.js';

function makeJob(groups: Array<{ organizationId: string }>) {
  const prisma = {
    orgInvoiceHistory: { groupBy: vi.fn().mockResolvedValue(groups) },
  };
  const intelligence = { recomputeBaselines: vi.fn() };
  const job = new InvoiceProofBaselineJob(prisma as never, intelligence as never);
  return { job, prisma, intelligence };
}

describe('InvoiceProofBaselineJob.runOnce', () => {
  it('recomputes baselines for every organization that has invoice history', async () => {
    const { job, prisma, intelligence } = makeJob([
      { organizationId: 'org-a' },
      { organizationId: 'org-b' },
      { organizationId: 'org-c' },
    ]);
    intelligence.recomputeBaselines.mockResolvedValueOnce(2).mockResolvedValueOnce(0).mockResolvedValueOnce(5);

    const result = await job.runOnce();

    expect(prisma.orgInvoiceHistory.groupBy).toHaveBeenCalledWith({
      by: ['organizationId'],
      _count: { id: true },
      having: { id: { _count: { gte: BASELINE_MIN_HISTORY_ROWS } } },
    });
    expect(intelligence.recomputeBaselines.mock.calls.map((c) => c[0])).toEqual(['org-a', 'org-b', 'org-c']);
    expect(result).toEqual({ organizations: 3, vendorsUpdated: 7, failedOrganizations: 0 });
  });

  it('keeps going when one organization fails and reports the failure', async () => {
    const { job, intelligence } = makeJob([{ organizationId: 'org-a' }, { organizationId: 'org-b' }]);
    intelligence.recomputeBaselines.mockRejectedValueOnce(new Error('db down')).mockResolvedValueOnce(4);

    const result = await job.runOnce();

    expect(intelligence.recomputeBaselines).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ organizations: 2, vendorsUpdated: 4, failedOrganizations: 1 });
  });

  it('does nothing when no organization has enough history', async () => {
    const { job, intelligence } = makeJob([]);
    const result = await job.runOnce();
    expect(intelligence.recomputeBaselines).not.toHaveBeenCalled();
    expect(result).toEqual({ organizations: 0, vendorsUpdated: 0, failedOrganizations: 0 });
  });

  it('skips an overlapping run', async () => {
    const { job, intelligence } = makeJob([{ organizationId: 'org-a' }]);
    let release!: (n: number) => void;
    intelligence.recomputeBaselines.mockReturnValueOnce(new Promise<number>((r) => (release = r)));

    const first = job.runOnce();
    await Promise.resolve();
    await Promise.resolve();
    const overlapping = await job.runOnce();
    release(1);
    await first;

    expect(overlapping).toEqual({ organizations: 0, vendorsUpdated: 0, failedOrganizations: 0 });
    expect(intelligence.recomputeBaselines).toHaveBeenCalledTimes(1);
  });
});

describe('isBaselineJobEnabled', () => {
  it('defaults to enabled in production and disabled elsewhere', () => {
    expect(isBaselineJobEnabled({ NODE_ENV: 'production' })).toBe(true);
    expect(isBaselineJobEnabled({ NODE_ENV: 'development' })).toBe(false);
    expect(isBaselineJobEnabled({})).toBe(false);
  });

  it('INVOICE_PROOF_BASELINE_JOB_ENABLED overrides the default both ways', () => {
    expect(isBaselineJobEnabled({ NODE_ENV: 'production', INVOICE_PROOF_BASELINE_JOB_ENABLED: 'false' })).toBe(false);
    expect(isBaselineJobEnabled({ NODE_ENV: 'production', INVOICE_PROOF_BASELINE_JOB_ENABLED: '0' })).toBe(false);
    expect(isBaselineJobEnabled({ NODE_ENV: 'development', INVOICE_PROOF_BASELINE_JOB_ENABLED: 'true' })).toBe(true);
    expect(isBaselineJobEnabled({ INVOICE_PROOF_BASELINE_JOB_ENABLED: '1' })).toBe(true);
  });
});

describe('msUntilNextRun', () => {
  it('targets the next 03:00 UTC', () => {
    expect(msUntilNextRun(new Date('2026-10-14T01:00:00.000Z'))).toBe(2 * 3600_000);
    expect(msUntilNextRun(new Date('2026-10-14T03:00:00.000Z'))).toBe(24 * 3600_000);
    expect(msUntilNextRun(new Date('2026-10-14T20:30:00.000Z'))).toBe(6.5 * 3600_000);
  });
});

describe('InvoiceProofBaselineJob lifecycle', () => {
  const original = { ...process.env };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-14T02:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = { ...original };
  });

  it('runs at 03:00 UTC when enabled and stops on module destroy', async () => {
    process.env.INVOICE_PROOF_BASELINE_JOB_ENABLED = 'true';
    const { job, prisma } = makeJob([]);

    job.onModuleInit();
    expect(prisma.orgInvoiceHistory.groupBy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(3600_000);
    expect(prisma.orgInvoiceHistory.groupBy).toHaveBeenCalledTimes(1);

    job.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(48 * 3600_000);
    expect(prisma.orgInvoiceHistory.groupBy).toHaveBeenCalledTimes(1);
  });

  it('schedules nothing when disabled', async () => {
    process.env.INVOICE_PROOF_BASELINE_JOB_ENABLED = 'false';
    const { job, prisma } = makeJob([]);

    job.onModuleInit();
    await vi.advanceTimersByTimeAsync(48 * 3600_000);

    expect(prisma.orgInvoiceHistory.groupBy).not.toHaveBeenCalled();
  });
});
