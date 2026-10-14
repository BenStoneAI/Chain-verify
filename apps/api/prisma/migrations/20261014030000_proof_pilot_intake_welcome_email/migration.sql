-- Purchase welcome email: one-time send marker. Additive only (nullable, no default, no backfill).
-- Rollback: ALTER TABLE "proof_pilot_intakes" DROP COLUMN "welcomeEmailSentAt";

-- AlterTable
ALTER TABLE "proof_pilot_intakes" ADD COLUMN     "welcomeEmailSentAt" TIMESTAMP(3);
