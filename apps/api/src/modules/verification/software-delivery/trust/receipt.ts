/**
 * Agent Gate receipt validation.
 *
 * Re-implements agentgate/receipt.py (canonical JSON, receipt id, Ed25519
 * signature) and the binding checks of agentgate/verify.py (`_sha_match`,
 * `_run_matches`, staleness) for receipts submitted as ADDITIONAL evidence.
 *
 * A receipt contributes OBSERVED_BY_AGENT_GATE evidence only when every one of
 * these holds: the id is the hash of the body; the signature verifies against
 * a key in the server-side trust store (a key that arrived inside the request
 * is never trusted); the receipt HEAD equals the requested afterSha; the
 * receipt repository equals repoOwner/repoName; and it is younger than the
 * configured maximum age. Anything else yields typed findings and NO observed
 * evidence.
 */
import { createPublicKey, verify as cryptoVerify, type KeyObject } from 'node:crypto';
import {
  CanonicalizationError,
  canonicalJsonBytes,
  sha256Hex,
} from './canonical-json.js';
import { shasMatch, shortSha } from './sha.js';
import { receiptMaxAgeHours } from './trust-config.js';

// ASN.1 prefix of an Ed25519 SubjectPublicKeyInfo; the 32 raw key bytes follow.
const ED25519_SPKI_DER_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const DERIVED_FIELDS = ['receipt_id', 'signature'] as const;
// Run recorders AgentGate accepts as "the gate itself observed this".
const GATE_RECORDERS = new Set(['gate', 'ci']);
const MAX_CANONICAL_BYTES = 2_000_000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_COMMANDS = 50;
const MAX_COMMAND_LENGTH = 1000;
const STRICT_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const RAW_KEY_HEX = /^[0-9a-fA-F]{64}$/;

// ---------------------------------------------------------------- trust store

export interface TrustedReceiptKey {
  /** 64 hex chars (32-byte raw Ed25519 public key). */
  publicKeyHex: string;
  /** AgentGate key id: "kid_" + sha256(raw public key)[:12]. */
  kid: string;
}

export interface ReceiptTrustStore {
  /**
   * Public keys this deployment trusts to sign Agent Gate receipts. Keys come
   * from operator configuration (or an operator-managed table) and never from
   * the request being verified.
   */
  trustedKeys(context?: { organizationId?: string | null }): TrustedReceiptKey[];
}

export function keyIdForPublicKey(rawPublicKey: Buffer): string {
  return `kid_${sha256Hex(rawPublicKey).slice(0, 12)}`;
}

function toTrustedKey(hex: string): TrustedReceiptKey | null {
  const trimmed = hex.trim();
  if (!RAW_KEY_HEX.test(trimmed)) return null;
  const raw = Buffer.from(trimmed, 'hex');
  return { publicKeyHex: trimmed.toLowerCase(), kid: keyIdForPublicKey(raw) };
}

/** Parses a comma-separated list of hex public keys; malformed entries are dropped and counted. */
export function parseTrustedKeyList(raw: string | undefined): {
  keys: TrustedReceiptKey[];
  malformed: number;
} {
  if (!raw) return { keys: [], malformed: 0 };
  const keys: TrustedReceiptKey[] = [];
  let malformed = 0;
  for (const entry of raw.split(',')) {
    if (entry.trim() === '') continue;
    const key = toTrustedKey(entry);
    if (key) keys.push(key);
    else malformed += 1;
  }
  return { keys, malformed };
}

/** Default store: AGENT_GATE_TRUSTED_RECEIPT_KEYS, read on every call. */
export class EnvReceiptTrustStore implements ReceiptTrustStore {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  trustedKeys(): TrustedReceiptKey[] {
    return parseTrustedKeyList(this.env['AGENT_GATE_TRUSTED_RECEIPT_KEYS']).keys;
  }
}

/** Fixed key list, for tests and for callers that load keys from elsewhere. */
export class StaticReceiptTrustStore implements ReceiptTrustStore {
  private readonly keys: TrustedReceiptKey[];

  constructor(publicKeyHexes: string[]) {
    this.keys = publicKeyHexes
      .map((hex) => toTrustedKey(hex))
      .filter((k): k is TrustedReceiptKey => k !== null);
  }

  trustedKeys(): TrustedReceiptKey[] {
    return this.keys;
  }
}

// ------------------------------------------------------------------ hashing

export function receiptBody(receipt: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const key of Object.keys(receipt)) {
    if (!(DERIVED_FIELDS as readonly string[]).includes(key)) body[key] = receipt[key];
  }
  return body;
}

/** `"rcpt_" + sha256(canonical(body))[:16]`, body excluding receipt_id and signature. */
export function computeReceiptId(receipt: Record<string, unknown>): string {
  return `rcpt_${sha256Hex(canonicalJsonBytes(receiptBody(receipt))).slice(0, 16)}`;
}

export function ed25519PublicKeyFromRaw(raw: Buffer): KeyObject {
  if (raw.length !== 32) throw new TypeError('Ed25519 public key must be 32 bytes');
  return createPublicKey({
    key: Buffer.concat([ED25519_SPKI_DER_PREFIX, raw]),
    format: 'der',
    type: 'spki',
  });
}

// -------------------------------------------------------------------- types

export type ReceiptFindingCode =
  | 'RECEIPT_MALFORMED'
  | 'CANONICALIZATION_FAILED'
  | 'HASH_MISMATCH'
  | 'SIGNATURE_ABSENT'
  | 'SIGNATURE_MALFORMED'
  | 'SIGNATURE_INVALID'
  | 'KEY_UNTRUSTED'
  | 'NO_TRUSTED_KEYS'
  | 'HEAD_MISSING'
  | 'HEAD_MISMATCH'
  | 'REPO_UNVERIFIABLE'
  | 'REPO_MISMATCH'
  | 'CREATED_AT_INVALID'
  | 'CREATED_AT_IN_FUTURE'
  | 'RECEIPT_STALE'
  | 'TREE_DIRTY'
  | 'NO_REQUIRED_TESTS'
  | 'TEST_NOT_RUN'
  | 'TEST_NOT_GATE_RECORDED'
  | 'TEST_TREE_MISMATCH'
  | 'TEST_DIRTY_STATE_MISMATCH'
  | 'TEST_TIMESTAMP_INVALID'
  | 'TEST_FAILED'
  | 'TEST_SUSPICIOUS';

export interface ReceiptFinding {
  code: ReceiptFindingCode;
  severity: 'FAIL' | 'WARNING';
  message: string;
}

export interface ObservedTestRun {
  runId: string | null;
  cmd: string;
  exitCode: 0;
  finishedAt: string | null;
  stdoutSha256: string | null;
  summary: string | null;
}

export interface ReceiptValidation {
  submitted: boolean;
  receiptId: string | null;
  /** Recomputed id equals recorded id and the body is canonicalizable. */
  integrityOk: boolean;
  /** Signature verified against a key in the server-side trust store. */
  signatureTrusted: boolean;
  signingKeyId: string | null;
  /** HEAD equals afterSha and repository equals repoOwner/repoName. */
  bindingOk: boolean;
  /** created_at present, not future-dated, within the maximum age. */
  fresh: boolean;
  /** Every integrity/trust/binding/freshness check passed. */
  accepted: boolean;
  /** accepted AND clean tree AND every required command has a matching clean run. */
  testsObserved: boolean;
  observedTests: ObservedTestRun[];
  /** Command strings carried by the receipt (trusted or not), for suppression scanning. */
  submittedCommands: string[];
  status: 'PASS' | 'FAIL' | 'WARNING' | 'SKIP';
  findings: ReceiptFinding[];
  headSha: string | null;
  createdAt: string | null;
  repository: string | null;
}

export interface ReceiptValidationContext {
  afterSha: string;
  repoOwner: string;
  repoName: string;
  now: Date;
  trustStore: ReceiptTrustStore;
  organizationId?: string | null;
  maxAgeHours?: number;
}

// ------------------------------------------------------------------ helpers

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** github.com remote -> owner/name. Anchored so "evilgithub.com" does not parse. */
export function parseGithubRemote(remote: unknown): { owner: string; name: string } | null {
  if (typeof remote !== 'string') return null;
  const m = /(?:^|[@/]|www\.)github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(remote.trim());
  return m ? { owner: m[1], name: m[2] } : null;
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value !== 'string' || value === '') return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/** The validation result for a request that carried no receipt. */
export function notSubmittedReceipt(): ReceiptValidation {
  return {
    submitted: false,
    receiptId: null,
    integrityOk: false,
    signatureTrusted: false,
    signingKeyId: null,
    bindingOk: false,
    fresh: false,
    accepted: false,
    testsObserved: false,
    observedTests: [],
    submittedCommands: [],
    status: 'SKIP',
    findings: [],
    headSha: null,
    createdAt: null,
    repository: null,
  };
}

function collectCommands(receipt: Record<string, unknown>): string[] {
  const tests = isRecord(receipt['tests']) ? receipt['tests'] : {};
  const out: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === 'string' && v.length > 0 && out.length < MAX_COMMANDS) {
      out.push(v.slice(0, MAX_COMMAND_LENGTH));
    }
  };
  if (Array.isArray(tests['required'])) tests['required'].forEach(push);
  if (Array.isArray(tests['runs'])) {
    for (const run of tests['runs']) if (isRecord(run)) push(run['cmd']);
  }
  return [...new Set(out)];
}

function redactRemote(remote: string): string {
  return remote.replace(/\/\/[^/@\s]+@/, '//');
}

// ---------------------------------------------------------------- validation

export function validateAgentGateReceipt(
  input: unknown,
  ctx: ReceiptValidationContext,
): ReceiptValidation {
  if (input === undefined || input === null) return notSubmittedReceipt();

  const result = notSubmittedReceipt();
  result.submitted = true;
  const findings: ReceiptFinding[] = [];
  const add = (code: ReceiptFindingCode, severity: 'FAIL' | 'WARNING', message: string) =>
    findings.push({ code, severity, message });

  const finish = (): ReceiptValidation => {
    result.findings = findings;
    result.accepted =
      result.integrityOk && result.signatureTrusted && result.bindingOk && result.fresh;
    if (!result.accepted) result.testsObserved = false;
    if (findings.some((f) => f.severity === 'FAIL')) result.status = 'FAIL';
    else if (findings.length > 0) result.status = 'WARNING';
    else result.status = 'PASS';
    if (!result.accepted) result.observedTests = [];
    return result;
  };

  if (!isRecord(input)) {
    add('RECEIPT_MALFORMED', 'FAIL', 'The submitted Agent Gate receipt is not a JSON object.');
    return finish();
  }
  const receipt = input;
  result.receiptId = asString(receipt['receipt_id']);
  result.submittedCommands = collectCommands(receipt);

  // 1. Hash: id must be the hash of the body.
  let bodyBytes: Buffer | null = null;
  try {
    bodyBytes = canonicalJsonBytes(receiptBody(receipt));
    if (bodyBytes.length > MAX_CANONICAL_BYTES) {
      bodyBytes = null;
      add('RECEIPT_MALFORMED', 'FAIL', 'The submitted Agent Gate receipt exceeds the maximum accepted size.');
    }
  } catch (err) {
    if (err instanceof CanonicalizationError) {
      add('CANONICALIZATION_FAILED', 'FAIL', `The receipt cannot be canonicalized: ${err.message}`);
    } else {
      throw err;
    }
  }
  if (bodyBytes) {
    const expected = `rcpt_${sha256Hex(bodyBytes).slice(0, 16)}`;
    if (result.receiptId === expected) {
      result.integrityOk = true;
    } else {
      add(
        'HASH_MISMATCH',
        'FAIL',
        `receipt_id mismatch: recorded ${result.receiptId ?? 'none'}, recomputed ${expected}. The receipt body was altered or the id is wrong.`,
      );
    }
  }

  // 2. Signature against a TRUSTED key only.
  const sig = receipt['signature'];
  if (sig === undefined || sig === null) {
    add(
      'SIGNATURE_ABSENT',
      'WARNING',
      'The receipt is unsigned. An unsigned receipt cannot be attributed to Agent Gate and is not accepted as observed evidence.',
    );
  } else {
    const sigRecord = isRecord(sig) ? sig : null;
    const sigB64 = sigRecord ? asString(sigRecord['sig']) : null;
    const sigBytes = sigB64 && STRICT_BASE64.test(sigB64) ? Buffer.from(sigB64, 'base64') : null;
    if (!sigRecord || sigRecord['alg'] !== 'ed25519' || !sigBytes || sigBytes.length !== 64) {
      add('SIGNATURE_MALFORMED', 'FAIL', 'The receipt signature is not a well-formed ed25519 signature.');
    } else {
      const trusted = ctx.trustStore.trustedKeys({ organizationId: ctx.organizationId ?? null });
      const claimedKid = asString(sigRecord['kid']);
      if (trusted.length === 0) {
        add(
          'NO_TRUSTED_KEYS',
          'WARNING',
          'No trusted Agent Gate receipt signing keys are configured, so the signature cannot be verified.',
        );
      } else if (!bodyBytes) {
        // Body could not be canonicalized; nothing to verify the signature over.
      } else {
        let verifiedBy: TrustedReceiptKey | null = null;
        for (const key of trusted) {
          try {
            const publicKey = ed25519PublicKeyFromRaw(Buffer.from(key.publicKeyHex, 'hex'));
            if (cryptoVerify(null, bodyBytes, publicKey, sigBytes)) {
              verifiedBy = key;
              break;
            }
          } catch {
            // unusable key entry: try the next one
          }
        }
        if (verifiedBy) {
          result.signatureTrusted = true;
          result.signingKeyId = verifiedBy.kid;
        } else if (claimedKid && trusted.some((k) => k.kid === claimedKid)) {
          add(
            'SIGNATURE_INVALID',
            'FAIL',
            `The receipt claims trusted key ${claimedKid} but its signature does not verify. The receipt was forged or altered.`,
          );
        } else {
          add(
            'KEY_UNTRUSTED',
            'WARNING',
            `The receipt is signed with key ${claimedKid ?? 'with no key id'}, which is not in this deployment's trusted receipt keys. It is treated as customer-submitted, not observed.`,
          );
        }
      }
    }
  }

  // 3. Binding: HEAD and repository.
  const repo = isRecord(receipt['repo']) ? receipt['repo'] : {};
  result.headSha = asString(repo['head_sha']);
  let headOk = false;
  if (!result.headSha) {
    add('HEAD_MISSING', 'FAIL', 'The receipt records no repo.head_sha, so it cannot be bound to a commit.');
  } else if (!shasMatch(result.headSha, ctx.afterSha)) {
    add(
      'HEAD_MISMATCH',
      'FAIL',
      `Receipt HEAD ${shortSha(result.headSha)} does not equal the requested afterSha ${shortSha(ctx.afterSha)}.`,
    );
  } else {
    headOk = true;
  }

  const remote = asString(repo['remote']);
  const parsedRemote = parseGithubRemote(remote);
  let repoOk = false;
  if (!parsedRemote) {
    add(
      'REPO_UNVERIFIABLE',
      'WARNING',
      remote
        ? `The receipt remote (${redactRemote(remote)}) is not a recognizable GitHub repository, so the repository identity cannot be confirmed.`
        : 'The receipt records no repository remote, so the repository identity cannot be confirmed.',
    );
  } else {
    result.repository = `${parsedRemote.owner}/${parsedRemote.name}`;
    if (
      parsedRemote.owner.toLowerCase() !== ctx.repoOwner.trim().toLowerCase() ||
      parsedRemote.name.toLowerCase() !== ctx.repoName.trim().toLowerCase()
    ) {
      add(
        'REPO_MISMATCH',
        'FAIL',
        `Receipt repository ${result.repository} does not equal the requested repository ${ctx.repoOwner}/${ctx.repoName}.`,
      );
    } else {
      repoOk = true;
    }
  }
  result.bindingOk = headOk && repoOk;

  // 4. Freshness.
  const createdMs = parseTimestamp(receipt['created_at']);
  result.createdAt = asString(receipt['created_at']);
  const maxAgeHours = ctx.maxAgeHours ?? receiptMaxAgeHours();
  if (createdMs === null) {
    add('CREATED_AT_INVALID', 'WARNING', 'The receipt has no valid created_at timestamp, so its age cannot be established.');
  } else if (createdMs - ctx.now.getTime() > CLOCK_SKEW_MS) {
    add('CREATED_AT_IN_FUTURE', 'WARNING', `The receipt created_at (${result.createdAt}) is in the future.`);
  } else if (ctx.now.getTime() - createdMs > maxAgeHours * 3_600_000) {
    add(
      'RECEIPT_STALE',
      'WARNING',
      `The receipt was created ${result.createdAt}, which is older than the ${maxAgeHours}-hour limit.`,
    );
  } else {
    result.fresh = true;
  }

  // 5. Executed tests. Only evaluated for a receipt that is otherwise accepted:
  //    test results inside an untrusted receipt are claims, not evidence.
  const accepted = result.integrityOk && result.signatureTrusted && result.bindingOk && result.fresh;
  if (accepted) {
    evaluateTests(receipt, repo, createdMs, result, add);
  }

  return finish();
}

function evaluateTests(
  receipt: Record<string, unknown>,
  repo: Record<string, unknown>,
  createdMs: number | null,
  result: ReceiptValidation,
  add: (code: ReceiptFindingCode, severity: 'FAIL' | 'WARNING', message: string) => void,
): void {
  let ok = true;

  if (repo['tree_clean'] !== true) {
    add('TREE_DIRTY', 'WARNING', 'The receipt was produced from a working tree with uncommitted changes, so its test runs do not describe the committed code.');
    ok = false;
  }

  const tests = isRecord(receipt['tests']) ? receipt['tests'] : {};
  const required = (Array.isArray(tests['required']) ? tests['required'] : []).filter(
    (c): c is string => typeof c === 'string' && c.length > 0,
  );
  const runs = (Array.isArray(tests['runs']) ? tests['runs'] : []).filter(isRecord);

  if (required.length === 0) {
    add('NO_REQUIRED_TESTS', 'WARNING', 'The receipt lists no required test commands, so nothing in it proves tests were executed.');
    ok = false;
  }

  const observed: ObservedTestRun[] = [];
  for (const cmd of required) {
    let matched: ObservedTestRun | null = null;
    let bestCode: ReceiptFindingCode = 'TEST_NOT_RUN';
    let bestMessage = `Required command ${JSON.stringify(cmd)} has no recorded run in the receipt.`;
    let bestSeverity: 'FAIL' | 'WARNING' = 'WARNING';

    for (const run of runs) {
      if (run['cmd'] !== cmd) continue;
      const why = explainRunMismatch(run, repo, createdMs);
      if (!why) {
        matched = {
          runId: asString(run['run_id']),
          cmd,
          exitCode: 0,
          finishedAt: asString(run['finished_at']),
          stdoutSha256: asString(run['stdout_sha256']),
          summary: asString(run['summary']),
        };
        break;
      }
      bestCode = why.code;
      bestMessage = `Required command ${JSON.stringify(cmd)}: ${why.message}`;
      bestSeverity = why.severity;
    }

    if (matched) observed.push(matched);
    else {
      add(bestCode, bestSeverity, bestMessage);
      ok = false;
    }
  }

  if (ok) {
    result.testsObserved = true;
    result.observedTests = observed;
  } else {
    result.testsObserved = false;
    result.observedTests = [];
  }
}

/** Port of verify._run_matches (plus the suspicious flag). Returns null when the run counts. */
function explainRunMismatch(
  run: Record<string, unknown>,
  repo: Record<string, unknown>,
  receiptCreatedMs: number | null,
): { code: ReceiptFindingCode; severity: 'FAIL' | 'WARNING'; message: string } | null {
  const recordedBy = run['recorded_by'];
  if (typeof recordedBy !== 'string' || !GATE_RECORDERS.has(recordedBy)) {
    return {
      code: 'TEST_NOT_GATE_RECORDED',
      severity: 'WARNING',
      message: 'the run was not recorded by the gate (a claim, not evidence).',
    };
  }
  if (typeof run['tree_sha'] !== 'string' || run['tree_sha'] !== repo['tree_sha']) {
    return {
      code: 'TEST_TREE_MISMATCH',
      severity: 'WARNING',
      message: `the run tree ${shortSha(run['tree_sha'])} differs from the receipt tree ${shortSha(repo['tree_sha'])}.`,
    };
  }
  if (typeof run['dirty_hash'] !== 'string' || run['dirty_hash'] !== repo['dirty_hash']) {
    return {
      code: 'TEST_DIRTY_STATE_MISMATCH',
      severity: 'WARNING',
      message: 'the working-tree state when the run finished differs from the receipt tree state.',
    };
  }
  const finishedMs = parseTimestamp(run['finished_at']);
  if (finishedMs === null || (receiptCreatedMs !== null && finishedMs - receiptCreatedMs > CLOCK_SKEW_MS)) {
    return {
      code: 'TEST_TIMESTAMP_INVALID',
      severity: 'WARNING',
      message: 'the run has no valid finish time, or it finished after the receipt was created.',
    };
  }
  if (run['exit_code'] !== 0) {
    return {
      code: 'TEST_FAILED',
      severity: 'FAIL',
      message: `the run exited with code ${String(run['exit_code'])}.`,
    };
  }
  if (run['suspicious'] === true) {
    const reasons = Array.isArray(run['suspicion_reasons'])
      ? run['suspicion_reasons'].filter((r): r is string => typeof r === 'string').slice(0, 3)
      : [];
    return {
      code: 'TEST_SUSPICIOUS',
      severity: 'WARNING',
      message: `the run was flagged suspicious by the gate${reasons.length ? `: ${reasons.join('; ')}` : ''}.`,
    };
  }
  return null;
}
