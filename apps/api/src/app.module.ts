import { Module } from '@nestjs/common';
import { DatabaseModule } from './modules/database/database.module.js';
import { ChainVerifyAdaptersModule } from './modules/adapters/adapters.module.js';
import { InvoiceProofModule } from './modules/invoice-proof/invoice-proof.module.js';

@Module({imports:[DatabaseModule,ChainVerifyAdaptersModule,InvoiceProofModule]})
export class AppModule {}
