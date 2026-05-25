# JobRadar — System Logic & Architecture

A concise reference for how data flows through the major subsystems: job sync, recommendation generation, new-job detection, and per-user preference resolution.

---

## 1. Job Sync Pipeline

Runs on a schedule (hourly cron) or on demand via `POST /api/sync/start`.

```mermaid
flowchart TD
    A([Cron / API trigger]) --> SR[resolveGlobalSyncSources]
    SR --> C{Global source\nmode?}
    C -- none  --> SK[Create SKIPPED SyncRun\nreason: NO_SOURCES_CONFIGURED]
    SK --> P([Done])
    C -- has sources --> F[Fetch jobs from\nprovider API for each source]
    F --> G{HTTP OK?}
    G -- No  --> H[Log error in\nSyncSourceRun]
    G -- Yes --> I[Parse response\nper provider]
    I --> J[Compute jobFingerprint\ncompany+title+location hash]
    J --> K{Fingerprint\nalready in DB?}
    K -- No  --> L[INSERT new Job\nfirstSeenAt = now]
    K -- Yes --> M[UPDATE lastSeenAt\nmark isActive = true]
    L & M --> N[Mark stale jobs\ninactive]
    N --> O[Write SyncSourceRun\nOK + counts]
    O --> P
```

**Key tables:** `JobSource`, `Job`, `SyncRun`, `SyncSourceRun`

**Source resolution for sync:** `resolveGlobalSyncSources()` in `lib/services/source-resolution.ts`. Returns all globally-enabled `JobSource` rows, or `mode: "none"` if none exist. Sync is always global (system-wide) — there is no per-user source filtering at sync time.

---

## 2. Recommendation Engine

Runs after sync, or on demand via `POST /api/recommendations/run`.

```mermaid
flowchart TD
    A([Trigger]) --> B[Load UserRoleProfile rows\n for this user]
    B --> C[Load unseen active jobs\nsince last run]
    C --> D{Jobs found?}
    D -- No --> Z([Done — no-op])
    D -- Yes --> E[For each job × profile pair\ncompute match score]
    E --> F{score ≥ profile.minScore\nAND prefs.minScore?}
    F -- No  --> G[Skip — below threshold]
    F -- Yes --> H{Blocked company?}
    H -- Yes --> I[Skip — blocked]
    H -- No  --> J{requiresSponsorship\nmatch?}
    J -- No  --> K[Skip — sponsorship mismatch]
    J -- Yes --> L[INSERT UserJobRecommendation\nwith score + profile ref]
    L --> M[Mark job seen in\nUserJobStatus]
    G & I & K & M --> N[Write UserRecommendationRun\nwith counts]
    N --> O([Done])
```

**Score components:**
- Title match against `preferredTitles` → up to 40 pts
- Must-have keywords present → up to 30 pts
- Nice-to-have keywords present → up to 15 pts
- Negative keywords absent → up to 15 pts (penalty if present)
- Location preference match → bonus

**Key tables:** `UserRoleProfile`, `UserJobPreference`, `UserJobRecommendation`, `UserRecommendationRun`, `UserJobStatus`

---

## 3. New-Job Detection

Powers the "New since last visit" badge and optional notifications.

```mermaid
flowchart TD
    A([GET /api/jobs/new-counts]) --> B[Read effectiveNewAt\nfrom Job table]
    B --> C[Compare against\nuser's lastSeenAt timestamp]
    C --> D[Count jobs where\neffectiveNewAt > lastSeenAt]
    D --> E[Return count per\nrole profile bucket]
    E --> F([Response])

    G([Notification trigger]) --> H{NOTIFICATIONS_ENABLED?}
    H -- No  --> Z([Skip])
    H -- Yes --> I[Query new recommendations\nsince last delivery]
    I --> J{count > 0?}
    J -- No  --> Z
    J -- Yes --> K[Send via NOTIFICATION_CHANNEL\nslack / email / webhook]
    K --> L[Write NotificationDelivery row]
    L --> Z
```

**effectiveNewAt** is set to `firstSeenAt` for brand-new jobs, or bumped to `NOW()` when a previously-inactive job becomes active again after an absence. This lets "new" mean "genuinely appeared recently" rather than "first ever seen."

---

## 4. Source Resolution & User Preference Layers

`lib/services/source-resolution.ts` is the single source of truth for which sources a user may see recommendations from.

```mermaid
flowchart TD
    A([resolveUserSources userId]) --> B{UserJobSource\nrows exist?}
    B -- Yes --> PM[mode: profile\nallowedSourceIds = user's IDs]
    B -- No  --> C{UserJobPreference\nuseGlobalDefaultSources = true?}
    C -- Yes --> GD[mode: global_defaults\nallowedSourceIds = null\nuses all enabled JobSource rows]
    C -- No  --> NO[mode: none\nNO_SOURCES_CONFIGURED\ncanSync = false]
```

**Source modes:**

| Mode | Trigger | Recommendations use |
|---|---|---|
| `profile` | User has ≥1 `UserJobSource` row | Only jobs from those sources |
| `global_defaults` | No user sources; `useGlobalDefaultSources = true` | All globally-enabled `JobSource` rows |
| `none` | No user sources; `useGlobalDefaultSources = false` | None — `NO_SOURCES_CONFIGURED` |

**Per-user config layers:**

```mermaid
flowchart LR
    subgraph Global
        GS[JobSource\nglobal enabled list]
        GJ[Job\nglobal job store]
    end

    subgraph User layer
        UJS[UserJobSource\nper-user source list]
        URP[UserRoleProfile\nper-user role profiles]
        UJP[UserJobPreference\nminScore · sponsorship · blocked\nuseGlobalDefaultSources]
        UJS_STATUS[UserJobStatus\nsaved · applied · hidden]
    end

    GS -->|global_defaults mode| REC
    UJS -->|profile mode| REC[Recommendation engine]
    GJ -->|job pool| REC
    URP -->|title + keyword matching| REC
    UJP -->|score threshold + sponsorship + blocked| REC
    REC --> UJR[UserJobRecommendation]
    UJR --> UJS_STATUS
```

---

## 5. Onboarding → Config Mapping

Shows how onboarding wizard answers flow into DB tables.

```mermaid
flowchart TD
    W([Onboarding wizard\nPOST /api/onboarding]) --> P[Parse OnboardingData]
    P --> UP[Upsert UserJobPreference\nminScore · sponsorship\ntargetLocations · targetRoles\nblockedCompanies]
    P --> RP[Create UserRoleProfile\n"My Job Search Profile"\npreferredTitles = selected titles\nmustHaveKeywords = selected skills]
    P --> OB[Mark UserOnboarding\nonboardingCompleted = true]
    UP & RP & OB --> J([Issue JWT cookie\nonboardingCompleted claim = true])
    J --> HOME([Redirect → /])
```

---

## 6. Reset Modes

`POST /api/profile/reset` with `{ mode }`:

| Mode | What it clears | Requires |
|---|---|---|
| `prefs` | `UserJobPreference` → defaults; clears `prefsJson` | — |
| `onboarding` | Sets `onboardingCompleted = false`; clears `prefsJson` | — |
| `sources` | Deletes all `UserJobSource` rows | — |
| `jobs` | Deletes `UserJobStatus`, `UserJobRecommendation`, `UserRecommendationRun` | — |
| `workspace` | All of the above + deletes `UserRoleProfile` rows | `confirm: "RESET"` |
