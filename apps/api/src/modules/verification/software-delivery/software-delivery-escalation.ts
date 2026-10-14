import { Injectable } from '@nestjs/common';
import type { SoftwareDeliveryVerifyDto } from './dto/software-delivery-verify.dto.js';
import { SoftwareTier } from './dto/software-delivery-verify.dto.js';

export type SoftwareVerificationTier = 'BASIC' | 'STANDARD' | 'THOROUGH';

@Injectable()
export class SoftwareDeliveryEscalationService {

  resolve(dto: SoftwareDeliveryVerifyDto): { tier: SoftwareVerificationTier; escalated: boolean; escalationReason: string | undefined } {
    let tier: SoftwareVerificationTier = dto.tier as SoftwareVerificationTier;
    let escalationReason: string | undefined;

    // Auto-escalate to STANDARD
    if (tier === 'BASIC') {
      const triggers = this.getStandardEscalationTriggers(dto);
      if (triggers.length > 0) {
        tier = 'STANDARD';
        escalationReason = `Auto-escalated to Standard: ${triggers.join('; ')}`;
      }
    }

    // Auto-escalate to THOROUGH
    if (tier !== 'THOROUGH') {
      const triggers = this.getThoroughEscalationTriggers(dto);
      if (triggers.length > 0) {
        tier = 'THOROUGH';
        escalationReason = `Auto-escalated to Thorough: ${triggers.join('; ')}`;
      }
    }

    return {
      tier,
      escalated: tier !== (dto.tier as string),
      escalationReason,
    };
  }

  private getStandardEscalationTriggers(dto: SoftwareDeliveryVerifyDto): string[] {
    const triggers: string[] = [];
    const desc = (dto.jobDescription ?? '').toLowerCase();

    if (dto.jobType === 'MIGRATE_DATA') triggers.push('data migration job type always requires Standard');
    if (dto.jobType === 'BUILD_INTEGRATION') triggers.push('integration build requires Standard verification');
    if ((dto.diffSize ?? 0) > 500) triggers.push(`diff size ${dto.diffSize} lines > 500 line threshold`);
    if (['production', 'live data', 'customer-facing', 'api key', 'live environment'].some(kw => desc.includes(kw))) {
      triggers.push('sensitive keywords detected in job description');
    }

    return triggers;
  }

  private getThoroughEscalationTriggers(dto: SoftwareDeliveryVerifyDto): string[] {
    const triggers: string[] = [];
    const desc = (dto.jobDescription ?? '').toLowerCase();

    if ((dto.diffSize ?? 0) > 1500) triggers.push(`diff size ${dto.diffSize} lines > 1500 line threshold`);
    if ((dto.jobValueUsd ?? 0) > 2000) triggers.push(`job value $${dto.jobValueUsd} > $2,000 threshold`);
    if (['compliance', 'hipaa', 'pci', 'gdpr', 'concurrent', 'scale', 'regulatory'].some(kw => desc.includes(kw))) {
      triggers.push('high-risk compliance keywords in description');
    }

    return triggers;
  }
}
