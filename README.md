# JobRadar

A small one-page personal job tracker for importing public job board APIs,
syncing jobs into SQLite, filtering them quickly, and tracking status.

## Local Setup

```bash
npm install
cp .env.example .env
npm run db:migrate
npm run db:seed -- --file "C:/Users/joshi/CascadeProjects/windsurf-project-2/cronfetcher/public_job_api_targets_321.xlsx"
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Useful Commands

```bash
npm run dev
npm run lint
npm run build
npm run db:migrate
npm run db:seed -- --file path/to/sources.xlsx
npm run db:studio
```

## Docker

Docker support is optional and uses one app container with SQLite persisted to
the mounted `data` directory.

```bash
docker compose up --build
```
