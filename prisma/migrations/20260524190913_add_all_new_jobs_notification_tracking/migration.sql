-- AlterTable
ALTER TABLE "Job" ADD COLUMN "allNewJobsNotifiedAt" DATETIME;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_NotificationDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "notificationType" TEXT NOT NULL DEFAULT 'RECOMMENDED_JOBS',
    "windowHours" INTEGER NOT NULL DEFAULT 1,
    "recommendationCount" INTEGER NOT NULL DEFAULT 0,
    "jobCount" INTEGER NOT NULL DEFAULT 0,
    "messagePreview" TEXT,
    "errorMessage" TEXT,
    "sentAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recommendationRunId" TEXT,
    CONSTRAINT "NotificationDelivery_recommendationRunId_fkey" FOREIGN KEY ("recommendationRunId") REFERENCES "RecommendationRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_NotificationDelivery" ("channel", "createdAt", "errorMessage", "id", "messagePreview", "recommendationCount", "recommendationRunId", "sentAt", "status", "windowHours") SELECT "channel", "createdAt", "errorMessage", "id", "messagePreview", "recommendationCount", "recommendationRunId", "sentAt", "status", "windowHours" FROM "NotificationDelivery";
DROP TABLE "NotificationDelivery";
ALTER TABLE "new_NotificationDelivery" RENAME TO "NotificationDelivery";
CREATE INDEX "NotificationDelivery_channel_createdAt_idx" ON "NotificationDelivery"("channel", "createdAt");
CREATE INDEX "NotificationDelivery_status_createdAt_idx" ON "NotificationDelivery"("status", "createdAt");
CREATE INDEX "NotificationDelivery_notificationType_createdAt_idx" ON "NotificationDelivery"("notificationType", "createdAt");
CREATE INDEX "NotificationDelivery_recommendationRunId_idx" ON "NotificationDelivery"("recommendationRunId");
CREATE TABLE "new_UserNotificationPreference" (
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
    "allNewJobsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "allNewJobsLookbackHours" INTEGER NOT NULL DEFAULT 1,
    "allNewJobsMaxJobs" INTEGER NOT NULL DEFAULT 50,
    "allNewJobsMaxCompanies" INTEGER NOT NULL DEFAULT 10,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserNotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_UserNotificationPreference" ("channel", "createdAt", "discordWebhookUrl", "enabled", "id", "lookbackHours", "maxJobs", "maxJobsPerCompany", "slackWebhookUrl", "telegramBotToken", "telegramChatId", "updatedAt", "userId") SELECT "channel", "createdAt", "discordWebhookUrl", "enabled", "id", "lookbackHours", "maxJobs", "maxJobsPerCompany", "slackWebhookUrl", "telegramBotToken", "telegramChatId", "updatedAt", "userId" FROM "UserNotificationPreference";
DROP TABLE "UserNotificationPreference";
ALTER TABLE "new_UserNotificationPreference" RENAME TO "UserNotificationPreference";
CREATE INDEX "UserNotificationPreference_userId_idx" ON "UserNotificationPreference"("userId");
CREATE UNIQUE INDEX "UserNotificationPreference_userId_channel_key" ON "UserNotificationPreference"("userId", "channel");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Job_isActive_firstSeenAt_idx" ON "Job"("isActive", "firstSeenAt");

-- CreateIndex
CREATE INDEX "Job_allNewJobsNotifiedAt_idx" ON "Job"("allNewJobsNotifiedAt");
