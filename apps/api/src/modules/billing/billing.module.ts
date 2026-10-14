import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { ProofActivationController } from './proof-activation.controller.js';
import { ProofActivationService } from './proof-activation.service.js';
import { ProofBillingService } from './proof-billing.service.js';
import { StripeWebhookController } from './stripe-webhook.controller.js';
import { StripeProvisioningService } from './stripe-provisioning.service.js';
import { ProofCredentialController } from './proof-credential.controller.js';

@Module({
  imports: [DatabaseModule],
  controllers: [ProofActivationController, StripeWebhookController, ProofCredentialController],
  providers: [ProofActivationService, ProofBillingService, StripeProvisioningService],
  exports: [ProofBillingService, ProofActivationService, StripeProvisioningService],
})
export class BillingModule {}
