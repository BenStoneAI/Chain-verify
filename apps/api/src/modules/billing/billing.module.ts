import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { ProofActivationController } from './proof-activation.controller.js';
import { ProofActivationService } from './proof-activation.service.js';
import { ProofBillingService } from './proof-billing.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [ProofActivationController],
  providers: [ProofActivationService, ProofBillingService],
  exports: [ProofBillingService, ProofActivationService],
})
export class BillingModule {}
