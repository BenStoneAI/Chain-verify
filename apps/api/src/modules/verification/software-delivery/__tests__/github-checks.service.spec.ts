import { vi, describe, it, expect, beforeEach, type Mocked } from 'vitest';
import { Test } from '@nestjs/testing';
import axios from 'axios';
import { GithubChecksService } from '../checks/github-checks.service.js';

vi.mock('axios');
const mockedAxios = axios as Mocked<typeof axios>;

// ---------------------------------------------------------------------------
// Fixtures — realistic GitHub REST API response shapes
// ---------------------------------------------------------------------------

function makeCompareResponse(files: Array<{ filename: string }>, aheadBy = 1) {
  return {
    data: {
      ahead_by: aheadBy,
      behind_by: 0,
      status: 'ahead',
      files,
      commits: [
        {
          sha: 'def456abc123',
          commit: {
            author: { name: 'Jane Dev', email: 'jane@acme.com', date: '2026-05-25T11:00:00Z' },
            message: 'fix: invoice rounding bug',
          },
        },
      ],
    },
  };
}

function makeCommitResponse(authorDate: string) {
  return {
    data: {
      sha: 'def456abc123',
      commit: {
        author: { name: 'Jane Dev', email: 'jane@acme.com', date: authorDate },
        committer: { name: 'GitHub', date: authorDate },
        message: 'fix: invoice rounding bug',
      },
    },
  };
}

function makePrResponse(overrides: Partial<{
  state: string;
  merged: boolean;
  merged_at: string | null;
}> = {}) {
  return {
    data: {
      number: 42,
      state: 'closed',
      merged: true,
      merged_at: '2026-05-25T11:30:00Z',
      title: 'Fix invoice rounding',
      html_url: 'https://github.com/acme-corp/payments-api/pull/42',
      ...overrides,
    },
  };
}

function makeWorkflowRunsResponse(
  runs: Array<{
    id: number;
    status: string;
    conclusion: string | null;
    created_at: string;
    name?: string;
    html_url?: string;
  }>,
) {
  return {
    data: {
      total_count: runs.length,
      workflow_runs: runs.map(r => ({
        id: r.id,
        status: r.status,
        conclusion: r.conclusion,
        created_at: r.created_at,
        name: r.name ?? 'CI',
        html_url: r.html_url ?? 'https://github.com/acme-corp/payments-api/actions/runs/1',
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GithubChecksService', () => {
  let service: GithubChecksService;
  const JOB_START = new Date('2026-05-25T10:00:00Z');
  const AFTER_JOB_START = '2026-05-25T11:00:00Z';
  const BEFORE_JOB_START = '2026-05-25T09:00:00Z';

  beforeEach(async () => {
    vi.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [GithubChecksService],
    }).compile();
    service = module.get(GithubChecksService);
  });

  // ── B1: Work exists in repo ───────────────────────────────────────────────

  describe('checkWorkExists (B1)', () => {
    it('PASS when diff contains ≥1 file changed', async () => {
      mockedAxios.get.mockResolvedValue(
        makeCompareResponse([{ filename: 'src/invoice.service.ts' }]),
      );
      const result = await service.checkWorkExists('acme', 'api', 'abc', 'def');
      expect(result.checkId).toBe('B1');
      expect(result.status).toBe('PASS');
      expect(result.detail).toContain('1 files changed');
    });

    it('FAIL when diff is empty (no files changed)', async () => {
      mockedAxios.get.mockResolvedValue(makeCompareResponse([], 0));
      const result = await service.checkWorkExists('acme', 'api', 'abc', 'def');
      expect(result.checkId).toBe('B1');
      expect(result.status).toBe('FAIL');
      expect(result.detail).toContain('No files changed');
    });

    it('PASS when multiple files changed', async () => {
      mockedAxios.get.mockResolvedValue(
        makeCompareResponse([
          { filename: 'src/invoice.service.ts' },
          { filename: 'src/invoice.service.spec.ts' },
          { filename: 'src/billing.module.ts' },
        ]),
      );
      const result = await service.checkWorkExists('acme', 'api', 'abc', 'def');
      expect(result.status).toBe('PASS');
      expect(result.detail).toContain('3 files changed');
    });

    it('FAIL on GitHub API 401 Unauthorized', async () => {
      const err = Object.assign(new Error('Request failed with status code 401'), { response: { status: 401 } });
      mockedAxios.get.mockRejectedValue(err);
      const result = await service.checkWorkExists('acme', 'api', 'abc', 'def');
      expect(result.checkId).toBe('B1');
      expect(result.status).toBe('FAIL');
      // Customer-readable, not a raw axios string.
      expect(result.detail).not.toContain('status code');
      expect(result.detail).toMatch(/access|token|permission/i);
    });

    it('FAIL on GitHub API 404 Not Found', async () => {
      const err = Object.assign(new Error('Request failed with status code 404'), { response: { status: 404 } });
      mockedAxios.get.mockRejectedValue(err);
      const result = await service.checkWorkExists('acme', 'api', 'abc', 'def');
      expect(result.status).toBe('FAIL');
      expect(result.detail).not.toContain('status code');
      expect(result.detail).toMatch(/not found/i);
    });

    it('FAIL on GitHub API 500 Server Error', async () => {
      const err = Object.assign(new Error('Internal Server Error'), { response: { status: 500 } });
      mockedAxios.get.mockRejectedValue(err);
      const result = await service.checkWorkExists('acme', 'api', 'abc', 'def');
      expect(result.status).toBe('FAIL');
    });

    it('FAIL on network timeout', async () => {
      mockedAxios.get.mockRejectedValue(new Error('ECONNABORTED: timeout'));
      const result = await service.checkWorkExists('acme', 'api', 'abc', 'def');
      expect(result.status).toBe('FAIL');
      expect(result.detail).not.toContain('ECONNABORTED');
      expect(result.detail).toMatch(/respond in time|retry/i);
    });

    it('evidence includes filesChanged and aheadBy counts', async () => {
      mockedAxios.get.mockResolvedValue(
        makeCompareResponse([{ filename: 'src/foo.ts' }], 2),
      );
      const result = await service.checkWorkExists('acme', 'api', 'abc', 'def');
      expect(result.evidence).toBeDefined();
      expect((result.evidence as Record<string, unknown>).filesChanged).toBe(1);
      expect((result.evidence as Record<string, unknown>).aheadBy).toBe(2);
    });

    it('returns durationMs as a non-negative number', async () => {
      mockedAxios.get.mockResolvedValue(makeCompareResponse([{ filename: 'src/foo.ts' }]));
      const result = await service.checkWorkExists('acme', 'api', 'abc', 'def');
      expect(typeof result.durationMs).toBe('number');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ── B2: Commit made after job started ──────────────────────────────────────

  describe('checkCommitTiming (B2)', () => {
    it('PASS when commit date is after jobStartedAt', async () => {
      mockedAxios.get.mockResolvedValue(makeCommitResponse(AFTER_JOB_START));
      const result = await service.checkCommitTiming('acme', 'api', 'def456', JOB_START);
      expect(result.checkId).toBe('B2');
      expect(result.status).toBe('PASS');
    });

    it('FAIL when commit date is before jobStartedAt', async () => {
      mockedAxios.get.mockResolvedValue(makeCommitResponse(BEFORE_JOB_START));
      const result = await service.checkCommitTiming('acme', 'api', 'def456', JOB_START);
      expect(result.checkId).toBe('B2');
      expect(result.status).toBe('FAIL');
      expect(result.detail).toContain('BEFORE the job started');
    });

    it('FAIL when commit date exactly equals jobStartedAt (not strictly after)', async () => {
      mockedAxios.get.mockResolvedValue(makeCommitResponse('2026-05-25T10:00:00Z'));
      const result = await service.checkCommitTiming('acme', 'api', 'def456', JOB_START);
      // commitDate === jobStartedAt: NOT strictly greater → FAIL
      expect(result.status).toBe('FAIL');
    });

    it('FAIL on GitHub API 401', async () => {
      mockedAxios.get.mockRejectedValue(new Error('Request failed with status code 401'));
      const result = await service.checkCommitTiming('acme', 'api', 'def456', JOB_START);
      expect(result.status).toBe('FAIL');
      expect(result.detail).not.toContain('status code');
      expect(result.detail).toMatch(/access|token|permission/i);
    });

    it('FAIL on network error', async () => {
      mockedAxios.get.mockRejectedValue(new Error('ENOTFOUND api.github.com'));
      const result = await service.checkCommitTiming('acme', 'api', 'def456', JOB_START);
      expect(result.status).toBe('FAIL');
    });

    it('evidence contains commitDate and jobStartedAt', async () => {
      mockedAxios.get.mockResolvedValue(makeCommitResponse(AFTER_JOB_START));
      const result = await service.checkCommitTiming('acme', 'api', 'def456', JOB_START);
      expect(result.evidence).toBeDefined();
      expect((result.evidence as Record<string, unknown>).commitDate).toBe(AFTER_JOB_START);
      expect((result.evidence as Record<string, unknown>).jobStartedAt).toBe(JOB_START.toISOString());
    });

    it('FAIL detail message contains both commit and job timestamps', async () => {
      mockedAxios.get.mockResolvedValue(makeCommitResponse(BEFORE_JOB_START));
      const result = await service.checkCommitTiming('acme', 'api', 'def456', JOB_START);
      // Detail contains ISO timestamp strings for both the commit and job start
      expect(result.detail).toContain('2026-05-25T09:00:00');
      expect(result.detail).toContain('2026-05-25T10:00:00');
    });
  });

  // ── B3: Right files were touched ──────────────────────────────────────────

  describe('checkFilesInScope (B3)', () => {
    it('PASS when source code files changed', async () => {
      mockedAxios.get.mockResolvedValue(
        makeCompareResponse([
          { filename: 'src/invoice.service.ts' },
          { filename: 'src/invoice.controller.ts' },
        ]),
      );
      const result = await service.checkFilesInScope('acme', 'api', 'abc', 'def', undefined);
      expect(result.checkId).toBe('B3');
      expect(result.status).toBe('PASS');
    });

    it('WARNING when only README changed', async () => {
      mockedAxios.get.mockResolvedValue(makeCompareResponse([{ filename: 'README.md' }]));
      const result = await service.checkFilesInScope('acme', 'api', 'abc', 'def', undefined);
      expect(result.checkId).toBe('B3');
      expect(result.status).toBe('WARNING');
      expect(result.detail).toContain('README.md');
    });

    it('WARNING when only .txt and package.json changed', async () => {
      mockedAxios.get.mockResolvedValue(
        makeCompareResponse([{ filename: 'CHANGELOG.txt' }, { filename: 'package.json' }]),
      );
      const result = await service.checkFilesInScope('acme', 'api', 'abc', 'def', undefined);
      expect(result.checkId).toBe('B3');
      expect(result.status).toBe('WARNING');
    });

    it('PASS when mix of source and config files changed (not only config)', async () => {
      mockedAxios.get.mockResolvedValue(
        makeCompareResponse([
          { filename: 'src/invoice.service.ts' },
          { filename: 'README.md' },
        ]),
      );
      const result = await service.checkFilesInScope('acme', 'api', 'abc', 'def', undefined);
      expect(result.status).toBe('PASS');
    });

    it('FAIL when empty diff (zero files changed)', async () => {
      mockedAxios.get.mockResolvedValue(makeCompareResponse([], 0));
      const result = await service.checkFilesInScope('acme', 'api', 'abc', 'def', undefined);
      expect(result.status).toBe('FAIL');
    });

    it('FAIL on GitHub API error', async () => {
      mockedAxios.get.mockRejectedValue(new Error('Network error'));
      const result = await service.checkFilesInScope('acme', 'api', 'abc', 'def', undefined);
      expect(result.status).toBe('FAIL');
    });

    it('evidence includes changedFiles array', async () => {
      mockedAxios.get.mockResolvedValue(
        makeCompareResponse([{ filename: 'src/foo.ts' }]),
      );
      const result = await service.checkFilesInScope('acme', 'api', 'abc', 'def', undefined);
      expect(result.evidence).toBeDefined();
      expect((result.evidence as Record<string, unknown>).changedFiles).toContain('src/foo.ts');
    });
  });

  // ── B4: AI report matches actual diff ─────────────────────────────────────
  // B4 is implemented in DiffAnalysisService; github-checks only provides
  // the diff data. These tests cover B4 through checkWorkExists evidence.

  // ── B7: PR is merged ──────────────────────────────────────────────────────

  describe('checkPrMerged (B7)', () => {
    it('SKIP when no prNumber provided', async () => {
      const result = await service.checkPrMerged('acme', 'api', undefined, JOB_START);
      expect(result.checkId).toBe('B7');
      expect(result.status).toBe('SKIP');
      expect(result.detail).toContain('No PR number');
    });

    it('PASS when PR is merged after jobStartedAt', async () => {
      mockedAxios.get.mockResolvedValue(makePrResponse({
        state: 'closed',
        merged: true,
        merged_at: '2026-05-25T11:30:00Z', // after JOB_START 10:00
      }));
      const result = await service.checkPrMerged('acme', 'api', 42, JOB_START);
      expect(result.checkId).toBe('B7');
      expect(result.status).toBe('PASS');
    });

    it('FAIL when PR is open (state = open, merged = false)', async () => {
      mockedAxios.get.mockResolvedValue(makePrResponse({ state: 'open', merged: false, merged_at: null }));
      const result = await service.checkPrMerged('acme', 'api', 42, JOB_START);
      expect(result.checkId).toBe('B7');
      expect(result.status).toBe('FAIL');
      expect(result.detail).toContain('NOT merged');
    });

    it('FAIL when PR is closed but NOT merged', async () => {
      mockedAxios.get.mockResolvedValue(makePrResponse({ state: 'closed', merged: false, merged_at: null }));
      const result = await service.checkPrMerged('acme', 'api', 42, JOB_START);
      expect(result.status).toBe('FAIL');
      expect(result.detail).toContain('NOT merged');
    });

    it('FAIL when PR was merged BEFORE job started (adversarial: pre-existing work)', async () => {
      mockedAxios.get.mockResolvedValue(makePrResponse({
        state: 'closed',
        merged: true,
        merged_at: '2026-05-25T09:00:00Z', // before JOB_START 10:00
      }));
      const result = await service.checkPrMerged('acme', 'api', 42, JOB_START);
      expect(result.status).toBe('FAIL');
      expect(result.detail).toContain('BEFORE the job started');
    });

    it('FAIL on GitHub API 401', async () => {
      mockedAxios.get.mockRejectedValue(new Error('Request failed with status code 401'));
      const result = await service.checkPrMerged('acme', 'api', 42, JOB_START);
      expect(result.status).toBe('FAIL');
    });

    it('FAIL on GitHub API 404 (PR not found)', async () => {
      mockedAxios.get.mockRejectedValue(new Error('Request failed with status code 404'));
      const result = await service.checkPrMerged('acme', 'api', 42, JOB_START);
      expect(result.status).toBe('FAIL');
    });

    it('evidence includes merged and state on PASS', async () => {
      mockedAxios.get.mockResolvedValue(makePrResponse({ state: 'closed', merged: true, merged_at: '2026-05-25T11:30:00Z' }));
      const result = await service.checkPrMerged('acme', 'api', 42, JOB_START);
      expect(result.evidence).toBeDefined();
      expect((result.evidence as Record<string, unknown>).merged).toBe(true);
      expect((result.evidence as Record<string, unknown>).state).toBe('closed');
    });
  });

  // ── S9: CI/CD pipeline passed ─────────────────────────────────────────────

  describe('checkCiPassed (S9)', () => {
    it('PASS when latest CI run completed with success after job start', async () => {
      mockedAxios.get.mockResolvedValue(makeWorkflowRunsResponse([
        { id: 1001, status: 'completed', conclusion: 'success', created_at: AFTER_JOB_START },
      ]));
      const result = await service.checkCiPassed('acme', 'api', 'def456', JOB_START);
      expect(result.checkId).toBe('S9');
      expect(result.status).toBe('PASS');
    });

    it('FAIL when CI run failed', async () => {
      mockedAxios.get.mockResolvedValue(makeWorkflowRunsResponse([
        { id: 1001, status: 'completed', conclusion: 'failure', created_at: AFTER_JOB_START },
      ]));
      const result = await service.checkCiPassed('acme', 'api', 'def456', JOB_START);
      expect(result.checkId).toBe('S9');
      expect(result.status).toBe('FAIL');
      expect(result.detail).toContain('failure');
    });

    it('FAIL when CI run was cancelled', async () => {
      mockedAxios.get.mockResolvedValue(makeWorkflowRunsResponse([
        { id: 1001, status: 'completed', conclusion: 'cancelled', created_at: AFTER_JOB_START },
      ]));
      const result = await service.checkCiPassed('acme', 'api', 'def456', JOB_START);
      expect(result.status).toBe('FAIL');
    });

    it('WARNING when no CI run found after job start (CI may not be configured)', async () => {
      // All runs are before job start
      mockedAxios.get.mockResolvedValue(makeWorkflowRunsResponse([
        { id: 900, status: 'completed', conclusion: 'success', created_at: BEFORE_JOB_START },
      ]));
      const result = await service.checkCiPassed('acme', 'api', 'def456', JOB_START);
      expect(result.checkId).toBe('S9');
      expect(result.status).toBe('WARNING');
      expect(result.detail).toContain('No CI workflow run found');
    });

    it('WARNING when no CI runs exist at all', async () => {
      mockedAxios.get.mockResolvedValue(makeWorkflowRunsResponse([]));
      const result = await service.checkCiPassed('acme', 'api', 'def456', JOB_START);
      expect(result.status).toBe('WARNING');
    });

    it('WARNING when CI run is still in_progress', async () => {
      mockedAxios.get.mockResolvedValue(makeWorkflowRunsResponse([
        { id: 1001, status: 'in_progress', conclusion: null, created_at: AFTER_JOB_START },
      ]));
      const result = await service.checkCiPassed('acme', 'api', 'def456', JOB_START);
      expect(result.status).toBe('WARNING');
    });

    it('FAIL on GitHub API 401 unauthorized', async () => {
      mockedAxios.get.mockRejectedValue(new Error('Request failed with status code 401'));
      const result = await service.checkCiPassed('acme', 'api', 'def456', JOB_START);
      expect(result.status).toBe('FAIL');
      expect(result.detail).not.toContain('status code');
      expect(result.detail).toMatch(/access|token|permission/i);
    });

    it('FAIL on network timeout', async () => {
      mockedAxios.get.mockRejectedValue(new Error('ECONNABORTED: timeout of 10000ms exceeded'));
      const result = await service.checkCiPassed('acme', 'api', 'def456', JOB_START);
      expect(result.status).toBe('FAIL');
    });

    it('only considers runs created after jobStartedAt', async () => {
      // Older failed run + newer passing run — should PASS
      mockedAxios.get.mockResolvedValue(makeWorkflowRunsResponse([
        { id: 1002, status: 'completed', conclusion: 'success', created_at: AFTER_JOB_START },
        { id: 999, status: 'completed', conclusion: 'failure', created_at: BEFORE_JOB_START },
      ]));
      const result = await service.checkCiPassed('acme', 'api', 'def456', JOB_START);
      expect(result.status).toBe('PASS');
    });

    it('evidence includes runId and conclusion on PASS', async () => {
      mockedAxios.get.mockResolvedValue(makeWorkflowRunsResponse([
        { id: 1001, status: 'completed', conclusion: 'success', created_at: AFTER_JOB_START },
      ]));
      const result = await service.checkCiPassed('acme', 'api', 'def456', JOB_START);
      expect(result.evidence).toBeDefined();
      expect((result.evidence as Record<string, unknown>).runId).toBe(1001);
      expect((result.evidence as Record<string, unknown>).conclusion).toBe('success');
    });
  });

  // ── getDiffFiles helper ───────────────────────────────────────────────────

  describe('getDiffFiles helper', () => {
    it('returns array of filenames from compare API', async () => {
      mockedAxios.get.mockResolvedValue(
        makeCompareResponse([{ filename: 'src/foo.ts' }, { filename: 'src/bar.ts' }]),
      );
      const files = await service.getDiffFiles('acme', 'api', 'abc', 'def');
      expect(files).toEqual(['src/foo.ts', 'src/bar.ts']);
    });

    it('returns empty array on API error (does not throw)', async () => {
      mockedAxios.get.mockRejectedValue(new Error('Network error'));
      const files = await service.getDiffFiles('acme', 'api', 'abc', 'def');
      expect(files).toEqual([]);
    });

    it('returns empty array when diff has no files property', async () => {
      mockedAxios.get.mockResolvedValue({ data: { ahead_by: 0 } });
      const files = await service.getDiffFiles('acme', 'api', 'abc', 'def');
      expect(files).toEqual([]);
    });
  });

  // ── getDiffText helper ────────────────────────────────────────────────────

  describe('getDiffText helper', () => {
    it('returns diff text string from GitHub diff endpoint', async () => {
      const fakeDiff = '--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1 +1 @@\n-old\n+new';
      mockedAxios.get.mockResolvedValue({ data: fakeDiff });
      const text = await service.getDiffText('acme', 'api', 'abc', 'def');
      expect(text).toBe(fakeDiff);
    });

    it('returns empty string on API error (does not throw)', async () => {
      mockedAxios.get.mockRejectedValue(new Error('Network error'));
      const text = await service.getDiffText('acme', 'api', 'abc', 'def');
      expect(text).toBe('');
    });

    it('returns empty string when response data is not a string', async () => {
      mockedAxios.get.mockResolvedValue({ data: { some: 'object' } });
      const text = await service.getDiffText('acme', 'api', 'abc', 'def');
      expect(text).toBe('');
    });
  });

  // ── Customer-facing error normalization ───────────────────────────────────
  describe('customer-facing error normalization', () => {
    it('403 rate-limit/denied → readable, no raw axios string', async () => {
      const err = Object.assign(new Error('Request failed with status code 403'), { response: { status: 403 } });
      mockedAxios.get.mockRejectedValue(err);
      const result = await service.checkWorkExists('acme', 'api', 'abc', 'def');
      expect(result.status).toBe('FAIL');
      expect(result.detail).not.toContain('status code');
      expect(result.detail).toMatch(/denied|rate.?limit/i);
    });

    it('PR 404 → "not found" guidance for B7', async () => {
      const err = Object.assign(new Error('Request failed with status code 404'), { response: { status: 404 } });
      mockedAxios.get.mockRejectedValue(err);
      const result = await service.checkPrMerged('acme', 'api', 42, new Date('2026-05-25T10:00:00Z'));
      expect(result.status).toBe('FAIL');
      expect(result.detail).not.toContain('status code');
      expect(result.detail).toMatch(/not found/i);
    });

    it('unknown error → generic readable message, never raw', async () => {
      mockedAxios.get.mockRejectedValue(new Error('socket hang up'));
      const result = await service.checkWorkExists('acme', 'api', 'abc', 'def');
      expect(result.status).toBe('FAIL');
      expect(result.detail).not.toContain('socket hang up');
      expect(result.detail).toMatch(/retry|could not be reached/i);
    });
  });
});
