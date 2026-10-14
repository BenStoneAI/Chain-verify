/**
 * Agent Gate receipt validation: canonical JSON, receipt id, Ed25519
 * signature against a TRUSTED key, HEAD / repo binding, freshness and
 * executed-test evidence. No network, no database. Keys are generated in-test;
 * the golden receipt was produced by AgentGate's Python implementation
 * (agentgate/receipt.py via `python -I`), so a pass here proves byte-level
 * compatibility with the real signer.
 */
import { generateKeyPairSync, sign as cryptoSign, type KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CanonicalizationError,
  EnvReceiptTrustStore,
  StaticReceiptTrustStore,
  buildReceiptCheck,
  canonicalJson,
  canonicalJsonBytes,
  computeReceiptId,
  keyIdForPublicKey,
  parseGithubRemote,
  parseTrustedKeyList,
  receiptBody,
  sha256Hex,
  shasMatch,
  validateAgentGateReceipt,
  type ReceiptValidationContext,
} from '../trust/index.js';

// ------------------------------------------------------------------ helpers

interface TestKey {
  privateKey: KeyObject;
  publicKeyHex: string;
  kid: string;
}

function makeKey(): TestKey {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const spki = publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
  const raw = spki.subarray(spki.length - 32);
  return { privateKey, publicKeyHex: raw.toString('hex'), kid: keyIdForPublicKey(raw) };
}

const OWNER = 'acme';
const NAME = 'widgets';
const HEAD = '9f8e7d6c5b4a39281706f5e4d3c2b1a098765432';
const TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const DIRTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const NOW = new Date('2026-10-14T12:30:00.000Z');

type Obj = Record<string, unknown>;

function body(overrides: Obj = {}): Obj {
  return {
    receipt_version: '0.1',
    created_at: '2026-10-14T12:00:00.000000Z',
    gate: { tool: 'agentgate', version: '0.1.0', host: 'dev-box', signing_key_id: null },
    repo: {
      remote: `https://github.com/${OWNER}/${NAME}.git`,
      root: '/work/widgets',
      branch: 'main',
      base_sha: '1'.repeat(40),
      head_sha: HEAD,
      tree_sha: TREE,
      dirty_hash: DIRTY,
      tree_clean: true,
      pushed: true,
    },
    changed_files: ['src/invoice.ts'],
    tests: {
      required: ['npm test'],
      runs: [
        {
          run_id: 'run_1',
          cmd: 'npm test',
          started_at: '2026-10-14T11:59:00.000000Z',
          finished_at: '2026-10-14T11:59:30.000000Z',
          exit_code: 0,
          tree_sha: TREE,
          dirty_hash: DIRTY,
          stdout_sha256: 'b'.repeat(64),
          summary: '12 passed',
          recorded_by: 'gate',
          suspicious: false,
          suspicion_reasons: [],
        },
      ],
    },
    status: { computed: 'TESTED', reasons: {} },
    ...overrides,
  };
}

function seal(b: Obj, key: TestKey | null, kid?: string): Obj {
  const out: Obj = { ...receiptBody(b) };
  out['receipt_id'] = computeReceiptId(out);
  if (key) {
    const sig = cryptoSign(null, canonicalJsonBytes(receiptBody(out)), key.privateKey);
    out['signature'] = { alg: 'ed25519', kid: kid ?? key.kid, sig: sig.toString('base64') };
  }
  return out;
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function repoWith(overrides: Obj): Obj {
  return { ...(body()['repo'] as Obj), ...overrides };
}

function runWith(overrides: Obj): Obj {
  const tests = body()['tests'] as { required: string[]; runs: Obj[] };
  return { required: tests.required, runs: [{ ...tests.runs[0], ...overrides }] };
}

const trusted = makeKey();
const other = makeKey();

function ctx(overrides: Partial<ReceiptValidationContext> = {}): ReceiptValidationContext {
  return {
    afterSha: HEAD,
    repoOwner: OWNER,
    repoName: NAME,
    now: NOW,
    trustStore: new StaticReceiptTrustStore([trusted.publicKeyHex]),
    ...overrides,
  };
}

function codes(v: { findings: Array<{ code: string }> }): string[] {
  return v.findings.map((f) => f.code);
}

// ------------------------------------------------------------ golden / python

describe('golden receipt produced by the Python AgentGate implementation', () => {
  const golden = JSON.parse(
    readFileSync(fileURLToPath(new URL('./fixtures/agentgate-golden-receipt.json', import.meta.url)), 'utf8'),
  ) as {
    public_key_hex: string;
    kid: string;
    receipt_id: string;
    body_sha256: string;
    receipt: Obj;
    canonical_cases: Array<{ input: unknown; canonical: string }>;
  };

  it('canonical JSON is byte-identical to Python canonical_json, including code-point key order', () => {
    expect(golden.canonical_cases.length).toBeGreaterThanOrEqual(3);
    for (const c of golden.canonical_cases) {
      expect(canonicalJson(c.input)).toBe(c.canonical);
    }
  });

  it('recomputes the same receipt id and body hash as Python', () => {
    expect(computeReceiptId(golden.receipt)).toBe(golden.receipt_id);
    expect(sha256Hex(canonicalJsonBytes(receiptBody(golden.receipt)))).toBe(golden.body_sha256);
  });

  it('verifies the Python-made Ed25519 signature against its public key (DER SPKI built from raw bytes)', () => {
    const store = new StaticReceiptTrustStore([golden.public_key_hex]);
    expect(store.trustedKeys()[0].kid).toBe(golden.kid);
    const v = validateAgentGateReceipt(
      golden.receipt,
      ctx({ trustStore: store, afterSha: String((golden.receipt['repo'] as Obj)['head_sha']), repoOwner: 'acme', repoName: 'widgets' }),
    );
    expect(v.integrityOk).toBe(true);
    expect(v.signatureTrusted).toBe(true);
    expect(v.signingKeyId).toBe(golden.kid);
    expect(v.accepted).toBe(true);
    expect(v.testsObserved).toBe(true);
    expect(v.status).toBe('PASS');
  });

  it('rejects the golden receipt when its signing key is not in the trust store', () => {
    const v = validateAgentGateReceipt(
      golden.receipt,
      ctx({ afterSha: String((golden.receipt['repo'] as Obj)['head_sha']) }),
    );
    expect(v.signatureTrusted).toBe(false);
    expect(v.accepted).toBe(false);
    expect(codes(v)).toContain('KEY_UNTRUSTED');
  });
});

describe('canonical JSON rules', () => {
  it('sorts keys, drops whitespace and emits UTF-8 text unescaped', () => {
    expect(canonicalJson({ b: [1, { z: 'é', a: null }], a: true })).toBe('{"a":true,"b":[1,{"a":null,"z":"é"}]}');
  });

  it('is key-order independent', () => {
    expect(canonicalJson({ x: 1, y: 2 })).toBe(canonicalJson({ y: 2, x: 1 }));
  });

  it('rejects non-integral floats, NaN and Infinity', () => {
    expect(() => canonicalJson({ a: 1.5 })).toThrow(CanonicalizationError);
    expect(() => canonicalJson({ a: Number.NaN })).toThrow(CanonicalizationError);
    expect(() => canonicalJson({ a: Number.POSITIVE_INFINITY })).toThrow(CanonicalizationError);
  });

  it('rejects undefined and functions rather than silently dropping them', () => {
    expect(() => canonicalJson({ a: undefined })).toThrow(CanonicalizationError);
    expect(() => canonicalJson({ a: () => 1 })).toThrow(CanonicalizationError);
  });

  it('receipt id excludes receipt_id and signature, so adding a signature does not change it', () => {
    const sealed = seal(body(), null);
    const id = computeReceiptId(sealed);
    expect(id).toMatch(/^rcpt_[0-9a-f]{16}$/);
    expect(computeReceiptId({ ...sealed, signature: { alg: 'x', sig: 'y' } })).toBe(id);
  });
});

// ------------------------------------------------------------------ trust

describe('receipt validation', () => {
  it('accepts a valid receipt signed by a trusted key and reports the executed tests as observed', () => {
    const receipt = seal(body(), trusted);
    const v = validateAgentGateReceipt(receipt, ctx());
    expect(v.status).toBe('PASS');
    expect(v.integrityOk).toBe(true);
    expect(v.signatureTrusted).toBe(true);
    expect(v.signingKeyId).toBe(trusted.kid);
    expect(v.bindingOk).toBe(true);
    expect(v.fresh).toBe(true);
    expect(v.accepted).toBe(true);
    expect(v.testsObserved).toBe(true);
    expect(v.observedTests).toEqual([
      expect.objectContaining({ cmd: 'npm test', exitCode: 0, runId: 'run_1' }),
    ]);
    expect(v.findings).toEqual([]);
  });

  it('reports no receipt as not submitted', () => {
    const v = validateAgentGateReceipt(undefined, ctx());
    expect(v.submitted).toBe(false);
    expect(v.status).toBe('SKIP');
    expect(buildReceiptCheck(v).status).toBe('SKIP');
  });

  it('rejects a tampered body: hash mismatch, nothing observed', () => {
    // A genuinely failed run, sealed and signed by the gate ...
    const receipt = clone(seal(body({ tests: runWith({ exit_code: 1 }) }), trusted));
    // ... then edited by the customer to look like it passed.
    ((receipt['tests'] as Obj)['runs'] as Obj[])[0]['exit_code'] = 0;
    const v = validateAgentGateReceipt(receipt, ctx());
    expect(codes(v)).toContain('HASH_MISMATCH');
    expect(v.integrityOk).toBe(false);
    expect(v.accepted).toBe(false);
    expect(v.testsObserved).toBe(false);
    expect(v.observedTests).toEqual([]);
    expect(v.status).toBe('FAIL');
  });

  it('rejects a forged body that was re-hashed but not re-signed: invalid signature', () => {
    const receipt = clone(seal(body(), trusted));
    (receipt['repo'] as Obj)['branch'] = 'forged';
    receipt['receipt_id'] = computeReceiptId(receipt); // attacker fixes the id
    const v = validateAgentGateReceipt(receipt, ctx());
    expect(v.integrityOk).toBe(true);
    expect(codes(v)).toEqual(['SIGNATURE_INVALID']);
    expect(v.accepted).toBe(false);
    expect(v.status).toBe('FAIL');
  });

  it('rejects an invalid signature that claims a trusted key id', () => {
    const receipt = clone(seal(body(), trusted));
    const sig = receipt['signature'] as Obj;
    const bytes = Buffer.from(String(sig['sig']), 'base64');
    bytes[0] ^= 0xff;
    sig['sig'] = bytes.toString('base64');
    const v = validateAgentGateReceipt(receipt, ctx());
    expect(codes(v)).toContain('SIGNATURE_INVALID');
    expect(v.signatureTrusted).toBe(false);
    expect(v.accepted).toBe(false);
  });

  it('flags a malformed signature object', () => {
    const receipt = clone(seal(body(), trusted));
    receipt['signature'] = { alg: 'rsa', kid: trusted.kid, sig: 'AAAA' };
    expect(codes(validateAgentGateReceipt(receipt, ctx()))).toContain('SIGNATURE_MALFORMED');
  });

  it('does not trust a key merely because the receipt was signed with it (untrusted key)', () => {
    const receipt = seal(body(), other); // valid signature, but not by a trusted key
    const v = validateAgentGateReceipt(receipt, ctx());
    expect(v.integrityOk).toBe(true);
    expect(codes(v)).toEqual(['KEY_UNTRUSTED']);
    expect(v.signatureTrusted).toBe(false);
    expect(v.accepted).toBe(false);
    expect(v.testsObserved).toBe(false);
    expect(v.status).toBe('WARNING');
  });

  it('does not trust a public key that the customer embeds in the receipt', () => {
    const embedded = seal(
      body({ gate: { tool: 'agentgate', signing_public_key: other.publicKeyHex } }),
      other,
    );
    (embedded['signature'] as Obj)['public_key'] = other.publicKeyHex;
    const v = validateAgentGateReceipt(embedded, ctx());
    expect(v.integrityOk).toBe(true);
    expect(v.signatureTrusted).toBe(false);
    expect(v.accepted).toBe(false);
    expect(v.testsObserved).toBe(false);
  });

  it('reports a missing trust configuration instead of silently trusting', () => {
    const v = validateAgentGateReceipt(seal(body(), trusted), ctx({ trustStore: new StaticReceiptTrustStore([]) }));
    expect(codes(v)).toEqual(['NO_TRUSTED_KEYS']);
    expect(v.accepted).toBe(false);
  });

  it('treats an unsigned receipt as untrusted', () => {
    const v = validateAgentGateReceipt(seal(body(), null), ctx());
    expect(v.integrityOk).toBe(true);
    expect(codes(v)).toEqual(['SIGNATURE_ABSENT']);
    expect(v.accepted).toBe(false);
    expect(v.testsObserved).toBe(false);
  });

  it('rejects a receipt whose HEAD is not the requested afterSha', () => {
    const receipt = seal(body({ repo: repoWith({ head_sha: 'a'.repeat(40) }) }), trusted);
    const v = validateAgentGateReceipt(receipt, ctx());
    expect(codes(v)).toContain('HEAD_MISMATCH');
    expect(v.bindingOk).toBe(false);
    expect(v.accepted).toBe(false);
    expect(v.testsObserved).toBe(false);
    expect(v.status).toBe('FAIL');
    expect(v.findings.find((f) => f.code === 'HEAD_MISMATCH')?.message).toContain('9f8e7d6c5b4a');
  });

  it('accepts a prefix-compatible afterSha but not a one-character prefix', () => {
    const receipt = seal(body(), trusted);
    expect(validateAgentGateReceipt(receipt, ctx({ afterSha: HEAD.slice(0, 12) })).accepted).toBe(true);
    expect(validateAgentGateReceipt(receipt, ctx({ afterSha: HEAD.slice(0, 1) })).accepted).toBe(false);
    expect(shasMatch(HEAD, HEAD.toUpperCase())).toBe(true);
    expect(shasMatch('abc', 'abcdef0123')).toBe(false);
  });

  it('rejects a receipt for another repository', () => {
    const receipt = seal(body({ repo: repoWith({ remote: 'git@github.com:acme/other-repo.git' }) }), trusted);
    const v = validateAgentGateReceipt(receipt, ctx());
    expect(codes(v)).toContain('REPO_MISMATCH');
    expect(v.accepted).toBe(false);
    expect(v.status).toBe('FAIL');
  });

  it('matches repository identity case-insensitively and over ssh remotes', () => {
    const receipt = seal(body({ repo: repoWith({ remote: 'git@github.com:ACME/Widgets.git' }) }), trusted);
    expect(validateAgentGateReceipt(receipt, ctx()).accepted).toBe(true);
  });

  it('does not accept a look-alike host as github.com', () => {
    expect(parseGithubRemote('https://evilgithub.com/acme/widgets')).toBeNull();
    expect(parseGithubRemote('https://x-access-token:secret@github.com/acme/widgets.git')).toEqual({
      owner: 'acme',
      name: 'widgets',
    });
    const receipt = seal(body({ repo: repoWith({ remote: 'https://evilgithub.com/acme/widgets' }) }), trusted);
    const v = validateAgentGateReceipt(receipt, ctx());
    expect(codes(v)).toContain('REPO_UNVERIFIABLE');
    expect(v.accepted).toBe(false);
  });

  it('rejects a stale receipt (older than the default 24 hours)', () => {
    const receipt = seal(body({ created_at: '2026-10-12T12:00:00.000000Z' }), trusted);
    const v = validateAgentGateReceipt(receipt, ctx());
    expect(codes(v)).toContain('RECEIPT_STALE');
    expect(v.fresh).toBe(false);
    expect(v.accepted).toBe(false);
    expect(v.testsObserved).toBe(false);
  });

  it('honours a configured maximum age', () => {
    const receipt = seal(body(), trusted); // 30 minutes old at NOW
    expect(validateAgentGateReceipt(receipt, ctx({ maxAgeHours: 1 })).accepted).toBe(true);
    expect(validateAgentGateReceipt(receipt, ctx({ maxAgeHours: 0.25 })).accepted).toBe(false);
  });

  it('flags a receipt dated in the future', () => {
    const receipt = seal(body({ created_at: '2026-10-15T12:00:00.000000Z' }), trusted);
    expect(codes(validateAgentGateReceipt(receipt, ctx()))).toContain('CREATED_AT_IN_FUTURE');
  });

  it('accepts a dirty-tree receipt as an artifact but does not count its tests as observed', () => {
    const receipt = seal(body({ repo: repoWith({ tree_clean: false }) }), trusted);
    const v = validateAgentGateReceipt(receipt, ctx());
    expect(v.accepted).toBe(true);
    expect(codes(v)).toContain('TREE_DIRTY');
    expect(v.testsObserved).toBe(false);
    expect(v.observedTests).toEqual([]);
    expect(v.status).toBe('WARNING');
  });

  it('records a failed test run as a FAIL and observes nothing', () => {
    const receipt = seal(body({ tests: runWith({ exit_code: 1 }) }), trusted);
    const v = validateAgentGateReceipt(receipt, ctx());
    expect(codes(v)).toContain('TEST_FAILED');
    expect(v.testsObserved).toBe(false);
    expect(v.status).toBe('FAIL');
  });

  it('requires the run to be bound to the same tree', () => {
    const receipt = seal(body({ tests: runWith({ tree_sha: 'c'.repeat(40) }) }), trusted);
    const v = validateAgentGateReceipt(receipt, ctx());
    expect(codes(v)).toContain('TEST_TREE_MISMATCH');
    expect(v.testsObserved).toBe(false);
  });

  it('requires the run to be recorded by the gate, not by the agent', () => {
    const receipt = seal(body({ tests: runWith({ recorded_by: 'agent' }) }), trusted);
    expect(codes(validateAgentGateReceipt(receipt, ctx()))).toContain('TEST_NOT_GATE_RECORDED');
  });

  it('does not count a run the gate flagged as suspicious', () => {
    const receipt = seal(
      body({ tests: runWith({ suspicious: true, suspicion_reasons: ["command: '|| true' swallows failures"] }) }),
      trusted,
    );
    const v = validateAgentGateReceipt(receipt, ctx());
    expect(codes(v)).toContain('TEST_SUSPICIOUS');
    expect(v.testsObserved).toBe(false);
  });

  it('flags required commands that have no recorded run', () => {
    const t = body()['tests'] as { runs: Obj[] };
    const receipt = seal(body({ tests: { required: ['npm test', 'npm run e2e'], runs: t.runs } }), trusted);
    const v = validateAgentGateReceipt(receipt, ctx());
    expect(codes(v)).toContain('TEST_NOT_RUN');
    expect(v.testsObserved).toBe(false);
  });

  it('flags a receipt that requires no tests at all', () => {
    const receipt = seal(body({ tests: { required: [], runs: [] } }), trusted);
    const v = validateAgentGateReceipt(receipt, ctx());
    expect(codes(v)).toContain('NO_REQUIRED_TESTS');
    expect(v.testsObserved).toBe(false);
  });

  it('rejects a receipt that cannot be canonicalized (non-integral float)', () => {
    const v = validateAgentGateReceipt({ ...body(), receipt_id: 'rcpt_0000000000000000', extra: 1.5 }, ctx());
    expect(codes(v)).toContain('CANONICALIZATION_FAILED');
    expect(v.accepted).toBe(false);
  });

  it('rejects something that is not an object', () => {
    expect(codes(validateAgentGateReceipt('rcpt_abc', ctx()))).toEqual(['RECEIPT_MALFORMED']);
  });

  it('exposes submitted commands for suppression scanning even when the receipt is untrusted', () => {
    const t = body()['tests'] as { runs: Obj[] };
    const receipt = seal(
      body({ tests: { required: ['npm test || true'], runs: t.runs.map((r) => ({ ...r, cmd: 'npm test || true' })) } }),
      other,
    );
    const v = validateAgentGateReceipt(receipt, ctx());
    expect(v.accepted).toBe(false);
    expect(v.submittedCommands).toEqual(['npm test || true']);
  });
});

describe('trust store', () => {
  it('reads AGENT_GATE_TRUSTED_RECEIPT_KEYS and drops malformed entries', () => {
    const store = new EnvReceiptTrustStore({
      AGENT_GATE_TRUSTED_RECEIPT_KEYS: ` ${trusted.publicKeyHex.toUpperCase()}, not-hex ,${other.publicKeyHex} `,
    } as NodeJS.ProcessEnv);
    expect(store.trustedKeys().map((k) => k.kid)).toEqual([trusted.kid, other.kid]);
    expect(parseTrustedKeyList('zz,').malformed).toBe(1);
    expect(parseTrustedKeyList(undefined)).toEqual({ keys: [], malformed: 0 });
  });

  it('trusts nothing when the variable is unset', () => {
    expect(new EnvReceiptTrustStore({} as NodeJS.ProcessEnv).trustedKeys()).toEqual([]);
  });
});
