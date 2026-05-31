-- Migration: workday_lifecycle_fields
-- Adds four nullable columns to JobSource for Workday source lifecycle management.
-- All columns are nullable with no defaults — fully backward-compatible.

ALTER TABLE "JobSource" ADD COLUMN "fetchStrategy"      TEXT;
ALTER TABLE "JobSource" ADD COLUMN "verificationStatus" TEXT;
ALTER TABLE "JobSource" ADD COLUMN "nextRetryAt"        DATETIME;
ALTER TABLE "JobSource" ADD COLUMN "metadata"           TEXT;

-- Indexes for sync source-selection queries
CREATE INDEX "JobSource_provider_verificationStatus_idx" ON "JobSource"("provider", "verificationStatus");
CREATE INDEX "JobSource_enabled_nextRetryAt_idx"         ON "JobSource"("enabled", "nextRetryAt");
