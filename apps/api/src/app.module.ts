import { Module } from '@nestjs/common';
import { RateLimitingModule } from './common/rate-limiting.module.js';
import { DatabaseModule } from './modules/database/database.module.js';
import { ChainVerifyAdaptersModule } from './modules/adapters/adapters.module.js';
import { InvoiceProofModule } from './modules/invoice-proof/invoice-proof.module.js';
import { VerificationModule } from './modules/verification/verification.module.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { BillingModule } from './modules/billing/billing.module.js';

@Module({imports:[RateLimitingModule,DatabaseModule,ChainVerifyAdaptersModule,VerificationModule,InvoiceProofModule,AdminModule,BillingModule]})
export class AppModule {}
