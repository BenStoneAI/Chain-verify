import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { BillingModule } from '../billing/billing.module.js';
import { EmailModule } from '../email/email.module.js';
import { ConduitModule } from '../conduit/conduit.module.js';
import { VerificationModule } from '../verification/verification.module.js';
import { InvoiceProofController } from './invoice-proof.controller.js';
import { InvoiceProofService } from './invoice-proof.service.js';
import { InvoiceProofErpService } from './invoice-proof-erp.service.js';
import { InvoiceProofIntelligenceService } from './invoice-proof-intelligence.service.js';
import { InvoicePdfService } from './invoice-pdf.service.js';

@Module({
  // ConduitModule: supplies ConduitBrowserService for URL intake (Work Item
  // 2, scanUrl()) — reuses the real Conduit browser engine, not a second
  // scraping layer. See InvoiceProofService's constructor doc comment for
  // why ConduitBrowserService specifically, not ConduitSessionService.
  //
  // VerificationModule gives InvoiceProofService access to VerificationService +
  // ProofService — the same chain-hashed ProofRecord infrastructure VerifyAPI
  // uses — so every InvoiceProof scan mints a real, independently re-verifiable
  // proof artifact instead of only the lightweight OrgInvoiceScanRun audit row.
  imports: [DatabaseModule, AuthModule, BillingModule, EmailModule, ConduitModule, VerificationModule],
  controllers: [InvoiceProofController],
  providers: [
    InvoiceProofService,
    InvoiceProofErpService,
    InvoiceProofIntelligenceService,
    InvoicePdfService,
  ],
  exports: [InvoiceProofService, InvoiceProofIntelligenceService],
})
export class InvoiceProofModule {}
