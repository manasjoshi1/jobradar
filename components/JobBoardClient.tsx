"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
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

const statuses: Array<"ALL" | JobStatus> = [
  "ALL",
  "NEW",
  "SAVED",
  "APPLIED",
  "SKIPPED",
];
const sponsorships: Array<"ANY" | Sponsorship> = ["ANY", "YES", "NO", "UNKNOWN"];
const providers = ["ALL", "GREENHOUSE", "LEVER", "ASHBY", "CUSTOM"];
const activeOptions = ["true", "all", "false"] as const;
const pageSizes = [25, 50, 100];

export function JobBoardClient({
  initialJobs,
  initialPage,
  initialPageSize,
  initialTotal,
  initialTotalPages,
  initialStats,
  sourceSummary,
  lastSyncRun,
}: {
  initialJobs: JobBoardJob[];
  initialPage: number;
  initialPageSize: number;
  initialTotal: number;
  initialTotalPages: number;
  initialStats: JobStats;
  sourceSummary: SourceSummary[];
  lastSyncRun: SyncRunSummary;
}) {
  const router = useRouter();
  const [jobs, setJobs] = useState(initialJobs);
  const [page, setPage] = useState(initialPage);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [total, setTotal] = useState(initialTotal);
  const [totalPages, setTotalPages] = useState(initialTotalPages);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] =
    useState<(typeof statuses)[number]>("ALL");
  const [sponsorshipFilter, setSponsorshipFilter] =
    useState<(typeof sponsorships)[number]>("ANY");
  const [providerFilter, setProviderFilter] = useState("ALL");
  const [locationFilter, setLocationFilter] = useState("");
  const [activeFilter, setActiveFilter] =
    useState<(typeof activeOptions)[number]>("true");
  const [jobsLoading, setJobsLoading] = useState(false);
  const [syncLoading, startSyncTransition] = useTransition();
  const [actionLoadingJobId, setActionLoadingJobId] = useState<string | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [search]);

  const fetchJobs = useCallback(
    async (nextPage = page) => {
      setJobsLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          page: String(nextPage),
          pageSize: String(pageSize),
          active: activeFilter,
        });

        if (debouncedSearch) params.set("search", debouncedSearch);
        if (statusFilter !== "ALL") params.set("status", statusFilter);
        if (sponsorshipFilter !== "ANY") {
          params.set("sponsorship", sponsorshipFilter);
        }
        if (providerFilter !== "ALL") params.set("provider", providerFilter);
        if (locationFilter.trim()) params.set("location", locationFilter.trim());

        const response = await fetch(`/api/jobs?${params.toString()}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const result = (await response.json()) as {
          jobs: JobBoardJob[];
          page: number;
          pageSize: number;
          total: number;
          totalPages: number;
        };

        setJobs(result.jobs);
        setPage(result.page);
        setPageSize(result.pageSize);
        setTotal(result.total);
        setTotalPages(result.totalPages);
      } catch (jobError) {
        setError(
          jobError instanceof Error
            ? `Could not load jobs: ${jobError.message}`
            : "Could not load jobs.",
        );
      } finally {
        setJobsLoading(false);
      }
    },
    [
      activeFilter,
      debouncedSearch,
      locationFilter,
      page,
      pageSize,
      providerFilter,
      sponsorshipFilter,
      statusFilter,
    ],
  );

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void fetchJobs(page);
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [fetchJobs, page]);

  function resetFilters() {
    setSearch("");
    setDebouncedSearch("");
    setStatusFilter("ALL");
    setSponsorshipFilter("ANY");
    setProviderFilter("ALL");
    setLocationFilter("");
    setActiveFilter("true");
    setPage(1);
  }

  function updateFilter(update: () => void) {
    update();
    setPage(1);
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
        await fetchJobs(1);
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
              onChange={(value) => updateFilter(() => setStatusFilter(value))}
              options={statuses}
              value={statusFilter}
            />
            <Select
              label="Sponsorship"
              onChange={(value) => updateFilter(() => setSponsorshipFilter(value))}
              options={sponsorships}
              value={sponsorshipFilter}
            />
            <Select
              label="Provider"
              onChange={(value) => updateFilter(() => setProviderFilter(value))}
              options={providers}
              value={providerFilter}
            />
            <label className="grid gap-1 text-sm font-medium text-slate-700">
              Location
              <input
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-600"
                onChange={(event) =>
                  updateFilter(() => setLocationFilter(event.target.value))
                }
                placeholder="Remote, US, India, Chicago"
                value={locationFilter}
              />
            </label>
            <Select
              label="Active"
              onChange={(value) => updateFilter(() => setActiveFilter(value))}
              options={activeOptions}
              value={activeFilter}
            />
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1 text-sm font-medium text-slate-700">
              Page Size
              <select
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-600"
                onChange={(event) =>
                  updateFilter(() => setPageSize(Number(event.target.value)))
                }
                value={pageSize}
              >
                {pageSizes.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-end gap-2">
              <button
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={page <= 1 || jobsLoading}
                onClick={() => setPage((currentPage) => Math.max(1, currentPage - 1))}
                type="button"
              >
                Previous
              </button>
              <span className="px-2 py-2 text-sm text-slate-600">
                Page {page} of {totalPages}
              </span>
              <button
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={page >= totalPages || jobsLoading}
                onClick={() =>
                  setPage((currentPage) => Math.min(totalPages, currentPage + 1))
                }
                type="button"
              >
                Next
              </button>
              <button
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                onClick={resetFilters}
                type="button"
              >
                Reset Filters
              </button>
            </div>
          </div>

          <p className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
            {jobsLoading
              ? "Loading jobs..."
              : `Showing ${pageStart(total, page, pageSize)}-${pageEnd(
                  total,
                  page,
                  pageSize,
                  jobs.length,
                )} of ${total} jobs`}
          </p>

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
          jobs={jobs}
          onStatusChange={updateJobStatus}
          totalJobs={total}
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
  options: readonly T[];
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

  return (
    <section className="overflow-x-auto py-5">
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
          {jobs.map((job) => (
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

function formatDate(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(
    new Date(value),
  );
}

function pageStart(total: number, page: number, pageSize: number) {
  if (total === 0) return 0;
  return (page - 1) * pageSize + 1;
}

function pageEnd(
  total: number,
  page: number,
  pageSize: number,
  currentPageCount: number,
) {
  if (total === 0) return 0;
  return Math.min((page - 1) * pageSize + currentPageCount, total);
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}
