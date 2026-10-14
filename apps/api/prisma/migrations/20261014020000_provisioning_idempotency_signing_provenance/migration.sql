-- Provisioning idempotency, webhook dedupe, signing status, provenance.
-- Additive only. Generated with `prisma migrate diff` (schema after
-- 20261014010000 -> this schema), then reordered so every unique index exists
-- before the redundant plain index it replaces is dropped, plus a hand-written
-- signing_status backfill. Pre-checked on production (2026-10-14): 1 org,
-- 3 entitlements, 0 intakes, no Stripe ids populated, no duplicates.

-- AlterTable
ALTER TABLE "ProofProductEntitlement" ADD COLUMN     "canceledAt" TIMESTAMP(3),
ADD COLUMN     "graceUntil" TIMESTAMP(3),
ADD COLUMN     "lastPaymentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "proof_records" ADD COLUMN     "evidence_fingerprint" TEXT,
ADD COLUMN     "signing_error" TEXT,
ADD COLUMN     "signing_status" TEXT NOT NULL DEFAULT 'UNSIGNED',
ADD COLUMN     "stale_after" TIMESTAMP(3);

-- Backfill: rows that already carry a signature are SIGNED; the rest stay UNSIGNED.
UPDATE "proof_records" SET "signing_status" = 'SIGNED' WHERE "proof_signature" IS NOT NULL;

-- AlterTable
ALTER TABLE "api_identities" ADD COLUMN     "issuedForSessionId" TEXT,
ADD COLUMN     "keyPrefix" TEXT;

-- AlterTable
ALTER TABLE "SoftwareDeliveryVerification" ADD COLUMN     "confidenceCapReason" TEXT,
ADD COLUMN     "evidenceFingerprint" TEXT,
ADD COLUMN     "headSha" TEXT,
ADD COLUMN     "lifecycleStatus" TEXT,
ADD COLUMN     "provenanceSummary" JSONB,
ADD COLUMN     "receiptId" TEXT,
ADD COLUMN     "staleAfter" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "vendor_portal_otps" (
    "id" TEXT NOT NULL,
    "vendorPortalTokenId" TEXT NOT NULL,
    "vendorName" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_portal_otps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stripe_webhook_events" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "livemode" BOOLEAN NOT NULL,
    "objectId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "lastError" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "stripe_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vendor_portal_otps_vendorPortalTokenId_idx" ON "vendor_portal_otps"("vendorPortalTokenId");

-- CreateIndex
CREATE INDEX "vendor_portal_otps_organizationId_idx" ON "vendor_portal_otps"("organizationId");

-- CreateIndex
CREATE INDEX "stripe_webhook_events_type_receivedAt_idx" ON "stripe_webhook_events"("type", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_stripeCustomerId_key" ON "Organization"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "ProofProductEntitlement_stripeSubscriptionId_key" ON "ProofProductEntitlement"("stripeSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "ProofProductEntitlement_stripeSessionId_key" ON "ProofProductEntitlement"("stripeSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "proof_pilot_intakes_stripeSessionId_key" ON "proof_pilot_intakes"("stripeSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "api_identities_issuedForSessionId_key" ON "api_identities"("issuedForSessionId");

-- DropIndex (index-only, no data): superseded by the unique indexes above on the same column.
DROP INDEX "ProofProductEntitlement_stripeSessionId_idx";

-- DropIndex (index-only, no data): superseded by the unique index above on the same column.
DROP INDEX "proof_pilot_intakes_stripeSessionId_idx";
