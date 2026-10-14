// Proof signing that fails loudly.
//
// Previously a missing or broken PROOF_SIGNING_PRIVATE_KEY silently produced an
// unsigned proof, indistinguishable from a signed one in the stored row. Now every
// proof records exactly one of:
//
//   SIGNED          - an Ed25519 signature was produced and self-checked.
//   UNSIGNED        - no signing key is configured (explicit, not an accident).
//   SIGNING_FAILED  - a key IS configured but could not be used.
//
// SECURITY: nothing here may ever return, log or persist key material or a raw
// exception message (an OpenSSL / Node message can echo parts of the input). Only
// a short error CLASS is kept: a whitelisted error code / name, or a fixed string.

import {
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
  verify as cryptoVerify,
} from 'crypto';

export type ProofSigningStatus = 'SIGNED' | 'UNSIGNED' | 'SIGNING_FAILED';

export interface ProofSigningOutcome {
  status: ProofSigningStatus;
  /** base64 Ed25519 signature over the chain hash; null unless status is SIGNED. */
  signature: string | null;
  /** Short error class / reason only (never key material); null unless SIGNING_FAILED. */
  error: string | null;
}

export const PROOF_SIGNING_KEY_ENV = 'PROOF_SIGNING_PRIVATE_KEY';
export const PROOF_SIGNING_REQUIRED_ENV = 'PROOF_SIGNING_REQUIRED';

type Env = Record<string, string | undefined>;

/** True when PROOF_SIGNING_REQUIRED is 'true' / '1' (trimmed, case-insensitive). */
export function isProofSigningRequired(env: Env = process.env): boolean {
  const raw = env[PROOF_SIGNING_REQUIRED_ENV]?.trim().toLowerCase();
  return raw === 'true' || raw === '1';
}

/** True when a non-blank signing key is configured (says nothing about validity). */
export function hasProofSigningKey(env: Env = process.env): boolean {
  const raw = env[PROOF_SIGNING_KEY_ENV];
  return typeof raw === 'string' && raw.trim() !== '';
}

let unsignedWarningEmitted = false;

/** Test seam: re-arm the once-per-process UNSIGNED warning. */
export function resetAuditProofSigningWarnings(): void {
  unsignedWarningEmitted = false;
}

/**
 * Reduce an arbitrary thrown value to a short, safe error class. Only a
 * upper-snake-case `code` (e.g. ERR_OSSL_UNSUPPORTED) or a plain alphabetic
 * `name` (e.g. TypeError) is ever kept; the message is discarded unread.
 */
export function classifySigningError(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && /^[A-Z0-9_]{3,64}$/.test(code)) {
    return `KEY_UNUSABLE_${code}`;
  }
  const name = error instanceof Error ? error.name : '';
  if (/^[A-Za-z]{1,40}$/.test(name)) return `KEY_UNUSABLE_${name}`;
  return 'KEY_UNUSABLE';
}

function failed(error: string, proofId: string | undefined): ProofSigningOutcome {
  console.error(
    JSON.stringify({
      level: 'error',
      event: 'proof_signing_failed',
      status: 'SIGNING_FAILED',
      reason: error,
      proofId: proofId ?? null,
      message:
        'PROOF_SIGNING_PRIVATE_KEY is configured but unusable; this proof was NOT signed. ' +
        'Fix the key (base64 PKCS8 DER Ed25519) or set PROOF_SIGNING_REQUIRED=true to refuse unsigned proofs.',
    }),
  );
  return { status: 'SIGNING_FAILED', signature: null, error };
}

/**
 * Sign a proof chain hash (hex) and report the outcome. Never throws for a
 * missing/invalid key - the caller decides (via PROOF_SIGNING_REQUIRED) whether
 * an unsigned record is acceptable.
 */
export function signProofChainHash(
  chainHash: string,
  env: Env = process.env,
  proofId?: string,
): ProofSigningOutcome {
  if (!hasProofSigningKey(env)) {
    if (!unsignedWarningEmitted) {
      unsignedWarningEmitted = true;
      console.warn(
        JSON.stringify({
          level: 'warn',
          event: 'proof_signing_unsigned',
          status: 'UNSIGNED',
          message:
            'No PROOF_SIGNING_PRIVATE_KEY is configured; proofs are being stored UNSIGNED. ' +
            'This warning is logged once per process.',
        }),
      );
    }
    return { status: 'UNSIGNED', signature: null, error: null };
  }

  const keyB64 = (env[PROOF_SIGNING_KEY_ENV] as string).trim();
  try {
    const privateKey = createPrivateKey({
      key: Buffer.from(keyB64, 'base64'),
      format: 'der',
      type: 'pkcs8',
    });
    if (privateKey.asymmetricKeyType !== 'ed25519') {
      return failed('KEY_NOT_ED25519', proofId);
    }
    const data = Buffer.from(chainHash, 'hex');
    const signature = cryptoSign(null, data, privateKey);
    // Self-check so a key that signs but cannot verify is never reported SIGNED.
    if (!cryptoVerify(null, data, createPublicKey(privateKey), signature)) {
      return failed('SIGNATURE_SELF_CHECK_FAILED', proofId);
    }
    return { status: 'SIGNED', signature: signature.toString('base64'), error: null };
  } catch (e: unknown) {
    return failed(classifySigningError(e), proofId);
  }
}

/** Minimal proof shape needed to present signing state. */
export interface SigningPresentable {
  signingStatus?: string | null;
  signingError?: string | null;
  proof_signature?: string | null;
}

export interface ProofSigningView {
  signing_status: ProofSigningStatus;
  /** True ONLY when status is SIGNED and a signature is actually stored. */
  signed: boolean;
  /** Short error class for SIGNING_FAILED; null otherwise. */
  signing_error: string | null;
}

/**
 * The one way a controller should describe a proof's signing state. An UNSIGNED
 * or SIGNING_FAILED record can never be presented as signed: `signed` requires
 * both the SIGNED status and a stored signature. A legacy row with no status
 * column value is derived from the signature (present => SIGNED, else UNSIGNED).
 */
export function presentProofSigning(proof: SigningPresentable): ProofSigningView {
  const hasSignature = typeof proof.proof_signature === 'string' && proof.proof_signature !== '';
  let status: ProofSigningStatus;
  if (proof.signingStatus === 'SIGNING_FAILED') {
    status = 'SIGNING_FAILED';
  } else {
    // A stored signature is the evidence; a SIGNED label without one is not trusted,
    // and a signature on a row whose status was never set (pre-migration) is SIGNED.
    status = hasSignature ? 'SIGNED' : 'UNSIGNED';
  }
  return {
    signing_status: status,
    signed: status === 'SIGNED',
    signing_error: status === 'SIGNING_FAILED' ? (proof.signingError ?? 'UNKNOWN') : null,
  };
}
