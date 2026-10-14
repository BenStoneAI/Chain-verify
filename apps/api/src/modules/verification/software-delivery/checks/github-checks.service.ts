import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import type { CheckResult } from '../software-delivery.types.js';
import { CHECK_NAMES } from '../software-delivery.types.js';

@Injectable()
export class GithubChecksService {
  private readonly logger = new Logger(GithubChecksService.name);

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

  /**
   * Turn a raw axios/GitHub error into a customer-readable explanation while
   * preserving the technical detail in the server logs. Customers never see
   * "Request failed with status code 404" — they see what to do about it.
   */
  private githubErrorDetail(err: unknown, checkId: string): string {
    const code = (err as { code?: string })?.code;
    const raw = err instanceof Error ? err.message : String(err);
    // Prefer the structured axios status; fall back to parsing it from the
    // message ("Request failed with status code 404") so categorization works
    // even when only an Error message is available.
    const status =
      (err as { response?: { status?: number } })?.response?.status ??
      (() => {
        const m = /status code (\d{3})/i.exec(raw);
        return m ? Number(m[1]) : undefined;
      })();
    // Keep the raw technical detail for operators; never surface it to customers.
    this.logger.warn(`${checkId} GitHub call failed (HTTP ${status ?? 'n/a'}, code ${code ?? 'n/a'}): ${raw}`);

    if (status === 404) {
      return 'Repository, commit, or pull request not found. Confirm the repo exists, the before/after commits (and PR number) are correct, and that Agent Gate has access if the repository is private.';
    }
    if (status === 401) {
      return 'GitHub access failed — the access token is missing, expired, or lacks permission to read this repository.';
    }
    if (status === 403) {
      return 'GitHub access was denied or rate-limited. Check repository permissions, or retry after the GitHub rate limit resets.';
    }
    if (code === 'ECONNABORTED' || /timeout/i.test(raw)) {
      return 'GitHub did not respond in time. This is usually transient — please retry shortly.';
    }
    return 'GitHub could not be reached for this check. Please retry; if the problem persists, verify the repository details and Agent Gate GitHub access.';
  }

  private async getDiff(owner: string, repo: string, before: string, after: string) {
    const start = Date.now();
    const response = await axios.get(
      `https://api.github.com/repos/${owner}/${repo}/compare/${before}...${after}`,
      { headers: this.headers(), timeout: 10000 },
    );
    return { data: response.data, durationMs: Date.now() - start };
  }

  // B1 — Work exists in the repo
  async checkWorkExists(owner: string, repo: string, before: string, after: string): Promise<CheckResult> {
    const start = Date.now();
    try {
      const { data } = await this.getDiff(owner, repo, before, after);
      const filesChanged: number = data.files?.length ?? 0;
      const aheadBy: number = data.ahead_by ?? 0;
      return {
        checkId: 'B1',
        checkName: CHECK_NAMES['B1'],
        tier: 'BASIC',
        status: filesChanged > 0 ? 'PASS' : 'FAIL',
        detail: filesChanged === 0 ? 'No files changed between the before and after commits. Diff is empty.' : `${filesChanged} files changed, ${aheadBy} commits ahead.`,
        evidence: { filesChanged, aheadBy },
        durationMs: Date.now() - start,
      };
    } catch (err: unknown) {
      return { checkId: 'B1', checkName: CHECK_NAMES['B1'], tier: 'BASIC', status: 'FAIL', detail: this.githubErrorDetail(err, 'B1'), durationMs: Date.now() - start };
    }
  }

  // B2 — Commit was made after the job started
  async checkCommitTiming(owner: string, repo: string, sha: string, jobStartedAt: Date): Promise<CheckResult> {
    const start = Date.now();
    try {
      const response = await axios.get(
        `https://api.github.com/repos/${owner}/${repo}/commits/${sha}`,
        { headers: this.headers(), timeout: 10000 },
      );
      // committer.date is server-set by GitHub and cannot be freely backdated by the committer.
      // author.date is user-controlled and can be set to any value with --date / --amend.
      const rawDate = (response.data.commit.committer?.date ?? response.data.commit.author?.date) as string;
      const commitDate = new Date(rawDate);
      const passed = commitDate > jobStartedAt;
      return {
        checkId: 'B2',
        checkName: CHECK_NAMES['B2'],
        tier: 'BASIC',
        status: passed ? 'PASS' : 'FAIL',
        detail: !passed
          ? `Commit was made BEFORE the job started. Commit: ${commitDate.toISOString()}, Job start: ${jobStartedAt.toISOString()}`
          : undefined,
        evidence: { commitDate: rawDate, jobStartedAt: jobStartedAt.toISOString() },
        durationMs: Date.now() - start,
      };
    } catch (err: unknown) {
      return { checkId: 'B2', checkName: CHECK_NAMES['B2'], tier: 'BASIC', status: 'FAIL', detail: this.githubErrorDetail(err, 'B2'), durationMs: Date.now() - start };
    }
  }

  // B3 — The right files were touched
  async checkFilesInScope(owner: string, repo: string, before: string, after: string, _jobDescription: string | undefined): Promise<CheckResult> {
    const start = Date.now();
    try {
      const { data } = await this.getDiff(owner, repo, before, after);
      const changedFiles: string[] = (data.files ?? []).map((f: { filename: string }) => f.filename);

      if (changedFiles.length === 0) {
        return { checkId: 'B3', checkName: CHECK_NAMES['B3'], tier: 'BASIC', status: 'FAIL', detail: 'No files changed — nothing to verify.', durationMs: Date.now() - start };
      }

      // Flag if ONLY doc/config files changed with no source changes
      const onlyDocChanges = changedFiles.every(f =>
        f.endsWith('.md') || f.endsWith('.txt') || f === 'package.json' || f === 'package-lock.json' || f === '.gitignore',
      );

      return {
        checkId: 'B3',
        checkName: CHECK_NAMES['B3'],
        tier: 'BASIC',
        status: onlyDocChanges ? 'WARNING' : 'PASS',
        detail: onlyDocChanges ? `Only documentation or config files changed: ${changedFiles.join(', ')}` : undefined,
        evidence: { changedFiles, fileCount: changedFiles.length },
        durationMs: Date.now() - start,
      };
    } catch (err: unknown) {
      return { checkId: 'B3', checkName: CHECK_NAMES['B3'], tier: 'BASIC', status: 'FAIL', detail: this.githubErrorDetail(err, 'B3'), durationMs: Date.now() - start };
    }
  }

  // B7 — If delivered via PR — PR is merged, not just opened
  async checkPrMerged(owner: string, repo: string, prNumber: number | undefined, jobStartedAt: Date): Promise<CheckResult> {
    const start = Date.now();
    if (!prNumber) {
      return { checkId: 'B7', checkName: CHECK_NAMES['B7'], tier: 'BASIC', status: 'SKIP', detail: 'No PR number provided — skipping PR merge check.', durationMs: Date.now() - start };
    }
    try {
      const response = await axios.get(
        `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`,
        { headers: this.headers(), timeout: 10000 },
      );
      const pr = response.data;
      const isMerged = pr.state === 'closed' && pr.merged === true;
      const mergedAt = pr.merged_at ? new Date(pr.merged_at as string) : null;
      const mergedAfterStart = mergedAt ? mergedAt > jobStartedAt : false;

      if (!isMerged) {
        return { checkId: 'B7', checkName: CHECK_NAMES['B7'], tier: 'BASIC', status: 'FAIL', detail: `PR #${prNumber} is ${pr.state} but NOT merged.`, evidence: { state: pr.state, merged: pr.merged }, durationMs: Date.now() - start };
      }
      if (!mergedAfterStart) {
        return { checkId: 'B7', checkName: CHECK_NAMES['B7'], tier: 'BASIC', status: 'FAIL', detail: `PR was merged BEFORE the job started. Merged at: ${pr.merged_at}, Job start: ${jobStartedAt.toISOString()}`, evidence: { merged_at: pr.merged_at }, durationMs: Date.now() - start };
      }
      return { checkId: 'B7', checkName: CHECK_NAMES['B7'], tier: 'BASIC', status: 'PASS', evidence: { state: pr.state, merged: pr.merged, merged_at: pr.merged_at }, durationMs: Date.now() - start };
    } catch (err: unknown) {
      return { checkId: 'B7', checkName: CHECK_NAMES['B7'], tier: 'BASIC', status: 'FAIL', detail: this.githubErrorDetail(err, 'B7'), durationMs: Date.now() - start };
    }
  }

  // S9 — CI/CD pipeline passed on the delivery commit
  async checkCiPassed(owner: string, repo: string, sha: string, jobStartedAt: Date): Promise<CheckResult> {
    const start = Date.now();
    try {
      const response = await axios.get(
        `https://api.github.com/repos/${owner}/${repo}/actions/runs`,
        { headers: this.headers(), params: { head_sha: sha, per_page: 10 }, timeout: 10000 },
      );
      const runs: Array<{
        id: number;
        status: string;
        conclusion: string | null;
        created_at: string;
        html_url: string;
        name: string;
      }> = response.data.workflow_runs ?? [];

      const relevantRuns = runs.filter(r => new Date(r.created_at) >= jobStartedAt);
      if (relevantRuns.length === 0) {
        return { checkId: 'S9', checkName: CHECK_NAMES['S9'], tier: 'STANDARD', status: 'WARNING', detail: 'No CI workflow run found for this commit after job start. CI may not be configured.', durationMs: Date.now() - start };
      }

      const latestRun = relevantRuns[0];
      const passed = latestRun.status === 'completed' && latestRun.conclusion === 'success';
      return {
        checkId: 'S9',
        checkName: CHECK_NAMES['S9'],
        tier: 'STANDARD',
        status: passed ? 'PASS' : latestRun.status === 'in_progress' ? 'WARNING' : 'FAIL',
        detail: !passed ? `CI run "${latestRun.name}" status: ${latestRun.status}, conclusion: ${latestRun.conclusion ?? 'pending'}` : undefined,
        evidence: { runId: latestRun.id, status: latestRun.status, conclusion: latestRun.conclusion, htmlUrl: latestRun.html_url },
        durationMs: Date.now() - start,
      };
    } catch (err: unknown) {
      return { checkId: 'S9', checkName: CHECK_NAMES['S9'], tier: 'STANDARD', status: 'FAIL', detail: this.githubErrorDetail(err, 'S9'), durationMs: Date.now() - start };
    }
  }

  // Helper: get the diff file list (used by other services)
  async getDiffFiles(owner: string, repo: string, before: string, after: string): Promise<string[]> {
    try {
      const { data } = await this.getDiff(owner, repo, before, after);
      return (data.files ?? []).map((f: { filename: string }) => f.filename);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status && status !== 404) {
        this.logger.warn(`getDiffFiles failed (HTTP ${status}) — security checks will be skipped. Check GITHUB_TOKEN configuration.`);
      }
      return [];
    }
  }

  // Helper: get raw diff text (used by security checks)
  async getDiffText(owner: string, repo: string, before: string, after: string): Promise<string> {
    try {
      const response = await axios.get(
        `https://api.github.com/repos/${owner}/${repo}/compare/${before}...${after}`,
        { headers: { ...this.headers(), Accept: 'application/vnd.github.v3.diff' }, timeout: 15000 },
      );
      return typeof response.data === 'string' ? response.data : '';
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status && status !== 404) {
        this.logger.warn(`getDiffText failed (HTTP ${status}) — security checks will be skipped. Check GITHUB_TOKEN configuration.`);
      }
      return '';
    }
  }
}
