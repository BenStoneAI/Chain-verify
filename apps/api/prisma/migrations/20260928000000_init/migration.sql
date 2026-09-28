-- CreateEnum
CREATE TYPE "ProofProductType" AS ENUM ('INVOICE_PROOF', 'AUDIT_PROOF', 'VERIFY_API');

-- CreateEnum
CREATE TYPE "ProofEntitlementStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProofProduct" AS ENUM ('INVOICE_AUDIT', 'IDENTITY_CHECK', 'DOCUMENT_VERIFY', 'COMPLIANCE_SCAN');

-- CreateEnum
CREATE TYPE "ProofSubject" AS ENUM ('INVOICE', 'IDENTITY', 'DOCUMENT', 'COMPLIANCE');

-- CreateEnum
CREATE TYPE "ProofFinalDecision" AS ENUM ('APPROVED', 'REJECTED', 'ESCALATED', 'INCONCLUSIVE');

-- CreateEnum
CREATE TYPE "ProofStatus" AS ENUM ('CREATED', 'EXPORTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ProofSourceType" AS ENUM ('UPLOAD', 'URL', 'API_PUSH', 'WEBHOOK');

-- CreateEnum
CREATE TYPE "ProofRunStatus" AS ENUM ('QUEUED', 'PROCESSING', 'PASSED', 'FAILED', 'NEEDS_REVIEW', 'ERROR');

-- CreateEnum
CREATE TYPE "ProofRiskLevel" AS ENUM ('UNKNOWN', 'LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "OrgDataSource" AS ENUM ('MANUAL', 'QUICKBOOKS', 'XERO', 'NETSUITE', 'SAGE', 'BILLDOTCOM', 'VENDOR_PORTAL_VERIFIED', 'ERP');

-- CreateEnum
CREATE TYPE "InvoiceScanRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "OrgVendorStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'REVIEW');

-- CreateEnum
CREATE TYPE "OrgPoStatus" AS ENUM ('OPEN', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ErpProvider" AS ENUM ('QUICKBOOKS', 'XERO', 'NETSUITE', 'SAGE', 'BILLDOTCOM');

-- CreateEnum
CREATE TYPE "ScanApprovalStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'BLOCKED');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "stripeCustomerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProofProductEntitlement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "product" "ProofProductType" NOT NULL,
    "planSlug" TEXT NOT NULL,
    "status" "ProofEntitlementStatus" NOT NULL DEFAULT 'ACTIVE',
    "monthlyLimit" INTEGER,
    "periodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "periodEnd" TIMESTAMP(3),
    "stripeSubscriptionId" TEXT,
    "stripeSessionId" TEXT,
    "stripeSubscriptionItemId" TEXT,
    "meteredBillingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProofProductEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proof_pilot_intakes" (
    "id" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "planSlug" TEXT,
    "companyName" TEXT NOT NULL,
    "contactName" TEXT,
    "contactEmail" TEXT NOT NULL,
    "workflowName" TEXT,
    "agentCount" INTEGER,
    "invoiceCount" INTEGER,
    "notes" TEXT,
    "stripeSessionId" TEXT,
    "organizationId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "sourcePath" TEXT,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proof_pilot_intakes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proof_free_scans" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "emailHash" TEXT,
    "ipHash" TEXT,
    "product" TEXT NOT NULL DEFAULT 'invoice-proof',
    "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proof_free_scans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_runs" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "product" "ProofProduct" NOT NULL,
    "source_type" "ProofSourceType" NOT NULL,
    "status" "ProofRunStatus" NOT NULL DEFAULT 'QUEUED',
    "risk_level" "ProofRiskLevel" NOT NULL DEFAULT 'UNKNOWN',
    "input_summary" TEXT NOT NULL,
    "output_summary" TEXT,
    "confidence" INTEGER,
    "checks_performed" JSONB NOT NULL DEFAULT '[]',
    "issues_found" JSONB NOT NULL DEFAULT '[]',
    "claim_token" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proof_records" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "verification_run_id" TEXT NOT NULL,
    "product" "ProofProduct" NOT NULL,
    "subject" "ProofSubject" NOT NULL,
    "summary" TEXT NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "final_decision" "ProofFinalDecision" NOT NULL,
    "proof_status" "ProofStatus" NOT NULL DEFAULT 'CREATED',
    "timeline" JSONB NOT NULL DEFAULT '[]',
    "export_urls" JSONB NOT NULL DEFAULT '[]',
    "chain_hash" TEXT,
    "prev_chain_hash" TEXT,
    "chain_seq" SERIAL NOT NULL,
    "conduit_proof_id" TEXT,
    "proof_signature" TEXT,
    "retention_expires_at" TIMESTAMP(3),
    "archived_at" TIMESTAMP(3),
    "retention_policy_days" INTEGER,
    "retention_status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proof_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerifyApiUsage" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerifyApiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proof_usage_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "proofId" TEXT,
    "verificationRunId" TEXT,
    "planSlug" TEXT NOT NULL,
    "isOverage" BOOLEAN NOT NULL DEFAULT false,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "overageCents" DOUBLE PRECISION,
    "stripeReported" BOOLEAN NOT NULL DEFAULT false,
    "stripeUsageRecordId" TEXT,
    "stripeReportAttempts" INTEGER NOT NULL DEFAULT 0,
    "nextStripeReportAt" TIMESTAMP(3),
    "lastStripeReportError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proof_usage_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_invoice_history" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "invoiceNo" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "poNumber" TEXT,
    "paidAt" TIMESTAMP(3),
    "source" "OrgDataSource" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "org_invoice_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_invoice_scan_runs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "userId" TEXT,
    "ipHash" TEXT,
    "invoiceCount" INTEGER NOT NULL,
    "findingCount" INTEGER NOT NULL DEFAULT 0,
    "criticalCount" INTEGER NOT NULL DEFAULT 0,
    "riskLevel" "InvoiceScanRiskLevel" NOT NULL DEFAULT 'LOW',
    "findings" JSONB NOT NULL DEFAULT '[]',
    "coverageSummary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "proofRecordId" TEXT,

    CONSTRAINT "org_invoice_scan_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_vendor_master" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "vendorName" TEXT NOT NULL,
    "city" TEXT,
    "state" TEXT,
    "expectedEmailDomain" TEXT,
    "bankRoutingNumber" TEXT,
    "bankAccountLast4" TEXT,
    "remitAddress" TEXT,
    "status" "OrgVendorStatus" NOT NULL DEFAULT 'ACTIVE',
    "source" "OrgDataSource" NOT NULL DEFAULT 'MANUAL',
    "contactEmail" TEXT,
    "externalId" TEXT,
    "bankDetailChangedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_vendor_master_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_po_register" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "poNumber" TEXT NOT NULL,
    "vendorName" TEXT NOT NULL,
    "authorizedAmount" DOUBLE PRECISION NOT NULL,
    "status" "OrgPoStatus" NOT NULL DEFAULT 'OPEN',
    "issuedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "source" "OrgDataSource" NOT NULL DEFAULT 'MANUAL',
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_po_register_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_erp_connections" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" "ErpProvider" NOT NULL,
    "encryptedTokens" TEXT NOT NULL,
    "realmId" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_erp_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_vendor_baselines" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "vendorName" TEXT NOT NULL,
    "avgAmount" DOUBLE PRECISION,
    "amountStdDev" DOUBLE PRECISION,
    "typicalFrequencyDays" DOUBLE PRECISION,
    "typicalPoNumbers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastInvoiceAt" TIMESTAMP(3),
    "sampleCount" INTEGER NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "org_vendor_baselines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scan_finding_approvals" (
    "id" TEXT NOT NULL,
    "scanRunId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "findingPattern" TEXT NOT NULL,
    "findingDetail" TEXT NOT NULL,
    "invoiceNo" TEXT,
    "vendor" TEXT,
    "status" "ScanApprovalStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "approverUserId" TEXT,
    "decisionNote" TEXT,
    "signatureHmac" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scan_finding_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_portal_tokens" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "vendorName" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "verifiedEmail" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_portal_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_identities" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "label" TEXT,
    "apiKeyHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_identities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "ProofProductEntitlement_organizationId_product_status_idx" ON "ProofProductEntitlement"("organizationId", "product", "status");

-- CreateIndex
CREATE INDEX "ProofProductEntitlement_stripeSessionId_idx" ON "ProofProductEntitlement"("stripeSessionId");

-- CreateIndex
CREATE INDEX "proof_pilot_intakes_product_idx" ON "proof_pilot_intakes"("product");

-- CreateIndex
CREATE INDEX "proof_pilot_intakes_contactEmail_idx" ON "proof_pilot_intakes"("contactEmail");

-- CreateIndex
CREATE INDEX "proof_pilot_intakes_organizationId_idx" ON "proof_pilot_intakes"("organizationId");

-- CreateIndex
CREATE INDEX "proof_pilot_intakes_stripeSessionId_idx" ON "proof_pilot_intakes"("stripeSessionId");

-- CreateIndex
CREATE INDEX "proof_pilot_intakes_status_idx" ON "proof_pilot_intakes"("status");

-- CreateIndex
CREATE INDEX "proof_free_scans_userId_product_idx" ON "proof_free_scans"("userId", "product");

-- CreateIndex
CREATE INDEX "proof_free_scans_emailHash_product_idx" ON "proof_free_scans"("emailHash", "product");

-- CreateIndex
CREATE INDEX "proof_free_scans_ipHash_product_idx" ON "proof_free_scans"("ipHash", "product");

-- CreateIndex
CREATE UNIQUE INDEX "verification_runs_claim_token_key" ON "verification_runs"("claim_token");

-- CreateIndex
CREATE INDEX "verification_runs_org_id_idx" ON "verification_runs"("org_id");

-- CreateIndex
CREATE INDEX "verification_runs_claim_token_idx" ON "verification_runs"("claim_token");

-- CreateIndex
CREATE INDEX "verification_runs_org_id_product_idx" ON "verification_runs"("org_id", "product");

-- CreateIndex
CREATE INDEX "verification_runs_org_id_status_idx" ON "verification_runs"("org_id", "status");

-- CreateIndex
CREATE INDEX "verification_runs_org_id_created_at_idx" ON "verification_runs"("org_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "proof_records_chain_seq_key" ON "proof_records"("chain_seq");

-- CreateIndex
CREATE INDEX "proof_records_org_id_idx" ON "proof_records"("org_id");

-- CreateIndex
CREATE INDEX "proof_records_org_id_product_idx" ON "proof_records"("org_id", "product");

-- CreateIndex
CREATE INDEX "proof_records_org_id_proof_status_idx" ON "proof_records"("org_id", "proof_status");

-- CreateIndex
CREATE INDEX "proof_records_org_id_final_decision_idx" ON "proof_records"("org_id", "final_decision");

-- CreateIndex
CREATE INDEX "proof_records_org_id_created_at_idx" ON "proof_records"("org_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "proof_records_org_id_chain_seq_idx" ON "proof_records"("org_id", "chain_seq" DESC);

-- CreateIndex
CREATE INDEX "proof_records_verification_run_id_idx" ON "proof_records"("verification_run_id");

-- CreateIndex
CREATE INDEX "proof_records_retention_status_retention_expires_at_idx" ON "proof_records"("retention_status", "retention_expires_at");

-- CreateIndex
CREATE INDEX "VerifyApiUsage_orgId_product_idx" ON "VerifyApiUsage"("orgId", "product");

-- CreateIndex
CREATE UNIQUE INDEX "VerifyApiUsage_orgId_product_periodKey_key" ON "VerifyApiUsage"("orgId", "product", "periodKey");

-- CreateIndex
CREATE INDEX "proof_usage_events_organizationId_product_createdAt_idx" ON "proof_usage_events"("organizationId", "product", "createdAt");

-- CreateIndex
CREATE INDEX "proof_usage_events_stripeReported_idx" ON "proof_usage_events"("stripeReported");

-- CreateIndex
CREATE INDEX "proof_usage_events_nextStripeReportAt_idx" ON "proof_usage_events"("nextStripeReportAt");

-- CreateIndex
CREATE INDEX "proof_usage_events_verificationRunId_isOverage_idx" ON "proof_usage_events"("verificationRunId", "isOverage");

-- CreateIndex
CREATE INDEX "org_invoice_history_organizationId_invoiceNo_idx" ON "org_invoice_history"("organizationId", "invoiceNo");

-- CreateIndex
CREATE INDEX "org_invoice_history_organizationId_vendor_idx" ON "org_invoice_history"("organizationId", "vendor");

-- CreateIndex
CREATE INDEX "org_invoice_history_organizationId_paidAt_idx" ON "org_invoice_history"("organizationId", "paidAt");

-- CreateIndex
CREATE INDEX "org_invoice_scan_runs_organizationId_createdAt_idx" ON "org_invoice_scan_runs"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "org_invoice_scan_runs_ipHash_createdAt_idx" ON "org_invoice_scan_runs"("ipHash", "createdAt");

-- CreateIndex
CREATE INDEX "org_vendor_master_organizationId_vendorName_idx" ON "org_vendor_master"("organizationId", "vendorName");

-- CreateIndex
CREATE INDEX "org_vendor_master_organizationId_status_idx" ON "org_vendor_master"("organizationId", "status");

-- CreateIndex
CREATE INDEX "org_po_register_organizationId_status_idx" ON "org_po_register"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "org_po_register_organizationId_poNumber_key" ON "org_po_register"("organizationId", "poNumber");

-- CreateIndex
CREATE UNIQUE INDEX "org_erp_connections_organizationId_provider_key" ON "org_erp_connections"("organizationId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "org_vendor_baselines_organizationId_vendorName_key" ON "org_vendor_baselines"("organizationId", "vendorName");

-- CreateIndex
CREATE INDEX "scan_finding_approvals_organizationId_status_idx" ON "scan_finding_approvals"("organizationId", "status");

-- CreateIndex
CREATE INDEX "scan_finding_approvals_scanRunId_idx" ON "scan_finding_approvals"("scanRunId");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_portal_tokens_token_key" ON "vendor_portal_tokens"("token");

-- CreateIndex
CREATE INDEX "vendor_portal_tokens_organizationId_vendorName_idx" ON "vendor_portal_tokens"("organizationId", "vendorName");

-- CreateIndex
CREATE UNIQUE INDEX "api_identities_apiKeyHash_key" ON "api_identities"("apiKeyHash");

-- CreateIndex
CREATE INDEX "api_identities_organizationId_active_idx" ON "api_identities"("organizationId", "active");

-- AddForeignKey
ALTER TABLE "ProofProductEntitlement" ADD CONSTRAINT "ProofProductEntitlement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proof_records" ADD CONSTRAINT "proof_records_verification_run_id_fkey" FOREIGN KEY ("verification_run_id") REFERENCES "verification_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_invoice_history" ADD CONSTRAINT "org_invoice_history_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_invoice_scan_runs" ADD CONSTRAINT "org_invoice_scan_runs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_vendor_master" ADD CONSTRAINT "org_vendor_master_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_po_register" ADD CONSTRAINT "org_po_register_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_erp_connections" ADD CONSTRAINT "org_erp_connections_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_vendor_baselines" ADD CONSTRAINT "org_vendor_baselines_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_finding_approvals" ADD CONSTRAINT "scan_finding_approvals_scanRunId_fkey" FOREIGN KEY ("scanRunId") REFERENCES "org_invoice_scan_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_finding_approvals" ADD CONSTRAINT "scan_finding_approvals_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_portal_tokens" ADD CONSTRAINT "vendor_portal_tokens_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_identities" ADD CONSTRAINT "api_identities_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
