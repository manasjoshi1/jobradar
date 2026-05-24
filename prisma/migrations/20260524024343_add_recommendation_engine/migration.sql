-- AlterTable
ALTER TABLE "Job" ADD COLUMN "effectiveNewAt" DATETIME;

-- CreateTable
CREATE TABLE "RoleProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "preferredTitles" TEXT NOT NULL,
    "preferredLocations" TEXT NOT NULL,
    "mustHaveKeywords" TEXT NOT NULL,
    "niceHaveKeywords" TEXT NOT NULL,
    "negativeKeywords" TEXT NOT NULL,
    "requiresSponsorship" BOOLEAN NOT NULL DEFAULT false,
    "minScore" INTEGER NOT NULL DEFAULT 50,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "JobRecommendation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "roleProfileId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "reason" TEXT,
    "matched" TEXT NOT NULL,
    "negatives" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UNSEEN',
    "recommendedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JobRecommendation_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "JobRecommendation_roleProfileId_fkey" FOREIGN KEY ("roleProfileId") REFERENCES "RoleProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RecommendationRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "status" TEXT NOT NULL,
    "windowStart" DATETIME NOT NULL,
    "windowEnd" DATETIME NOT NULL,
    "jobsScanned" INTEGER NOT NULL DEFAULT 0,
    "recommendationsCreated" INTEGER NOT NULL DEFAULT 0,
    "errorSummary" TEXT
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_JobSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "company" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "boardToken" TEXT,
    "url" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "tags" TEXT,
    "lastSyncAt" DATETIME,
    "lastSyncStatus" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_JobSource" ("company", "createdAt", "enabled", "id", "lastSyncAt", "lastSyncStatus", "provider", "updatedAt", "url") SELECT "company", "createdAt", "enabled", "id", "lastSyncAt", "lastSyncStatus", "provider", "updatedAt", "url" FROM "JobSource";
DROP TABLE "JobSource";
ALTER TABLE "new_JobSource" RENAME TO "JobSource";
CREATE UNIQUE INDEX "JobSource_url_key" ON "JobSource"("url");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "RoleProfile_name_key" ON "RoleProfile"("name");

-- CreateIndex
CREATE INDEX "JobRecommendation_recommendedAt_idx" ON "JobRecommendation"("recommendedAt");

-- CreateIndex
CREATE INDEX "JobRecommendation_status_recommendedAt_idx" ON "JobRecommendation"("status", "recommendedAt");

-- CreateIndex
CREATE INDEX "JobRecommendation_roleProfileId_recommendedAt_idx" ON "JobRecommendation"("roleProfileId", "recommendedAt");

-- CreateIndex
CREATE INDEX "JobRecommendation_status_idx" ON "JobRecommendation"("status");

-- CreateIndex
CREATE UNIQUE INDEX "JobRecommendation_jobId_roleProfileId_key" ON "JobRecommendation"("jobId", "roleProfileId");

-- CreateIndex
CREATE INDEX "Job_firstSeenAt_idx" ON "Job"("firstSeenAt");

-- CreateIndex
CREATE INDEX "Job_effectiveNewAt_idx" ON "Job"("effectiveNewAt");

-- CreateIndex
CREATE INDEX "Job_isActive_effectiveNewAt_idx" ON "Job"("isActive", "effectiveNewAt");
