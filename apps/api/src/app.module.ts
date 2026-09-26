import { Module } from '@nestjs/common';
import { DatabaseModule } from './modules/database/database.module.js';
import { ChainVerifyAdaptersModule } from './modules/adapters/adapters.module.js';
import { InvoiceProofModule } from './modules/invoice-proof/invoice-proof.module.js';
import { VerificationModule } from './modules/verification/verification.module.js';

@Module({imports:[DatabaseModule,ChainVerifyAdaptersModule,VerificationModule,InvoiceProofModule]})
export class AppModule {}
