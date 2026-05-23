"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SponsorshipBadge, StatusBadge } from "@/components/badges";
import type { JobStatus, Sponsorship } from "@/lib/types";

export type JobBoardJob = {
  id: string;
  company: string;
  title: string;
  location: string | null;
  department: string | null;
  employmentType: string | null;
  provider: string;
  description: string | null;
  applyUrl: string;
  postedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  status: JobStatus;
  sponsorship: Sponsorship;
  isActive: boolean;
};

export type SourceSummary = {
  id: string;
  company: string;
  provider: string;
  enabled: boolean;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
};

export type SyncRunSummary = {
  id: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  sourcesProcessed: number;
  sourcesSucceeded: number;
  sourcesFailed: number;
  jobsCreated: number;
  jobsUpdated: number;
  jobsMarkedStale: number;
  errorSummary: string | null;
  failedSources: Array<{
    id: string;
    company: string | null;
    provider: string | null;
    errorMessage: string | null;
  }>;
} | null;

export type JobStats = {
  Total: number;
  New: number;
  Saved: number;
  Applied: number;
  Skipped: number;
  "Sponsor Yes": number;
  "Sponsor No": number;
  Unknown: number;
};

type SyncSummary = {
  sourcesProcessed: number;
  sourcesSucceeded: number;
  sourcesFailed: number;
  jobsCreated: number;
  jobsUpdated: number;
  jobsMarkedStale?: number;
  errors?: unknown[];
};

const DEFAULT_JOB_LIMIT = 1_000;
const MAX_VISIBLE_JOBS = 500;

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

export function JobBoardClient({
  initialJobs,
  initialStats,
  sourceSummary,
  lastSyncRun,
  totalJobCount,
}: {
  initialJobs: JobBoardJob[];
  initialStats: JobStats;
  sourceSummary: SourceSummary[];
  lastSyncRun: SyncRunSummary;
  totalJobCount: number;
}) {
  const router = useRouter();
  const [jobs, setJobs] = useState(initialJobs);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] =
    useState<(typeof statuses)[number]>("ALL");
  const [sponsorshipFilter, setSponsorshipFilter] =
    useState<(typeof sponsorships)[number]>("ANY");
  const [providerFilter, setProviderFilter] = useState("ALL");
  const [locationFilter, setLocationFilter] = useState("");
  const [syncLoading, startSyncTransition] = useTransition();
  const [actionLoadingJobId, setActionLoadingJobId] = useState<string | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filteredJobs = useMemo(
    () =>
      jobs
        .filter((job) =>
          matchesFilters(
            job,
            search,
            statusFilter,
            sponsorshipFilter,
            providerFilter,
            locationFilter,
          ),
        )
        .sort(sortJobs),
    [jobs, locationFilter, providerFilter, search, sponsorshipFilter, statusFilter],
  );

  function resetFilters() {
    setSearch("");
    setStatusFilter("ALL");
    setSponsorshipFilter("ANY");
    setProviderFilter("ALL");
    setLocationFilter("");
  }

  function syncJobs() {
    setMessage("Syncing jobs... this can take a while for 321 sources");
    setError(null);

    startSyncTransition(async () => {
      try {
        const response = await fetch("/api/sync", { method: "POST" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const result = (await response.json()) as SyncSummary;
        setMessage(
          `Sync complete: ${result.sourcesSucceeded}/${result.sourcesProcessed} sources succeeded, ${result.jobsCreated} created, ${result.jobsUpdated} updated, ${result.sourcesFailed} failed, ${result.errors?.length ?? 0} errors.`,
        );
        router.refresh();
      } catch (syncError) {
        setError(
          syncError instanceof Error
            ? `Sync may still be running or timed out. Refresh after a minute. ${syncError.message}`
            : "Sync may still be running or timed out. Refresh after a minute.",
        );
      }
    });
  }

  async function updateJobStatus(jobId: string, status: JobStatus) {
    setActionLoadingJobId(jobId);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(`/api/jobs/${jobId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? `HTTP ${response.status}`);
      }

      setJobs((previousJobs) =>
        previousJobs.map((job) =>
          job.id === jobId ? { ...job, status } : job,
        ),
      );
      setMessage(`Marked job ${status.toLowerCase()}.`);
    } catch (statusError) {
      setError(
        statusError instanceof Error
          ? `Could not update status: ${statusError.message}`
          : "Could not update status.",
      );
    } finally {
      setActionLoadingJobId(null);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <h1 className="text-2xl font-semibold tracking-tight">JobRadar</h1>
          <button
            className="rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
            disabled={syncLoading}
            onClick={syncJobs}
            type="button"
          >
            {syncLoading ? "Syncing Jobs..." : "Sync Jobs"}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <section className="grid gap-3 border-b border-slate-200 pb-5">
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            Search
            <input
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-600"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="backend java spring aws remote"
              value={search}
            />
          </label>

          <div className="grid gap-3 md:grid-cols-5">
            <Select
              label="Status"
              onChange={setStatusFilter}
              options={statuses}
              value={statusFilter}
            />
            <Select
              label="Sponsorship"
              onChange={setSponsorshipFilter}
              options={sponsorships}
              value={sponsorshipFilter}
            />
            <Select
              label="Provider"
              onChange={setProviderFilter}
              options={providers}
              value={providerFilter}
            />
            <label className="grid gap-1 text-sm font-medium text-slate-700">
              Location
              <input
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-600"
                onChange={(event) => setLocationFilter(event.target.value)}
                placeholder="Remote, US, India, Chicago"
                value={locationFilter}
              />
            </label>
            <div className="flex items-end">
              <button
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                onClick={resetFilters}
                type="button"
              >
                Reset Filters
              </button>
            </div>
          </div>

          <p className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
            Showing {filteredJobs.length} of {jobs.length} loaded jobs. Showing
            latest {Math.min(DEFAULT_JOB_LIMIT, totalJobCount)} jobs. Use
            search/filters within loaded jobs.
          </p>

          {totalJobCount > jobs.length ? (
            <p className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
              Loaded latest {jobs.length} of {totalJobCount} total jobs for fast
              filtering.
            </p>
          ) : null}

          {message ? (
            <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {message}
            </p>
          ) : null}
          {error ? (
            <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              {error}
            </p>
          ) : null}
        </section>

        <Stats stats={initialStats} />
        <SourcesSummary lastSyncRun={lastSyncRun} sources={sourceSummary} />
        <JobTable
          actionLoadingJobId={actionLoadingJobId}
          jobs={filteredJobs}
          onStatusChange={updateJobStatus}
          totalJobs={jobs.length}
        />
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

function SourcesSummary({
  sources,
  lastSyncRun,
}: {
  sources: SourceSummary[];
  lastSyncRun: SyncRunSummary;
}) {
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
        {lastSyncRun ? (
          <p>
            Last run: {lastSyncRun.status} at{" "}
            {lastSyncRun.finishedAt
              ? formatDateTime(lastSyncRun.finishedAt)
              : "running"}{" "}
            / {lastSyncRun.jobsCreated} created / {lastSyncRun.jobsUpdated}{" "}
            updated / {lastSyncRun.jobsMarkedStale} stale
          </p>
        ) : null}
        {lastSyncRun?.failedSources.length ? (
          <ul className="grid gap-2">
            {lastSyncRun.failedSources.slice(0, 10).map((source) => (
              <li
                className="rounded-md border border-rose-100 bg-rose-50 px-3 py-2"
                key={source.id}
              >
                <span className="font-medium">{source.company ?? "Unknown"}</span>:{" "}
                {source.errorMessage}
              </li>
            ))}
          </ul>
        ) : failedSources.length > 0 ? (
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

function JobTable({
  jobs,
  totalJobs,
  actionLoadingJobId,
  onStatusChange,
}: {
  jobs: JobBoardJob[];
  totalJobs: number;
  actionLoadingJobId: string | null;
  onStatusChange: (jobId: string, status: JobStatus) => void;
}) {
  if (totalJobs === 0) {
    return <EmptyState message="No jobs yet. Click Sync Jobs." />;
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
      <table className="w-full min-w-[1180px] border-separate border-spacing-0 text-left text-sm">
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
            <tr
              className={`border-b border-slate-200 align-top ${job.isActive ? "" : "opacity-60"}`}
              key={job.id}
            >
              <td className="border-t border-slate-200 py-4 pr-3">
                <div className="grid gap-2">
                  <StatusBadge status={job.status} />
                  {!job.isActive ? (
                    <span className="inline-flex rounded border border-slate-200 bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-500">
                      Stale
                    </span>
                  ) : null}
                </div>
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
                <JobActions
                  disabled={actionLoadingJobId === job.id}
                  job={job}
                  onStatusChange={onStatusChange}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function JobActions({
  job,
  disabled,
  onStatusChange,
}: {
  job: JobBoardJob;
  disabled: boolean;
  onStatusChange: (jobId: string, status: JobStatus) => void;
}) {
  const actionsByStatus: Record<JobStatus, JobStatus[]> = {
    NEW: ["SAVED", "APPLIED", "SKIPPED"],
    SAVED: ["NEW", "APPLIED", "SKIPPED"],
    APPLIED: ["NEW", "SAVED", "SKIPPED"],
    SKIPPED: ["NEW", "SAVED", "APPLIED"],
  };

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
      {actionsByStatus[job.status].map((status) => (
        <ActionButton
          disabled={disabled}
          key={status}
          onClick={() => onStatusChange(job.id, status)}
        >
          {status === "SAVED" ? "Save" : status[0] + status.slice(1).toLowerCase()}
        </ActionButton>
      ))}
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
      {disabled ? "Saving..." : children}
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
  job: JobBoardJob,
  search: string,
  statusFilter: string,
  sponsorshipFilter: string,
  providerFilter: string,
  locationFilter: string,
) {
  const haystack = [
    job.title,
    job.company,
    job.location,
    job.department,
    job.employmentType,
    job.provider,
    job.sponsorship,
    job.status,
    job.applyUrl,
    job.description,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const normalizedSearch = search.trim().toLowerCase();
  const normalizedLocation = locationFilter.trim().toLowerCase();

  return (
    (!normalizedSearch || haystack.includes(normalizedSearch)) &&
    (statusFilter === "ALL" || job.status === statusFilter) &&
    (sponsorshipFilter === "ANY" || job.sponsorship === sponsorshipFilter) &&
    (providerFilter === "ALL" || job.provider === providerFilter) &&
    (!normalizedLocation ||
      (job.location ?? "").toLowerCase().includes(normalizedLocation))
  );
}

function sortJobs(a: JobBoardJob, b: JobBoardJob) {
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
