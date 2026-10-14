import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { SoftwareDeliveryService } from './software-delivery.service.js';
import { SoftwareDeliveryEscalationService } from './software-delivery-escalation.js';
import { GithubChecksService } from './checks/github-checks.service.js';
import { LiveChecksService } from './checks/live-checks.service.js';
import { SecurityChecksService } from './checks/security-checks.service.js';
import { DiffAnalysisService } from './checks/diff-analysis.service.js';
import { DeploymentChecksService } from './checks/deployment-checks.service.js';
import { JobTypeChecksService } from './checks/job-type-checks.service.js';
import { BuildChecksService } from './checks/build-checks.service.js';
import { BuildSandboxService } from './checks/build-sandbox.service.js';
import { ExternalToolChecksService } from './checks/external-tool-checks.service.js';
import { VerifyApiUsageService } from './verify-api-usage.service.js';

@Module({
  imports: [DatabaseModule],
  providers: [
    SoftwareDeliveryService,
    SoftwareDeliveryEscalationService,
    GithubChecksService,
    LiveChecksService,
    SecurityChecksService,
    DiffAnalysisService,
    DeploymentChecksService,
    JobTypeChecksService,
    BuildSandboxService,
    BuildChecksService,
    ExternalToolChecksService,
    VerifyApiUsageService,
  ],
  exports: [SoftwareDeliveryService, VerifyApiUsageService],
})
export class SoftwareDeliveryModule {}
