-- CreateTable
CREATE TABLE "NotificationDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "windowHours" INTEGER NOT NULL DEFAULT 1,
    "recommendationCount" INTEGER NOT NULL DEFAULT 0,
    "messagePreview" TEXT,
    "errorMessage" TEXT,
    "sentAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recommendationRunId" TEXT,
    CONSTRAINT "NotificationDelivery_recommendationRunId_fkey" FOREIGN KEY ("recommendationRunId") REFERENCES "RecommendationRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "NotificationDelivery_channel_createdAt_idx" ON "NotificationDelivery"("channel", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationDelivery_status_createdAt_idx" ON "NotificationDelivery"("status", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationDelivery_recommendationRunId_idx" ON "NotificationDelivery"("recommendationRunId");
