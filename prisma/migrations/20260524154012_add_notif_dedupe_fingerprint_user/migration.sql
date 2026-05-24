-- AlterTable
ALTER TABLE "Job" ADD COLUMN "jobFingerprint" TEXT;

-- AlterTable
ALTER TABLE "JobRecommendation" ADD COLUMN "notificationDeliveryId" TEXT;
ALTER TABLE "JobRecommendation" ADD COLUMN "notifiedAt" DATETIME;

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT,
    "name" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "UserNotificationPreference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "slackWebhookUrl" TEXT,
    "telegramBotToken" TEXT,
    "telegramChatId" TEXT,
    "discordWebhookUrl" TEXT,
    "lookbackHours" INTEGER NOT NULL DEFAULT 24,
    "maxJobs" INTEGER NOT NULL DEFAULT 10,
    "maxJobsPerCompany" INTEGER NOT NULL DEFAULT 2,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserNotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_isDefault_idx" ON "User"("isDefault");

-- CreateIndex
CREATE INDEX "UserNotificationPreference_userId_idx" ON "UserNotificationPreference"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserNotificationPreference_userId_channel_key" ON "UserNotificationPreference"("userId", "channel");

-- CreateIndex
CREATE INDEX "Job_jobFingerprint_idx" ON "Job"("jobFingerprint");

-- CreateIndex
CREATE INDEX "JobRecommendation_notifiedAt_idx" ON "JobRecommendation"("notifiedAt");

-- CreateIndex
CREATE INDEX "JobRecommendation_jobId_status_idx" ON "JobRecommendation"("jobId", "status");
