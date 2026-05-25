-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_UserOnboarding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "onboardingCompleted" BOOLEAN NOT NULL DEFAULT false,
    "onboardingVersion" INTEGER NOT NULL DEFAULT 1,
    "prefsJson" TEXT,
    "completedAt" DATETIME,
    "requiresReboarding" BOOLEAN NOT NULL DEFAULT false,
    "reboardingReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserOnboarding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_UserOnboarding" ("completedAt", "createdAt", "id", "onboardingCompleted", "onboardingVersion", "prefsJson", "updatedAt", "userId") SELECT "completedAt", "createdAt", "id", "onboardingCompleted", "onboardingVersion", "prefsJson", "updatedAt", "userId" FROM "UserOnboarding";
DROP TABLE "UserOnboarding";
ALTER TABLE "new_UserOnboarding" RENAME TO "UserOnboarding";
CREATE UNIQUE INDEX "UserOnboarding_userId_key" ON "UserOnboarding"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Backfill: users who completed onboarding but have completedAt=NULL
-- (created before the completedAt column was tracked).
-- Use updatedAt as a safe proxy for when they completed.
UPDATE "UserOnboarding"
SET "completedAt" = "updatedAt"
WHERE "onboardingCompleted" = true AND "completedAt" IS NULL;
