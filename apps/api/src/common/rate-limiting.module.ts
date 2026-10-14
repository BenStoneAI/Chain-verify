import 'reflect-metadata';
import { Module, type ExecutionContext } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule, type ThrottlerModuleOptions } from '@nestjs/throttler';

/** Metadata key prefix @nestjs/throttler v6 uses for `@Throttle` limits (not exported by the package). */
const THROTTLER_LIMIT = 'THROTTLER:LIMIT';

/** Window for every named throttler, in milliseconds (@nestjs/throttler v6 unit). */
export const RATE_LIMIT_TTL_MS = 60_000;
/** Applies to every route that does not carry its own `@Throttle({ default })` override. */
export const DEFAULT_RATE_LIMIT = 120;
/** Applies only to routes that opt in with `@Throttle({ public: ... })` (unauthenticated intake). */
export const PUBLIC_RATE_LIMIT = 20;

/**
 * `@Throttle({ [name]: ... })` stores its limit under `THROTTLER_LIMIT + name` on the
 * route handler or controller class. ThrottlerGuard runs EVERY configured throttler on
 * EVERY route unless skipped, so a named throttler that only some routes opt into must
 * skip itself when no such override is present.
 */
function hasRouteOverride(name: string, context: ExecutionContext): boolean {
  const key = THROTTLER_LIMIT + name;
  return (
    Reflect.getMetadata(key, context.getHandler()) !== undefined ||
    Reflect.getMetadata(key, context.getClass()) !== undefined
  );
}

export function buildThrottlerOptions(): ThrottlerModuleOptions {
  return {
    throttlers: [
      { name: 'default', ttl: RATE_LIMIT_TTL_MS, limit: DEFAULT_RATE_LIMIT },
      {
        name: 'public',
        ttl: RATE_LIMIT_TTL_MS,
        limit: PUBLIC_RATE_LIMIT,
        skipIf: (context) => !hasRouteOverride('public', context),
      },
    ],
  };
}

/**
 * Global rate limiting. In-memory storage (per API instance); the tracker is `req.ip`,
 * which is the real client address only when Express `trust proxy` is configured (main.ts).
 */
@Module({
  imports: [ThrottlerModule.forRoot(buildThrottlerOptions())],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
  exports: [ThrottlerModule],
})
export class RateLimitingModule {}
