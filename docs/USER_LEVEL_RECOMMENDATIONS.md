# User-Level Recommendations — Migration Plan

## Current (single-tenant global model)

```
JobSource         → global
Job               → global, status is global
SyncRun           → global
RoleProfile       → global
JobRecommendation → global (notifiedAt, notificationDeliveryId added)
NotificationDelivery → global
User              → exists, single default user (foundation only)
UserNotificationPreference → per user, per channel
```

## Target (multi-user model)

```
JobSource         → global (unchanged)
Job               → global (unchanged, status moves to UserJobStatus)
SyncRun           → global (unchanged)

User              → real auth, email+password or OAuth
UserRoleProfile   → replaces global RoleProfile per user
UserJobStatus     → replaces Job.status per user
UserJobRecommendation → replaces JobRecommendation per user
UserNotificationPreference → already exists
UserNotificationDelivery  → future: per-user delivery log
```

## Migration Phases

### Phase A — Default User Assignment (safe to do now)
1. `User` table exists with one default user ✅
2. `UserNotificationPreference` exists, seeded from env ✅
3. Add `userId` FK to `RoleProfile` (nullable, existing = default user)
4. Add `userId` FK to `JobRecommendation` (nullable, existing = default user)
5. Migrate all existing rows to default user
6. No auth UI yet — single tenant still works

### Phase B — Add Authentication
1. NextAuth.js or Lucia auth
2. Email/password sign-up
3. Session management
4. Protect all pages behind auth
5. User-specific API routes

### Phase C — Per-User Job Status
1. Create `UserJobStatus` table:
   ```prisma
   model UserJobStatus {
     id     String @id @default(cuid())
     userId String
     jobId  String
     status String @default("NEW")  // NEW, SAVED, APPLIED, SKIPPED
     user   User   @relation(...)
     job    Job    @relation(...)
     @@unique([userId, jobId])
   }
   ```
2. Remove `Job.status` (or keep as denormalized global status)
3. All status queries filtered by userId

### Phase D — Per-User Scheduler
1. Each user has their own notification schedule preference
2. Scheduler runs recommendations per user's RoleProfiles
3. Notifications sent to each user's configured channel

## Current Foundation

These tables are already in the schema and ready:

```prisma
User {
  id, email, name, isDefault
  notificationPreferences UserNotificationPreference[]
}

UserNotificationPreference {
  userId, channel (SLACK/TELEGRAM/DISCORD)
  enabled, slackWebhookUrl, telegramBotToken, telegramChatId, discordWebhookUrl
  lookbackHours, maxJobs, maxJobsPerCompany
}
```

The notification service already reads from `UserNotificationPreference` with env fallback,
so adding more users just requires seeding their preferences.

## Key Design Constraints

- **Job table stays global** — jobs are scraped globally, not per user
- **RoleProfile becomes per-user** — each user defines their own search criteria
- **JobRecommendation becomes per-user** — scored against user's profiles
- **Job.status becomes UserJobStatus** — "Applied" is per-user, not global
- **SyncRun stays global** — one sync runs for all users

## API Changes Required in Phase B

```
GET  /api/recommendations          → filter by session userId
GET  /api/role-profiles            → filter by session userId
POST /api/role-profiles            → create for session userId
PATCH /api/recommendations/[id]/status → check ownership
GET  /api/settings/notifications   → session user's preferences
```

All currently global APIs become user-scoped automatically once userId FK
is added to the relevant models and the middleware extracts userId from session.
