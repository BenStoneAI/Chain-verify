import { vi, describe, it, expect, beforeEach, type Mocked } from 'vitest';
import { Test } from '@nestjs/testing';
import axios from 'axios';
import { DeploymentChecksService } from '../checks/deployment-checks.service.js';

vi.mock('axios');
const mockedAxios = axios as Mocked<typeof axios>;

// DNS lookups must be mocked so the SSRF guard in checkProductionRunningNewCode passes
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
}));

// ---------------------------------------------------------------------------
// Fixtures — realistic Netlify & Render API response shapes
// ---------------------------------------------------------------------------

function makeNetlifyDeploysResponse(
  deploys: Array<{
    id?: string;
    state?: string;
    commit_ref?: string;
    created_at?: string;
    skipped?: boolean;
    deploy_ssl_url?: string;
  }>,
) {
  return {
    data: deploys.map(d => ({
      id: d.id ?? 'netlify-deploy-123',
      state: d.state ?? 'ready',
      commit_ref: d.commit_ref ?? 'def456abc123',
      created_at: d.created_at ?? '2026-05-25T11:00:00Z',
      skipped: d.skipped ?? false,
      deploy_ssl_url: d.deploy_ssl_url ?? 'https://app.example.com',
    })),
  };
}

function makeRenderDeploysResponse(
  deploys: Array<{
    id?: string;
    status?: string;
    commitId?: string;
    createdAt?: string;
  }>,
) {
  return {
    data: deploys.map(d => ({
      deploy: {
        id: d.id ?? 'render-deploy-123',
        status: d.status ?? 'live',
        commit: { id: d.commitId ?? 'def456abc123' },
        createdAt: d.createdAt ?? '2026-05-25T11:00:00Z',
      },
    })),
  };
}

const EXPECTED_SHA = 'def456abc123';
const JOB_START = new Date('2026-05-25T10:00:00Z');
const AFTER_JOB_START = '2026-05-25T11:00:00Z';
const BEFORE_JOB_START = '2026-05-25T09:00:00Z';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DeploymentChecksService', () => {
  let service: DeploymentChecksService;

  beforeEach(async () => {
    vi.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [DeploymentChecksService],
    }).compile();
    service = module.get(DeploymentChecksService);
  });

  const baseInput = {
    expectedSha: EXPECTED_SHA,
    token: 'test-token-value',
    jobStartedAt: JOB_START,
    deployUrl: 'https://app.example.com',
  };

  // ── NETLIFY ────────────────────────────────────────────────────────────────

  describe('checkNetlifyDeployment', () => {
    it('SKIP when no siteId or token provided', async () => {
      const results = await service.checkNetlifyDeployment(undefined, { ...baseInput, token: undefined });
      expect(results).toHaveLength(1);
      expect(results[0].checkId).toBe('S10');
      expect(results[0].status).toBe('SKIP');
    });

    it('returns DEP2 PASS + DEP3 PASS + S10 PASS when deploy is not skipped and SHA matches', async () => {
      mockedAxios.get.mockResolvedValue(
        makeNetlifyDeploysResponse([{
          state: 'ready',
          commit_ref: EXPECTED_SHA,
          created_at: AFTER_JOB_START,
          skipped: false,
        }]),
      );

      const results = await service.checkNetlifyDeployment('site-abc123', baseInput);

      const dep2 = results.find(r => r.checkId === 'DEP2');
      const dep3 = results.find(r => r.checkId === 'DEP3');
      const s10 = results.find(r => r.checkId === 'S10');

      expect(dep2?.status).toBe('PASS');
      expect(dep3?.status).toBe('PASS');
      expect(s10?.status).toBe('PASS');
    });

    it('DEP2 FAIL when Netlify deploy is skipped (adversarial #9: cache hit)', async () => {
      mockedAxios.get.mockResolvedValue(
        makeNetlifyDeploysResponse([{
          state: 'ready',
          commit_ref: EXPECTED_SHA,
          created_at: AFTER_JOB_START,
          skipped: true, // cache hit!
        }]),
      );

      const results = await service.checkNetlifyDeployment('site-abc123', baseInput);
      const dep2 = results.find(r => r.checkId === 'DEP2');
      expect(dep2?.status).toBe('FAIL');
      expect(dep2?.detail).toContain('skipped');
    });

    it('DEP3 FAIL when Netlify deploy SHA does not match expected (adversarial #8: deployed to staging)', async () => {
      mockedAxios.get.mockResolvedValue(
        makeNetlifyDeploysResponse([{
          state: 'ready',
          commit_ref: 'aaaaaaaabbbb', // wrong SHA
          created_at: AFTER_JOB_START,
          skipped: false,
        }]),
      );

      const results = await service.checkNetlifyDeployment('site-abc123', baseInput);
      const dep3 = results.find(r => r.checkId === 'DEP3');
      expect(dep3?.status).toBe('FAIL');
      expect(dep3?.detail).toContain('does not match');
    });

    it('S10 FAIL when no deploy found after job start', async () => {
      // All deploys are before job start
      mockedAxios.get.mockResolvedValue(
        makeNetlifyDeploysResponse([{
          state: 'ready',
          commit_ref: EXPECTED_SHA,
          created_at: BEFORE_JOB_START,
          skipped: false,
        }]),
      );

      const results = await service.checkNetlifyDeployment('site-abc123', baseInput);
      expect(results).toHaveLength(1);
      expect(results[0].checkId).toBe('S10');
      expect(results[0].status).toBe('FAIL');
      expect(results[0].detail).toContain('No successful Netlify deploy found');
    });

    it('S10 FAIL when no deploys exist at all', async () => {
      mockedAxios.get.mockResolvedValue(makeNetlifyDeploysResponse([]));
      const results = await service.checkNetlifyDeployment('site-abc123', baseInput);
      expect(results[0].checkId).toBe('S10');
      expect(results[0].status).toBe('FAIL');
    });

    it('S10 FAIL when deploy state is not "ready"', async () => {
      mockedAxios.get.mockResolvedValue(
        makeNetlifyDeploysResponse([{
          state: 'error',
          commit_ref: EXPECTED_SHA,
          created_at: AFTER_JOB_START,
          skipped: false,
        }]),
      );

      const results = await service.checkNetlifyDeployment('site-abc123', baseInput);
      // State = "error" → no ready deploy found → S10 FAIL
      const s10 = results.find(r => r.checkId === 'S10');
      expect(s10?.status).toBe('FAIL');
    });

    it('S10 FAIL on invalid token (401 Unauthorized)', async () => {
      mockedAxios.get.mockRejectedValue(
        Object.assign(new Error('Request failed with status code 401'), { response: { status: 401 } }),
      );

      const results = await service.checkNetlifyDeployment('site-abc123', baseInput);
      expect(results[0].status).toBe('FAIL');
      expect(results[0].detail).toContain('Netlify API error');
    });

    it('S10 FAIL on network error — graceful degradation', async () => {
      mockedAxios.get.mockRejectedValue(new Error('Network error'));
      const results = await service.checkNetlifyDeployment('site-abc123', baseInput);
      expect(results[0].status).toBe('FAIL');
    });

    it('accepts short SHA prefix match (first 8 chars)', async () => {
      // If Netlify returns a short commit_ref that is a prefix of expected SHA
      const shortRef = EXPECTED_SHA.slice(0, 8);
      mockedAxios.get.mockResolvedValue(
        makeNetlifyDeploysResponse([{
          state: 'ready',
          commit_ref: shortRef,
          created_at: AFTER_JOB_START,
          skipped: false,
        }]),
      );

      const results = await service.checkNetlifyDeployment('site-abc123', baseInput);
      const dep3 = results.find(r => r.checkId === 'DEP3');
      expect(dep3?.status).toBe('PASS');
    });

    it('DEP2 evidence includes skipped field and deployId', async () => {
      mockedAxios.get.mockResolvedValue(
        makeNetlifyDeploysResponse([{
          id: 'deploy-xyz',
          state: 'ready',
          commit_ref: EXPECTED_SHA,
          created_at: AFTER_JOB_START,
          skipped: false,
        }]),
      );
      const results = await service.checkNetlifyDeployment('site-abc123', baseInput);
      const dep2 = results.find(r => r.checkId === 'DEP2');
      expect((dep2?.evidence as Record<string, unknown>).skipped).toBe(false);
      expect((dep2?.evidence as Record<string, unknown>).deployId).toBe('deploy-xyz');
    });
  });

  // ── RENDER ─────────────────────────────────────────────────────────────────

  describe('checkRenderDeployment', () => {
    it('SKIP when no serviceId or token provided', async () => {
      const results = await service.checkRenderDeployment(undefined, { ...baseInput, token: undefined });
      expect(results).toHaveLength(1);
      expect(results[0].checkId).toBe('S10');
      expect(results[0].status).toBe('SKIP');
    });

    it('returns DEP2 PASS + DEP3 PASS + S10 PASS when deploy is live and SHA matches', async () => {
      mockedAxios.get.mockResolvedValue(
        makeRenderDeploysResponse([{
          status: 'live',
          commitId: EXPECTED_SHA,
          createdAt: AFTER_JOB_START,
        }]),
      );

      const results = await service.checkRenderDeployment('svc-abc123', baseInput);

      const dep2 = results.find(r => r.checkId === 'DEP2');
      const dep3 = results.find(r => r.checkId === 'DEP3');
      const s10 = results.find(r => r.checkId === 'S10');

      expect(dep2?.status).toBe('PASS');
      expect(dep3?.status).toBe('PASS');
      expect(s10?.status).toBe('PASS');
    });

    it('S10 FAIL when Render deploy status is not "live" (deploy suspended)', async () => {
      mockedAxios.get.mockResolvedValue(
        makeRenderDeploysResponse([{
          status: 'build_failed',
          commitId: EXPECTED_SHA,
          createdAt: AFTER_JOB_START,
        }]),
      );

      const results = await service.checkRenderDeployment('svc-abc123', baseInput);
      const s10 = results.find(r => r.checkId === 'S10');
      expect(s10?.status).toBe('FAIL');
    });

    it('DEP3 FAIL when Render commit ID does not match expected SHA', async () => {
      mockedAxios.get.mockResolvedValue(
        makeRenderDeploysResponse([{
          status: 'live',
          commitId: 'wrongsha12345', // mismatch
          createdAt: AFTER_JOB_START,
        }]),
      );

      const results = await service.checkRenderDeployment('svc-abc123', baseInput);
      const dep3 = results.find(r => r.checkId === 'DEP3');
      expect(dep3?.status).toBe('FAIL');
      expect(dep3?.detail).toContain('does not match');
    });

    it('S10 FAIL when no live Render deploy found after job start', async () => {
      mockedAxios.get.mockResolvedValue(
        makeRenderDeploysResponse([{
          status: 'live',
          commitId: EXPECTED_SHA,
          createdAt: BEFORE_JOB_START,
        }]),
      );

      const results = await service.checkRenderDeployment('svc-abc123', baseInput);
      const s10 = results.find(r => r.checkId === 'S10');
      expect(s10?.status).toBe('FAIL');
    });

    it('S10 FAIL on invalid token — graceful error handling', async () => {
      mockedAxios.get.mockRejectedValue(new Error('Request failed with status code 401'));
      const results = await service.checkRenderDeployment('svc-abc123', baseInput);
      expect(results[0].status).toBe('FAIL');
      expect(results[0].detail).toContain('Render API error');
    });

    it('DEP3 evidence includes deployedSha and expectedSha', async () => {
      mockedAxios.get.mockResolvedValue(
        makeRenderDeploysResponse([{
          status: 'live',
          commitId: EXPECTED_SHA,
          createdAt: AFTER_JOB_START,
        }]),
      );
      const results = await service.checkRenderDeployment('svc-abc123', baseInput);
      const dep3 = results.find(r => r.checkId === 'DEP3');
      expect((dep3?.evidence as Record<string, unknown>).deployedSha).toBe(EXPECTED_SHA);
      expect((dep3?.evidence as Record<string, unknown>).expectedSha).toBe(EXPECTED_SHA);
    });
  });

  // ── DEP1: Production running new code ────────────────────────────────────

  describe('checkProductionRunningNewCode (DEP1)', () => {
    it('PASS when production responds with < 500 status', async () => {
      // axios.get with validateStatus: () => true resolves (not rejects) on any status
      mockedAxios.get.mockResolvedValue({ status: 200, data: '', headers: {} });
      const result = await service.checkProductionRunningNewCode('https://api.acme.com', EXPECTED_SHA);
      expect(result.checkId).toBe('DEP1');
      expect(result.status).toBe('PASS');
    });

    it('FAIL when production returns 500', async () => {
      mockedAxios.get.mockResolvedValue({ status: 500, data: 'error', headers: {} });
      const result = await service.checkProductionRunningNewCode('https://api.acme.com', EXPECTED_SHA);
      expect(result.status).toBe('FAIL');
    });

    it('SKIP when no deployUrl provided', async () => {
      const result = await service.checkProductionRunningNewCode(undefined, EXPECTED_SHA);
      expect(result.status).toBe('SKIP');
    });

    it('FAIL on network error', async () => {
      mockedAxios.get.mockRejectedValue(new Error('ENOTFOUND'));
      const result = await service.checkProductionRunningNewCode('https://api.acme.com', EXPECTED_SHA);
      expect(result.status).toBe('FAIL');
    });
  });

  // ── DEP5: No crash loops ──────────────────────────────────────────────────

  describe('checkNoCrashLoops (DEP5)', () => {
    it('SKIP when no serviceId provided', async () => {
      const result = await service.checkNoCrashLoops(undefined, 'RENDER', 'token', JOB_START);
      expect(result.checkId).toBe('DEP5');
      expect(result.status).toBe('SKIP');
    });

    it('SKIP when platform is not RENDER', async () => {
      const result = await service.checkNoCrashLoops('svc-123', 'NETLIFY', 'token', JOB_START);
      expect(result.status).toBe('SKIP');
    });

    it('PASS when no failed deploys after job start', async () => {
      mockedAxios.get.mockResolvedValue(
        makeRenderDeploysResponse([{
          status: 'live',
          commitId: EXPECTED_SHA,
          createdAt: AFTER_JOB_START,
        }]),
      );
      const result = await service.checkNoCrashLoops('svc-123', 'RENDER', 'token', JOB_START);
      expect(result.status).toBe('PASS');
    });

    it('FAIL when failed deploys detected after job start (crash loop)', async () => {
      mockedAxios.get.mockResolvedValue({
        data: [
          { deploy: { id: 'd1', status: 'failed', commit: { id: 'abc' }, createdAt: AFTER_JOB_START } },
          { deploy: { id: 'd2', status: 'failed', commit: { id: 'abc' }, createdAt: AFTER_JOB_START } },
        ],
      });
      const result = await service.checkNoCrashLoops('svc-123', 'RENDER', 'token', JOB_START);
      expect(result.status).toBe('FAIL');
      expect(result.detail).toContain('crash loop');
    });

    it('PASS when failed deploy exists but was before job start', async () => {
      mockedAxios.get.mockResolvedValue({
        data: [
          { deploy: { id: 'd1', status: 'failed', commit: { id: 'abc' }, createdAt: BEFORE_JOB_START } },
          { deploy: { id: 'd2', status: 'live', commit: { id: EXPECTED_SHA }, createdAt: AFTER_JOB_START } },
        ],
      });
      const result = await service.checkNoCrashLoops('svc-123', 'RENDER', 'token', JOB_START);
      expect(result.status).toBe('PASS');
    });
  });

  // ── Vercel / Railway deploy handlers ───────────────────────────────────────

  describe('checkVercelDeployment', () => {
    it('SKIP when project ID or token missing', async () => {
      const results = await service.checkVercelDeployment(undefined, undefined, baseInput);
      expect(results[0]?.status).toBe('SKIP');
    });

    it('PASS when a READY deployment matches the expected SHA', async () => {
      mockedAxios.get.mockResolvedValue({
        data: {
          deployments: [{
            uid: 'dpl_123',
            url: 'https://app.vercel.app',
            readyState: 'READY',
            createdAt: new Date(AFTER_JOB_START).getTime(),
            meta: { githubCommitSha: EXPECTED_SHA },
          }],
        },
      });
      const results = await service.checkVercelDeployment('prj_123', undefined, {
        ...baseInput,
        token: 'vercel-token',
      });
      const s10 = results.find((r) => r.checkId === 'S10');
      expect(s10?.status).toBe('PASS');
    });
  });

  describe('checkRailwayDeployment', () => {
    it('SKIP when service ID or token missing', async () => {
      const results = await service.checkRailwayDeployment(undefined, baseInput);
      expect(results[0]?.status).toBe('SKIP');
    });

    it('PASS when a SUCCESS deployment matches the expected SHA', async () => {
      mockedAxios.post.mockResolvedValue({
        data: {
          data: {
            deployments: {
              edges: [{
                node: {
                  id: 'dep_123',
                  status: 'SUCCESS',
                  createdAt: AFTER_JOB_START,
                  meta: { commitHash: EXPECTED_SHA },
                },
              }],
            },
          },
        },
      });
      const results = await service.checkRailwayDeployment('svc-123', {
        ...baseInput,
        token: 'railway-token',
      });
      const s10 = results.find((r) => r.checkId === 'S10');
      expect(s10?.status).toBe('PASS');
    });
  });

  describe('Netlify URL encoding', () => {
    it('percent-encodes the site ID in the Netlify API path', async () => {
      mockedAxios.get.mockResolvedValue(makeNetlifyDeploysResponse([]));
      await service.checkNetlifyDeployment('site/with/slash', {
        ...baseInput,
        token: 'netlify-token',
      });
      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining('/sites/site%2Fwith%2Fslash/deploys'),
        expect.any(Object),
      );
    });
  });
});
