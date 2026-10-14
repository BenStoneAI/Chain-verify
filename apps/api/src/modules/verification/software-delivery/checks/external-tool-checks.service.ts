import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { assertSsrfSafeWithDns } from '../../../../common/utils/ssrf-guard.js';
import type { SoftwareDeliveryVerifyDto } from '../dto/software-delivery-verify.dto.js';
import type { CheckResult } from '../software-delivery.types.js';
import { CHECK_NAMES } from '../software-delivery.types.js';

type SemgrepSeverity = 'ERROR' | 'WARNING' | 'INFO' | 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

interface SemgrepFinding {
  path?: string;
  check_id?: string;
  extra?: {
    severity?: SemgrepSeverity;
    message?: string;
  };
  severity?: SemgrepSeverity;
  message?: string;
}

@Injectable()
export class ExternalToolChecksService {
  checkStaticSecurityAnalysis(dto: SoftwareDeliveryVerifyDto, diffFiles: string[]): CheckResult {
    const start = Date.now();
    const findings = (dto.semgrepFindings ?? []) as SemgrepFinding[];

    if (findings.length === 0) {
      return {
        checkId: 'T3',
        checkName: CHECK_NAMES['T3'],
        tier: 'THOROUGH',
        status: 'SKIP',
        detail:
          'No Semgrep findings report supplied. Pass semgrepFindings from a Semgrep JSON run to enable T3 static security analysis.',
        durationMs: Date.now() - start,
      };
    }

    const changed = new Set(diffFiles.map((f) => f.replace(/\\/g, '/')));
    const highRisk = findings.filter((finding) => {
      const severity = String(finding.extra?.severity ?? finding.severity ?? '').toUpperCase();
      const findingPath = finding.path?.replace(/\\/g, '/');
      const inChangedFile = !findingPath || changed.size === 0 || changed.has(findingPath);
      return inChangedFile && ['ERROR', 'CRITICAL', 'HIGH'].includes(severity);
    });

    return {
      checkId: 'T3',
      checkName: CHECK_NAMES['T3'],
      tier: 'THOROUGH',
      status: highRisk.length === 0 ? 'PASS' : 'FAIL',
      detail:
        highRisk.length > 0
          ? `Semgrep reported ${highRisk.length} high-risk finding(s) in changed code.`
          : undefined,
      evidence: {
        findingsChecked: findings.length,
        highRiskFindings: highRisk.slice(0, 10).map((finding) => ({
          path: finding.path,
          rule: finding.check_id,
          severity: finding.extra?.severity ?? finding.severity,
          message: finding.extra?.message ?? finding.message,
        })),
      },
      durationMs: Date.now() - start,
    };
  }

  async checkPerformanceRegression(dto: SoftwareDeliveryVerifyDto): Promise<CheckResult> {
    const start = Date.now();
    if (!dto.deployUrl) {
      return {
        checkId: 'T6',
        checkName: CHECK_NAMES['T6'],
        tier: 'THOROUGH',
        status: 'SKIP',
        detail: 'No deployUrl provided — cannot run T6 performance probes.',
        durationMs: 0,
      };
    }
    if (typeof dto.performanceBaselineP95Ms !== 'number') {
      return {
        checkId: 'T6',
        checkName: CHECK_NAMES['T6'],
        tier: 'THOROUGH',
        status: 'SKIP',
        detail:
          'No performanceBaselineP95Ms provided — cannot compare current p95 latency to baseline.',
        durationMs: 0,
      };
    }

    const probeUrls = this.buildProbeUrls(dto.deployUrl, dto.performanceProbePaths);
    for (const url of probeUrls) {
      try {
        await assertSsrfSafeWithDns(url);
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : String(err);
        return {
          checkId: 'T6',
          checkName: CHECK_NAMES['T6'],
          tier: 'THOROUGH',
          status: 'FAIL',
          detail: `SSRF guard blocked performance probe: ${reason}`,
          durationMs: 0,
        };
      }
    }

    try {
      const samples = await Promise.all(
        Array.from({ length: 50 }, (_, i) => this.measureRequest(probeUrls[i % probeUrls.length])),
      );
      const p95 = this.percentile(samples, 0.95);
      const allowed = dto.performanceBaselineP95Ms * 1.15;
      return {
        checkId: 'T6',
        checkName: CHECK_NAMES['T6'],
        tier: 'THOROUGH',
        status: p95 <= allowed ? 'PASS' : 'FAIL',
        detail:
          p95 > allowed
            ? `p95 latency ${p95}ms exceeds 15% regression budget (${Math.round(allowed)}ms).`
            : undefined,
        evidence: {
          baselineP95Ms: dto.performanceBaselineP95Ms,
          currentP95Ms: p95,
          allowedP95Ms: Math.round(allowed),
          sampleCount: samples.length,
          probeCount: probeUrls.length,
        },
        durationMs: Date.now() - start,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        checkId: 'T6',
        checkName: CHECK_NAMES['T6'],
        tier: 'THOROUGH',
        status: 'WARNING',
        detail: `Performance probes could not complete: ${message}`,
        durationMs: Date.now() - start,
      };
    }
  }

  async checkErrorRateStable(dto: SoftwareDeliveryVerifyDto, jobStartedAt: Date): Promise<CheckResult> {
    const start = Date.now();
    const org = dto.sentryOrgSlug ?? process.env.SENTRY_ORG_SLUG;
    const project = dto.sentryProjectSlug ?? process.env.SENTRY_PROJECT_SLUG;
    const token = dto.sentryAuthToken ?? process.env.SENTRY_AUTH_TOKEN;
    if (!org || !project || !token) {
      return {
        checkId: 'T11',
        checkName: CHECK_NAMES['T11'],
        tier: 'THOROUGH',
        status: 'SKIP',
        detail:
          'Sentry org/project/token not provided — cannot compare post-deploy error rate.',
        durationMs: 0,
      };
    }

    const beforeStart = new Date(jobStartedAt.getTime() - 15 * 60 * 1000);
    const beforeEnd = jobStartedAt;
    const afterStart = jobStartedAt;
    const afterEnd = new Date(jobStartedAt.getTime() + 15 * 60 * 1000);

    try {
      const [beforeErrors, afterErrors] = await Promise.all([
        this.fetchSentryErrorCount(org, project, token, beforeStart, beforeEnd, dto.sentryEnvironment),
        this.fetchSentryErrorCount(org, project, token, afterStart, afterEnd, dto.sentryEnvironment),
      ]);
      return {
        checkId: 'T11',
        checkName: CHECK_NAMES['T11'],
        tier: 'THOROUGH',
        status: afterErrors <= beforeErrors ? 'PASS' : 'FAIL',
        detail:
          afterErrors > beforeErrors
            ? `Sentry error count increased after deploy (${beforeErrors} before, ${afterErrors} after).`
            : undefined,
        evidence: { beforeErrors, afterErrors, windowMinutes: 15 },
        durationMs: Date.now() - start,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        checkId: 'T11',
        checkName: CHECK_NAMES['T11'],
        tier: 'THOROUGH',
        status: 'WARNING',
        detail: `Sentry error-rate query could not complete: ${message}`,
        durationMs: Date.now() - start,
      };
    }
  }

  private buildProbeUrls(deployUrl: string, paths: string[] | undefined): string[] {
    const probePaths = paths && paths.length > 0 ? paths : ['/'];
    return probePaths.map((path) => {
      const normalizedPath = path.startsWith('/') ? path : `/${path}`;
      return new URL(normalizedPath, deployUrl).toString();
    });
  }

  private async measureRequest(url: string): Promise<number> {
    const started = Date.now();
    await axios.get(url, {
      timeout: 8000,
      validateStatus: () => true,
      headers: { 'Cache-Control': 'no-cache, no-store', Pragma: 'no-cache' },
    });
    return Date.now() - started;
  }

  private percentile(samples: number[], p: number): number {
    const sorted = [...samples].sort((a, b) => a - b);
    const index = Math.max(0, Math.ceil(sorted.length * p) - 1);
    return sorted[index] ?? 0;
  }

  private async fetchSentryErrorCount(
    org: string,
    project: string,
    token: string,
    start: Date,
    end: Date,
    environment?: string,
  ): Promise<number> {
    const response = await axios.get(
      `https://sentry.io/api/0/projects/${encodeURIComponent(org)}/${encodeURIComponent(project)}/events-stats/`,
      {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10000,
        params: {
          field: 'count()',
          interval: '15m',
          query: ['event.type:error', environment ? `environment:${environment}` : '']
            .filter(Boolean)
            .join(' '),
          start: start.toISOString(),
          end: end.toISOString(),
        },
      },
    );
    return this.sumSentryStats(response.data?.data ?? response.data);
  }

  private sumSentryStats(data: unknown): number {
    if (!Array.isArray(data)) return 0;
    return data.reduce((sum, bucket) => {
      if (!Array.isArray(bucket)) return sum;
      const series = bucket[1];
      if (!Array.isArray(series)) return sum;
      const bucketCount = series.reduce((innerSum, point) => {
        const count = Number((point as { count?: unknown })?.count ?? 0);
        return innerSum + (Number.isFinite(count) ? count : 0);
      }, 0);
      return sum + bucketCount;
    }, 0);
  }
}
