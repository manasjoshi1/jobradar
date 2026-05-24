-- CreateTable
CREATE TABLE "UserRoleProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
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
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserRoleProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserJobPreference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "targetLocations" TEXT,
    "targetRoles" TEXT,
    "blockedCompanies" TEXT,
    "preferredCompanies" TEXT,
    "minScore" INTEGER NOT NULL DEFAULT 45,
    "requiresSponsorship" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserJobPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserJobStatus" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "notes" TEXT,
    "appliedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserJobStatus_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "UserJobStatus_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserJobRecommendation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "userRoleProfileId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "reason" TEXT,
    "matched" TEXT NOT NULL,
    "negatives" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UNSEEN',
    "recommendedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" DATETIME,
    "notificationDeliveryId" TEXT,
    CONSTRAINT "UserJobRecommendation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "UserJobRecommendation_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "UserJobRecommendation_userRoleProfileId_fkey" FOREIGN KEY ("userRoleProfileId") REFERENCES "UserRoleProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserRecommendationRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "status" TEXT NOT NULL,
    "windowStart" DATETIME NOT NULL,
    "windowEnd" DATETIME NOT NULL,
    "jobsScanned" INTEGER NOT NULL DEFAULT 0,
    "recommendationsCreated" INTEGER NOT NULL DEFAULT 0,
    "recommendationsUpdated" INTEGER NOT NULL DEFAULT 0,
    "errorSummary" TEXT,
    CONSTRAINT "UserRecommendationRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "UserRoleProfile_userId_enabled_idx" ON "UserRoleProfile"("userId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "UserRoleProfile_userId_name_key" ON "UserRoleProfile"("userId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "UserJobPreference_userId_key" ON "UserJobPreference"("userId");

-- CreateIndex
CREATE INDEX "UserJobStatus_userId_status_idx" ON "UserJobStatus"("userId", "status");

-- CreateIndex
CREATE INDEX "UserJobStatus_userId_updatedAt_idx" ON "UserJobStatus"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserJobStatus_userId_jobId_key" ON "UserJobStatus"("userId", "jobId");

-- CreateIndex
CREATE INDEX "UserJobRecommendation_userId_status_recommendedAt_idx" ON "UserJobRecommendation"("userId", "status", "recommendedAt");

-- CreateIndex
CREATE INDEX "UserJobRecommendation_userId_notifiedAt_idx" ON "UserJobRecommendation"("userId", "notifiedAt");

-- CreateIndex
CREATE INDEX "UserJobRecommendation_userId_recommendedAt_idx" ON "UserJobRecommendation"("userId", "recommendedAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserJobRecommendation_userId_jobId_userRoleProfileId_key" ON "UserJobRecommendation"("userId", "jobId", "userRoleProfileId");

-- CreateIndex
CREATE INDEX "UserRecommendationRun_userId_startedAt_idx" ON "UserRecommendationRun"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "UserRecommendationRun_userId_status_idx" ON "UserRecommendationRun"("userId", "status");
