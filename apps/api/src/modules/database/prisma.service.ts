import { INestApplication, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' },
      ],
    });

    // Log slow queries (> 1000ms)
    this.$on('query' as never, (e: unknown) => {
      const ev = e as { duration: number; query: string };
      if (ev.duration > 1000) {
        this.logger.warn(`Slow query detected (${ev.duration}ms): ${ev.query}`);
      }
    });

    this.$on('error' as never, (e: unknown) => {
      this.logger.error('Prisma error:', e);
    });

    this.$on('warn' as never, (e: unknown) => {
      this.logger.warn('Prisma warning:', e);
    });
  }

  async onModuleInit() {
    this.logDatabaseTarget();
    // Supabase pooler (port 6543) needs a moment on cold starts before accepting
    // connections. Retry with exponential backoff so a P1001 on the first attempt
    // does not propagate as an unhandled rejection and crash the bootstrap.
    const maxAttempts = 5;
    const baseDelayMs = 1000;
    const connectTimeoutMs = Math.max(
      5000,
      parseInt(process.env.PRISMA_CONNECT_TIMEOUT_MS ?? '120000', 10),
    );
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        this.logger.log(
          `Prisma $connect() attempt ${attempt}/${maxAttempts} (hard cap ${connectTimeoutMs}ms per attempt)…`,
        );
        await this.withTimeout(
          this.$connect(),
          connectTimeoutMs,
          `Prisma $connect() timed out after ${connectTimeoutMs}ms — check DATABASE_URL host, VPN/firewall, ` +
            `and add connect_timeout=15 to the query string (libpq).`,
        );
        this.logger.log('Database connection established');
        break;
      } catch (err: unknown) {
        const code = (err as { code?: string }).code;
        const isTransient = code === 'P1001' || code === 'P1002' || code === 'P1017';
        if (isTransient && attempt < maxAttempts) {
          const delayMs = baseDelayMs * 2 ** (attempt - 1);
          this.logger.warn(
            `Database not reachable yet (${code}, attempt ${attempt}/${maxAttempts}). ` +
              `Retrying in ${delayMs}ms…`,
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        } else {
          // Non-transient error or final attempt — let NestJS log it but do NOT
          // call process.exit(). The health endpoint will return "degraded" and
          // Render will retry rather than cycling the container in a crash loop.
          this.logger.error(
            `Failed to connect to database after ${attempt} attempt(s): ` +
              (err instanceof Error ? err.message : String(err)),
          );
          break;
        }
      }
    }

    // DDL removed: routing_api_keys columns (monthlySpendLimitCents, currentMonthSpendCents,
    // spendWindowResetAt) are declared in apps/api/prisma/schema.prisma and managed via
    // Prisma migrations. Startup ALTER TABLE bypassed the migration system; removed 2026-06-15.

    // Chain Verify owns a deliberately small schema; Prisma migrations are the schema gate.

  /** Log where we are connecting without exposing credentials. */
  private logDatabaseTarget(): void {
    const raw = process.env.DATABASE_URL;
    const directRaw = process.env.DIRECT_URL;
    if (!raw) {
      this.logger.warn('DATABASE_URL is not set — Prisma $connect() will fail.');
      return;
    }
    try {
      const normalized = raw.replace(/^postgresql:\/\//i, 'http://');
      const u = new URL(normalized);
      const host = u.hostname || '(unknown)';
      const port = u.port || '5432';
      this.logger.log(`Prisma target: host=${host} port=${port} (from DATABASE_URL)`);
      if (host.includes('pooler.supabase.com') && port === '5432') {
        this.logger.warn(
          'Supabase pooler on port 5432 is usually session mode. Prisma at scale should use ' +
            'transaction pooler port 6543 with ?pgbouncer=true&connection_limit=5 (see project docs).',
        );
      }

      if (directRaw) {
        const directNormalized = directRaw.replace(/^postgresql:\/\//i, 'http://');
        const directUrl = new URL(directNormalized);
        const directHost = directUrl.hostname || '(unknown)';
        const directPort = directUrl.port || '5432';
        this.logger.log(`Prisma direct target: host=${directHost} port=${directPort} (from DIRECT_URL)`);
        if (directHost.includes('pooler.supabase.com')) {
          this.logger.error(
            'DIRECT_URL points to a Supabase pooler host. Migrations may fail or drift. ' +
              'Set DIRECT_URL to db.<project-ref>.supabase.co:5432 (direct connection).',
          );
        }
      } else {
        this.logger.warn('DIRECT_URL is not set — prisma migrate deploy cannot target direct database host.');
      }
    } catch {
      this.logger.warn('DATABASE_URL is set but could not be parsed for logging.');
    }
  }

  private async withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<T>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(message)), ms);
    });
    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  async enableShutdownHooks(app: INestApplication) {
    process.on('beforeExit', async () => {
      await app.close();
    });
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('Database connection closed');
  }

  /**
   * Get connection pool metrics.
   *
   * Returns one of three statuses:
   *   healthy   — DB query succeeded
   *   degraded  — Transient connectivity error (P1001/P1002/P1017 — Supabase pooler
   *               cold-start). The process is alive; Render should NOT restart it.
   *   unhealthy — Unexpected error (misconfiguration, schema mismatch, etc.)
   *
   * HTTP status is always 200 so load balancers do not kill a warming instance.
   */
  async getConnectionMetrics() {
    try {
      const startTime = Date.now();
      await this.$queryRaw`SELECT 1`;
      const responseTimeMs = Date.now() - startTime;
      return {
        status: 'healthy',
        responseTimeMs,
        connected: true,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const code = (error as { code?: string }).code;
      const isTransient = code === 'P1001' || code === 'P1002' || code === 'P1017';
      if (isTransient) {
        // Log at warn level only — not error — so Render doesn't flag this as a crash.
        this.logger.warn(
          `Health check: database not yet reachable (${code}). ` +
            'Service is alive; pooler may be warming up.',
        );
        return {
          status: 'degraded',
          responseTimeMs: null,
          connected: false,
          reason: 'Database pooler is warming up (transient)',
          timestamp: new Date().toISOString(),
        };
      }
      this.logger.error('Connection health check failed:', error);
      return {
        status: 'unhealthy',
        responseTimeMs: null,
        connected: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      };
    }
  }
}
