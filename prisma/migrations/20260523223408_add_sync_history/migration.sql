-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "status" TEXT NOT NULL,
    "sourcesProcessed" INTEGER NOT NULL DEFAULT 0,
    "sourcesSucceeded" INTEGER NOT NULL DEFAULT 0,
    "sourcesFailed" INTEGER NOT NULL DEFAULT 0,
    "jobsCreated" INTEGER NOT NULL DEFAULT 0,
    "jobsUpdated" INTEGER NOT NULL DEFAULT 0,
    "jobsMarkedStale" INTEGER NOT NULL DEFAULT 0,
    "errorSummary" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SyncSourceRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "syncRunId" TEXT NOT NULL,
    "sourceId" TEXT,
    "company" TEXT,
    "provider" TEXT,
    "status" TEXT NOT NULL,
    "jobsFetched" INTEGER NOT NULL DEFAULT 0,
    "jobsCreated" INTEGER NOT NULL DEFAULT 0,
    "jobsUpdated" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "SyncSourceRun_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "SyncRun" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
