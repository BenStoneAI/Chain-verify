import { vi, describe, it, expect, beforeEach, type Mocked } from 'vitest';
import axios from 'axios';
import { ExternalToolChecksService } from '../checks/external-tool-checks.service.js';
import { DeployPlatform, SoftwareJobType, SoftwareTier } from '../dto/software-delivery-verify.dto.js';

vi.mock('axios');
const mockedAxios = axios as Mocked<typeof axios>;

// T6 now resolves probe hostnames (DNS-rebinding defense, HKO L1), so the DNS
// lookup must be mocked to a public IP for the non-SSRF probe tests.
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
}));

describe('ExternalToolChecksService', () => {
  let service: ExternalToolChecksService;

  const baseDto = {
    repoOwner: 'acme',
    repoName: 'app',
    beforeSha: 'abc',
    afterSha: 'def',
    jobStartedAt: '2026-05-25T10:00:00Z',
    tier: SoftwareTier.THOROUGH,
    jobType: SoftwareJobType.NEW_FEATURE,
    deployUrl: 'https://app.example.com',
    deployPlatform: DeployPlatform.OTHER,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ExternalToolChecksService();
  });

  it('T3 fails when Semgrep reports a high-risk finding in changed code', () => {
    const result = service.checkStaticSecurityAnalysis(
      {
        ...baseDto,
        semgrepFindings: [
          {
            path: 'src/api.ts',
            check_id: 'typescript.express.security.audit.xss',
            extra: { severity: 'ERROR', message: 'Unsanitized response' },
          },
        ],
      },
      ['src/api.ts'],
    );

    expect(result.status).toBe('FAIL');
    expect(result.detail).toContain('high-risk');
  });

  it('T3 SKIPs (fail-safe) when no Semgrep findings are supplied', () => {
    const result = service.checkStaticSecurityAnalysis({ ...baseDto }, ['src/api.ts']);
    expect(result.status).toBe('SKIP');
    expect(result.detail).toContain('No Semgrep findings');
  });

  it('T3 passes when Semgrep findings contain no high-risk changed-file issues', () => {
    const result = service.checkStaticSecurityAnalysis(
      {
        ...baseDto,
        semgrepFindings: [
          {
            path: 'src/api.ts',
            check_id: 'typescript.best-practice',
            extra: { severity: 'INFO', message: 'Style note' },
          },
        ],
      },
      ['src/api.ts'],
    );

    expect(result.status).toBe('PASS');
  });

  it('T6 SKIPs (fail-safe) when no deployUrl is provided', async () => {
    const result = await service.checkPerformanceRegression({
      ...baseDto,
      deployUrl: undefined,
      performanceBaselineP95Ms: 100,
    });
    expect(result.status).toBe('SKIP');
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('T6 SKIPs (fail-safe) when no performance baseline is provided', async () => {
    const result = await service.checkPerformanceRegression({ ...baseDto });
    expect(result.status).toBe('SKIP');
    expect(result.detail).toContain('performanceBaselineP95Ms');
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('T6 runs 50 probes and fails when p95 exceeds the 15 percent budget', async () => {
    mockedAxios.get.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return { status: 200, data: {} };
    });
    let nowCalls = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => {
      nowCalls += 1;
      return nowCalls <= 51 ? 0 : 200;
    });

    const result = await service.checkPerformanceRegression({
      ...baseDto,
      performanceBaselineP95Ms: 100,
      performanceProbePaths: ['/health', '/api/ping'],
    });

    expect(mockedAxios.get).toHaveBeenCalledTimes(50);
    expect(result.status).toBe('FAIL');
    expect(result.evidence).toEqual(expect.objectContaining({ sampleCount: 50 }));
    vi.restoreAllMocks();
  });

  it('T6 blocks unsafe probe URLs before making requests', async () => {
    const result = await service.checkPerformanceRegression({
      ...baseDto,
      deployUrl: 'https://127.0.0.1',
      performanceBaselineP95Ms: 100,
    });

    expect(result.status).toBe('FAIL');
    expect(result.detail).toContain('SSRF guard blocked');
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('T11 SKIPs (fail-safe) when Sentry org/project/token are absent', async () => {
    const prev = {
      org: process.env.SENTRY_ORG_SLUG,
      project: process.env.SENTRY_PROJECT_SLUG,
      token: process.env.SENTRY_AUTH_TOKEN,
    };
    delete process.env.SENTRY_ORG_SLUG;
    delete process.env.SENTRY_PROJECT_SLUG;
    delete process.env.SENTRY_AUTH_TOKEN;
    try {
      const result = await service.checkErrorRateStable({ ...baseDto }, new Date(baseDto.jobStartedAt));
      expect(result.status).toBe('SKIP');
      expect(mockedAxios.get).not.toHaveBeenCalled();
    } finally {
      if (prev.org !== undefined) process.env.SENTRY_ORG_SLUG = prev.org;
      if (prev.project !== undefined) process.env.SENTRY_PROJECT_SLUG = prev.project;
      if (prev.token !== undefined) process.env.SENTRY_AUTH_TOKEN = prev.token;
    }
  });

  it('T11 compares Sentry pre/post deploy error counts', async () => {
    mockedAxios.get
      .mockResolvedValueOnce({ data: { data: [[1, [{ count: 5 }]]] } })
      .mockResolvedValueOnce({ data: { data: [[1, [{ count: 2 }]]] } });

    const result = await service.checkErrorRateStable(
      {
        ...baseDto,
        sentryOrgSlug: 'acme',
        sentryProjectSlug: 'api',
        sentryAuthToken: 'token',
      },
      new Date(baseDto.jobStartedAt),
    );

    expect(result.status).toBe('PASS');
    expect(result.evidence).toEqual(expect.objectContaining({ beforeErrors: 5, afterErrors: 2 }));
  });
});
