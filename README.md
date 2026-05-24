# JobRadar

A self-hosted job aggregator and recommendation engine. Pulls live listings from 300+ company job boards (Greenhouse, Lever, Ashby, custom), scores them against your personal role profiles, and delivers alerts to Telegram, Discord, or Slack. One Docker container, no cloud dependencies.

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![Prisma](https://img.shields.io/badge/Prisma-6-2D3748?logo=prisma)
![SQLite](https://img.shields.io/badge/SQLite-embedded-003B57?logo=sqlite)
![Docker](https://img.shields.io/badge/Docker-single--container-2496ED?logo=docker)

---

## What it does

| Feature | Detail |
|---------|--------|
| **Job sync** | Fetches 330+ company boards every hour via parallel HTTP (concurrency 8, hard 10 s timeout per source) |
| **Recommendation engine** | Scores every job against keyword-weighted role profiles (title, location, must-have, nice-have, negative) |
| **Notifications** | Sends top matches to Telegram, Discord, or Slack after each hourly sync |
| **History UI** | 5-tab dashboard — All Jobs, Recommended, Alerts, History, Sources |
| **Live sync progress** | Non-blocking `POST /api/sync/start` + polling `GET /api/sync/status?runId=` |
| **Fully self-hosted** | Single Docker container, SQLite on a local volume, no Redis, no external DB |

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Docker Container                  │
│                                                     │
│  Next.js 16 (App Router)                            │
│  ├─ /api/sync/start   POST → async background       │
│  ├─ /api/sync/status  GET  → live poll              │
│  ├─ /api/recommendations/*                          │
│  ├─ /api/history/*                                  │
│  └─ /api/diagnostics/*                              │
│                                                     │
│  lib/services/                                      │
│  ├─ sync-service.ts        p-limit concurrency      │
│  ├─ recommendation-service.ts  keyword scoring      │
│  ├─ notification-service.ts   Telegram/Discord/Slack│
│  └─ run-recovery-service.ts   stuck-run cleanup     │
│                                                     │
│  lib/scheduler.ts          node-cron, hourly        │
│  prisma/                   SQLite via Prisma ORM     │
└────────────────────┬────────────────────────────────┘
                     │ volume mount
              ./data/jobradar.db
```

**Providers supported:** Greenhouse · Lever · Ashby · Custom JSON/RSS

---

## Quick start — local dev

### Prerequisites

- Node.js 22+
- npm 10+

```bash
git clone https://github.com/YOUR_USERNAME/jobradar.git
cd jobradar

npm install
cp .env.example .env           # review and edit as needed

npx prisma migrate dev         # creates ./dev.db
npm run config:import          # loads config/job-sources.yml + role-profiles.yml
npm run db:seed                # optional: import 321 sources from bundled Excel

npm run dev                    # open http://localhost:3000
```

> `ENABLE_SCHEDULER=false` by default in local dev — the hourly cron does not run. Trigger syncs manually from the History tab or via `POST /api/sync/start`.

---

## Docker — production

### 1. Clone and configure

```bash
git clone https://github.com/YOUR_USERNAME/jobradar.git
cd jobradar
cp .env.example .env
```

Edit `.env` — at minimum set your notification credentials (see [Notification setup](#notification-setup)):

```env
NOTIFICATIONS_ENABLED=true
NOTIFICATION_CHANNEL=telegram
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_numeric_chat_id
APP_PUBLIC_URL=http://your-server-ip-or-domain
```

### 2. Build and start

```bash
docker compose up --build -d
```

The container automatically runs `prisma migrate deploy` on every start before launching Next.js.

### 3. Bootstrap (first deploy or after reset)

```bash
docker compose exec jobradar npm run deploy:bootstrap
```

This is **idempotent** — safe to run on every deploy. It:
1. Applies any pending Prisma migrations
2. Imports `config/job-sources.yml` and `config/role-profiles.yml`
3. Backfills any NULL `effectiveNewAt` values on existing jobs
4. Recovers any stuck `RUNNING` rows from a previous crash

Sample output:
```
▶ prisma migrate deploy          No pending migrations to apply.
▶ config:import                  Sources — Created: 0, Updated: 15 | Profiles — Created: 0, Updated: 7
▶ backfill effectiveNewAt        Nothing to backfill.
▶ recover abandoned runs         SyncRun rows recovered: 0

  Jobs              : 16821 active / 16826 total
  JobSources        : 332 enabled / 332 total
  RoleProfiles      : 7 enabled / 7 total
  Recommendations   : 59 total
  RUNNING SyncRuns  : 0
```

### 4. Import all job sources (optional)

The bundled `imports/public_job_api_targets_321.xlsx` contains 321 pre-configured company boards:

```bash
docker compose exec jobradar npm run db:seed
# Imported 321 sources: 317 created, 4 updated.
```

### 5. Trigger first sync

From the **History** tab → click **Start Sync**, or via API:

```bash
# Start (returns immediately with runId)
curl -X POST http://localhost:3000/api/sync/start
# {"runId":"abc123..."}

# Poll live progress
curl "http://localhost:3000/api/sync/status?runId=abc123..."
# {"status":"RUNNING","sourcesSucceeded":120,"sourcesProcessed":332,"jobsCreated":8500,...}

# Final result
# {"status":"PARTIAL_FAILURE","sourcesSucceeded":316,"sourcesFailed":16,"jobsCreated":22496,"durationMs":316914}
```

---

## Deploy to EC2 (or any Linux server)

### Install Docker on the server

```bash
ssh ubuntu@YOUR_SERVER_IP
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
# Log out and back in
```

### Transfer project and run

```bash
# From your local machine — transfer via tar over SSH
tar czf - \
  --exclude='.next' --exclude='node_modules' \
  --exclude='data' --exclude='.git' --exclude='*.db' \
  . | ssh ubuntu@YOUR_SERVER_IP "mkdir -p ~/jobradar && cd ~/jobradar && tar xzf -"

# Write production .env on server
ssh ubuntu@YOUR_SERVER_IP 'cat > ~/jobradar/.env' << 'EOF'
DATABASE_URL="file:/app/data/jobradar.db"
ENABLE_SCHEDULER=true
CRON_SECRET="change-me-in-production"
SYNC_FETCH_CONCURRENCY=8
SYNC_DB_CONCURRENCY=1
SOURCE_FETCH_TIMEOUT_MS=10000
SOURCE_FETCH_RETRIES=1
DEBUG_SYNC=false
NOTIFICATIONS_ENABLED=true
NOTIFICATION_CHANNEL=telegram
TELEGRAM_BOT_TOKEN=your_token
TELEGRAM_CHAT_ID=your_chat_id
APP_PUBLIC_URL=http://YOUR_SERVER_IP
EOF

# Build and start on port 80 using the prod override
ssh ubuntu@YOUR_SERVER_IP "
  cd ~/jobradar
  sudo docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d
"

# Bootstrap (imports config + profiles)
ssh ubuntu@YOUR_SERVER_IP "sudo docker exec jobradar npm run deploy:bootstrap"

# Import all 321 sources
ssh ubuntu@YOUR_SERVER_IP "sudo docker exec jobradar npm run db:seed"
```

App is now live at `http://YOUR_SERVER_IP`.

### Update deployment

```bash
# Transfer updated files
tar czf - --exclude='.next' --exclude='node_modules' --exclude='data' \
  --exclude='.git' --exclude='*.db' . \
  | ssh ubuntu@YOUR_SERVER_IP "cd ~/jobradar && tar xzf -"

# Rebuild and restart (data volume is preserved)
ssh ubuntu@YOUR_SERVER_IP "
  cd ~/jobradar
  sudo docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d
  sudo docker exec jobradar npm run deploy:bootstrap
"
```

---

## Configuration reference

### `.env` — all variables

```env
# ── Database ──────────────────────────────────────────────────────────────────
DATABASE_URL="file:./dev.db"
# Docker sets this to file:/app/data/jobradar.db automatically

# ── Config import ─────────────────────────────────────────────────────────────
# Directory containing job-sources.yml and role-profiles.yml
# Docker sets this to /app/config. Local default: ./config
# CONFIG_DIR=./config

# ── Job source spreadsheet ────────────────────────────────────────────────────
JOB_SOURCE_FILE="./imports/public_job_api_targets_321.xlsx"

# ── Scheduler ─────────────────────────────────────────────────────────────────
ENABLE_SCHEDULER=false        # set true only in Docker production
CRON_SECRET="change-me"       # protects /api/cron/hourly endpoint

# ── Sync performance ──────────────────────────────────────────────────────────
SYNC_FETCH_CONCURRENCY=8      # parallel HTTP fetches (8 = good default)
SYNC_DB_CONCURRENCY=1         # SQLite write slots — keep at 1
SOURCE_FETCH_TIMEOUT_MS=10000 # hard per-source timeout in ms
SOURCE_FETCH_RETRIES=1        # retry count on timeout/error (0 = no retry)
DEBUG_SYNC=false              # true = log per-source timing to console

# ── Notifications ─────────────────────────────────────────────────────────────
NOTIFICATIONS_ENABLED=false
NOTIFICATION_CHANNEL=telegram        # telegram | discord | slack
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
DISCORD_WEBHOOK_URL=
SLACK_WEBHOOK_URL=

# ── App ───────────────────────────────────────────────────────────────────────
APP_PUBLIC_URL=http://localhost:3000
```

### `config/job-sources.yml`

```yaml
providers:
  greenhouse:
    enabled: true
    jobsUrlTemplate: "https://boards-api.greenhouse.io/v1/boards/{boardToken}/jobs?content=true"
  lever:
    enabled: true
    jobsUrlTemplate: "https://api.lever.co/v0/postings/{boardToken}"
  ashby:
    enabled: true
    jobsUrlTemplate: "https://api.ashbyhq.com/posting-api/job-board/{boardToken}"

sources:
  - company: Stripe
    provider: greenhouse
    boardToken: stripe
    enabled: true
    priority: 10
    tags: ["payments", "fintech", "backend"]

  - company: Vercel
    provider: lever
    boardToken: vercel
    enabled: true
    priority: 8
```

Run `npm run config:import` (or `docker compose exec jobradar npm run config:import`) after any changes.

### `config/role-profiles.yml`

```yaml
profiles:
  - name: Backend Java / Spring / AWS
    enabled: true
    priority: 10
    minScore: 48              # only show jobs scoring >= this
    requiresSponsorship: false

    preferredTitles:          # +6 pts per match
      - software engineer
      - backend engineer
      - java developer

    preferredLocations:       # +4 pts per match
      - remote
      - united states
      - chicago

    mustHaveKeywords:         # +25 pts if ANY match (0 if none)
      - java
      - spring
      - spring boot

    niceHaveKeywords:         # +5 pts per match
      - aws
      - kafka
      - kubernetes
      - postgresql

    negativeKeywords:         # -8 pts per match
      - wordpress
      - salesforce admin
      - ios only
```

**Scoring:** title match → +6 | location → +4 | must-have (any) → +25 | nice-have → +5 | negative → −8 | clamped 0–100.

---

## Notification setup

### Telegram (recommended)

1. Message `@BotFather` → `/newbot` → copy the API token
2. Message `@userinfobot` → copy your numeric chat ID
3. Set in `.env`:
   ```env
   NOTIFICATIONS_ENABLED=true
   NOTIFICATION_CHANNEL=telegram
   TELEGRAM_BOT_TOKEN=123456789:AABBccDDeeFF-yourtoken
   TELEGRAM_CHAT_ID=987654321
   ```
4. Test:
   ```bash
   curl "https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<CHAT_ID>&text=JobRadar+test"
   ```

### Discord

1. Server Settings → Integrations → Webhooks → New Webhook → Copy URL
2. Set in `.env`:
   ```env
   NOTIFICATIONS_ENABLED=true
   NOTIFICATION_CHANNEL=discord
   DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/111/xxx
   ```

### Slack

1. `api.slack.com/apps` → Create app → Incoming Webhooks → Activate → Copy URL
2. Set in `.env`:
   ```env
   NOTIFICATIONS_ENABLED=true
   NOTIFICATION_CHANNEL=slack
   SLACK_WEBHOOK_URL=https://hooks.slack.com/services/T00/B00/xxx
   ```

---

## npm scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start dev server with hot reload (no scheduler) |
| `npm run build` | Production Next.js build |
| `npm run start` | Start production server |
| `npm run lint` | ESLint |
| `npm run db:migrate` | Create a new Prisma migration (dev only) |
| `npm run db:deploy` | Apply pending migrations (production) |
| `npm run db:seed` | Import job sources from XLSX file |
| `npm run db:studio` | Open Prisma Studio at http://localhost:5555 |
| `npm run config:import` | Import `job-sources.yml` + `role-profiles.yml` |
| `npm run db:backfill-effective-new-at` | Fix NULL `effectiveNewAt` on existing jobs |
| `npm run runs:recover [-- --threshold-minutes N]` | Mark stuck RUNNING rows as FAILED |
| `npm run deploy:bootstrap` | All-in-one safe deploy init |

---

## API reference

### Sync

| Endpoint | Method | Body / Params | Description |
|----------|--------|---------------|-------------|
| `/api/sync/start` | POST | — | Start async sync, returns `{ runId }` in ~350 ms |
| `/api/sync/status` | GET | `?runId=` | Poll live progress (sources, jobs, status) |
| `/api/sync` | GET / POST | — | Synchronous sync — waits for full completion |

### Recommendations

| Endpoint | Method | Body / Params | Description |
|----------|--------|---------------|-------------|
| `/api/recommendations` | GET | `?page= &pageSize= &status= &profileId= &window= &sponsorship=` | Paginated recommendations |
| `/api/recommendations/run` | POST | `{ "windowHours": 24 }` | Trigger scoring run |
| `/api/recommendations/counts` | GET | — | Counts by time window |
| `/api/recommendations/:id/status` | PATCH | `{ "status": "SAVED" }` | Update recommendation status |

### History

| Endpoint | Method | Params | Description |
|----------|--------|--------|-------------|
| `/api/history/sync-runs` | GET | `?page= &pageSize= &status=` | Paginated sync run history |
| `/api/history/sync-runs/:id` | GET | — | Full run detail with per-source breakdown |
| `/api/history/recommendation-runs` | GET | `?page= &pageSize=` | Recommendation run history |
| `/api/history/notifications` | GET | `?page= &pageSize= &channel= &status=` | Notification delivery history |

### Other

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/jobs` | GET | Paginated jobs with search + filters |
| `/api/jobs/:id/timeline` | GET | Job lifecycle (first seen → recommended → status changes) |
| `/api/sources/health` | GET | Per-source active job count and last-seen date |
| `/api/role-profiles` | GET | All role profiles |
| `/api/diagnostics/recommendations` | GET | Full system snapshot (DB counts, last run, config) |

---

## Database schema

```
JobSource            company + ATS provider config (enabled/disabled, last sync status)
Job                  normalized listing — upsert on (sourceId, applyUrl)
SyncRun              one row per sync cycle (status, counts, errorSummary)
SyncSourceRun        per-source result row within a SyncRun
RoleProfile          scoring profile definition
JobRecommendation    Job × Profile scored match — unique per pair
RecommendationRun    one row per recommendation scoring cycle
NotificationDelivery delivery log (SENT / FAILED / SKIPPED, per channel)
```

Data lives in `./data/jobradar.db` (Docker volume) or `./dev.db` (local dev). Migrations are in `prisma/migrations/`.

---

## Performance (measured)

Tested on AWS EC2, 332 enabled sources, first full sync:

| Metric | Value |
|--------|-------|
| `/api/sync/start` response time | **370 ms** |
| Total sync duration | **5 min 17 s (317 s)** |
| Sources succeeded | **316 / 332 (95.2%)** |
| Sources failed (404) | **16** — stale ATS endpoints |
| Jobs created | **22,496** |
| Throughput | **~63 sources/min · ~4,260 jobs/min** |
| SQLite lock errors | **0** |
| Duplicate jobs | **0** |

Subsequent incremental syncs (mostly updates, no new jobs) complete in **2–3 minutes**.

### Tuning guide

| Situation | Recommended action |
|-----------|--------------------|
| Sync still slow, no errors | Raise `SYNC_FETCH_CONCURRENCY` to 12–16 |
| SQLite lock errors | Keep `SYNC_DB_CONCURRENCY=1`, never raise for SQLite |
| Many timeout failures | Keep `SOURCE_FETCH_TIMEOUT_MS=10000`; slow sources are already isolated |
| HTTP 429 rate limits | Lower `SYNC_FETCH_CONCURRENCY` to 4–6 |
| Diagnosing slow sources | Set `DEBUG_SYNC=true` to log per-source timing |

---

## Adding job sources

**Option A — Edit `config/job-sources.yml`** and re-import (recommended):

```yaml
sources:
  - company: Acme Corp
    provider: greenhouse       # greenhouse | lever | ashby | custom
    boardToken: acmecorp
    enabled: true
    priority: 5
```

```bash
npm run config:import
# or inside Docker:
docker compose exec jobradar npm run config:import
```

**Option B — XLSX bulk import:**

Create a spreadsheet with columns `company`, `provider`, `url` and run:
```bash
JOB_SOURCE_FILE=./my-sources.xlsx npm run db:seed
```

**Option C — Prisma Studio (GUI):**
```bash
npm run db:studio    # http://localhost:5555
```

---

## Adding role profiles

Edit `config/role-profiles.yml`, then re-import and run recommendations:

```bash
npm run config:import

curl -X POST http://localhost:3000/api/recommendations/run \
  -H "Content-Type: application/json" \
  -d '{"windowHours": 168}'   # scan last 7 days
```

---

## Troubleshooting

### Sync stuck as RUNNING after a crash

```bash
docker compose exec jobradar npm run runs:recover -- --threshold-minutes 10
```

This is called automatically on every sync start and hourly scheduler tick, so it self-heals.

### No recommendations appearing

```bash
curl http://localhost:3000/api/diagnostics/recommendations | jq
```

Check:
- `roleProfiles.enabled > 0` — run `npm run config:import`
- `jobs.withEffectiveNewAt > 0` — run `npm run db:backfill-effective-new-at`
- `jobs.last24h > 0` — sync must have run recently

### Notifications not delivering

Check the **Notifications** sub-tab in the History UI for `FAILED` rows with error messages.

Test Telegram credentials directly:
```bash
curl "https://api.telegram.org/bot<TOKEN>/getMe"
curl "https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<CHAT_ID>&text=test"
```

Common issues:
- `NOTIFICATIONS_ENABLED` not set to `true`
- `TELEGRAM_CHAT_ID` must be a numeric ID (get from `@userinfobot`), not a username
- `NOTIFICATION_CHANNEL` must be exactly `telegram`, `discord`, or `slack`

### Container exits immediately

```bash
docker compose logs jobradar
```

Common cause: port 3000 already in use. Either stop the conflicting process or change the port mapping in `docker-compose.yml`.

---

## Project structure

```
jobradar/
├── app/
│   ├── api/
│   │   ├── sync/
│   │   │   ├── start/route.ts         POST — async start, returns runId
│   │   │   ├── status/route.ts        GET  — live poll by runId
│   │   │   └── route.ts               GET/POST — synchronous sync
│   │   ├── recommendations/
│   │   │   ├── route.ts               GET — paginated listing
│   │   │   ├── run/route.ts           POST — trigger scoring
│   │   │   ├── counts/route.ts        GET — counts by window
│   │   │   └── [id]/status/route.ts   PATCH — update status
│   │   ├── history/
│   │   │   ├── sync-runs/route.ts
│   │   │   ├── sync-runs/[id]/route.ts
│   │   │   ├── recommendation-runs/route.ts
│   │   │   └── notifications/route.ts
│   │   ├── jobs/
│   │   │   ├── route.ts
│   │   │   └── [id]/timeline/route.ts
│   │   ├── sources/health/route.ts
│   │   ├── role-profiles/route.ts
│   │   └── diagnostics/recommendations/route.ts
│   ├── page.tsx
│   └── layout.tsx
│
├── components/
│   └── JobBoardClient.tsx             5-tab SPA dashboard (Jobs/Recs/Alerts/History/Sources)
│
├── config/
│   ├── job-sources.yml                company ATS configuration
│   └── role-profiles.yml             keyword scoring profiles
│
├── lib/
│   ├── services/
│   │   ├── sync-service.ts            concurrent sync engine (p-limit + Promise.race timeout)
│   │   ├── recommendation-service.ts  keyword scorer
│   │   ├── notification-service.ts    Telegram / Discord / Slack
│   │   └── run-recovery-service.ts   stuck-run cleanup
│   ├── providers/
│   │   ├── greenhouse.ts
│   │   ├── lever.ts
│   │   ├── ashby.ts
│   │   └── custom.ts
│   ├── scheduler.ts                   node-cron hourly job
│   ├── prisma.ts                      Prisma client singleton
│   ├── sponsorship.ts                 visa sponsorship detector
│   ├── source-utils.ts               provider normalization
│   └── types.ts
│
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts                        XLSX bulk importer
│
├── scripts/
│   ├── deploy-bootstrap.mjs          safe all-in-one deploy init
│   ├── config-import.ts              YAML config importer
│   ├── backfill-effective-new-at.mjs
│   └── recover-abandoned-runs.mjs
│
├── imports/
│   └── public_job_api_targets_321.xlsx
│
├── Dockerfile
├── docker-compose.yml
├── docker-compose.prod.yml            port 80 override for EC2 / production
├── docker-entrypoint.sh
├── .env.example
└── package.json
```

---

## License

MIT
