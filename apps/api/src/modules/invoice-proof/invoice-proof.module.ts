import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { ChainVerifyAdaptersModule } from '../adapters/adapters.module.js';
import { VerificationModule } from '../verification/verification.module.js';
import { InvoiceProofController } from './invoice-proof.controller.js';
import { InvoiceProofService } from './invoice-proof.service.js';
import { InvoiceProofErpService } from './invoice-proof-erp.service.js';
import { InvoiceProofIntelligenceService } from './invoice-proof-intelligence.service.js';
import { InvoicePdfService } from './invoice-pdf.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';

@Module({
  // Chain Verify adapters supply narrow external-service boundaries; verification remains local.
  imports: [DatabaseModule, ChainVerifyAdaptersModule, VerificationModule],
  controllers: [InvoiceProofController],
  providers: [
    InvoiceProofService,
    InvoiceProofErpService,
    InvoiceProofIntelligenceService,
    InvoicePdfService,
    JwtAuthGuard,
  ],
  exports: [InvoiceProofService, InvoiceProofIntelligenceService],
})
export class InvoiceProofModule {}
