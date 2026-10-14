-- CreateEnum
CREATE TYPE "SoftwareVerificationTier" AS ENUM ('BASIC', 'STANDARD', 'THOROUGH');

-- CreateEnum
CREATE TYPE "SoftwareJobType" AS ENUM ('BUG_FIX', 'DEPLOY_UPDATE', 'WRITE_TESTS', 'MIGRATE_DATA', 'BUILD_INTEGRATION', 'NEW_FEATURE', 'CODE_REVIEW');

-- CreateEnum
CREATE TYPE "DeployPlatform" AS ENUM ('NETLIFY', 'RENDER', 'VERCEL', 'RAILWAY', 'OTHER');

-- CreateEnum
CREATE TYPE "CheckResultStatus" AS ENUM ('PASS', 'FAIL', 'WARNING', 'SKIP');

-- CreateEnum
CREATE TYPE "SoftwareVerificationStatus" AS ENUM ('PASSED', 'FAILED', 'NEEDS_REVIEW', 'ESCALATED');

-- CreateTable
CREATE TABLE "SoftwareDeliveryVerification" (
    "id" TEXT NOT NULL,
    "proofId" TEXT NOT NULL,
    "organizationId" TEXT,
    "tier" "SoftwareVerificationTier" NOT NULL,
    "jobType" "SoftwareJobType" NOT NULL,
    "repoOwner" TEXT NOT NULL,
    "repoName" TEXT NOT NULL,
    "beforeSha" TEXT NOT NULL,
    "afterSha" TEXT NOT NULL,
    "jobStartedAt" TIMESTAMP(3) NOT NULL,
    "jobDescription" TEXT,
    "aiReport" TEXT,
    "deployUrl" TEXT,
    "deployPlatform" "DeployPlatform",
    "prNumber" INTEGER,
    "diffSize" INTEGER,
    "jobValueUsd" DOUBLE PRECISION,
    "checksRun" INTEGER NOT NULL DEFAULT 0,
    "checksPassed" INTEGER NOT NULL DEFAULT 0,
    "checksFailed" INTEGER NOT NULL DEFAULT 0,
    "checksWarning" INTEGER NOT NULL DEFAULT 0,
    "checksSkipped" INTEGER NOT NULL DEFAULT 0,
    "overallStatus" "SoftwareVerificationStatus" NOT NULL,
    "escalated" BOOLEAN NOT NULL DEFAULT false,
    "escalationReason" TEXT,
    "buyerSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SoftwareDeliveryVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SoftwareDeliveryCheckResult" (
    "id" TEXT NOT NULL,
    "verificationId" TEXT NOT NULL,
    "checkId" TEXT NOT NULL,
    "checkName" TEXT NOT NULL,
    "tier" "SoftwareVerificationTier" NOT NULL,
    "status" "CheckResultStatus" NOT NULL,
    "detail" TEXT,
    "evidence" JSONB,
    "durationMs" INTEGER,

    CONSTRAINT "SoftwareDeliveryCheckResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SoftwareDeliveryVerification_proofId_key" ON "SoftwareDeliveryVerification"("proofId");

-- CreateIndex
CREATE INDEX "SoftwareDeliveryVerification_organizationId_createdAt_idx" ON "SoftwareDeliveryVerification"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "SoftwareDeliveryCheckResult_verificationId_idx" ON "SoftwareDeliveryCheckResult"("verificationId");

-- AddForeignKey
ALTER TABLE "SoftwareDeliveryCheckResult" ADD CONSTRAINT "SoftwareDeliveryCheckResult_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "SoftwareDeliveryVerification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

