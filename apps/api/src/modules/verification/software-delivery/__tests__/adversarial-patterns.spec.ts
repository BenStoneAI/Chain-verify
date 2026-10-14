/**
 * Adversarial-patterns test suite — 20 fake delivery patterns.
 *
 * Each test verifies that a specific fraud/evasion pattern is correctly caught
 * (FAIL) or escalated (WARNING) by the individual check services.
 */

import { vi, describe, it, expect, beforeEach, type Mocked } from 'vitest';
import { Test } from '@nestjs/testing';
import axios from 'axios';
import { GithubChecksService } from '../checks/github-checks.service.js';
import { LiveChecksService } from '../checks/live-checks.service.js';
import { DiffAnalysisService } from '../checks/diff-analysis.service.js';
import { SecurityChecksService } from '../checks/security-checks.service.js';

vi.mock('axios');
const mockedAxios = axios as Mocked<typeof axios>;

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
}));

beforeEach(() => {
  // Reset implementations — not just call counts — to prevent mock leak between tests.
  vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// Service factories
// ---------------------------------------------------------------------------

async function makeGithub(): Promise<GithubChecksService> {
  const m = await Test.createTestingModule({ providers: [GithubChecksService] }).compile();
  return m.get(GithubChecksService);
}

async function makeLive(): Promise<LiveChecksService> {
  const m = await Test.createTestingModule({ providers: [LiveChecksService] }).compile();
  return m.get(LiveChecksService);
}

async function makeDiff(): Promise<DiffAnalysisService> {
  const m = await Test.createTestingModule({ providers: [DiffAnalysisService] }).compile();
  return m.get(DiffAnalysisService);
}

async function makeSecurity(): Promise<SecurityChecksService> {
  const m = await Test.createTestingModule({ providers: [SecurityChecksService] }).compile();
  return m.get(SecurityChecksService);
}

// ---------------------------------------------------------------------------
// FAKE-1: identical beforeSha/afterSha → no real work
// ---------------------------------------------------------------------------

describe('FAKE-1: identical SHAs produce empty diff → B1 FAIL', () => {
  it('returns FAIL when GitHub reports 0 changed files', async () => {
    mockedAxios.get.mockResolvedValue({ data: { files: [] } });

    const svc = await makeGithub();
    const result = await svc.checkWorkExists('owner', 'repo', 'abc', 'abc');
    expect(result.status).toBe('FAIL');
  });
});

// ---------------------------------------------------------------------------
// FAKE-2: AI report references files not in diff
// ---------------------------------------------------------------------------

describe('FAKE-2: AI report references files absent from diff → B4 FAIL', () => {
  it('returns FAIL when AI report mentions files that are not in the diff', async () => {
    const svc = await makeDiff();
    const aiReport = 'I updated auth.service.ts and login.component.ts.';
    const diffFiles = [
      'src/invoice.service.ts',
      'src/billing.controller.ts',
      'src/email.service.ts',
    ];
    const result = svc.checkAiReportMatchesDiff(aiReport, diffFiles);
    expect(result.status).toBe('FAIL');
  });
});

// ---------------------------------------------------------------------------
// FAKE-3: commit pre-dates job start
// ---------------------------------------------------------------------------

describe('FAKE-3: commit predates job start → B2 FAIL', () => {
  it('returns FAIL when latest commit was made before the job started', async () => {
    const jobStart = new Date('2026-05-25T10:00:00Z');
    mockedAxios.get.mockResolvedValue({
      data: { commit: { committer: { date: '2026-05-24T08:00:00Z' } } },
    });

    const svc = await makeGithub();
    const result = await svc.checkCommitTiming('owner', 'repo', 'sha123', jobStart);
    expect(result.status).toBe('FAIL');
  });
});

// ---------------------------------------------------------------------------
// FAKE-4: deploy URL unreachable
// ---------------------------------------------------------------------------

describe('FAKE-4: deploy URL unreachable → B6 FAIL', () => {
  it('returns FAIL when axios throws a connection error', async () => {
    mockedAxios.get.mockRejectedValue(new Error('connect ECONNREFUSED'));

    const svc = await makeLive();
    const result = await svc.checkLiveSite('https://broken.example.com');
    expect(result.status).toBe('FAIL');
  });
});

// ---------------------------------------------------------------------------
// FAKE-5: hardcoded sk_live_ key in diff
// ---------------------------------------------------------------------------

describe('FAKE-5: hardcoded Stripe live key → S3 FAIL', () => {
  it('returns FAIL when diff contains sk_live_ key', async () => {
    const svc = await makeSecurity();
    const diff = '+const stripe = require("stripe")("sk_live_ABCDEFGHIJKLMNOPQRSTUVWX");\n';
    const result = await svc.checkNoHardcodedSecrets(diff);
    expect(result.checkId).toBe('S3');
    expect(result.status).toBe('FAIL');
    expect(result.detail).toContain('Stripe live key');
  });
});

// ---------------------------------------------------------------------------
// FAKE-6: package.json changed, no lock file → S11 WARNING
// ---------------------------------------------------------------------------

describe('FAKE-6: package.json changed without lock file → S11 WARNING', () => {
  it('returns WARNING when package.json is changed but lock file is not', async () => {
    const svc = await makeDiff();
    const diffFiles = ['src/app.ts', 'package.json'];
    const result = svc.checkLockFileConsistency(diffFiles);
    expect(result.checkId).toBe('S11');
    expect(result.status).toBe('WARNING');
  });
});

// ---------------------------------------------------------------------------
// FAKE-7: PR still open → B7 FAIL
// ---------------------------------------------------------------------------

describe('FAKE-7: PR still open → B7 FAIL', () => {
  it('returns FAIL when PR state is open', async () => {
    const jobStart = new Date('2026-05-25T10:00:00Z');
    mockedAxios.get.mockResolvedValue({
      data: { state: 'open', merged_at: null, merged: false },
    });

    const svc = await makeGithub();
    const result = await svc.checkPrMerged('owner', 'repo', 42, jobStart);
    expect(result.status).toBe('FAIL');
  });
});

// ---------------------------------------------------------------------------
// FAKE-9: .env file modified → S7 WARNING
// ---------------------------------------------------------------------------

describe('FAKE-9: .env file in diff → S7 WARNING', () => {
  it('returns WARNING when .env file appears in diff', async () => {
    const svc = await makeDiff();
    const diffFiles = ['src/app.ts', '.env'];
    const result = svc.checkScopeAdherence(diffFiles);
    expect(result.checkId).toBe('S7');
    expect(result.status).toBe('WARNING');
  });
});

// ---------------------------------------------------------------------------
// FAKE-10: CI pipeline failed → S9 FAIL
// ---------------------------------------------------------------------------

describe('FAKE-10: CI pipeline failed → S9 FAIL', () => {
  it('returns FAIL when latest workflow run conclusion is failure', async () => {
    const jobStart = new Date('2026-05-25T10:00:00Z');
    mockedAxios.get.mockResolvedValue({
      data: {
        workflow_runs: [
          {
            head_sha: 'sha123',
            status: 'completed',
            conclusion: 'failure',
            created_at: '2026-05-25T10:05:00Z',
            name: 'CI',
            id: 1,
            html_url: 'https://github.com',
          },
        ],
      },
    });

    const svc = await makeGithub();
    const result = await svc.checkCiPassed('owner', 'repo', 'sha123', jobStart);
    expect(result.status).toBe('FAIL');
  });
});

// ---------------------------------------------------------------------------
// FAKE-11: PR merged before job start → B7 FAIL
// ---------------------------------------------------------------------------

describe('FAKE-11: PR merged before job was created → B7 FAIL', () => {
  it('returns FAIL when merged_at predates job start', async () => {
    const jobStart = new Date('2026-05-25T10:00:00Z');
    mockedAxios.get.mockResolvedValue({
      data: {
        state: 'closed',
        merged: true,
        merged_at: '2026-05-24T08:00:00Z', // day before job started
      },
    });

    const svc = await makeGithub();
    const result = await svc.checkPrMerged('owner', 'repo', 99, jobStart);
    expect(result.status).toBe('FAIL');
  });
});

// ---------------------------------------------------------------------------
// FAKE-12: empty diff (no files changed)
// ---------------------------------------------------------------------------

describe('FAKE-12: empty diff → B1 FAIL', () => {
  it('returns FAIL when diff has no files', async () => {
    mockedAxios.get.mockResolvedValue({ data: { files: [] } });

    const svc = await makeGithub();
    const result = await svc.checkWorkExists('owner', 'repo', 'abc', 'def');
    expect(result.status).toBe('FAIL');
  });
});

// ---------------------------------------------------------------------------
// FAKE-13: AWS credentials committed
// ---------------------------------------------------------------------------

describe('FAKE-13: AWS access key in diff → S3 FAIL', () => {
  it('returns FAIL when AKIA key pattern found in added lines', async () => {
    const svc = await makeSecurity();
    const diff = '+const awsKey = "AKIAIOSFODNN7EXAMPLE";\n';
    const result = await svc.checkNoHardcodedSecrets(diff);
    expect(result.checkId).toBe('S3');
    expect(result.status).toBe('FAIL');
  });
});

// ---------------------------------------------------------------------------
// FAKE-14: deploy URL returns 500
// ---------------------------------------------------------------------------

describe('FAKE-14: deploy URL returns HTTP 500 → B6 FAIL', () => {
  it('returns FAIL when site returns 500', async () => {
    mockedAxios.get.mockResolvedValue({
      status: 500,
      data: 'Internal Server Error',
      headers: {},
      config: {},
      statusText: 'Internal Server Error',
    });

    const svc = await makeLive();
    const result = await svc.checkLiveSite('https://example.com');
    expect(result.status).toBe('FAIL');
  });
});

// ---------------------------------------------------------------------------
// FAKE-15: /health returns degraded → DEP4 FAIL
// ---------------------------------------------------------------------------

describe('FAKE-15: /health endpoint reports degraded → DEP4 FAIL', () => {
  it('returns FAIL when health body reports degraded status', async () => {
    mockedAxios.get.mockResolvedValue({
      status: 200,
      data: { status: 'degraded', db: 'down' },
      headers: {},
      config: {},
      statusText: 'OK',
    });

    const svc = await makeLive();
    const result = await svc.checkHealthEndpoint('https://api.example.com');
    expect(result.checkId).toBe('DEP4');
    expect(result.status).toBe('FAIL');
  });
});

// ---------------------------------------------------------------------------
// FAKE-17: AI report with specific wrong file references (0% match)
// ---------------------------------------------------------------------------

describe('FAKE-17: AI report mentions wrong files (0% match) → B4 FAIL', () => {
  it('returns FAIL when AI report mentions only files that are not in the diff', async () => {
    const svc = await makeDiff();
    // Report mentions specific files that don't match the diff at all
    const aiReport = 'Updated auth.controller.ts and user.service.ts with new login flow.';
    const diffFiles = ['src/invoice.service.ts', 'src/payment.controller.ts'];
    const result = svc.checkAiReportMatchesDiff(aiReport, diffFiles);
    // 0 of 2 mentioned files match → 0% < 40% threshold → FAIL
    expect(result.status).toBe('FAIL');
  });
});

// ---------------------------------------------------------------------------
// FAKE-18: reused 3-year-old commit hash
// ---------------------------------------------------------------------------

describe('FAKE-18: commit date is 3 years before job start → B2 FAIL', () => {
  it('returns FAIL when commit date is years before job start', async () => {
    const jobStart = new Date('2026-05-25T10:00:00Z');
    mockedAxios.get.mockResolvedValue({
      data: { commit: { committer: { date: '2023-01-01T00:00:00Z' } } },
    });

    const svc = await makeGithub();
    const result = await svc.checkCommitTiming('owner', 'repo', 'oldsha', jobStart);
    expect(result.status).toBe('FAIL');
  });
});

// ---------------------------------------------------------------------------
// FAKE-19: PR closed but not merged
// ---------------------------------------------------------------------------

describe('FAKE-19: PR closed without merge → B7 FAIL', () => {
  it('returns FAIL when PR is closed but merged is false', async () => {
    const jobStart = new Date('2026-05-25T10:00:00Z');
    mockedAxios.get.mockResolvedValue({
      data: { state: 'closed', merged: false, merged_at: null },
    });

    const svc = await makeGithub();
    const result = await svc.checkPrMerged('owner', 'repo', 77, jobStart);
    expect(result.status).toBe('FAIL');
  });
});

// ---------------------------------------------------------------------------
// FAKE-20: CI status is "skipped"
// ---------------------------------------------------------------------------

describe('FAKE-20: CI conclusion is skipped → S9 FAIL', () => {
  it('returns FAIL when workflow conclusion is skipped (not success)', async () => {
    const jobStart = new Date('2026-05-25T10:00:00Z');
    mockedAxios.get.mockResolvedValue({
      data: {
        workflow_runs: [
          {
            head_sha: 'sha123',
            status: 'completed',
            conclusion: 'skipped',
            created_at: '2026-05-25T10:05:00Z',
            name: 'CI',
            id: 2,
            html_url: 'https://github.com',
          },
        ],
      },
    });

    const svc = await makeGithub();
    const result = await svc.checkCiPassed('owner', 'repo', 'sha123', jobStart);
    expect(result.status).toBe('FAIL');
  });
});
