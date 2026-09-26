import 'reflect-metadata';

jest.mock('@agent-market/config', () => ({
  verifyApiPlanConfigs: [{ slug: 'free', monthlyRuns: 10, overageCents: null, retentionDays: 7 }],
}));

import { verifyApiRuleTestHooks } from './verify-api.controller.js';

// buildSoftwareDeliveryValidationError is exposed via the non-production test hooks.
const build = verifyApiRuleTestHooks!.buildSoftwareDeliveryValidationError;

type FakeError = { property: string; value?: unknown; constraints?: Record<string, string> };

describe('buildSoftwareDeliveryValidationError', () => {
  it('lists all required fields as "required inside output" when output is empty', () => {
    const errors: FakeError[] = [
      { property: 'repoOwner', value: undefined, constraints: { isString: 'repoOwner must be a string' } },
      { property: 'repoName', value: undefined, constraints: { isString: 'repoName must be a string' } },
      { property: 'beforeSha', value: undefined, constraints: { isString: 'beforeSha must be a string' } },
      { property: 'afterSha', value: undefined, constraints: { isString: 'afterSha must be a string' } },
      { property: 'jobStartedAt', value: undefined, constraints: { isDateString: 'jobStartedAt must be ISO' } },
      { property: 'tier', value: undefined, constraints: { isEnum: 'tier must be an enum' } },
      { property: 'jobType', value: undefined, constraints: { isEnum: 'jobType must be an enum' } },
    ];
    const result = build(errors, { source_type: 'software_delivery', output: {} });

    expect(result.statusCode).toBe(400);
    expect(result.message).toBe('Invalid software_delivery payload');
    expect(result.docs).toContain('/docs/verify-api');
    expect(result.example.output.repoOwner).toBeDefined();
    for (const field of ['repoOwner', 'repoName', 'beforeSha', 'afterSha', 'jobStartedAt', 'tier', 'jobType']) {
      expect(result.details.some((d: string) => d.includes(`${field} is required inside output`))).toBe(true);
    }
  });

  it('detects the top-level misplacement mistake and tells the customer to nest under output', () => {
    // Fields sent at the top level instead of inside output (the real-world 400 trap).
    const body = {
      source_type: 'software_delivery',
      repoOwner: 'swarmsync-ai',
      repoName: 'atep-spec',
      beforeSha: 'abc',
      afterSha: 'def',
      jobStartedAt: '2026-03-01T00:00:00Z',
      tier: 'BASIC',
      jobType: 'NEW_FEATURE',
      output: {},
    };
    const errors: FakeError[] = [
      { property: 'repoOwner', value: undefined },
      { property: 'repoName', value: undefined },
    ];
    const result = build(errors, body);
    const joined = result.details.join(' ');
    expect(joined).toMatch(/must be nested inside "output"/i);
    expect(joined).toContain('repoOwner');
  });

  it('surfaces enum/constraint violations with the output. field path', () => {
    const errors: FakeError[] = [
      { property: 'tier', value: 'PLATINUM', constraints: { isEnum: 'tier must be one of BASIC, STANDARD, THOROUGH' } },
    ];
    const result = build(errors, { output: { tier: 'PLATINUM' } });
    expect(result.details.some((d: string) => d.includes('output.tier'))).toBe(true);
  });
});
