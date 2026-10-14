import { ServiceUnavailableException } from '@nestjs/common';
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto';

/** A code is valid for 10 minutes from issue. */
export const VENDOR_PORTAL_OTP_EXPIRY_MS = 10 * 60 * 1000;
/** Comparisons allowed per code. The 5th failed comparison locks the code. */
export const VENDOR_PORTAL_OTP_MAX_ATTEMPTS = 5;
/** Longest candidate we will hash; anything longer can never be a valid code. */
const MAX_CANDIDATE_LENGTH = 64;

let processLocalDevSecret: Buffer | undefined;

/**
 * Server-side HMAC key for OTP codes. Fails CLOSED in production when
 * `VENDOR_PORTAL_OTP_SECRET` is unset. Outside production an unset secret falls
 * back to a random per-process key (codes survive only for the process lifetime,
 * which is acceptable for dev/test and never a shared constant).
 */
export function resolveVendorPortalOtpSecret(env: NodeJS.ProcessEnv = process.env): string | Buffer {
  const configured = env.VENDOR_PORTAL_OTP_SECRET?.trim();
  if (configured) return configured;
  if (env.NODE_ENV === 'production') {
    throw new ServiceUnavailableException('Vendor portal verification is temporarily unavailable.');
  }
  processLocalDevSecret ??= randomBytes(32);
  return processLocalDevSecret;
}

/**
 * HMAC-SHA256 of the code, bound to the portal token id so a hash cannot be
 * lifted from one challenge and replayed against another.
 */
export function hashVendorPortalOtp(secret: string | Buffer, portalTokenId: string, code: string): string {
  const candidate = code.length <= MAX_CANDIDATE_LENGTH ? code : '';
  return createHmac('sha256', secret).update(`vendor-portal-otp:v1:${portalTokenId}:${candidate}`).digest('hex');
}

/** Constant-time comparison of two hex digests. */
export function vendorPortalOtpHashesMatch(suppliedHash: string, storedHash: string): boolean {
  const a = Buffer.from(suppliedHash, 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

/** 6-digit numeric code from the OS CSPRNG. */
export function generateVendorPortalOtpCode(): string {
  return String(randomInt(100_000, 1_000_000));
}
