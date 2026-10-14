import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import type { CheckResult, SoftwareTier } from '../software-delivery.types.js';
import { CHECK_NAMES } from '../software-delivery.types.js';
import { BuildSandboxService } from './build-sandbox.service.js';

// B5/S2/S4/S5 verify that the delivered commit builds, its tests pass, its type
// checker is clean, and its linter is clean. The VerifyAPI cannot clone and
// execute an arbitrary buyer repo (no build sandbox), so Phase 1 derives these
// signals from the CI the repo already runs: GitHub Check-Runs and the legacy
// commit-status API on the delivery SHA. When a repo publishes a matching
// check (e.g. a "build" / "test" / "typecheck" / "lint" job), we surface its
// real PASS/FAIL. When no matching signal exists, the check is a documented
// SKIP rather than a false PASS — S9 still covers overall CI health, and a
// local build sandbox is the Phase 2 upgrade path.

type Conclusion = 'success' | 'failure' | 'pending' | 'neutral';

interface NormalizedCiResult {
  name: string;
  conclusion: Conclusion;
}

interface BuildCheckCategory {
  checkId: 'B5' | 'S2' | 'S4' | 'S5';
  tier: SoftwareTier;
  pattern: RegExp;
}

const CATEGORIES: BuildCheckCategory[] = [
  { checkId: 'B5', tier: 'BASIC', pattern: /\b(build|compile|webpack|turbo|next\s*build|bundle)\b/i },
  { checkId: 'S2', tier: 'STANDARD', pattern: /\b(test|tests|jest|vitest|mocha|pytest|playwright|e2e|unit|spec)\b/i },
  { checkId: 'S4', tier: 'STANDARD', pattern: /\b(typecheck|type-check|type\s*check|tsc|typescript|types)\b/i },
  { checkId: 'S5', tier: 'STANDARD', pattern: /\b(lint|eslint|prettier|format|style)\b/i },
];

@Injectable()
export class BuildChecksService {
  private readonly logger = new Logger(BuildChecksService.name);

  constructor(private readonly sandbox: BuildSandboxService) {}

  private get token(): string {
    return process.env.GITHUB_TOKEN ?? '';
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  // Returns CheckResults only for the build-family checks present in checkList.
  async runBuildChecks(
    owner: string,
    repo: string,
    sha: string,
    checkList: string[],
  ): Promise<CheckResult[]> {
    const wanted = CATEGORIES.filter((c) => checkList.includes(c.checkId));
    if (wanted.length === 0) return [];

    const start = Date.now();
    let ciResults: NormalizedCiResult[] = [];
    let signalAvailable = true;

    try {
      ciResults = await this.fetchCiResults(owner, repo, sha);
    } catch (err: unknown) {
      // A failed lookup is not a delivery failure — it means we have no signal.
      signalAvailable = false;
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`build-checks CI lookup failed for ${owner}/${repo}@${sha}: ${message}`);
    }

    const durationMs = Date.now() - start;
    const initial = wanted.map((category) =>
      this.evaluateCategory(category, ciResults, signalAvailable, durationMs),
    );

    if (!this.sandbox.isEnabled()) return initial;

    const upgraded: CheckResult[] = [];
    for (const result of initial) {
      if (result.status !== 'SKIP' || !['B5', 'S2', 'S4', 'S5'].includes(result.checkId)) {
        upgraded.push(result);
        continue;
      }
      const sandboxResult = await this.sandbox.runCheck(
        owner,
        repo,
        sha,
        result.checkId as 'B5' | 'S2' | 'S4' | 'S5',
      );
      upgraded.push(sandboxResult ?? result);
    }
    return upgraded;
  }

  private evaluateCategory(
    category: BuildCheckCategory,
    ciResults: NormalizedCiResult[],
    signalAvailable: boolean,
    durationMs: number,
  ): CheckResult {
    const { checkId, tier, pattern } = category;
    const base = { checkId, checkName: CHECK_NAMES[checkId], tier, durationMs };

    if (!signalAvailable) {
      return {
        ...base,
        status: 'SKIP',
        detail:
          'No CI signal could be retrieved for this commit (GitHub Check-Runs unavailable). Overall CI health is covered by S9. Enable BUILD_SANDBOX_ENABLED for local build fallback.',
      };
    }

    const matches = ciResults.filter((r) => pattern.test(r.name));
    if (matches.length === 0) {
      return {
        ...base,
        status: 'SKIP',
        detail: `No matching CI check (${CHECK_NAMES[checkId].toLowerCase()}) was published on the delivery commit. Covered by S9 (CI). Enable BUILD_SANDBOX_ENABLED for local build fallback.`,
        evidence: { matched: 0, totalCiChecks: ciResults.length },
      };
    }

    const failing = matches.filter((r) => r.conclusion === 'failure');
    const pending = matches.filter((r) => r.conclusion === 'pending');
    const passing = matches.filter((r) => r.conclusion === 'success');

    if (failing.length > 0) {
      return {
        ...base,
        status: 'FAIL',
        detail: `CI reported failure: ${failing.map((r) => r.name).join(', ')}`,
        evidence: { failing: failing.map((r) => r.name) },
      };
    }
    if (passing.length === 0 && pending.length > 0) {
      return {
        ...base,
        status: 'WARNING',
        detail: `CI check(s) still running: ${pending.map((r) => r.name).join(', ')}`,
        evidence: { pending: pending.map((r) => r.name) },
      };
    }
    // Only PASS on a genuine success. Matching checks that exist but are all
    // neutral / skipped / stale carry no pass signal — reporting PASS here would
    // let a skipped build masquerade as a passing one (adversarial FAKE-20).
    if (passing.length === 0) {
      return {
        ...base,
        status: 'SKIP',
        detail: `Matching CI check(s) were neutral or skipped — no usable pass/fail signal. Covered by S9 (CI). Enable BUILD_SANDBOX_ENABLED for local build fallback.`,
        evidence: { matched: matches.length, neutralOrSkipped: matches.map((r) => r.name) },
      };
    }
    return {
      ...base,
      status: 'PASS',
      evidence: { passing: passing.map((r) => r.name) },
    };
  }

  // Pull both the Check-Runs API and the legacy commit-status API and merge into
  // one normalized list. Both run in parallel; either may legitimately be empty.
  private async fetchCiResults(
    owner: string,
    repo: string,
    sha: string,
  ): Promise<NormalizedCiResult[]> {
    const [checkRuns, statuses] = await Promise.all([
      this.fetchCheckRuns(owner, repo, sha),
      this.fetchCommitStatuses(owner, repo, sha),
    ]);
    return [...checkRuns, ...statuses];
  }

  private async fetchCheckRuns(
    owner: string,
    repo: string,
    sha: string,
  ): Promise<NormalizedCiResult[]> {
    const response = await axios.get(
      `https://api.github.com/repos/${owner}/${repo}/commits/${sha}/check-runs`,
      { headers: this.headers(), timeout: 10000, params: { per_page: 100 } },
    );
    const runs: Array<{ name?: string; status?: string; conclusion?: string | null }> =
      response.data?.check_runs ?? [];
    return runs.map((r) => ({
      name: r.name ?? '',
      conclusion: this.normalizeCheckRun(r.status, r.conclusion),
    }));
  }

  private async fetchCommitStatuses(
    owner: string,
    repo: string,
    sha: string,
  ): Promise<NormalizedCiResult[]> {
    const response = await axios.get(
      `https://api.github.com/repos/${owner}/${repo}/commits/${sha}/status`,
      { headers: this.headers(), timeout: 10000, params: { per_page: 100 } },
    );
    const statuses: Array<{ context?: string; state?: string }> = response.data?.statuses ?? [];
    return statuses.map((s) => ({
      name: s.context ?? '',
      conclusion: this.normalizeStatusState(s.state),
    }));
  }

  private normalizeCheckRun(status?: string, conclusion?: string | null): Conclusion {
    if (status && status !== 'completed') return 'pending';
    switch (conclusion) {
      case 'success':
        return 'success';
      case 'failure':
      case 'timed_out':
      case 'cancelled':
      case 'action_required':
      case 'startup_failure':
        return 'failure';
      default:
        // neutral, skipped, stale, null → treat as non-signal
        return 'neutral';
    }
  }

  private normalizeStatusState(state?: string): Conclusion {
    switch (state) {
      case 'success':
        return 'success';
      case 'failure':
      case 'error':
        return 'failure';
      case 'pending':
        return 'pending';
      default:
        return 'neutral';
    }
  }
}
