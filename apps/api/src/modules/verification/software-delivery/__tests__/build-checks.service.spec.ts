import { vi, describe, it, expect, beforeEach, type Mocked } from 'vitest';
import { Test } from '@nestjs/testing';
import axios from 'axios';
import { BuildChecksService } from '../checks/build-checks.service.js';
import { BuildSandboxService } from '../checks/build-sandbox.service.js';

vi.mock('axios');
const mockedAxios = axios as Mocked<typeof axios>;

// Route the two GitHub calls (check-runs + commit status) by URL so tests can
// supply each independently regardless of Promise.all ordering.
function mockGithub(opts: {
  checkRuns?: Array<{ name: string; status?: string; conclusion?: string | null }>;
  statuses?: Array<{ context: string; state: string }>;
  checkRunsError?: boolean;
}) {
  mockedAxios.get.mockImplementation((url: string) => {
    if (url.includes('/check-runs')) {
      if (opts.checkRunsError) return Promise.reject(new Error('GitHub 500'));
      return Promise.resolve({ data: { check_runs: opts.checkRuns ?? [] } });
    }
    if (url.includes('/status')) {
      return Promise.resolve({ data: { statuses: opts.statuses ?? [] } });
    }
    return Promise.resolve({ data: {} });
  });
}

const ALL = ['B5', 'S2', 'S4', 'S5'];

describe('BuildChecksService', () => {
  let service: BuildChecksService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        BuildChecksService,
        {
          provide: BuildSandboxService,
          useValue: { isEnabled: () => false, runCheck: vi.fn() },
        },
      ],
    }).compile();
    service = moduleRef.get(BuildChecksService);
    vi.clearAllMocks();
  });

  it('returns nothing when none of B5/S2/S4/S5 are requested', async () => {
    mockGithub({ checkRuns: [{ name: 'build', conclusion: 'success' }] });
    const results = await service.runBuildChecks('acme', 'app', 'sha', ['B1', 'B2']);
    expect(results).toEqual([]);
  });

  it('B5 PASS when a successful build check-run exists', async () => {
    mockGithub({ checkRuns: [{ name: 'build (ubuntu)', status: 'completed', conclusion: 'success' }] });
    const results = await service.runBuildChecks('acme', 'app', 'sha', ['B5']);
    const b5 = results.find((r) => r.checkId === 'B5');
    expect(b5?.status).toBe('PASS');
  });

  it('S2 FAIL when the test check-run failed', async () => {
    mockGithub({ checkRuns: [{ name: 'unit tests', status: 'completed', conclusion: 'failure' }] });
    const results = await service.runBuildChecks('acme', 'app', 'sha', ALL);
    const s2 = results.find((r) => r.checkId === 'S2');
    expect(s2?.status).toBe('FAIL');
    expect(s2?.detail).toMatch(/failure/i);
  });

  it('S4 PASS from the legacy commit-status API (typecheck context)', async () => {
    mockGithub({ statuses: [{ context: 'ci/typecheck', state: 'success' }] });
    const results = await service.runBuildChecks('acme', 'app', 'sha', ['S4']);
    const s4 = results.find((r) => r.checkId === 'S4');
    expect(s4?.status).toBe('PASS');
  });

  it('S5 SKIP (documented) when no matching lint signal is published', async () => {
    mockGithub({ checkRuns: [{ name: 'build', conclusion: 'success' }] });
    const results = await service.runBuildChecks('acme', 'app', 'sha', ['S5']);
    const s5 = results.find((r) => r.checkId === 'S5');
    expect(s5?.status).toBe('SKIP');
    expect(s5?.detail).toMatch(/no matching ci check|BUILD_SANDBOX_ENABLED/i);
  });

  it('all four SKIP when GitHub CI lookup fails (no false pass)', async () => {
    mockGithub({ checkRunsError: true });
    const results = await service.runBuildChecks('acme', 'app', 'sha', ALL);
    expect(results).toHaveLength(4);
    for (const r of results) {
      expect(r.status).toBe('SKIP');
      expect(r.detail).toMatch(/no ci signal|covered by s9|phase 2/i);
    }
  });

  it('B5 SKIP (no false PASS) when the only matching build check was skipped/neutral', async () => {
    mockGithub({ checkRuns: [{ name: 'build', status: 'completed', conclusion: 'skipped' }] });
    const results = await service.runBuildChecks('acme', 'app', 'sha', ['B5']);
    const b5 = results.find((r) => r.checkId === 'B5');
    expect(b5?.status).toBe('SKIP');
    expect(b5?.detail).toMatch(/neutral or skipped|no usable pass/i);
  });

  it('S2 WARNING when the only matching test run is still in progress', async () => {
    mockGithub({ checkRuns: [{ name: 'jest', status: 'in_progress', conclusion: null }] });
    const results = await service.runBuildChecks('acme', 'app', 'sha', ['S2']);
    const s2 = results.find((r) => r.checkId === 'S2');
    expect(s2?.status).toBe('WARNING');
  });
});
