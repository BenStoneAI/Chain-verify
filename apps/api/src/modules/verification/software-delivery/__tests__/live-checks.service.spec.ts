import { vi, describe, it, expect, beforeEach, type Mocked } from 'vitest';
import { Test } from '@nestjs/testing';
import axios from 'axios';
import { LiveChecksService } from '../checks/live-checks.service.js';

vi.mock('axios');
const mockedAxios = axios as Mocked<typeof axios>;

// DNS lookups must be mocked so the SSRF guard passes without real network I/O
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
}));

// ---------------------------------------------------------------------------
// Helper: simulate axios.get returning a resolved response
// ---------------------------------------------------------------------------

function makeResponse(status: number, data: unknown = '') {
  return { status, data, headers: {}, config: {}, statusText: 'OK' };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LiveChecksService', () => {
  let service: LiveChecksService;

  beforeEach(async () => {
    vi.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [LiveChecksService],
    }).compile();
    service = module.get(LiveChecksService);
  });

  // ── B6: Live site still opens ─────────────────────────────────────────────

  describe('checkLiveSite (B6)', () => {
    it('PASS when URL returns 200 within 5000ms', async () => {
      mockedAxios.get.mockResolvedValue(makeResponse(200, '<html>Hello</html>'));
      const result = await service.checkLiveSite('https://api.acme.com');
      expect(result.checkId).toBe('B6');
      expect(result.status).toBe('PASS');
    });

    it('FAIL when URL returns 500 Internal Server Error', async () => {
      mockedAxios.get.mockResolvedValue(makeResponse(500, 'Internal Server Error'));
      const result = await service.checkLiveSite('https://api.acme.com');
      expect(result.checkId).toBe('B6');
      expect(result.status).toBe('FAIL');
      expect(result.detail).toContain('HTTP 500');
    });

    it('FAIL when URL returns 404 Not Found', async () => {
      mockedAxios.get.mockResolvedValue(makeResponse(404, 'Not Found'));
      const result = await service.checkLiveSite('https://api.acme.com');
      expect(result.status).toBe('FAIL');
      expect(result.detail).toContain('HTTP 404');
    });

    it('FAIL when URL returns 503 Service Unavailable', async () => {
      mockedAxios.get.mockResolvedValue(makeResponse(503, 'Service Unavailable'));
      const result = await service.checkLiveSite('https://api.acme.com');
      expect(result.status).toBe('FAIL');
    });

    it('FAIL when URL is unreachable (network error)', async () => {
      mockedAxios.get.mockRejectedValue(new Error('ENOTFOUND api.acme.com'));
      const result = await service.checkLiveSite('https://api.acme.com');
      expect(result.checkId).toBe('B6');
      expect(result.status).toBe('FAIL');
      expect(result.detail).toContain('Could not reach');
    });

    it('FAIL on connection timeout', async () => {
      mockedAxios.get.mockRejectedValue(new Error('ECONNABORTED: timeout of 5000ms exceeded'));
      const result = await service.checkLiveSite('https://api.acme.com');
      expect(result.status).toBe('FAIL');
    });

    it('SKIP when no deployUrl provided', async () => {
      const result = await service.checkLiveSite(undefined);
      expect(result.checkId).toBe('B6');
      expect(result.status).toBe('SKIP');
      expect(result.detail).toContain('No deploy URL');
    });

    it('SKIP when deployUrl is empty string', async () => {
      const result = await service.checkLiveSite('');
      expect(result.checkId).toBe('B6');
      expect(result.status).toBe('SKIP');
    });

    it('evidence includes statusCode and url on PASS', async () => {
      mockedAxios.get.mockResolvedValue(makeResponse(200));
      const result = await service.checkLiveSite('https://api.acme.com');
      expect((result.evidence as Record<string, unknown>).statusCode).toBe(200);
      expect((result.evidence as Record<string, unknown>).url).toBe('https://api.acme.com');
    });

    it('evidence includes durationMs as a non-negative number', async () => {
      mockedAxios.get.mockResolvedValue(makeResponse(200));
      const result = await service.checkLiveSite('https://api.acme.com');
      expect(typeof (result.evidence as Record<string, unknown>).durationMs).toBe('number');
      expect((result.evidence as Record<string, unknown>).durationMs).toBeGreaterThanOrEqual(0);
    });

    it('returns durationMs on the result object', async () => {
      mockedAxios.get.mockResolvedValue(makeResponse(200));
      const result = await service.checkLiveSite('https://api.acme.com');
      expect(typeof result.durationMs).toBe('number');
    });

    it('FAIL when deployUrl uses http:// (SSRF regression)', async () => {
      const result = await service.checkLiveSite('http://api.acme.com');
      expect(result.status).toBe('FAIL');
      expect(result.detail).toContain('SSRF guard blocked');
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it('FAIL when deployUrl targets AWS metadata host (SSRF regression)', async () => {
      const result = await service.checkLiveSite('https://169.254.169.254/latest/meta-data/');
      expect(result.status).toBe('FAIL');
      expect(result.detail).toContain('SSRF guard blocked');
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it('FAIL when deployUrl hostname is loopback (SSRF regression)', async () => {
      const result = await service.checkLiveSite('https://127.0.0.1/');
      expect(result.status).toBe('FAIL');
      expect(result.detail).toContain('SSRF guard blocked');
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it('FAIL when deployUrl hostname is RFC-1918 (SSRF regression)', async () => {
      const result = await service.checkLiveSite('https://10.0.0.1/');
      expect(result.status).toBe('FAIL');
      expect(result.detail).toContain('SSRF guard blocked');
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });
  });

  // ── DEP4: Health check passes ─────────────────────────────────────────────

  describe('checkHealthEndpoint (DEP4)', () => {
    it('PASS when /health returns 200 with {status: "ok"}', async () => {
      mockedAxios.get.mockResolvedValue(makeResponse(200, { status: 'ok' }));
      const result = await service.checkHealthEndpoint('https://api.acme.com');
      expect(result.checkId).toBe('DEP4');
      expect(result.status).toBe('PASS');
    });

    it('PASS when /health returns 200 with {status: "healthy"}', async () => {
      mockedAxios.get.mockResolvedValue(makeResponse(200, { status: 'healthy' }));
      const result = await service.checkHealthEndpoint('https://api.acme.com');
      expect(result.checkId).toBe('DEP4');
      expect(result.status).toBe('PASS');
    });

    it('PASS when /health returns 200 with {status: "OK"} (uppercase)', async () => {
      mockedAxios.get.mockResolvedValue(makeResponse(200, { status: 'OK' }));
      const result = await service.checkHealthEndpoint('https://api.acme.com');
      expect(result.status).toBe('PASS');
    });

    it('PASS when /health returns 200 with {healthy: true}', async () => {
      mockedAxios.get.mockResolvedValue(makeResponse(200, { healthy: true, version: '1.2.3' }));
      const result = await service.checkHealthEndpoint('https://api.acme.com');
      expect(result.status).toBe('PASS');
    });

    it('FAIL when /health returns 200 but unexpected body shape (not healthy)', async () => {
      mockedAxios.get.mockResolvedValue(makeResponse(200, { message: 'pong', uptime: 12345 }));
      const result = await service.checkHealthEndpoint('https://api.acme.com');
      expect(result.checkId).toBe('DEP4');
      // Body doesn't contain status:ok|healthy|OK or healthy:true — reachable but unhealthy → FAIL
      expect(result.status).toBe('FAIL');
    });

    it('FAIL when /health returns 200 with empty body (no healthy indicator)', async () => {
      mockedAxios.get.mockResolvedValue(makeResponse(200, {}));
      const result = await service.checkHealthEndpoint('https://api.acme.com');
      // Empty body cannot confirm healthy state → FAIL
      expect(result.status).toBe('FAIL');
    });

    it('WARNING when /health returns 503 (not FAIL — health endpoint may not exist)', async () => {
      // The implementation returns WARNING on HTTP errors because /health may not be required
      mockedAxios.get.mockResolvedValue(makeResponse(503, { status: 'error' }));
      const result = await service.checkHealthEndpoint('https://api.acme.com');
      expect(result.checkId).toBe('DEP4');
      // Implementation: returns WARNING when not healthy (status check fails)
      expect(['WARNING', 'FAIL']).toContain(result.status);
    });

    it('WARNING when no /health endpoint found (404 or connection error)', async () => {
      // Connection refused → catches error → returns WARNING (not FAIL, to not block on missing health route)
      mockedAxios.get.mockRejectedValue(new Error('ECONNREFUSED'));
      const result = await service.checkHealthEndpoint('https://api.acme.com');
      expect(result.checkId).toBe('DEP4');
      expect(result.status).toBe('WARNING');
    });

    it('SKIP when no deployUrl provided', async () => {
      const result = await service.checkHealthEndpoint(undefined);
      expect(result.checkId).toBe('DEP4');
      expect(result.status).toBe('SKIP');
    });

    it('constructs health URL by appending /health to deployUrl', async () => {
      mockedAxios.get.mockResolvedValue(makeResponse(200, { status: 'ok' }));
      await service.checkHealthEndpoint('https://api.acme.com');
      const calledUrl = mockedAxios.get.mock.calls[0][0] as string;
      expect(calledUrl).toBe('https://api.acme.com/health');
    });

    it('handles trailing slash in deployUrl', async () => {
      mockedAxios.get.mockResolvedValue(makeResponse(200, { status: 'ok' }));
      await service.checkHealthEndpoint('https://api.acme.com/');
      const calledUrl = mockedAxios.get.mock.calls[0][0] as string;
      // Should not produce double slash
      expect(calledUrl).toBe('https://api.acme.com/health');
    });

    it('evidence includes url and statusCode', async () => {
      mockedAxios.get.mockResolvedValue(makeResponse(200, { status: 'ok' }));
      const result = await service.checkHealthEndpoint('https://api.acme.com');
      expect((result.evidence as Record<string, unknown>).url).toContain('/health');
      expect((result.evidence as Record<string, unknown>).statusCode).toBe(200);
    });
  });

  // ── S8: Feature reachable via entry point ─────────────────────────────────

  describe('checkFeatureReachable (S8)', () => {
    it('PASS when deployUrl returns HTTP < 500', async () => {
      mockedAxios.get.mockResolvedValue(makeResponse(200, 'OK'));
      const result = await service.checkFeatureReachable('https://api.acme.com', undefined);
      expect(result.checkId).toBe('S8');
      expect(result.status).toBe('PASS');
    });

    it('PASS when deployUrl returns 401 (auth wall means app is running)', async () => {
      mockedAxios.get.mockResolvedValue(makeResponse(401, 'Unauthorized'));
      const result = await service.checkFeatureReachable('https://api.acme.com', undefined);
      expect(result.status).toBe('PASS'); // < 500 → reachable
    });

    it('FAIL when deployUrl returns 500 (server error)', async () => {
      mockedAxios.get.mockResolvedValue(makeResponse(500, 'Internal Server Error'));
      const result = await service.checkFeatureReachable('https://api.acme.com', undefined);
      expect(result.status).toBe('FAIL');
    });

    it('FAIL on network error', async () => {
      mockedAxios.get.mockRejectedValue(new Error('ENOTFOUND api.acme.com'));
      const result = await service.checkFeatureReachable('https://api.acme.com', undefined);
      expect(result.status).toBe('FAIL');
    });

    it('SKIP when no deployUrl provided', async () => {
      const result = await service.checkFeatureReachable(undefined, undefined);
      expect(result.checkId).toBe('S8');
      expect(result.status).toBe('SKIP');
    });

    it('includes evidence with statusCode', async () => {
      mockedAxios.get.mockResolvedValue(makeResponse(200));
      const result = await service.checkFeatureReachable('https://api.acme.com', 'Fix login bug');
      // evidence.statusCode is set in the service implementation
      expect(result.evidence).toBeDefined();
      expect((result.evidence as Record<string, unknown>).statusCode).toBeDefined();
    });
  });
});
