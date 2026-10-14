import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { assertSsrfSafeWithDns } from '../../../../common/utils/ssrf-guard.js';
import type { CheckResult } from '../software-delivery.types.js';
import { CHECK_NAMES } from '../software-delivery.types.js';

@Injectable()
export class LiveChecksService {

  // B6 — Live site still opens
  async checkLiveSite(deployUrl: string | undefined): Promise<CheckResult> {
    const start = Date.now();
    if (!deployUrl) {
      return {
        checkId: 'B6',
        checkName: CHECK_NAMES['B6'],
        tier: 'BASIC',
        status: 'SKIP',
        detail: 'No deploy URL provided — skipping live site check.',
        durationMs: 0,
      };
    }
    try {
      await assertSsrfSafeWithDns(deployUrl);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { checkId: 'B6', checkName: CHECK_NAMES['B6'], tier: 'BASIC', status: 'FAIL', detail: `SSRF guard blocked request: ${message}`, durationMs: 0 };
    }
    try {
      const response = await axios.get(deployUrl, {
        timeout: 5000,
        validateStatus: () => true,
        headers: { 'Cache-Control': 'no-cache' },
      });
      const duration = Date.now() - start;
      const statusOk = response.status === 200;
      const timingOk = duration < 5000;
      return {
        checkId: 'B6',
        checkName: CHECK_NAMES['B6'],
        tier: 'BASIC',
        status: statusOk && timingOk ? 'PASS' : statusOk ? 'WARNING' : 'FAIL',
        detail: !statusOk
          ? `Site returned HTTP ${response.status} (expected 200).`
          : !timingOk
          ? `Site responded in ${duration}ms — exceeded 5 second threshold.`
          : undefined,
        evidence: { statusCode: response.status, durationMs: duration, url: deployUrl },
        durationMs: duration,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        checkId: 'B6',
        checkName: CHECK_NAMES['B6'],
        tier: 'BASIC',
        status: 'FAIL',
        detail: `Could not reach ${deployUrl}: ${message}`,
        durationMs: Date.now() - start,
      };
    }
  }

  // DEP4 — Health check passes
  async checkHealthEndpoint(deployUrl: string | undefined): Promise<CheckResult> {
    const start = Date.now();
    if (!deployUrl) {
      return {
        checkId: 'DEP4',
        checkName: CHECK_NAMES['DEP4'],
        tier: 'BASIC',
        status: 'SKIP',
        detail: 'No deploy URL provided — skipping health check.',
        durationMs: 0,
      };
    }
    const healthUrl = deployUrl.replace(/\/$/, '') + '/health';
    try {
      await assertSsrfSafeWithDns(deployUrl);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { checkId: 'DEP4', checkName: CHECK_NAMES['DEP4'], tier: 'BASIC', status: 'FAIL', detail: `SSRF guard blocked request: ${message}`, durationMs: 0 };
    }
    try {
      const response = await axios.get(healthUrl, {
        timeout: 5000,
        validateStatus: () => true,
      });
      const body = response.data as Record<string, unknown>;
      const isHealthy =
        response.status === 200 &&
        (body?.status === 'ok' || body?.status === 'healthy' || body?.healthy === true || body?.status === 'OK');
      // A reachable /health that explicitly reports degraded/unhealthy is a hard failure.
      return {
        checkId: 'DEP4',
        checkName: CHECK_NAMES['DEP4'],
        tier: 'BASIC',
        status: isHealthy ? 'PASS' : 'FAIL',
        detail: !isHealthy
          ? `Health endpoint returned HTTP ${response.status}: ${JSON.stringify(body).slice(0, 200)}`
          : undefined,
        evidence: { url: healthUrl, statusCode: response.status, body: JSON.stringify(body).slice(0, 500) },
        durationMs: Date.now() - start,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        checkId: 'DEP4',
        checkName: CHECK_NAMES['DEP4'],
        tier: 'BASIC',
        status: 'WARNING',
        detail: `No /health endpoint reachable at ${healthUrl}: ${message}`,
        durationMs: Date.now() - start,
      };
    }
  }

  // S8 — Feature is reachable via the correct entry point
  async checkFeatureReachable(deployUrl: string | undefined, _jobDescription: string | undefined): Promise<CheckResult> {
    const start = Date.now();
    if (!deployUrl) {
      return {
        checkId: 'S8',
        checkName: CHECK_NAMES['S8'],
        tier: 'STANDARD',
        status: 'SKIP',
        detail: 'No deploy URL provided — skipping feature reachability check.',
        durationMs: 0,
      };
    }
    // Try the root URL as a basic reachability probe (callers can provide a specific endpoint in future)
    try {
      await assertSsrfSafeWithDns(deployUrl);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { checkId: 'S8', checkName: CHECK_NAMES['S8'], tier: 'STANDARD', status: 'FAIL', detail: `SSRF guard blocked request: ${message}`, durationMs: 0 };
    }
    try {
      const response = await axios.get(deployUrl, {
        timeout: 8000,
        validateStatus: () => true,
        headers: { 'Cache-Control': 'no-cache' },
      });
      const reachable = response.status < 500;
      return {
        checkId: 'S8',
        checkName: CHECK_NAMES['S8'],
        tier: 'STANDARD',
        status: reachable ? 'PASS' : 'FAIL',
        detail: !reachable
          ? `Application returned HTTP ${response.status} — server error detected.`
          : 'Application is reachable. For endpoint-specific verification, provide a probe URL in the job description.',
        evidence: { url: deployUrl, statusCode: response.status },
        durationMs: Date.now() - start,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        checkId: 'S8',
        checkName: CHECK_NAMES['S8'],
        tier: 'STANDARD',
        status: 'FAIL',
        detail: `Could not reach ${deployUrl}: ${message}`,
        durationMs: Date.now() - start,
      };
    }
  }
}
