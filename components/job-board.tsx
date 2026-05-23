"use client";

import { useMemo, useState, useTransition } from "react";
import { markJobStatus } from "@/app/actions/jobs";
import { SponsorshipBadge, StatusBadge } from "@/components/badges";
import type { JobStatus, Sponsorship } from "@/lib/types";

type JobRow = {
  id: string;
  company: string;
  title: string;
  location: string | null;
  department: string | null;
  provider: string;
  description: string | null;
  applyUrl: string;
  postedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  status: JobStatus;
  sponsorship: Sponsorship;
};

type SourceRow = {
  id: string;
  company: string;
  provider: string;
  enabled: boolean;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
};

type SyncSummary = {
  sourcesProcessed: number;
  sourcesSucceeded: number;
  sourcesFailed: number;
  jobsCreated: number;
  jobsUpdated: number;
};

type JobStats = {
  Total: number;
  New: number;
  Saved: number;
  Applied: number;
  Skipped: number;
  "Sponsor Yes": number;
  "Sponsor No": number;
  Unknown: number;
};

const STATUS_ORDER: Record<JobStatus, number> = {
  NEW: 0,
  SAVED: 1,
  APPLIED: 2,
  SKIPPED: 3,
};

const statuses: Array<"ALL" | JobStatus> = [
  "ALL",
  "NEW",
  "SAVED",
  "APPLIED",
  "SKIPPED",
];
const sponsorships: Array<"ANY" | Sponsorship> = ["ANY", "YES", "NO", "UNKNOWN"];
const providers = ["ALL", "GREENHOUSE", "LEVER", "ASHBY", "CUSTOM"];
const MAX_VISIBLE_JOBS = 500;

export function JobBoard({
  jobs,
  sources,
  stats,
  totalJobCount,
}: {
  jobs: JobRow[];
  sources: SourceRow[];
  stats: JobStats;
  totalJobCount: number;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<(typeof statuses)[number]>("ALL");
  const [sponsorship, setSponsorship] =
    useState<(typeof sponsorships)[number]>("ANY");
  const [provider, setProvider] = useState("ALL");
  const [location, setLocation] = useState("");
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [isSyncing, startSync] = useTransition();

  const filteredJobs = useMemo(
    () =>
      jobs
        .filter((job) => matchesFilters(job, query, status, sponsorship, provider, location))
        .sort(sortJobs),
    [jobs, location, provider, query, sponsorship, status],
  );

  function syncJobs() {
    startSync(async () => {
      setSyncResult(null);
      try {
        const response = await fetch("/api/sync", { method: "POST" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const result = (await response.json()) as SyncSummary;
        setSyncResult(
          `Sync complete: ${result.jobsCreated} created, ${result.jobsUpdated} updated, ${result.sourcesFailed} failed`,
        );
        window.location.reload();
      } catch (error) {
        setSyncResult(
          error instanceof Error ? `Sync failed: ${error.message}` : "Sync failed",
        );
      }
    });
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <h1 className="text-2xl font-semibold tracking-tight">JobRadar</h1>
          <button
            className="rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
            disabled={isSyncing}
            onClick={syncJobs}
            type="button"
          >
            {isSyncing ? "Syncing..." : "Sync Jobs"}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <section className="grid gap-3 border-b border-slate-200 pb-5">
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            Search
            <input
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-600"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="backend java spring aws remote"
              value={query}
            />
          </label>

          <div className="grid gap-3 md:grid-cols-4">
            <Select label="Status" onChange={setStatus} options={statuses} value={status} />
            <Select
              label="Sponsorship"
              onChange={setSponsorship}
              options={sponsorships}
              value={sponsorship}
            />
            <Select label="Provider" onChange={setProvider} options={providers} value={provider} />
            <label className="grid gap-1 text-sm font-medium text-slate-700">
              Location
              <input
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-600"
                onChange={(event) => setLocation(event.target.value)}
                placeholder="Remote, US, India, Chicago"
                value={location}
              />
            </label>
          </div>

          {syncResult ? (
            <p className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
              {syncResult}
            </p>
          ) : null}
          {totalJobCount > jobs.length ? (
            <p className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
              Loaded latest {jobs.length} of {totalJobCount} jobs for fast
              filtering.
            </p>
          ) : null}
        </section>

        <Stats stats={stats} />
        <SourcesSummary sources={sources} />
        <JobTable jobs={filteredJobs} totalJobs={jobs.length} />
      </main>
    </div>
  );
}

function Select<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: T[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <label className="grid gap-1 text-sm font-medium text-slate-700">
      {label}
      <select
        className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-600"
        onChange={(event) => onChange(event.target.value as T)}
        value={value}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function Stats({ stats }: { stats: JobStats }) {
  return (
    <section className="grid grid-cols-2 gap-3 border-b border-slate-200 py-5 sm:grid-cols-4 lg:grid-cols-8">
      {Object.entries(stats).map(([label, value]) => (
        <div key={label} className="rounded-md border border-slate-200 bg-white p-3">
          <div className="text-xs font-medium uppercase text-slate-500">{label}</div>
          <div className="mt-1 text-2xl font-semibold">{value}</div>
        </div>
      ))}
    </section>
  );
}

function SourcesSummary({ sources }: { sources: SourceRow[] }) {
  const enabledSources = sources.filter((source) => source.enabled);
  const failedSources = sources.filter((source) =>
    source.lastSyncStatus?.startsWith("ERROR"),
  );
  const lastSync = sources
    .map((source) => source.lastSyncAt)
    .filter(Boolean)
    .sort()
    .at(-1);

  return (
    <details className="border-b border-slate-200 py-4">
      <summary className="cursor-pointer text-sm font-semibold text-slate-800">
        Sources Summary
      </summary>
      <div className="mt-3 grid gap-3 text-sm text-slate-700">
        <p>
          Enabled: {enabledSources.length} / Failed: {failedSources.length} / Last
          sync: {lastSync ? formatDateTime(lastSync) : "Never"}
        </p>
        {failedSources.length > 0 ? (
          <ul className="grid gap-2">
            {failedSources.slice(0, 10).map((source) => (
              <li
                className="rounded-md border border-rose-100 bg-rose-50 px-3 py-2"
                key={source.id}
              >
                <span className="font-medium">{source.company}</span>:{" "}
                {source.lastSyncStatus}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </details>
  );
}

function JobTable({ jobs, totalJobs }: { jobs: JobRow[]; totalJobs: number }) {
  if (totalJobs === 0) {
    return (
      <EmptyState message="No jobs yet. Click Sync Jobs." />
    );
  }

  if (jobs.length === 0) {
    return <EmptyState message="No jobs match these filters." />;
  }

  const visibleJobs = jobs.slice(0, MAX_VISIBLE_JOBS);

  return (
    <section className="overflow-x-auto py-5">
      {jobs.length > MAX_VISIBLE_JOBS ? (
        <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Showing first {MAX_VISIBLE_JOBS} of {jobs.length} matching jobs. Use
          search or filters to narrow the list.
        </p>
      ) : null}
      <table className="w-full min-w-[1100px] border-separate border-spacing-0 text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
            <th className="py-3 pr-3">Status</th>
            <th className="py-3 pr-3">Sponsor</th>
            <th className="py-3 pr-3">Title</th>
            <th className="py-3 pr-3">Company</th>
            <th className="py-3 pr-3">Location</th>
            <th className="py-3 pr-3">Department</th>
            <th className="py-3 pr-3">Provider</th>
            <th className="py-3 pr-3">Posted</th>
            <th className="py-3 pr-3">Last Seen</th>
            <th className="py-3">Actions</th>
          </tr>
        </thead>
        <tbody>
          {visibleJobs.map((job) => (
            <tr className="border-b border-slate-200 align-top" key={job.id}>
              <td className="border-t border-slate-200 py-4 pr-3">
                <StatusBadge status={job.status} />
              </td>
              <td className="border-t border-slate-200 py-4 pr-3">
                <SponsorshipBadge sponsorship={job.sponsorship} />
              </td>
              <td className="max-w-sm border-t border-slate-200 py-4 pr-3 font-medium">
                {job.title}
              </td>
              <td className="border-t border-slate-200 py-4 pr-3">{job.company}</td>
              <td className="border-t border-slate-200 py-4 pr-3">
                {job.location || "Unknown"}
              </td>
              <td className="border-t border-slate-200 py-4 pr-3">
                {job.department || "-"}
              </td>
              <td className="border-t border-slate-200 py-4 pr-3">{job.provider}</td>
              <td className="border-t border-slate-200 py-4 pr-3">
                {formatDate(job.postedAt)}
              </td>
              <td className="border-t border-slate-200 py-4 pr-3">
                {formatDate(job.lastSeenAt)}
              </td>
              <td className="border-t border-slate-200 py-4">
                <JobActions job={job} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function JobActions({ job }: { job: JobRow }) {
  const [isPending, startTransition] = useTransition();

  function updateStatus(status: JobStatus) {
    startTransition(async () => {
      await markJobStatus(job.id, status);
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      <a
        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
        href={job.applyUrl}
        rel="noopener noreferrer"
        target="_blank"
      >
        Open
      </a>
      <ActionButton disabled={isPending} onClick={() => updateStatus("SAVED")}>
        Save
      </ActionButton>
      <ActionButton disabled={isPending} onClick={() => updateStatus("APPLIED")}>
        Applied
      </ActionButton>
      <ActionButton disabled={isPending} onClick={() => updateStatus("SKIPPED")}>
        Skip
      </ActionButton>
      <ActionButton disabled={isPending} onClick={() => updateStatus("NEW")}>
        New
      </ActionButton>
    </div>
  );
}

function ActionButton({
  children,
  disabled,
  onClick,
}: {
  children: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <section className="flex min-h-72 items-center justify-center py-10 text-center">
      <p className="rounded-md border border-slate-200 bg-white px-6 py-5 text-sm text-slate-600">
        {message}
      </p>
    </section>
  );
}

function matchesFilters(
  job: JobRow,
  query: string,
  status: string,
  sponsorship: string,
  provider: string,
  location: string,
) {
  const haystack = [
    job.title,
    job.company,
    job.location,
    job.department,
    job.description,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const normalizedQuery = query.trim().toLowerCase();
  const normalizedLocation = location.trim().toLowerCase();

  return (
    (!normalizedQuery || haystack.includes(normalizedQuery)) &&
    (status === "ALL" || job.status === status) &&
    (sponsorship === "ANY" || job.sponsorship === sponsorship) &&
    (provider === "ALL" || job.provider === provider) &&
    (!normalizedLocation ||
      (job.location ?? "").toLowerCase().includes(normalizedLocation))
  );
}

function sortJobs(a: JobRow, b: JobRow) {
  const statusDiff = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
  if (statusDiff !== 0) return statusDiff;

  return dateValue(b.postedAt ?? b.firstSeenAt) - dateValue(a.postedAt ?? a.firstSeenAt);
}

function dateValue(value: string | null) {
  return value ? new Date(value).getTime() : 0;
}

function formatDate(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(
    new Date(value),
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}
