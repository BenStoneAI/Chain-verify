-- Enum values only. Postgres cannot use a new enum value inside the same
-- transaction that adds it, so these live in their own migration ahead of
-- 20261014020000_provisioning_idempotency_signing_provenance.
-- VERIFY_API is intentionally kept (read both, write AGENT_GATE).
-- ProofEntitlementStatus already has CANCELLED; no second "CANCELED" spelling is added.

-- AlterEnum
ALTER TYPE "ProofProductType" ADD VALUE IF NOT EXISTS 'AGENT_GATE';

-- AlterEnum
ALTER TYPE "ProofEntitlementStatus" ADD VALUE IF NOT EXISTS 'PAST_DUE';
