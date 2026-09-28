import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InvoiceProofIntelligenceService } from './invoice-proof-intelligence.service.js';

describe('InvoiceProofIntelligenceService.enrichFindings', () => {
  const prisma = {
    orgVendorBaseline: { findMany: vi.fn().mockResolvedValue([]) },
    orgVendorMaster: { findMany: vi.fn().mockResolvedValue([]) },
    fraudIntelSignal: { findMany: vi.fn().mockResolvedValue([]) },
    fraudIntelOrgReport: { upsert: vi.fn(), count: vi.fn() },
  };

  const service = new InvoiceProofIntelligenceService(prisma as never);

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.orgVendorBaseline.findMany.mockResolvedValue([]);
    prisma.orgVendorMaster.findMany.mockResolvedValue([]);
    prisma.fraudIntelSignal.findMany.mockResolvedValue([]);
  });

  it('does not duplicate findings when downgrading verified bank changes (BANK_ACCOUNT_CHANGE_DETECTED legacy)', async () => {
    const baseFindings = [
      {
        severity: 'critical' as const,
        pattern: 'BANK_ACCOUNT_CHANGE_DETECTED',
        detail: 'Routing differs for Acme Supplies',
        rows: ['INV-1'],
      },
    ];

    const result = await service.enrichFindings('org-1', [], baseFindings);

    expect(result).toHaveLength(1);
    expect(result[0].pattern).toBe('BANK_ACCOUNT_CHANGE_DETECTED');
  });

  it('does not duplicate findings when downgrading proof-core emitted bank changes', async () => {
    const baseFindings = [
      {
        severity: 'critical' as const,
        pattern: 'Bank account change (BANK_ACCOUNT_CHANGE)',
        detail: 'Routing differs for Acme Supplies',
        rows: ['INV-1'],
      },
    ];

    const result = await service.enrichFindings('org-1', [], baseFindings);

    expect(result).toHaveLength(1);
    expect(result[0].pattern).toBe('Bank account change (BANK_ACCOUNT_CHANGE)');
  });

  it('returns base findings unchanged without organization context', async () => {
    const baseFindings = [
      {
        severity: 'high' as const,
        pattern: 'EXACT_DUPLICATE',
        detail: 'Duplicate invoice',
        rows: ['INV-2'],
      },
    ];

    const result = await service.enrichFindings(undefined, [], baseFindings);

    expect(result).toHaveLength(1);
    expect(result[0].pattern).toBe('EXACT_DUPLICATE');
  });

  it('downgradeVerifiedBankChanges handles proof-core emitted pattern string', async () => {
    prisma.orgVendorMaster.findMany.mockResolvedValue([
      {
        vendorName: 'Acme Supplies',
        source: 'VENDOR_PORTAL_VERIFIED',
        bankDetailChangedAt: new Date('2026-01-15'),
      },
    ]);

    const baseFindings = [
      {
        severity: 'critical' as const,
        pattern: 'Bank account change (BANK_ACCOUNT_CHANGE)',
        detail: 'Routing differs for Acme Supplies',
        rows: ['INV-1'],
      },
    ];

    const result = await service.enrichFindings('org-1', [], baseFindings);

    // Severity should be downgraded to medium when vendor-portal-verified
    expect(result[0].severity).toBe('medium');
    expect(result[0].detail).toContain('self-verified');
  });
});
