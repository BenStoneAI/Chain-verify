import { Injectable, Logger } from '@nestjs/common';
import { execFile as execFileCb } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream/promises';
import axios from 'axios';
import type { CheckResult } from '../software-delivery.types.js';
import { CHECK_NAMES } from '../software-delivery.types.js';

const execFile = promisify(execFileCb);

// Allowlist of environment variables passed to the untrusted child process.
// CRITICAL (HKO H1): the sandbox runs `npm run <script>` from an arbitrary
// caller-supplied repo. Passing `...process.env` would hand every server
// secret (DATABASE_URL, STRIPE_SECRET_KEY, JWT_SECRET, AGENT_WALLET_ENCRYPTION_KEY,
// provider API keys, etc.) to attacker-controlled package.json scripts. Only
// the minimum needed to locate and run npm is forwarded; PATH plus a few
// Windows-only vars so npm.cmd resolves during local dev.
const SANDBOX_ENV_ALLOWLIST = [
  'PATH',
  'HOME',
  'LANG',
  'LC_ALL',
  'TMPDIR',
  'TEMP',
  'TMP',
  'SystemRoot',
  'APPDATA',
  'USERPROFILE',
  'ProgramData',
  'COMSPEC',
] as const;

function buildSandboxEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of SANDBOX_ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  // Force CI/test markers; never inherit ambient NODE_ENV or secrets.
  env.CI = 'true';
  env.NODE_ENV = 'test';
  return env;
}

type SandboxCheckId = 'B5' | 'S2' | 'S4' | 'S5';

const SCRIPT_CANDIDATES: Record<SandboxCheckId, string[]> = {
  B5: ['build', 'compile'],
  S2: ['test', 'test:unit', 'test:ci'],
  S4: ['typecheck', 'type-check', 'check-types'],
  S5: ['lint', 'lint:check', 'eslint'],
};

export interface SandboxRunOutcome {
  exitCode: number;
  script: string;
  stdout: string;
  stderr: string;
}

@Injectable()
export class BuildSandboxService {
  private readonly logger = new Logger(BuildSandboxService.name);

  isEnabled(): boolean {
    return process.env.BUILD_SANDBOX_ENABLED === 'true';
  }

  timeoutMs(): number {
    const parsed = Number(process.env.BUILD_SANDBOX_TIMEOUT_MS ?? '120000');
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 120_000;
  }

  /** Attempt local script execution when CI did not publish a matching check. */
  async runCheck(
    owner: string,
    repo: string,
    sha: string,
    checkId: SandboxCheckId,
  ): Promise<CheckResult | null> {
    if (!this.isEnabled()) return null;

    const start = Date.now();
    const tier = checkId === 'B5' ? 'BASIC' : 'STANDARD';
    const base = {
      checkId,
      checkName: CHECK_NAMES[checkId],
      tier,
    } as const;

    try {
      const outcome = await this.runBestScript(owner, repo, sha, checkId);
      if (!outcome) {
        return {
          ...base,
          status: 'SKIP',
          detail: `Build sandbox enabled but no ${checkId} script found in package.json.`,
          durationMs: Date.now() - start,
        };
      }

      if (outcome.exitCode === 0) {
        return {
          ...base,
          status: 'PASS',
          detail: `Local sandbox ran \`npm run ${outcome.script}\` successfully.`,
          evidence: { sandbox: true, script: outcome.script },
          durationMs: Date.now() - start,
        };
      }

      return {
        ...base,
        status: 'FAIL',
        detail: `Local sandbox \`npm run ${outcome.script}\` exited with code ${outcome.exitCode}.`,
        evidence: {
          sandbox: true,
          script: outcome.script,
          stderr: outcome.stderr.slice(0, 500),
        },
        durationMs: Date.now() - start,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Build sandbox ${checkId} failed for ${owner}/${repo}@${sha}: ${message}`);
      return {
        ...base,
        status: 'WARNING',
        detail: `Build sandbox could not complete: ${message}`,
        durationMs: Date.now() - start,
      };
    }
  }

  private async runBestScript(
    owner: string,
    repo: string,
    sha: string,
    checkId: SandboxCheckId,
  ): Promise<SandboxRunOutcome | null> {
    const workDir = await mkdtemp(join(tmpdir(), 'verify-build-'));
    try {
      const archivePath = join(workDir, 'repo.tar.gz');
      await this.downloadTarball(owner, repo, sha, archivePath);
      await execFile('tar', ['-xzf', archivePath, '-C', workDir], { timeout: 60_000 });
      const repoRoot = await this.findExtractedRoot(workDir);
      const scripts = await this.readPackageScripts(repoRoot);
      const scriptName = SCRIPT_CANDIDATES[checkId].find((name) => scripts[name]);
      if (!scriptName) return null;

      const { stdout, stderr } = await execFile(
        process.platform === 'win32' ? 'npm.cmd' : 'npm',
        ['run', scriptName, '--if-present'],
        {
          cwd: repoRoot,
          timeout: this.timeoutMs(),
          maxBuffer: 1024 * 1024,
          // Scrubbed env — no server secrets reach the untrusted repo (HKO H1).
          env: buildSandboxEnv(),
        },
      );

      return { exitCode: 0, script: scriptName, stdout, stderr };
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err) {
        const execErr = err as { code?: number | string; stdout?: string; stderr?: string };
        if (typeof execErr.code === 'number') {
          return {
            exitCode: execErr.code,
            script: SCRIPT_CANDIDATES[checkId][0],
            stdout: execErr.stdout ?? '',
            stderr: execErr.stderr ?? '',
          };
        }
      }
      throw err;
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async downloadTarball(owner: string, repo: string, sha: string, dest: string): Promise<void> {
    const token = process.env.GITHUB_TOKEN ?? '';
    const response = await axios.get(
      `https://api.github.com/repos/${owner}/${repo}/tarball/${sha}`,
      {
        headers: {
          Authorization: token ? `Bearer ${token}` : undefined,
          Accept: 'application/vnd.github+json',
        },
        responseType: 'stream',
        timeout: 60_000,
        maxRedirects: 5,
      },
    );
    await pipeline(response.data, createWriteStream(dest));
  }

  private async findExtractedRoot(workDir: string): Promise<string> {
    const entries = await readdir(workDir, { withFileTypes: true });
    const dir = entries.find((e) => e.isDirectory() && !e.name.endsWith('.tar.gz'));
    if (!dir) throw new Error('Could not locate extracted repository root');
    return join(workDir, dir.name);
  }

  private async readPackageScripts(repoRoot: string): Promise<Record<string, string>> {
    const raw = await readFile(join(repoRoot, 'package.json'), 'utf8');
    const parsed = JSON.parse(raw) as { scripts?: Record<string, string> };
    return parsed.scripts ?? {};
  }
}
