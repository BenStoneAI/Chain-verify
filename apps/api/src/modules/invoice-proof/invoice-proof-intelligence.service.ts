import { Injectable } from '@nestjs/common';
import { FraudIntelStatus } from '@prisma/client';

import { PrismaService } from '../database/prisma.service.js';
import type { Row } from '@chain-verify/proof-core/invoice-scan.js';

type Finding = {
  severity: 'critical' | 'high' | 'medium';
  pattern: string;
  detail: string;
  rows: string[];
  evidence?: string;
};

/** Matches both the legacy string and the proof-core emitted string for bank-change findings. */
function isBankChangePattern(pattern: string): boolean {
  return pattern.includes('BANK_ACCOUNT_CHANGE');
}

@Injectable()
export class InvoiceProofIntelligenceService {
  constructor(private readonly prisma: PrismaService) {}

  async enrichFindings(
    organizationId: string | undefined,
    rows: Row[],
    findings: Finding[],
  ): Promise<Finding[]> {
    let enriched = [...findings];

    if (organizationId) {
      const baselineFindings = await this.checkStatisticalAnomalies(organizationId, rows);
      enriched.push(...baselineFindings);
      enriched = await this.downgradeVerifiedBankChanges(organizationId, enriched);
    }

    const consortiumFindings = await this.checkConsortiumSignals(rows);
    enriched.push(...consortiumFindings);

    const severityRank = { critical: 0, high: 1, medium: 2 } as const;
    return enriched.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
  }

  async checkStatisticalAnomalies(organizationId: string, rows: Row[]): Promise<Finding[]> {
    const baselines = await this.prisma.orgVendorBaseline.findMany({
      where: { organizationId, sampleCount: { gte: 3 } },
    });
    if (baselines.length === 0) return [];

    const findings: Finding[] = [];
    for (const row of rows) {
      const baseline = baselines.find(
        (b) => b.vendorName.toLowerCase() === row.vendor.toLowerCase(),
      );
      if (!baseline || !baseline.avgAmount) continue;

      const threshold = baseline.avgAmount * 3;
      if (row.amount >= threshold) {
        findings.push({
          severity: 'high',
          pattern: 'STATISTICAL_ANOMALY',
          detail: `Invoice amount $${row.amount.toLocaleString()} is 3×+ above vendor average ($${baseline.avgAmount.toLocaleString()}).`,
          rows: [row.invoiceNo],
          evidence: `avg=${baseline.avgAmount}, stddev=${baseline.amountStdDev ?? 'n/a'}`,
        });
      }

      if (
        row.po &&
        baseline.typicalPoNumbers.length > 0 &&
        !baseline.typicalPoNumbers.some((p) => p.toLowerCase() === row.po.toLowerCase())
      ) {
        findings.push({
          severity: 'medium',
          pattern: 'STATISTICAL_ANOMALY',
          detail: `PO ${row.po} has not been used before for vendor ${row.vendor}.`,
          rows: [row.invoiceNo],
        });
      }
    }
    return findings;
  }

  async downgradeVerifiedBankChanges(
    organizationId: string,
    findings: Finding[],
  ): Promise<Finding[]> {
    const vendors = await this.prisma.orgVendorMaster.findMany({
      where: {
        organizationId,
        source: 'VENDOR_PORTAL_VERIFIED',
        bankDetailChangedAt: { not: null },
      },
    });
    if (vendors.length === 0) return findings;

    return findings.map((f) => {
      if (!isBankChangePattern(f.pattern)) return f;
      const vendor = vendors.find((v) =>
        f.detail.toLowerCase().includes(v.vendorName.toLowerCase()),
      );
      if (!vendor?.bankDetailChangedAt) return f;
      return {
        ...f,
        severity: 'medium' as const,
        detail: `${f.detail} (Bank change matches vendor self-verified update from ${vendor.bankDetailChangedAt.toISOString().slice(0, 10)}.)`,
      };
    });
  }

  async checkConsortiumSignals(rows: Row[]): Promise<Finding[]> {
    const routingNumbers = [...new Set(rows.map((r) => r.bank).filter(Boolean))];
    if (routingNumbers.length === 0) return [];

    const signals = await this.prisma.fraudIntelSignal.findMany({
      where: {
        routingNumber: { in: routingNumbers },
        status: FraudIntelStatus.ACTIVE,
        distinctOrgCount: { gte: 3 },
      },
    });

    const findings: Finding[] = [];
    for (const row of rows) {
      const signal = signals.find((s) => s.routingNumber === row.bank);
      if (!signal) continue;
      findings.push({
        severity: 'critical',
        pattern: 'CONSORTIUM_FRAUD_SIGNAL',
        detail: `Routing number on invoice from ${row.vendor} flagged across ${signal.distinctOrgCount} distinct InvoiceProof organizations (${signal.reportCount} total reports) in the last 30 days. Do not pay.`,
        rows: [row.invoiceNo],
        evidence: `routing=${row.bank}, confidence=${signal.confidence}, distinctOrgCount=${signal.distinctOrgCount}, reportCount=${signal.reportCount}`,
      });
    }
    return findings;
  }

  async reportConsortiumSignals(findings: Finding[], organizationId: string): Promise<void> {
    const bankFlags = findings.filter(
      (f) => isBankChangePattern(f.pattern) && f.severity === 'critical',
    );
    for (const f of bankFlags) {
      const match = f.evidence?.match(/routing[=:]?\s*(\d+)/i) ?? f.detail.match(/(\d{9})/);
      const routing = match?.[1];
      if (!routing) continue;

      // Upsert the per-org report row (idempotent per org per routing number).
      await this.prisma.fraudIntelOrgReport.upsert({
        where: { routingNumber_organizationId: { routingNumber: routing, organizationId } },
        create: { routingNumber: routing, organizationId },
        update: { lastReportedAt: new Date() },
      });

      // Count distinct orgs that have ever reported this routing number.
      const distinctOrgCount = await this.prisma.fraudIntelOrgReport.count({
        where: { routingNumber: routing },
      });

      // Upsert the aggregate signal, keeping raw reportCount for auditing.
      await this.prisma.fraudIntelSignal.upsert({
        where: { routingNumber: routing },
        create: {
          routingNumber: routing,
          reportCount: 1,
          distinctOrgCount,
          confidence: 0.5,
        },
        update: {
          reportCount: { increment: 1 },
          distinctOrgCount,
          lastSeenAt: new Date(),
          confidence: { increment: 0.05 },
        },
      });
    }
  }

  async recomputeBaselines(organizationId: string): Promise<number> {
    const history = await this.prisma.orgInvoiceHistory.findMany({
      where: { organizationId },
      orderBy: { paidAt: 'asc' },
    });
    const byVendor = new Map<string, typeof history>();
    for (const h of history) {
      const key = h.vendor.toLowerCase();
      const list = byVendor.get(key) ?? [];
      list.push(h);
      byVendor.set(key, list);
    }

    let updated = 0;
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    for (const [, records] of byVendor) {
      const recent = records.filter((r) => (r.paidAt ?? r.createdAt) >= sixtyDaysAgo);
      if (recent.length < 3) continue;
      const vendorName = records[0].vendor;
      const amounts = recent.map((r) => r.amount);
      const avgAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length;
      const variance =
        amounts.reduce((sum, a) => sum + (a - avgAmount) ** 2, 0) / amounts.length;
      const amountStdDev = Math.sqrt(variance);
      const poNumbers = [...new Set(recent.map((r) => r.poNumber).filter(Boolean))] as string[];

      let typicalFrequencyDays: number | undefined;
      if (recent.length >= 2) {
        const dates = recent
          .map((r) => (r.paidAt ?? r.createdAt).getTime())
          .sort((a, b) => a - b);
        const gaps = dates.slice(1).map((d, i) => (d - dates[i]) / (1000 * 60 * 60 * 24));
        typicalFrequencyDays = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      }

      await this.prisma.orgVendorBaseline.upsert({
        where: { organizationId_vendorName: { organizationId, vendorName } },
        create: {
          organizationId,
          vendorName,
          avgAmount,
          amountStdDev,
          typicalFrequencyDays,
          typicalPoNumbers: poNumbers,
          lastInvoiceAt: recent[recent.length - 1].paidAt ?? recent[recent.length - 1].createdAt,
          sampleCount: recent.length,
        },
        update: {
          avgAmount,
          amountStdDev,
          typicalFrequencyDays,
          typicalPoNumbers: poNumbers,
          lastInvoiceAt: recent[recent.length - 1].paidAt ?? recent[recent.length - 1].createdAt,
          sampleCount: recent.length,
          computedAt: new Date(),
        },
      });
      updated++;
    }
    return updated;
  }

  async aggregateFraudIntel(): Promise<number> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const signals = await this.prisma.fraudIntelSignal.findMany({
      where: { lastSeenAt: { gte: thirtyDaysAgo }, distinctOrgCount: { gte: 3 } },
    });
    for (const s of signals) {
      await this.prisma.fraudIntelSignal.update({
        where: { id: s.id },
        data: {
          status: FraudIntelStatus.ACTIVE,
          confidence: Math.min(0.99, 0.5 + s.reportCount * 0.05),
        },
      });
    }
    return signals.length;
  }
}
