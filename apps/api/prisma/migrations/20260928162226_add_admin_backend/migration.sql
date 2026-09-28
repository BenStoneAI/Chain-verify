-- CreateTable
CREATE TABLE "admin_identities" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "apiKeyHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_audit_logs" (
    "id" TEXT NOT NULL,
    "adminIdentityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_identities_apiKeyHash_key" ON "admin_identities"("apiKeyHash");

-- CreateIndex
CREATE INDEX "admin_identities_active_idx" ON "admin_identities"("active");

-- CreateIndex
CREATE INDEX "admin_audit_logs_adminIdentityId_createdAt_idx" ON "admin_audit_logs"("adminIdentityId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "admin_audit_logs_action_createdAt_idx" ON "admin_audit_logs"("action", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_adminIdentityId_fkey" FOREIGN KEY ("adminIdentityId") REFERENCES "admin_identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
