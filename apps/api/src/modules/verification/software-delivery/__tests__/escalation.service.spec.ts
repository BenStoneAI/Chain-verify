import { describe, it, expect, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { SoftwareDeliveryEscalationService } from '../software-delivery-escalation.js';
import { SoftwareTier, SoftwareJobType } from '../dto/software-delivery-verify.dto.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDto(
  overrides: Partial<{
    tier: SoftwareTier;
    jobType: SoftwareJobType;
    jobDescription: string;
    diffSize: number;
    jobValueUsd: number;
  }> = {},
): any {
  return {
    tier: SoftwareTier.BASIC,
    jobType: SoftwareJobType.NEW_FEATURE,
    jobDescription: '',
    diffSize: 0,
    jobValueUsd: 0,
    repoOwner: 'acme-corp',
    repoName: 'payments-api',
    beforeSha: 'abc123def456',
    afterSha: 'def456abc123',
    jobStartedAt: new Date('2026-05-25T10:00:00Z').toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SoftwareDeliveryEscalationService', () => {
  let service: SoftwareDeliveryEscalationService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [SoftwareDeliveryEscalationService],
    }).compile();
    service = module.get(SoftwareDeliveryEscalationService);
  });

  // ── No escalation ──────────────────────────────────────────────────────────

  describe('no escalation — conditions not met', () => {
    it('returns BASIC unchanged for a small new-feature job with no triggers', () => {
      const result = service.resolve(makeDto({ tier: SoftwareTier.BASIC, diffSize: 50 }));
      expect(result.tier).toBe('BASIC');
      expect(result.escalated).toBe(false);
      expect(result.escalationReason).toBeUndefined();
    });

    it('returns STANDARD unchanged when caller already requests STANDARD and no thorough triggers fire', () => {
      const result = service.resolve(
        makeDto({ tier: SoftwareTier.STANDARD, diffSize: 400, jobValueUsd: 1500 }),
      );
      expect(result.tier).toBe('STANDARD');
      expect(result.escalated).toBe(false);
    });

    it('returns THOROUGH unchanged when caller already requests THOROUGH regardless of triggers', () => {
      // Even if diffSize is small and jobValueUsd is small, THOROUGH never de-escalates
      const result = service.resolve(makeDto({ tier: SoftwareTier.THOROUGH, diffSize: 10, jobValueUsd: 0 }));
      expect(result.tier).toBe('THOROUGH');
      expect(result.escalated).toBe(false);
    });

    it('does not escalate when diffSize is exactly 500 (boundary: not >', () => {
      const result = service.resolve(
        makeDto({ tier: SoftwareTier.BASIC, diffSize: 500, jobType: SoftwareJobType.NEW_FEATURE }),
      );
      expect(result.tier).toBe('BASIC');
      expect(result.escalated).toBe(false);
    });

    it('does not escalate when diffSize is exactly 1500 (boundary: not > for thorough)', () => {
      const result = service.resolve(
        makeDto({ tier: SoftwareTier.STANDARD, diffSize: 1500, jobValueUsd: 0 }),
      );
      expect(result.tier).toBe('STANDARD');
      expect(result.escalated).toBe(false);
    });

    it('does not escalate to THOROUGH when jobValueUsd is exactly 2000', () => {
      const result = service.resolve(makeDto({ tier: SoftwareTier.STANDARD, jobValueUsd: 2000 }));
      expect(result.tier).toBe('STANDARD');
      expect(result.escalated).toBe(false);
    });

    it('does not escalate WRITE_TESTS with small diff and no keywords', () => {
      const result = service.resolve(
        makeDto({ tier: SoftwareTier.BASIC, jobType: SoftwareJobType.WRITE_TESTS, diffSize: 100 }),
      );
      expect(result.tier).toBe('BASIC');
      expect(result.escalated).toBe(false);
    });
  });

  // ── BASIC → STANDARD escalation ───────────────────────────────────────────

  describe('BASIC → STANDARD escalation', () => {
    it('escalates MIGRATE_DATA job type to STANDARD', () => {
      const result = service.resolve(makeDto({ tier: SoftwareTier.BASIC, jobType: SoftwareJobType.MIGRATE_DATA }));
      expect(result.tier).toBe('STANDARD');
      expect(result.escalated).toBe(true);
      expect(result.escalationReason).toContain('migration');
    });

    it('escalates BUILD_INTEGRATION job type to STANDARD', () => {
      const result = service.resolve(
        makeDto({ tier: SoftwareTier.BASIC, jobType: SoftwareJobType.BUILD_INTEGRATION }),
      );
      expect(result.tier).toBe('STANDARD');
      expect(result.escalated).toBe(true);
      expect(result.escalationReason).toContain('integration');
    });

    it('escalates when diffSize is 501 (just over threshold)', () => {
      const result = service.resolve(makeDto({ tier: SoftwareTier.BASIC, diffSize: 501 }));
      expect(result.tier).toBe('STANDARD');
      expect(result.escalated).toBe(true);
      expect(result.escalationReason).toContain('501');
    });

    it('escalates when diffSize is far above 500', () => {
      const result = service.resolve(makeDto({ tier: SoftwareTier.BASIC, diffSize: 1200 }));
      // 1200 > 500 → STANDARD; but 1200 is NOT > 1500 so should NOT reach THOROUGH
      expect(result.tier).toBe('STANDARD');
      expect(result.escalated).toBe(true);
    });

    it('escalates when jobDescription contains "production" (lowercase)', () => {
      const result = service.resolve(
        makeDto({ tier: SoftwareTier.BASIC, jobDescription: 'Deploy fix to production environment' }),
      );
      expect(result.tier).toBe('STANDARD');
      expect(result.escalated).toBe(true);
    });

    it('escalates when jobDescription contains "PRODUCTION" (uppercase — case-insensitive)', () => {
      const result = service.resolve(
        makeDto({ tier: SoftwareTier.BASIC, jobDescription: 'Deploy to PRODUCTION server' }),
      );
      expect(result.tier).toBe('STANDARD');
      expect(result.escalated).toBe(true);
    });

    it('escalates when jobDescription contains "live data"', () => {
      const result = service.resolve(
        makeDto({ tier: SoftwareTier.BASIC, jobDescription: 'Script that processes live data from users' }),
      );
      expect(result.tier).toBe('STANDARD');
      expect(result.escalated).toBe(true);
    });

    it('escalates when jobDescription contains "customer-facing"', () => {
      const result = service.resolve(
        makeDto({ tier: SoftwareTier.BASIC, jobDescription: 'This is a customer-facing change to checkout' }),
      );
      expect(result.tier).toBe('STANDARD');
      expect(result.escalated).toBe(true);
    });

    it('escalates when jobDescription contains "api key"', () => {
      const result = service.resolve(
        makeDto({ tier: SoftwareTier.BASIC, jobDescription: 'Rotate the API key used by payment service' }),
      );
      expect(result.tier).toBe('STANDARD');
      expect(result.escalated).toBe(true);
    });

    it('escalates when jobDescription contains "live environment"', () => {
      const result = service.resolve(
        makeDto({ tier: SoftwareTier.BASIC, jobDescription: 'Testing against the live environment' }),
      );
      expect(result.tier).toBe('STANDARD');
      expect(result.escalated).toBe(true);
    });

    it('escalationReason is a non-empty string on BASIC → STANDARD escalation', () => {
      const result = service.resolve(
        makeDto({ tier: SoftwareTier.BASIC, jobType: SoftwareJobType.MIGRATE_DATA }),
      );
      expect(typeof result.escalationReason).toBe('string');
      expect((result.escalationReason as string).length).toBeGreaterThan(0);
    });

    it('escalationReason mentions "Standard" when escalating to STANDARD', () => {
      const result = service.resolve(
        makeDto({ tier: SoftwareTier.BASIC, jobType: SoftwareJobType.MIGRATE_DATA }),
      );
      expect(result.escalationReason).toMatch(/standard/i);
    });
  });

  // ── Any → THOROUGH escalation ─────────────────────────────────────────────

  describe('any tier → THOROUGH escalation', () => {
    it('escalates BASIC to THOROUGH when diffSize > 1500', () => {
      const result = service.resolve(makeDto({ tier: SoftwareTier.BASIC, diffSize: 2000 }));
      expect(result.tier).toBe('THOROUGH');
      expect(result.escalated).toBe(true);
      expect(result.escalationReason).toMatch(/thorough/i);
    });

    it('escalates STANDARD to THOROUGH when diffSize > 1500', () => {
      const result = service.resolve(makeDto({ tier: SoftwareTier.STANDARD, diffSize: 1501 }));
      expect(result.tier).toBe('THOROUGH');
      expect(result.escalated).toBe(true);
    });

    it('escalates BASIC to THOROUGH when jobValueUsd > 2000', () => {
      const result = service.resolve(makeDto({ tier: SoftwareTier.BASIC, jobValueUsd: 2001 }));
      expect(result.tier).toBe('THOROUGH');
      expect(result.escalated).toBe(true);
    });

    it('escalates STANDARD to THOROUGH when jobValueUsd > 2000', () => {
      const result = service.resolve(makeDto({ tier: SoftwareTier.STANDARD, jobValueUsd: 5000 }));
      expect(result.tier).toBe('THOROUGH');
      expect(result.escalated).toBe(true);
    });

    it('escalates when jobDescription contains "compliance"', () => {
      const result = service.resolve(
        makeDto({ tier: SoftwareTier.BASIC, jobDescription: 'Regulatory compliance reporting module' }),
      );
      expect(result.tier).toBe('THOROUGH');
      expect(result.escalated).toBe(true);
    });

    it('escalates when jobDescription contains "hipaa" (case-insensitive)', () => {
      const result = service.resolve(
        makeDto({ tier: SoftwareTier.BASIC, jobDescription: 'HIPAA-compliant data storage implementation' }),
      );
      expect(result.tier).toBe('THOROUGH');
      expect(result.escalated).toBe(true);
    });

    it('escalates when jobDescription contains "pci"', () => {
      const result = service.resolve(
        makeDto({ tier: SoftwareTier.BASIC, jobDescription: 'PCI DSS payment flow changes for card processing' }),
      );
      expect(result.tier).toBe('THOROUGH');
      expect(result.escalated).toBe(true);
    });

    it('escalates when jobDescription contains "gdpr"', () => {
      const result = service.resolve(
        makeDto({ tier: SoftwareTier.STANDARD, jobDescription: 'GDPR compliance update for EU users' }),
      );
      expect(result.tier).toBe('THOROUGH');
      expect(result.escalated).toBe(true);
    });

    it('escalates when jobDescription contains "concurrent"', () => {
      const result = service.resolve(
        makeDto({ tier: SoftwareTier.BASIC, jobDescription: 'Handle concurrent requests safely with mutex locks' }),
      );
      expect(result.tier).toBe('THOROUGH');
      expect(result.escalated).toBe(true);
    });

    it('escalates when jobDescription contains "scale"', () => {
      const result = service.resolve(
        makeDto({ tier: SoftwareTier.BASIC, jobDescription: 'System must scale to 1 million users' }),
      );
      expect(result.tier).toBe('THOROUGH');
      expect(result.escalated).toBe(true);
    });

    it('escalates when jobDescription contains "regulatory"', () => {
      const result = service.resolve(
        makeDto({ tier: SoftwareTier.BASIC, jobDescription: 'Implement regulatory filing integration' }),
      );
      expect(result.tier).toBe('THOROUGH');
      expect(result.escalated).toBe(true);
    });

    it('escalationReason mentions "Thorough" when escalating to THOROUGH', () => {
      const result = service.resolve(makeDto({ tier: SoftwareTier.BASIC, diffSize: 2000 }));
      expect(result.escalationReason).toMatch(/thorough/i);
    });
  });

  // ── Multiple triggers in one request ──────────────────────────────────────

  describe('multiple triggers in a single request', () => {
    it('applies THOROUGH when both standard and thorough triggers present', () => {
      // MIGRATE_DATA → STANDARD trigger; diffSize > 1500 → THOROUGH trigger
      const result = service.resolve(
        makeDto({
          tier: SoftwareTier.BASIC,
          jobType: SoftwareJobType.MIGRATE_DATA,
          diffSize: 2000,
        }),
      );
      expect(result.tier).toBe('THOROUGH');
      expect(result.escalated).toBe(true);
    });

    it('applies THOROUGH when keyword triggers both standard and thorough escalation simultaneously', () => {
      // "production" → STANDARD; "compliance" → THOROUGH
      const result = service.resolve(
        makeDto({
          tier: SoftwareTier.BASIC,
          jobDescription: 'Update the production compliance reporting pipeline',
        }),
      );
      expect(result.tier).toBe('THOROUGH');
      expect(result.escalated).toBe(true);
    });

    it('THOROUGH wins even when standard trigger fires after thorough is already set', () => {
      const result = service.resolve(
        makeDto({
          tier: SoftwareTier.BASIC,
          jobType: SoftwareJobType.MIGRATE_DATA, // standard trigger
          jobValueUsd: 5000, // thorough trigger
          diffSize: 1600, // another thorough trigger
        }),
      );
      expect(result.tier).toBe('THOROUGH');
      expect(result.escalated).toBe(true);
    });

    it('escalationReason contains at least one trigger description when multiple fire', () => {
      const result = service.resolve(
        makeDto({
          tier: SoftwareTier.BASIC,
          diffSize: 2000,
          jobValueUsd: 5000,
        }),
      );
      expect(result.escalationReason).toBeTruthy();
      // Should mention the thorough reason (multiple may be joined)
      expect((result.escalationReason as string).length).toBeGreaterThan(10);
    });
  });

  // ── Never de-escalates ────────────────────────────────────────────────────

  describe('one-way escalation invariant', () => {
    it('THOROUGH requested + MIGRATE_DATA stays THOROUGH, escalated=false (already at ceiling)', () => {
      const result = service.resolve(
        makeDto({ tier: SoftwareTier.THOROUGH, jobType: SoftwareJobType.MIGRATE_DATA }),
      );
      expect(result.tier).toBe('THOROUGH');
      // Caller already requested THOROUGH; no escalation occurred because result.tier === dto.tier
      expect(result.escalated).toBe(false);
    });

    it('escalated flag is false when caller tier already matches resolved tier', () => {
      const result = service.resolve(
        makeDto({ tier: SoftwareTier.STANDARD, diffSize: 400 }),
      );
      expect(result.escalated).toBe(false);
    });
  });

  // ── escalationReason field contract ──────────────────────────────────────

  describe('escalationReason field contract', () => {
    it('is undefined when no escalation occurs', () => {
      const result = service.resolve(makeDto({ tier: SoftwareTier.BASIC, diffSize: 10 }));
      expect(result.escalationReason).toBeUndefined();
    });

    it('is a string when escalation occurs', () => {
      const result = service.resolve(
        makeDto({ tier: SoftwareTier.BASIC, jobType: SoftwareJobType.MIGRATE_DATA }),
      );
      expect(typeof result.escalationReason).toBe('string');
      expect((result.escalationReason as string).length).toBeGreaterThan(0);
    });

    it('includes the specific diff size number when that trigger fires', () => {
      const result = service.resolve(makeDto({ tier: SoftwareTier.BASIC, diffSize: 750 }));
      expect(result.escalationReason).toContain('750');
    });

    it('includes dollar value when job value triggers thorough', () => {
      const result = service.resolve(makeDto({ tier: SoftwareTier.BASIC, jobValueUsd: 3500 }));
      expect(result.escalationReason).toContain('3500');
    });
  });
});
