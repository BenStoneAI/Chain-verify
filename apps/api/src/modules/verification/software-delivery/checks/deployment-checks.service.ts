import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { assertSsrfSafeWithDns } from '../../../../common/utils/ssrf-guard.js';
import type { CheckResult } from '../software-delivery.types.js';
import { CHECK_NAMES } from '../software-delivery.types.js';

interface DeployCheckInput {
  expectedSha: string;
  token: string | undefined;
  jobStartedAt: Date;
  deployUrl?: string;
}

@Injectable()
export class DeploymentChecksService {

  // Netlify: S10 + DEP2 + DEP3 checks
  async checkNetlifyDeployment(siteId: string | undefined, input: DeployCheckInput): Promise<CheckResult[]> {
    const { expectedSha, token, jobStartedAt } = input;
    const usedToken = token ?? process.env.NETLIFY_VERIFY_TOKEN;

    if (!siteId || !usedToken) {
      return [{
        checkId: 'S10',
        checkName: CHECK_NAMES['S10'],
        tier: 'STANDARD',
        status: 'SKIP',
        detail: 'No Netlify site ID or token provided — skipping Netlify deployment check.',
      }];
    }

    try {
      const siteSegment = encodeURIComponent(siteId);
      const response = await axios.get(
        `https://api.netlify.com/api/v1/sites/${siteSegment}/deploys?per_page=10`,
        { headers: { Authorization: `Bearer ${usedToken}` }, timeout: 10000 },
      );
      const deploys: Array<{
        id: string;
        state: string;
        commit_ref: string;
        created_at: string;
        skipped: boolean;
        deploy_ssl_url: string;
      }> = response.data;

      const relevantDeploy = deploys.find(
        d => new Date(d.created_at) >= jobStartedAt && d.state === 'ready',
      );

      if (!relevantDeploy) {
        return [{
          checkId: 'S10',
          checkName: CHECK_NAMES['S10'],
          tier: 'STANDARD',
          status: 'FAIL',
          detail: 'No successful Netlify deploy found after job start. The build may have failed or deployment has not occurred.',
        }];
      }

      const results: CheckResult[] = [];

      // DEP2 — Not a cache hit
      results.push({
        checkId: 'DEP2',
        checkName: CHECK_NAMES['DEP2'],
        tier: 'BASIC',
        status: !relevantDeploy.skipped ? 'PASS' : 'FAIL',
        detail: relevantDeploy.skipped ? 'Netlify deploy was skipped (cache hit) — production may not have been updated.' : undefined,
        evidence: { skipped: relevantDeploy.skipped, deployId: relevantDeploy.id },
      });

      // DEP3 — Commit SHA matches
      const shaMatch = relevantDeploy.commit_ref === expectedSha ||
        relevantDeploy.commit_ref?.startsWith(expectedSha.slice(0, 8));
      results.push({
        checkId: 'DEP3',
        checkName: CHECK_NAMES['DEP3'],
        tier: 'BASIC',
        status: shaMatch ? 'PASS' : 'FAIL',
        detail: !shaMatch
          ? `Netlify deploy SHA (${relevantDeploy.commit_ref}) does not match expected SHA (${expectedSha}).`
          : undefined,
        evidence: { deployedSha: relevantDeploy.commit_ref, expectedSha },
      });

      // S10 — Production is running the new code
      results.push({
        checkId: 'S10',
        checkName: CHECK_NAMES['S10'],
        tier: 'STANDARD',
        status: shaMatch ? 'PASS' : 'FAIL',
        detail: !shaMatch ? 'Production SHA does not match the delivery commit.' : undefined,
        evidence: { deployId: relevantDeploy.id, deployUrl: relevantDeploy.deploy_ssl_url, commitRef: relevantDeploy.commit_ref },
      });

      return results;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return [{
        checkId: 'S10',
        checkName: CHECK_NAMES['S10'],
        tier: 'STANDARD',
        status: 'FAIL',
        detail: `Netlify API error: ${message}`,
      }];
    }
  }

  // Render: S10 + DEP checks
  async checkRenderDeployment(serviceId: string | undefined, input: DeployCheckInput): Promise<CheckResult[]> {
    const { expectedSha, token, jobStartedAt } = input;
    const usedToken = token ?? process.env.RENDER_VERIFY_TOKEN;

    if (!serviceId || !usedToken) {
      return [{
        checkId: 'S10',
        checkName: CHECK_NAMES['S10'],
        tier: 'STANDARD',
        status: 'SKIP',
        detail: 'No Render service ID or token provided — skipping Render deployment check.',
      }];
    }

    try {
      const response = await axios.get(
        `https://api.render.com/v1/services/${serviceId}/deploys?limit=10`,
        { headers: { Authorization: `Bearer ${usedToken}` }, timeout: 10000 },
      );

      const deploys: Array<{
        deploy: {
          id: string;
          status: string;
          commit: { id: string };
          createdAt: string;
        };
      }> = response.data;

      const relevantDeploy = deploys.find(d =>
        new Date(d.deploy.createdAt) >= jobStartedAt && d.deploy.status === 'live',
      );

      if (!relevantDeploy) {
        return [{
          checkId: 'S10',
          checkName: CHECK_NAMES['S10'],
          tier: 'STANDARD',
          status: 'FAIL',
          detail: 'No live Render deploy found after job start.',
        }];
      }

      const d = relevantDeploy.deploy;
      const shaMatch = d.commit?.id === expectedSha || d.commit?.id?.startsWith(expectedSha.slice(0, 8));

      return [
        {
          checkId: 'DEP2',
          checkName: CHECK_NAMES['DEP2'],
          tier: 'BASIC',
          status: d.status === 'live' ? 'PASS' : 'FAIL',
          detail: d.status !== 'live' ? `Render deploy status is "${d.status}", not "live".` : undefined,
          evidence: { status: d.status, deployId: d.id },
        },
        {
          checkId: 'DEP3',
          checkName: CHECK_NAMES['DEP3'],
          tier: 'BASIC',
          status: shaMatch ? 'PASS' : 'FAIL',
          detail: !shaMatch ? `Render deploy SHA (${d.commit?.id}) does not match expected (${expectedSha}).` : undefined,
          evidence: { deployedSha: d.commit?.id, expectedSha },
        },
        {
          checkId: 'S10',
          checkName: CHECK_NAMES['S10'],
          tier: 'STANDARD',
          status: shaMatch ? 'PASS' : 'FAIL',
          detail: !shaMatch ? 'Production SHA does not match delivery commit.' : undefined,
          evidence: { deployId: d.id, commitSha: d.commit?.id },
        },
      ];
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return [{
        checkId: 'S10',
        checkName: CHECK_NAMES['S10'],
        tier: 'STANDARD',
        status: 'FAIL',
        detail: `Render API error: ${message}`,
      }];
    }
  }

  // Vercel: S10 + DEP2 + DEP3 checks
  async checkVercelDeployment(
    projectId: string | undefined,
    teamId: string | undefined,
    input: DeployCheckInput,
  ): Promise<CheckResult[]> {
    const { expectedSha, token, jobStartedAt } = input;
    const usedToken = token ?? process.env.VERCEL_VERIFY_TOKEN;

    if (!projectId || !usedToken) {
      return [{
        checkId: 'S10',
        checkName: CHECK_NAMES['S10'],
        tier: 'STANDARD',
        status: 'SKIP',
        detail: 'No Vercel project ID or token provided — skipping Vercel deployment check.',
      }];
    }

    try {
      const params: Record<string, string | number> = { projectId, limit: 10 };
      if (teamId) params.teamId = teamId;

      const response = await axios.get('https://api.vercel.com/v6/deployments', {
        headers: { Authorization: `Bearer ${usedToken}` },
        params,
        timeout: 10000,
      });

      const deployments: Array<{
        uid?: string;
        url?: string;
        readyState?: string;
        state?: string;
        createdAt?: number;
        meta?: { githubCommitSha?: string; gitlabCommitSha?: string };
      }> = response.data?.deployments ?? [];

      const relevantDeploy = deployments.find((d) => {
        const created = d.createdAt ? new Date(d.createdAt) : null;
        const ready = (d.readyState ?? d.state) === 'READY';
        return created && created >= jobStartedAt && ready;
      });

      if (!relevantDeploy) {
        return [{
          checkId: 'S10',
          checkName: CHECK_NAMES['S10'],
          tier: 'STANDARD',
          status: 'FAIL',
          detail: 'No successful Vercel deployment found after job start.',
        }];
      }

      const deployedSha =
        relevantDeploy.meta?.githubCommitSha ?? relevantDeploy.meta?.gitlabCommitSha ?? '';
      const shaMatch =
        deployedSha === expectedSha || deployedSha.startsWith(expectedSha.slice(0, 8));

      return [
        {
          checkId: 'DEP2',
          checkName: CHECK_NAMES['DEP2'],
          tier: 'BASIC',
          status: 'PASS',
          detail: undefined,
          evidence: { deployId: relevantDeploy.uid, readyState: relevantDeploy.readyState ?? relevantDeploy.state },
        },
        {
          checkId: 'DEP3',
          checkName: CHECK_NAMES['DEP3'],
          tier: 'BASIC',
          status: shaMatch ? 'PASS' : 'FAIL',
          detail: !shaMatch
            ? `Vercel deploy SHA (${deployedSha || 'unknown'}) does not match expected (${expectedSha}).`
            : undefined,
          evidence: { deployedSha, expectedSha },
        },
        {
          checkId: 'S10',
          checkName: CHECK_NAMES['S10'],
          tier: 'STANDARD',
          status: shaMatch ? 'PASS' : 'FAIL',
          detail: !shaMatch ? 'Production SHA does not match delivery commit.' : undefined,
          evidence: { deployId: relevantDeploy.uid, deployUrl: relevantDeploy.url, commitSha: deployedSha },
        },
      ];
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return [{
        checkId: 'S10',
        checkName: CHECK_NAMES['S10'],
        tier: 'STANDARD',
        status: 'FAIL',
        detail: `Vercel API error: ${message}`,
      }];
    }
  }

  // Railway: S10 + DEP2 + DEP3 checks (GraphQL)
  async checkRailwayDeployment(
    serviceId: string | undefined,
    input: DeployCheckInput,
  ): Promise<CheckResult[]> {
    const { expectedSha, token, jobStartedAt } = input;
    const usedToken = token ?? process.env.RAILWAY_VERIFY_TOKEN;

    if (!serviceId || !usedToken) {
      return [{
        checkId: 'S10',
        checkName: CHECK_NAMES['S10'],
        tier: 'STANDARD',
        status: 'SKIP',
        detail: 'No Railway service ID or token provided — skipping Railway deployment check.',
      }];
    }

    try {
      const response = await axios.post(
        'https://backboard.railway.com/graphql/v2',
        {
          query: `
            query ServiceDeployments($serviceId: String!) {
              deployments(input: { serviceId: $serviceId, first: 10 }) {
                edges {
                  node {
                    id
                    status
                    createdAt
                    meta
                  }
                }
              }
            }
          `,
          variables: { serviceId },
        },
        {
          headers: {
            Authorization: `Bearer ${usedToken}`,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        },
      );

      const edges: Array<{
        node?: {
          id?: string;
          status?: string;
          createdAt?: string;
          meta?: { commitHash?: string; repo?: string };
        };
      }> = response.data?.data?.deployments?.edges ?? [];

      const relevantDeploy = edges
        .map((e) => e.node)
        .find((d) => {
          if (!d?.createdAt) return false;
          const success = String(d.status ?? '').toUpperCase() === 'SUCCESS';
          return success && new Date(d.createdAt) >= jobStartedAt;
        });

      if (!relevantDeploy) {
        return [{
          checkId: 'S10',
          checkName: CHECK_NAMES['S10'],
          tier: 'STANDARD',
          status: 'FAIL',
          detail: 'No successful Railway deployment found after job start.',
        }];
      }

      const deployedSha = relevantDeploy.meta?.commitHash ?? '';
      const shaMatch =
        deployedSha === expectedSha || deployedSha.startsWith(expectedSha.slice(0, 8));

      return [
        {
          checkId: 'DEP2',
          checkName: CHECK_NAMES['DEP2'],
          tier: 'BASIC',
          status: 'PASS',
          evidence: { deployId: relevantDeploy.id, status: relevantDeploy.status },
        },
        {
          checkId: 'DEP3',
          checkName: CHECK_NAMES['DEP3'],
          tier: 'BASIC',
          status: shaMatch ? 'PASS' : 'FAIL',
          detail: !shaMatch
            ? `Railway deploy SHA (${deployedSha || 'unknown'}) does not match expected (${expectedSha}).`
            : undefined,
          evidence: { deployedSha, expectedSha },
        },
        {
          checkId: 'S10',
          checkName: CHECK_NAMES['S10'],
          tier: 'STANDARD',
          status: shaMatch ? 'PASS' : 'FAIL',
          detail: !shaMatch ? 'Production SHA does not match delivery commit.' : undefined,
          evidence: { deployId: relevantDeploy.id, commitSha: deployedSha },
        },
      ];
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return [{
        checkId: 'S10',
        checkName: CHECK_NAMES['S10'],
        tier: 'STANDARD',
        status: 'FAIL',
        detail: `Railway API error: ${message}`,
      }];
    }
  }

  // DEP1 — Production is running the new code (behavioral probe)
  async checkProductionRunningNewCode(deployUrl: string | undefined, expectedSha: string): Promise<CheckResult> {
    const start = Date.now();
    if (!deployUrl) {
      return { checkId: 'DEP1', checkName: CHECK_NAMES['DEP1'], tier: 'BASIC', status: 'SKIP', detail: 'No deploy URL provided.', durationMs: 0 };
    }
    try {
      await assertSsrfSafeWithDns(deployUrl);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { checkId: 'DEP1', checkName: CHECK_NAMES['DEP1'], tier: 'BASIC', status: 'FAIL', detail: `SSRF guard blocked request: ${message}`, durationMs: 0 };
    }
    try {
      const response = await axios.get(deployUrl, {
        timeout: 8000,
        validateStatus: () => true,
        headers: { 'Cache-Control': 'no-cache, no-store', 'Pragma': 'no-cache' },
      });
      const reachable = response.status < 500;
      return {
        checkId: 'DEP1',
        checkName: CHECK_NAMES['DEP1'],
        tier: 'BASIC',
        status: reachable ? 'PASS' : 'FAIL',
        detail: !reachable ? `Production returned HTTP ${response.status} with cache headers bypassed.` : 'Production responded successfully with no-cache headers. SHA cross-check handled by DEP3.',
        evidence: { statusCode: response.status, expectedSha },
        durationMs: Date.now() - start,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { checkId: 'DEP1', checkName: CHECK_NAMES['DEP1'], tier: 'BASIC', status: 'FAIL', detail: `Could not reach production: ${message}`, durationMs: Date.now() - start };
    }
  }

  // DEP5 — No crash loops after deploy
  async checkNoCrashLoops(serviceId: string | undefined, platform: string | undefined, token: string | undefined, jobStartedAt: Date): Promise<CheckResult> {
    const start = Date.now();
    if (!serviceId || !token || platform !== 'RENDER') {
      return {
        checkId: 'DEP5',
        checkName: CHECK_NAMES['DEP5'],
        tier: 'BASIC',
        status: 'SKIP',
        detail: 'Crash loop detection requires a Render service ID and token. Pass renderToken and a service ID to enable this check.',
        durationMs: 0,
      };
    }
    try {
      const response = await axios.get(
        `https://api.render.com/v1/services/${serviceId}/deploys?limit=5`,
        { headers: { Authorization: `Bearer ${token}` }, timeout: 10000 },
      );
      const deploys: Array<{ deploy: { status: string; createdAt: string } }> = response.data;
      const recentDeploys = deploys.filter(d => new Date(d.deploy.createdAt) >= jobStartedAt);
      const crashedDeploys = recentDeploys.filter(d => d.deploy.status === 'failed' || d.deploy.status === 'canceled');

      return {
        checkId: 'DEP5',
        checkName: CHECK_NAMES['DEP5'],
        tier: 'BASIC',
        status: crashedDeploys.length === 0 ? 'PASS' : 'FAIL',
        detail: crashedDeploys.length > 0 ? `${crashedDeploys.length} failed/canceled deploy(s) detected after job start — possible crash loop.` : undefined,
        evidence: { deployCount: recentDeploys.length, crashedCount: crashedDeploys.length },
        durationMs: Date.now() - start,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { checkId: 'DEP5', checkName: CHECK_NAMES['DEP5'], tier: 'BASIC', status: 'WARNING', detail: `Could not verify crash loops: ${message}`, durationMs: Date.now() - start };
    }
  }
}
