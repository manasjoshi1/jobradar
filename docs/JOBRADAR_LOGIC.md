# JobRadar — System Logic & Architecture

A concise reference for how data flows through the major subsystems: job sync, recommendation generation, new-job detection, and per-user preference resolution.

---

## 1. Job Sync Pipeline

Runs on a schedule (hourly cron) or on demand via `POST /api/sync/start`.

```mermaid
flowchart TD
    A([Cron / API trigger]) --> B[Load enabled sources]
    B --> C{UserJobSource rows\nexist for user?}
    C -- Yes --> D[Filter to user's sources]
    C -- No  --> E[Use all enabled\nglobal sources]
    D & E --> F[Fetch jobs from\nprovider API]
    F --> G{HTTP OK?}
    G -- No  --> H[Log error in\nSyncSourceRun]
    G -- Yes --> I[Parse response\nper provider]
    I --> J[Compute jobFingerprint\ncompany+title+location hash]
    J --> K{Fingerprint\nalready in DB?}
    K -- No  --> L[INSERT new Job\nfirstSeenAt = now]
    K -- Yes --> M[UPDATE lastSeenAt\nmark isActive = true]
    L & M --> N[Mark stale jobs\ninactive]
    N --> O[Write SyncSourceRun\nOK + counts]
    O --> P([Done])
```

**Key tables:** `JobSource`, `UserJobSource`, `Job`, `SyncRun`, `SyncSourceRun`

**Fallback rule:** If a user has zero `UserJobSource` rows, sync and recommendations fall back to all globally-enabled `JobSource` rows. This preserves backward compatibility for single-user / default-user setups.

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

## 4. User Preference Resolution

Shows how per-user config layers over global config.

```mermaid
flowchart LR
    subgraph Global
        GS[JobSource\nglobal enabled list]
        GJ[Job\nglobal job store]
        GRP[RoleProfile\nglobal presets]
    end

    subgraph User layer
        UJS[UserJobSource\nper-user source enable/priority]
        URP[UserRoleProfile\nper-user role profiles]
        UJP[UserJobPreference\nminScore · sponsorship · blocked]
        UJS_STATUS[UserJobStatus\nsaved · applied · hidden]
    end

    GS -->|fallback if no UJS rows| SYNC[Sync pipeline]
    UJS -->|user's sources| SYNC
    SYNC --> GJ
    GJ -->|unfiltered jobs| REC[Recommendation engine]
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
