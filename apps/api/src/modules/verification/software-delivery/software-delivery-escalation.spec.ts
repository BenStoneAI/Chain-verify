import { describe, it, expect, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { SoftwareDeliveryEscalationService } from './software-delivery-escalation.js';
import { SoftwareTier, SoftwareJobType } from './dto/software-delivery-verify.dto.js';

function makeDto(overrides: Partial<{
  tier: SoftwareTier;
  jobType: SoftwareJobType;
  jobDescription: string;
  diffSize: number;
  jobValueUsd: number;
  repoOwner: string;
  repoName: string;
  beforeSha: string;
  afterSha: string;
  jobStartedAt: string;
}> = {}): any {
  return {
    tier: SoftwareTier.BASIC,
    jobType: SoftwareJobType.NEW_FEATURE,
    jobDescription: '',
    diffSize: 0,
    jobValueUsd: 0,
    repoOwner: 'test-owner',
    repoName: 'test-repo',
    beforeSha: 'abc123',
    afterSha: 'def456',
    jobStartedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('SoftwareDeliveryEscalationService', () => {
  let service: SoftwareDeliveryEscalationService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [SoftwareDeliveryEscalationService],
    }).compile();
    service = module.get(SoftwareDeliveryEscalationService);
  });

  describe('no escalation', () => {
    it('returns BASIC for a simple new feature with small diff', () => {
      const dto = makeDto({ tier: SoftwareTier.BASIC, jobType: SoftwareJobType.NEW_FEATURE, diffSize: 50 });
      const result = service.resolve(dto);
      expect(result.tier).toBe('BASIC');
      expect(result.escalated).toBe(false);
      expect(result.escalationReason).toBeUndefined();
    });

    it('returns STANDARD when caller requests STANDARD and no thorough triggers', () => {
      const dto = makeDto({ tier: SoftwareTier.STANDARD });
      const result = service.resolve(dto);
      expect(result.tier).toBe('STANDARD');
      expect(result.escalated).toBe(false);
    });

    it('returns THOROUGH unchanged when caller requests THOROUGH', () => {
      const dto = makeDto({ tier: SoftwareTier.THOROUGH });
      const result = service.resolve(dto);
      expect(result.tier).toBe('THOROUGH');
      expect(result.escalated).toBe(false);
    });
  });

  describe('BASIC → STANDARD escalation', () => {
    it('escalates MIGRATE_DATA job to STANDARD', () => {
      const dto = makeDto({ tier: SoftwareTier.BASIC, jobType: SoftwareJobType.MIGRATE_DATA });
      const result = service.resolve(dto);
      expect(result.tier).toBe('STANDARD');
      expect(result.escalated).toBe(true);
      expect(result.escalationReason).toContain('migration');
    });

    it('escalates BUILD_INTEGRATION job to STANDARD', () => {
      const dto = makeDto({ tier: SoftwareTier.BASIC, jobType: SoftwareJobType.BUILD_INTEGRATION });
      const result = service.resolve(dto);
      expect(result.tier).toBe('STANDARD');
      expect(result.escalated).toBe(true);
      expect(result.escalationReason).toContain('integration');
    });

    it('escalates when diffSize > 500', () => {
      const dto = makeDto({ tier: SoftwareTier.BASIC, diffSize: 501 });
      const result = service.resolve(dto);
      expect(result.tier).toBe('STANDARD');
      expect(result.escalated).toBe(true);
      expect(result.escalationReason).toContain('501');
    });

    it('does NOT escalate when diffSize is exactly 500', () => {
      const dto = makeDto({ tier: SoftwareTier.BASIC, diffSize: 500, jobType: SoftwareJobType.NEW_FEATURE });
      const result = service.resolve(dto);
      expect(result.tier).toBe('BASIC');
      expect(result.escalated).toBe(false);
    });

    it('escalates when jobDescription contains "production"', () => {
      const dto = makeDto({ tier: SoftwareTier.BASIC, jobDescription: 'Deploy to production environment' });
      const result = service.resolve(dto);
      expect(result.tier).toBe('STANDARD');
      expect(result.escalated).toBe(true);
    });

    it('escalates when jobDescription contains "live data"', () => {
      const dto = makeDto({ tier: SoftwareTier.BASIC, jobDescription: 'Processing live data from users' });
      const result = service.resolve(dto);
      expect(result.tier).toBe('STANDARD');
      expect(result.escalated).toBe(true);
    });

    it('escalates when jobDescription contains "customer-facing"', () => {
      const dto = makeDto({ tier: SoftwareTier.BASIC, jobDescription: 'This is a customer-facing change' });
      const result = service.resolve(dto);
      expect(result.tier).toBe('STANDARD');
      expect(result.escalated).toBe(true);
    });

    it('escalates when jobDescription contains "api key"', () => {
      const dto = makeDto({ tier: SoftwareTier.BASIC, jobDescription: 'Update the API key rotation logic' });
      const result = service.resolve(dto);
      expect(result.tier).toBe('STANDARD');
      expect(result.escalated).toBe(true);
    });

    it('keyword matching is case-insensitive', () => {
      const dto = makeDto({ tier: SoftwareTier.BASIC, jobDescription: 'Deploy to PRODUCTION environment' });
      const result = service.resolve(dto);
      expect(result.tier).toBe('STANDARD');
      expect(result.escalated).toBe(true);
    });
  });

  describe('→ THOROUGH escalation', () => {
    it('escalates when diffSize > 1500', () => {
      const dto = makeDto({ tier: SoftwareTier.BASIC, diffSize: 2000 });
      const result = service.resolve(dto);
      expect(result.tier).toBe('THOROUGH');
      expect(result.escalated).toBe(true);
      expect(result.escalationReason).toContain('Thorough');
    });

    it('escalates when jobValueUsd > 2000', () => {
      const dto = makeDto({ tier: SoftwareTier.STANDARD, jobValueUsd: 5000 });
      const result = service.resolve(dto);
      expect(result.tier).toBe('THOROUGH');
      expect(result.escalated).toBe(true);
    });

    it('escalates from BASIC when jobValueUsd > 2000', () => {
      const dto = makeDto({ tier: SoftwareTier.BASIC, jobValueUsd: 2001 });
      const result = service.resolve(dto);
      expect(result.tier).toBe('THOROUGH');
      expect(result.escalated).toBe(true);
    });

    it('does NOT escalate to THOROUGH when jobValueUsd is exactly 2000', () => {
      const dto = makeDto({ tier: SoftwareTier.STANDARD, jobValueUsd: 2000 });
      const result = service.resolve(dto);
      expect(result.tier).toBe('STANDARD');
      expect(result.escalated).toBe(false);
    });

    it('escalates when jobDescription contains "gdpr"', () => {
      const dto = makeDto({ tier: SoftwareTier.STANDARD, jobDescription: 'GDPR compliance update' });
      const result = service.resolve(dto);
      expect(result.tier).toBe('THOROUGH');
      expect(result.escalated).toBe(true);
    });

    it('escalates when jobDescription contains "hipaa"', () => {
      const dto = makeDto({ tier: SoftwareTier.BASIC, jobDescription: 'HIPAA-compliant data storage' });
      const result = service.resolve(dto);
      expect(result.tier).toBe('THOROUGH');
      expect(result.escalated).toBe(true);
    });

    it('escalates when jobDescription contains "pci"', () => {
      const dto = makeDto({ tier: SoftwareTier.BASIC, jobDescription: 'PCI DSS payment flow changes' });
      const result = service.resolve(dto);
      expect(result.tier).toBe('THOROUGH');
      expect(result.escalated).toBe(true);
    });

    it('escalates when jobDescription contains "compliance"', () => {
      const dto = makeDto({ tier: SoftwareTier.BASIC, jobDescription: 'Regulatory compliance reporting module' });
      const result = service.resolve(dto);
      expect(result.tier).toBe('THOROUGH');
      expect(result.escalated).toBe(true);
    });

    it('escalates when jobDescription contains "concurrent"', () => {
      const dto = makeDto({ tier: SoftwareTier.BASIC, jobDescription: 'Handle concurrent requests safely' });
      const result = service.resolve(dto);
      expect(result.tier).toBe('THOROUGH');
      expect(result.escalated).toBe(true);
    });

    it('escalates when jobDescription contains "scale"', () => {
      const dto = makeDto({ tier: SoftwareTier.BASIC, jobDescription: 'System must scale to 1M users' });
      const result = service.resolve(dto);
      expect(result.tier).toBe('THOROUGH');
      expect(result.escalated).toBe(true);
    });
  });

  describe('one-way escalation (never de-escalates)', () => {
    it('THOROUGH caller with no additional triggers stays THOROUGH, not de-escalated', () => {
      const dto = makeDto({ tier: SoftwareTier.THOROUGH, diffSize: 10, jobValueUsd: 0 });
      const result = service.resolve(dto);
      expect(result.tier).toBe('THOROUGH');
      expect(result.escalated).toBe(false);
    });

    it('STANDARD caller with no thorough triggers stays STANDARD', () => {
      const dto = makeDto({ tier: SoftwareTier.STANDARD, diffSize: 10 });
      const result = service.resolve(dto);
      expect(result.tier).toBe('STANDARD');
      expect(result.escalated).toBe(false);
    });
  });

  describe('escalationReason', () => {
    it('escalationReason is undefined when no escalation occurs', () => {
      const dto = makeDto({ tier: SoftwareTier.BASIC, diffSize: 10 });
      const result = service.resolve(dto);
      expect(result.escalationReason).toBeUndefined();
    });

    it('escalationReason is a non-empty string when escalated', () => {
      const dto = makeDto({ tier: SoftwareTier.BASIC, jobType: SoftwareJobType.MIGRATE_DATA });
      const result = service.resolve(dto);
      expect(typeof result.escalationReason).toBe('string');
      expect((result.escalationReason as string).length).toBeGreaterThan(0);
    });
  });
});
