import 'reflect-metadata';
import { Controller, Get, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  DEFAULT_RATE_LIMIT,
  PUBLIC_RATE_LIMIT,
  RateLimitingModule,
  buildThrottlerOptions,
} from './rate-limiting.module.js';

// Specs are excluded from tsconfig, so the test transformer does not enable
// experimentalDecorators; apply the decorators as plain function calls instead.
class ProbeController {
  tight() {
    return { ok: true };
  }
  plain() {
    return { ok: true };
  }
  publicTight() {
    return { ok: true };
  }
}

function decorateMethod(name: keyof ProbeController, ...decorators: MethodDecorator[]) {
  const proto = ProbeController.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, name)!;
  for (const decorate of decorators) decorate(proto, name, descriptor);
}

Controller('probe')(ProbeController);
decorateMethod('tight', Get('tight'), Throttle({ default: { ttl: 60000, limit: 2 } }));
decorateMethod('plain', Get('plain'));
// Mirrors the invoice-proof public intake routes: skip default, opt in to `public`.
decorateMethod(
  'publicTight',
  Get('public-tight'),
  SkipThrottle({ default: true, strict: true }),
  Throttle({ public: { ttl: 60000, limit: 2 } }),
);

describe('RateLimitingModule (global ThrottlerGuard)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [RateLimitingModule],
      controllers: [ProbeController],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('configures a sane global default and an opt-in public throttler', () => {
    const options = buildThrottlerOptions() as { throttlers: Array<{ name: string; limit: number; ttl: number }> };
    const byName = Object.fromEntries(options.throttlers.map((t) => [t.name, t]));
    expect(byName.default).toMatchObject({ limit: DEFAULT_RATE_LIMIT, ttl: 60000 });
    expect(DEFAULT_RATE_LIMIT).toBe(120);
    expect(byName.public).toMatchObject({ limit: PUBLIC_RATE_LIMIT, ttl: 60000 });
  });

  it('returns 429 on the 3rd call to a route with @Throttle({ default: { ttl: 60000, limit: 2 } })', async () => {
    const server = app.getHttpServer();
    await request(server).get('/probe/tight').expect(200);
    await request(server).get('/probe/tight').expect(200);
    const third = await request(server).get('/probe/tight');
    expect(third.status).toBe(429);
    // Retry-After must be seconds (<= the 60s window), not milliseconds.
    expect(Number(third.headers['retry-after'])).toBeLessThanOrEqual(60);
    expect(Number(third.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('returns 429 on the 3rd call to a route that opts into the `public` throttler', async () => {
    const server = app.getHttpServer();
    await request(server).get('/probe/public-tight').expect(200);
    await request(server).get('/probe/public-tight').expect(200);
    await request(server).get('/probe/public-tight').expect(429);
  });

  it('does not apply the public limit to routes that did not opt in', async () => {
    const server = app.getHttpServer();
    for (let i = 0; i < PUBLIC_RATE_LIMIT + 5; i += 1) {
      await request(server).get('/probe/plain').expect(200);
    }
  });
});
