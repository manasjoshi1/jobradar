"use client";

import { useEffect, useState, useTransition } from "react";
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

type RecStatus = "UNSEEN" | "SEEN" | "SAVED" | "APPLIED" | "SKIPPED";

type RoleProfileRef = {
  id: string;
  name: string;
  priority: number;
  minScore: number;
};

type RecJob = {
  id: string;
  title: string;
  company: string;
  location: string | null;
  department: string | null;
  employmentType: string | null;
  applyUrl: string;
  postedAt: string | null;
  firstSeenAt: string;
  effectiveNewAt: string | null;
  status: string;
  sponsorship: string;
  isActive: boolean;
};

type Recommendation = {
  id: string;
  score: number;
  reason: string | null;
  matched: string[];
  negatives: string[];
  status: RecStatus;
  recommendedAt: string;
  roleProfile: RoleProfileRef;
  job: RecJob;
};

type RecCounts = {
  last1h: number;
  last2h: number;
  last3h: number;
  last6h: number;
  last12h: number;
  last1d: number;
  last2d: number;
  last7d: number;
  unseen: number;
};

const WINDOW_OPTIONS = ["1h","2h","3h","6h","12h","1d","2d","7d"] as const;
type WindowOption = typeof WINDOW_OPTIONS[number];
const REC_STATUSES = ["ALL","UNSEEN","SEEN","SAVED","APPLIED","SKIPPED"] as const;

// ── History types ──────────────────────────────────────────────────────────
type SyncSourceRunItem = { id: string; company: string | null; provider: string | null;
    status: string; jobsFetched: number; jobsCreated: number; jobsUpdated: number;
    errorMessage: string | null; startedAt: string; finishedAt: string | null; };
type SyncRunRow = {
  id: string; startedAt: string; finishedAt: string | null; status: string;
  sourcesProcessed: number; sourcesSucceeded: number; sourcesFailed: number;
  jobsCreated: number; jobsUpdated: number; jobsMarkedStale: number;
  durationMs: number | null; errorSummary: string | null;
  sourceRuns?: SyncSourceRunItem[];
};
type SyncRunDetail = SyncRunRow & {
  sourceRuns: SyncSourceRunItem[];
  failedSources: Array<{ id: string; company: string | null; provider: string | null; errorMessage: string | null; }>;
};
type RecRunRow = {
  id: string; startedAt: string; finishedAt: string | null; status: string;
  windowHours: number; jobsScanned: number; recommendationsCreated: number;
  durationMs: number | null; errorSummary: string | null;
};
type NotifRow = {
  id: string; createdAt: string; sentAt: string | null; channel: string;
  status: string; windowHours: number; recommendationCount: number;
  messagePreview: string | null; errorMessage: string | null;
};
type SourceHealthRow = {
  id: string; company: string; provider: string; enabled: boolean;
  priority: number; tags: string | null; lastSyncAt: string | null;
  lastSyncStatus: string | null; activeJobCount: number; totalJobCount: number;
  latestJobSeenAt: string | null;
};
type TimelineJob = {
  id: string; company: string; title: string; location: string | null;
  applyUrl: string; sponsorship: string; status: string;
  postedAt: string | null; firstSeenAt: string; effectiveNewAt: string | null;
  lastSeenAt: string; isActive: boolean;
  recommendations: Array<{
    id: string; score: number; status: string; reason: string | null;
    matched: string; recommendedAt: string;
    roleProfile: { id: string; name: string; minScore: number };
  }>;
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
  const [companySearch, setCompanySearch] = useState("");
  const [debouncedCompanySearch, setDebouncedCompanySearch] = useState("");
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
  const [refetchKey, setRefetchKey] = useState(0);
  const [savedJobIds, setSavedJobIds] = useState<Set<string>>(new Set());
  const [allJobTitles, setAllJobTitles] = useState<string[]>([]);
  const [allCompanies, setAllCompanies] = useState<string[]>([]);
  const [jobTitleFilter, setJobTitleFilter] = useState("");
  const [viewMode, setViewMode] = useState<"all" | "saved">("all");
  const [sortOption, setSortOption] = useState<"newest" | "oldest" | "recently-seen" | "title-asc" | "company-asc">("newest");
  const [syncHistory, setSyncHistory] = useState<SyncRunRow[]>([]);
  const [showSyncHistory, setShowSyncHistory] = useState(false);
  const [loadingSyncHistory, setLoadingSyncHistory] = useState(false);

  // Main tab
  const [mainTab, setMainTab] = useState<"jobs" | "recommended" | "alerts" | "history" | "sources">("jobs");

  // Recommendation state
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [recTotal, setRecTotal] = useState(0);
  const [recTotalPages, setRecTotalPages] = useState(1);
  const [recPage, setRecPage] = useState(1);
  const [recLoading, setRecLoading] = useState(false);
  const [recWindow, setRecWindow] = useState<WindowOption>("1d");
  const [recStatus, setRecStatus] = useState<typeof REC_STATUSES[number]>("ALL");
  const [recProfileId, setRecProfileId] = useState("all");
  const [recSponsorship, setRecSponsorship] = useState("ANY");
  const [recCounts, setRecCounts] = useState<RecCounts | null>(null);
  const [roleProfiles, setRoleProfiles] = useState<RoleProfileRef[]>([]);
  const [recRunLoading, setRecRunLoading] = useState(false);
  const [recError, setRecError] = useState<string | null>(null);
  const [recMessage, setRecMessage] = useState<string | null>(null);

  // History tab state
  const [historySubTab, setHistorySubTab] = useState<"sync" | "recs" | "notifications">("sync");
  const [syncRuns, setSyncRuns] = useState<SyncRunRow[]>([]);
  const [syncRunsTotal, setSyncRunsTotal] = useState(0);
  const [syncRunsPage, setSyncRunsPage] = useState(1);
  const [syncRunsLoading, setSyncRunsLoading] = useState(false);
  const [expandedSyncRun, setExpandedSyncRun] = useState<string | null>(null);
  const [syncRunDetail, setSyncRunDetail] = useState<SyncRunDetail | null>(null);
  const [recRuns, setRecRuns] = useState<RecRunRow[]>([]);
  const [recRunsTotal, setRecRunsTotal] = useState(0);
  const [recRunsPage, setRecRunsPage] = useState(1);
  const [recRunsLoading, setRecRunsLoading] = useState(false);
  const [notifs, setNotifs] = useState<NotifRow[]>([]);
  const [notifsTotal, setNotifsTotal] = useState(0);
  const [notifsPage, setNotifsPage] = useState(1);
  const [notifsLoading, setNotifsLoading] = useState(false);

  // Sources tab state
  const [sourceHealth, setSourceHealth] = useState<SourceHealthRow[]>([]);
  const [sourceHealthLoading, setSourceHealthLoading] = useState(false);

  // Timeline modal state
  const [timelineJobId, setTimelineJobId] = useState<string | null>(null);
  const [timelineJob, setTimelineJob] = useState<TimelineJob | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(false);

  // Fetch job titles and companies for dropdowns
  useEffect(() => {
    const fetchMetadata = async () => {
      try {
        const res = await fetch("/api/jobs?pageSize=9999&active=all");
        const data = (await res.json()) as { jobs: JobBoardJob[] };
        const titles = Array.from(new Set(data.jobs.map(j => j.title)))
          .filter(Boolean)
          .sort();
        const companies = Array.from(new Set(data.jobs.map(j => j.company)))
          .filter(Boolean)
          .sort();
        setAllJobTitles(titles);
        setAllCompanies(companies);
      } catch (e) {
        console.error("Failed to fetch metadata:", e);
      }
    };
    fetchMetadata();
  }, []);

  // Fetch sync history
  const fetchSyncHistory = async () => {
    setLoadingSyncHistory(true);
    try {
      const res = await fetch("/api/sync/history");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSyncHistory(data);
    } catch (e) {
      console.error("Failed to fetch sync history:", e);
      setError("Could not load sync history");
    } finally {
      setLoadingSyncHistory(false);
    }
  };

  // Fetch role profiles for dropdown
  useEffect(() => {
    fetch("/api/role-profiles")
      .then((r) => r.json())
      .then((d: { profiles: RoleProfileRef[] }) => setRoleProfiles(d.profiles ?? []))
      .catch(console.error);
  }, []);

  // Fetch recommendation counts (unseen badge)
  const fetchRecCounts = () => {
    fetch("/api/recommendations/counts")
      .then((r) => r.json())
      .then((d) => setRecCounts(d as RecCounts))
      .catch(console.error);
  };
  useEffect(() => {
    fetchRecCounts();
    const id = setInterval(fetchRecCounts, 60_000);
    return () => clearInterval(id);
  }, []);

  // Fetch recommendations when rec tab is active or filters change
  useEffect(() => {
    if (mainTab !== "recommended" && mainTab !== "alerts") return;
    const controller = new AbortController();
    setRecLoading(true);
    setRecError(null);

    const params = new URLSearchParams({
      page: String(recPage),
      pageSize: "25",
      window: recWindow,
    });
    if (mainTab === "alerts") {
      params.set("status", "UNSEEN");
    } else if (recStatus !== "ALL") {
      params.set("status", recStatus);
    }
    if (recProfileId !== "all") params.set("roleProfileId", recProfileId);
    if (recSponsorship !== "ANY") params.set("sponsorship", recSponsorship);

    fetch(`/api/recommendations?${params}`, { signal: controller.signal })
      .then((r) => r.json() as Promise<{ recommendations: Recommendation[]; total: number; totalPages: number }>)
      .then((d) => {
        setRecommendations(d.recommendations);
        setRecTotal(d.total);
        setRecTotalPages(d.totalPages);
        setRecLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setRecError("Could not load recommendations.");
        setRecLoading(false);
      });
    return () => controller.abort();
  }, [mainTab, recPage, recWindow, recStatus, recProfileId, recSponsorship]);

  async function runRecommendations(windowHours: number) {
    setRecRunLoading(true);
    setRecMessage(null);
    setRecError(null);
    try {
      const res = await fetch("/api/recommendations/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ windowHours }),
      });
      const data = (await res.json()) as { jobsScanned: number; recommendationsCreated: number };
      setRecMessage(`Done: scanned ${data.jobsScanned} jobs, created ${data.recommendationsCreated} recommendations`);
      setRecPage(1);
      fetchRecCounts();
    } catch {
      setRecError("Recommendation run failed.");
    } finally {
      setRecRunLoading(false);
    }
  }

  // ── History fetchers ────────────────────────────────────────────────────
  const fetchSyncRuns = (page = 1) => {
    setSyncRunsLoading(true);
    fetch(`/api/history/sync-runs?page=${page}&pageSize=15`)
      .then((r) => r.json() as Promise<{ runs: SyncRunRow[]; total: number }>)
      .then((d) => { setSyncRuns(d.runs); setSyncRunsTotal(d.total); setSyncRunsPage(page); })
      .catch(console.error)
      .finally(() => setSyncRunsLoading(false));
  };

  const fetchSyncRunDetail = (id: string) => {
    if (expandedSyncRun === id) { setExpandedSyncRun(null); setSyncRunDetail(null); return; }
    setExpandedSyncRun(id);
    setSyncRunDetail(null);
    fetch(`/api/history/sync-runs/${id}`)
      .then((r) => r.json() as Promise<SyncRunDetail>)
      .then(setSyncRunDetail)
      .catch(console.error);
  };

  const fetchRecRuns = (page = 1) => {
    setRecRunsLoading(true);
    fetch(`/api/history/recommendation-runs?page=${page}&pageSize=15`)
      .then((r) => r.json() as Promise<{ runs: RecRunRow[]; total: number }>)
      .then((d) => { setRecRuns(d.runs); setRecRunsTotal(d.total); setRecRunsPage(page); })
      .catch(console.error)
      .finally(() => setRecRunsLoading(false));
  };

  const fetchNotifs = (page = 1) => {
    setNotifsLoading(true);
    fetch(`/api/history/notifications?page=${page}&pageSize=15`)
      .then((r) => r.json() as Promise<{ notifications: NotifRow[]; total: number }>)
      .then((d) => { setNotifs(d.notifications); setNotifsTotal(d.total); setNotifsPage(page); })
      .catch(console.error)
      .finally(() => setNotifsLoading(false));
  };

  const fetchSourceHealth = () => {
    setSourceHealthLoading(true);
    fetch("/api/sources/health")
      .then((r) => r.json() as Promise<{ sources: SourceHealthRow[] }>)
      .then((d) => setSourceHealth(d.sources))
      .catch(console.error)
      .finally(() => setSourceHealthLoading(false));
  };

  const openTimeline = (jobId: string) => {
    setTimelineJobId(jobId);
    setTimelineJob(null);
    setTimelineLoading(true);
    fetch(`/api/jobs/${jobId}/timeline`)
      .then((r) => r.json() as Promise<{ job: TimelineJob }>)
      .then((d) => setTimelineJob(d.job))
      .catch(console.error)
      .finally(() => setTimelineLoading(false));
  };

  useEffect(() => {
    if (mainTab === "history") {
      if (historySubTab === "sync") fetchSyncRuns(1);
      else if (historySubTab === "recs") fetchRecRuns(1);
      else fetchNotifs(1);
    } else if (mainTab === "sources") {
      fetchSourceHealth();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainTab, historySubTab]);

  async function updateRecStatus(recId: string, status: RecStatus) {
    try {
      await fetch(`/api/recommendations/${recId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      setRecommendations((prev) =>
        prev.map((r) => (r.id === recId ? { ...r, status } : r)),
      );
      fetchRecCounts();
    } catch {
      setRecError("Could not update recommendation status.");
    }
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedCompanySearch(companySearch);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [companySearch]);

  useEffect(() => {
    const controller = new AbortController();

    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      active: activeFilter,
      sort: sortOption,
    });
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (debouncedCompanySearch) params.set("company", debouncedCompanySearch);
    if (jobTitleFilter) params.set("search", jobTitleFilter);
    if (statusFilter !== "ALL") params.set("status", statusFilter);
    if (sponsorshipFilter !== "ANY") params.set("sponsorship", sponsorshipFilter);
    if (providerFilter !== "ALL") params.set("provider", providerFilter);
    if (locationFilter.trim()) params.set("location", locationFilter.trim());

    setJobsLoading(true);
    setError(null);

    fetch(`/api/jobs?${params.toString()}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<{
          jobs: JobBoardJob[];
          page: number;
          pageSize: number;
          total: number;
          totalPages: number;
        }>;
      })
      .then((data) => {
        setJobs(data.jobs);
        setTotal(data.total);
        setTotalPages(data.totalPages);
        setJobsLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setError(
          err instanceof Error
            ? `Could not load jobs: ${err.message}`
            : "Could not load jobs.",
        );
        setJobsLoading(false);
      });

    return () => controller.abort();
  }, [
    page,
    pageSize,
    debouncedSearch,
    debouncedCompanySearch,
    jobTitleFilter,
    statusFilter,
    sponsorshipFilter,
    providerFilter,
    locationFilter,
    activeFilter,
    sortOption,
    refetchKey,
  ]);

  function resetFilters() {
    setSearch("");
    setDebouncedSearch("");
    setCompanySearch("");
    setDebouncedCompanySearch("");
    setJobTitleFilter("");
    setStatusFilter("ALL");
    setSponsorshipFilter("ANY");
    setProviderFilter("ALL");
    setLocationFilter("");
    setActiveFilter("true");
    setPage(1);
    setViewMode("all");
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
          `Sync complete: ${result.sourcesSucceeded}/${result.sourcesProcessed} sources succeeded, ${result.jobsCreated} created, ${result.jobsUpdated} updated, ${result.sourcesFailed} failed`,
        );
        router.refresh();
        setPage(1);
        setRefetchKey((k) => k + 1);
        // Refresh sync history
        await fetchSyncHistory();
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
      setMessage(`Job marked as ${status.toLowerCase()}`);
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

  function toggleSaveJob(jobId: string) {
    setSavedJobIds((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) {
        next.delete(jobId);
      } else {
        next.add(jobId);
      }
      return next;
    });
  }

  const displayJobs = viewMode === "saved" ? jobs.filter(j => savedJobIds.has(j.id)) : jobs;

  const unseenCount = recCounts?.unseen ?? 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-blue-500/20 bg-slate-900/95 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between gap-4 mb-3">
            <div>
              <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-cyan-400 to-emerald-400">
                JobRadar
              </h1>
              <p className="text-xs text-blue-300/60 mt-0.5">
                {total.toLocaleString()} opportunities · {recCounts?.last1d ?? 0} new recommendations today
              </p>
            </div>
            <div className="flex gap-2">
              <button
                className="rounded-lg bg-gradient-to-r from-purple-500 to-pink-500 px-4 py-2 text-sm font-semibold text-white shadow-lg hover:shadow-purple-500/50 transition disabled:opacity-50"
                disabled={recRunLoading}
                onClick={() => runRecommendations(24)}
                type="button"
              >
                {recRunLoading ? "🧠 Running..." : "🧠 Run Recs"}
              </button>
              <button
                className="rounded-lg bg-gradient-to-r from-emerald-500 to-cyan-500 px-4 py-2 text-sm font-semibold text-white shadow-lg hover:shadow-emerald-500/50 transition disabled:opacity-50"
                disabled={syncLoading}
                onClick={syncJobs}
                type="button"
              >
                {syncLoading ? "🔄 Syncing..." : "⚡ Sync"}
              </button>
            </div>
          </div>
          {/* Tab Nav */}
          <div className="flex flex-wrap gap-1">
            {(["jobs", "recommended", "alerts", "history", "sources"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => { setMainTab(tab); setRecPage(1); }}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${
                  mainTab === tab
                    ? "bg-blue-500/30 text-white border border-blue-500/50"
                    : "text-blue-300/70 hover:text-white hover:bg-white/10"
                }`}
              >
                {tab === "jobs" && "📋 All Jobs"}
                {tab === "recommended" && "⭐ Recommended"}
                {tab === "history" && "📊 History"}
                {tab === "sources" && "🏢 Sources"}
                {tab === "alerts" && (
                  <span className="flex items-center gap-1.5">
                    🔔 Alerts
                    {unseenCount > 0 && (
                      <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-xs font-bold text-white">
                        {unseenCount}
                      </span>
                    )}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">

        {/* ═══════════════════════════════════════════════════════════════════
            RECOMMENDATION TABS (Recommended + Alerts)
        ════════════════════════════════════════════════════════════════════ */}
        {(mainTab === "recommended" || mainTab === "alerts") && (
          <div>
            {/* Rec alerts */}
            {recMessage && (
              <div className="mb-4 rounded-lg border border-emerald-500/50 bg-emerald-500/10 px-4 py-3 text-emerald-300">
                ✅ {recMessage}
              </div>
            )}
            {recError && (
              <div className="mb-4 rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-3 text-red-300">
                ❌ {recError}
              </div>
            )}

            {/* Rec filters */}
            <div className="rounded-2xl bg-white/10 backdrop-blur border border-blue-500/30 p-4 mb-6">
              <div className="flex flex-wrap gap-3 items-center mb-3">
                {/* Window */}
                <div>
                  <span className="text-xs text-blue-300 mr-1">Window:</span>
                  <div className="inline-flex rounded-lg border border-blue-500/30 overflow-hidden">
                    {WINDOW_OPTIONS.map((w) => (
                      <button
                        key={w}
                        onClick={() => { setRecWindow(w); setRecPage(1); }}
                        className={`px-3 py-1.5 text-xs font-medium transition ${
                          recWindow === w
                            ? "bg-blue-500 text-white"
                            : "text-blue-300 hover:bg-white/10"
                        }`}
                      >
                        {w}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                {/* Role profile */}
                <select
                  value={recProfileId}
                  onChange={(e) => { setRecProfileId(e.target.value); setRecPage(1); }}
                  className="rounded-lg bg-slate-800/50 border border-blue-500/30 text-white px-3 py-2 text-sm"
                >
                  <option value="all">All Profiles</option>
                  {roleProfiles.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>

                {/* Status (only in Recommended tab; Alerts always = UNSEEN) */}
                {mainTab === "recommended" && (
                  <select
                    value={recStatus}
                    onChange={(e) => { setRecStatus(e.target.value as typeof REC_STATUSES[number]); setRecPage(1); }}
                    className="rounded-lg bg-slate-800/50 border border-blue-500/30 text-white px-3 py-2 text-sm"
                  >
                    {REC_STATUSES.map((s) => (
                      <option key={s} value={s}>{s === "ALL" ? "All Statuses" : s}</option>
                    ))}
                  </select>
                )}

                {/* Sponsorship */}
                <select
                  value={recSponsorship}
                  onChange={(e) => { setRecSponsorship(e.target.value); setRecPage(1); }}
                  className="rounded-lg bg-slate-800/50 border border-blue-500/30 text-white px-3 py-2 text-sm"
                >
                  <option value="ANY">Any Sponsorship</option>
                  <option value="YES">Visa: YES</option>
                  <option value="NO">Visa: NO</option>
                  <option value="UNKNOWN">Visa: UNKNOWN</option>
                </select>

                <span className="ml-auto text-sm text-blue-300 self-center">
                  {recLoading ? "Loading..." : `${recTotal} recommendations`}
                </span>
              </div>
            </div>

            {/* Rec list */}
            {recLoading ? (
              <div className="text-center py-12 text-blue-300">🧠 Loading recommendations...</div>
            ) : recommendations.length === 0 ? (
              <div className="rounded-2xl bg-white/10 backdrop-blur border border-blue-500/30 p-12 text-center">
                <p className="text-blue-300/70 mb-2">
                  {mainTab === "alerts" ? "No unseen recommendations." : "No recommendations for this filter."}
                </p>
                <p className="text-xs text-blue-300/40">
                  Run &ldquo;🧠 Run Recs&rdquo; to score jobs against your profiles.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {recommendations.map((rec) => (
                  <div
                    key={rec.id}
                    className={`rounded-xl border p-4 backdrop-blur transition ${
                      rec.status === "UNSEEN"
                        ? "bg-blue-500/10 border-blue-500/40 hover:border-blue-500/60"
                        : "bg-white/5 border-blue-500/20 hover:border-blue-500/40"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        {/* Score + title */}
                        <div className="flex items-center gap-3 mb-1">
                          <span className={`text-2xl font-bold tabular-nums ${
                            rec.score >= 70 ? "text-emerald-400" : rec.score >= 50 ? "text-blue-400" : "text-amber-400"
                          }`}>
                            {rec.score}
                          </span>
                          <div>
                            <h3 className="font-bold text-white text-sm">{rec.job.title}</h3>
                            <p className="text-xs text-blue-300/70">{rec.job.company}
                              {rec.job.location && ` · ${rec.job.location}`}
                            </p>
                          </div>
                        </div>

                        {/* Profile + timing */}
                        <div className="flex flex-wrap gap-2 mb-2 text-xs">
                          <span className="bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded">
                            {rec.roleProfile.name}
                          </span>
                          {rec.job.postedAt && (
                            <span className="text-blue-300/50">
                              Posted: {timeAgo(rec.job.postedAt)}
                            </span>
                          )}
                          <span className="text-blue-300/50">
                            Found: {timeAgo(rec.job.effectiveNewAt ?? rec.job.firstSeenAt)}
                          </span>
                          <span className={`px-2 py-0.5 rounded font-medium ${
                            rec.job.sponsorship === "YES" ? "bg-emerald-500/20 text-emerald-300" :
                            rec.job.sponsorship === "NO" ? "bg-rose-500/20 text-rose-300" :
                            "bg-amber-500/20 text-amber-300"
                          }`}>
                            Visa: {rec.job.sponsorship}
                          </span>
                        </div>

                        {/* Matched keywords */}
                        {rec.matched.filter(m => !m.startsWith("title:") && !m.startsWith("location:")).length > 0 && (
                          <div className="flex flex-wrap gap-1 mb-2">
                            {rec.matched
                              .filter(m => !m.startsWith("title:") && !m.startsWith("location:"))
                              .slice(0, 8)
                              .map((kw) => (
                                <span key={kw} className="text-xs bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 px-1.5 py-0.5 rounded">
                                  {kw}
                                </span>
                              ))}
                          </div>
                        )}

                        {/* Reason */}
                        {rec.reason && (
                          <p className="text-xs text-slate-400 italic">{rec.reason}</p>
                        )}
                      </div>

                      {/* Status badge */}
                      <div className="flex-shrink-0">
                        <span className={`text-xs font-bold px-2 py-1 rounded ${
                          rec.status === "UNSEEN" ? "bg-blue-500/30 text-blue-200" :
                          rec.status === "SEEN" ? "bg-slate-500/30 text-slate-300" :
                          rec.status === "SAVED" ? "bg-emerald-500/30 text-emerald-300" :
                          rec.status === "APPLIED" ? "bg-cyan-500/30 text-cyan-300" :
                          "bg-slate-600/30 text-slate-400"
                        }`}>
                          {rec.status}
                        </span>
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex gap-2 mt-3 flex-wrap">
                      <a
                        href={rec.job.applyUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-lg bg-gradient-to-r from-blue-500 to-cyan-500 text-white text-xs font-semibold px-3 py-1.5 hover:shadow-lg hover:shadow-blue-500/30 transition"
                      >
                        Open →
                      </a>
                      {rec.status === "UNSEEN" && (
                        <button
                          onClick={() => updateRecStatus(rec.id, "SEEN")}
                          className="rounded-lg bg-slate-700/50 border border-slate-600 text-white text-xs px-3 py-1.5 hover:bg-slate-700 transition"
                        >
                          Mark Seen
                        </button>
                      )}
                      {rec.status !== "SAVED" && rec.status !== "APPLIED" && (
                        <button
                          onClick={() => updateRecStatus(rec.id, "SAVED")}
                          className="rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs px-3 py-1.5 hover:bg-emerald-500/30 transition"
                        >
                          Save
                        </button>
                      )}
                      {rec.status !== "APPLIED" && (
                        <button
                          onClick={() => updateRecStatus(rec.id, "APPLIED")}
                          className="rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 text-xs px-3 py-1.5 hover:bg-cyan-500/30 transition"
                        >
                          Applied
                        </button>
                      )}
                      {rec.status !== "SKIPPED" && (
                        <button
                          onClick={() => updateRecStatus(rec.id, "SKIPPED")}
                          className="rounded-lg bg-slate-700/30 border border-slate-600/50 text-slate-400 text-xs px-3 py-1.5 hover:bg-slate-700/50 transition"
                        >
                          Skip
                        </button>
                      )}
                      <button
                        onClick={() => openTimeline(rec.job.id)}
                        className="rounded-lg bg-violet-500/20 border border-violet-500/40 text-violet-300 text-xs px-3 py-1.5 hover:bg-violet-500/30 transition"
                      >
                        🕐 Timeline
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Rec pagination */}
            {recTotalPages > 1 && (
              <div className="mt-6 flex items-center justify-center gap-4">
                <button
                  onClick={() => setRecPage((p) => Math.max(1, p - 1))}
                  disabled={recPage <= 1 || recLoading}
                  className="rounded-lg border border-blue-500/50 bg-blue-500/10 px-4 py-2 text-sm font-medium text-blue-300 hover:bg-blue-500/20 disabled:opacity-50"
                >
                  ← Previous
                </button>
                <span className="text-sm text-blue-300">Page {recPage} of {recTotalPages}</span>
                <button
                  onClick={() => setRecPage((p) => Math.min(recTotalPages, p + 1))}
                  disabled={recPage >= recTotalPages || recLoading}
                  className="rounded-lg border border-blue-500/50 bg-blue-500/10 px-4 py-2 text-sm font-medium text-blue-300 hover:bg-blue-500/20 disabled:opacity-50"
                >
                  Next →
                </button>
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            JOBS TAB (original content, shown only when mainTab === "jobs")
        ════════════════════════════════════════════════════════════════════ */}
        {mainTab === "jobs" ? <>

        {/* Quick Stats */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-8 mb-8">
          {Object.entries(initialStats).map(([label, value]) => (
            <div key={label} className="rounded-xl bg-white/10 backdrop-blur border border-blue-500/30 p-4 hover:border-blue-500/50 transition">
              <div className="text-xs font-semibold uppercase text-blue-300">{label}</div>
              <div className="mt-2 text-2xl font-bold text-white">{value}</div>
            </div>
          ))}
        </div>

        {/* Alerts */}
        {message && (
          <div className="mb-6 rounded-lg border border-emerald-500/50 bg-emerald-500/10 px-4 py-3 text-emerald-300 backdrop-blur">
            ✅ {message}
          </div>
        )}
        {error && (
          <div className="mb-6 rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-3 text-red-300 backdrop-blur">
            ❌ {error}
          </div>
        )}

        {/* Filters Section */}
        <div className="rounded-2xl bg-white/10 backdrop-blur border border-blue-500/30 p-6 mb-8">
          <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            🔍 Advanced Search & Filters
          </h2>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mb-4">
            {/* Search by Job Title */}
            <div className="grid gap-2">
              <label className="text-sm font-semibold text-blue-300">Job Title</label>
              {allJobTitles.length > 0 ? (
                <select
                  value={jobTitleFilter}
                  onChange={(e) => updateFilter(() => setJobTitleFilter(e.target.value))}
                  className="rounded-lg bg-slate-800/50 border border-blue-500/30 text-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                >
                  <option value="">All Titles ({allJobTitles.length})</option>
                  {allJobTitles.slice(0, 50).map((title) => (
                    <option key={title} value={title}>
                      {title}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={jobTitleFilter}
                  onChange={(e) => updateFilter(() => setJobTitleFilter(e.target.value))}
                  placeholder="Type job title..."
                  className="rounded-lg bg-slate-800/50 border border-blue-500/30 text-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                />
              )}
            </div>

            {/* Search by Company */}
            <div className="grid gap-2">
              <label className="text-sm font-semibold text-blue-300">Company</label>
              {allCompanies.length > 0 ? (
                <select
                  value={companySearch}
                  onChange={(e) => updateFilter(() => setCompanySearch(e.target.value))}
                  className="rounded-lg bg-slate-800/50 border border-blue-500/30 text-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                >
                  <option value="">All Companies ({allCompanies.length})</option>
                  {allCompanies.slice(0, 50).map((company) => (
                    <option key={company} value={company}>
                      {company}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={companySearch}
                  onChange={(e) => updateFilter(() => setCompanySearch(e.target.value))}
                  placeholder="google,microsoft,meta (comma-separated)"
                  className="rounded-lg bg-slate-800/50 border border-blue-500/30 text-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                />
              )}
            </div>

            {/* Free Text Search */}
            <div className="grid gap-2">
              <label className="text-sm font-semibold text-blue-300">Keywords</label>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="python,react,aws (comma-separated)"
                className="rounded-lg bg-slate-800/50 border border-blue-500/30 text-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
              />
            </div>

            {/* Status Filter */}
            <select
              value={statusFilter}
              onChange={(e) => updateFilter(() => setStatusFilter(e.target.value as typeof statuses[number]))}
              className="rounded-lg bg-slate-800/50 border border-blue-500/30 text-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
            >
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {s === "ALL" ? "All Statuses" : s}
                </option>
              ))}
            </select>

            {/* Sponsorship Filter */}
            <select
              value={sponsorshipFilter}
              onChange={(e) => updateFilter(() => setSponsorshipFilter(e.target.value as typeof sponsorships[number]))}
              className="rounded-lg bg-slate-800/50 border border-blue-500/30 text-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
            >
              {sponsorships.map((s) => (
                <option key={s} value={s}>
                  {s === "ANY" ? "All Sponsorships" : `Visa: ${s}`}
                </option>
              ))}
            </select>

            {/* Location Filter */}
            <input
              value={locationFilter}
              onChange={(e) => updateFilter(() => setLocationFilter(e.target.value))}
              placeholder="Remote, New York, San Francisco..."
              className="rounded-lg bg-slate-800/50 border border-blue-500/30 text-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
            />

            {/* Sort Options */}
            <select
              value={sortOption}
              onChange={(e) => setSortOption(e.target.value as "newest" | "oldest" | "recently-seen" | "title-asc" | "company-asc")}
              className="rounded-lg bg-slate-800/50 border border-blue-500/30 text-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
            >
              <option value="newest">Newest Posted</option>
              <option value="oldest">Oldest Posted</option>
              <option value="recently-seen">Recently Seen</option>
              <option value="title-asc">Title (A-Z)</option>
              <option value="company-asc">Company (A-Z)</option>
            </select>
          </div>

          <div className="flex flex-wrap gap-3 items-center justify-between pt-4 border-t border-blue-500/20">
            <div className="flex gap-2">
              <button
                onClick={resetFilters}
                className="rounded-lg bg-slate-700/50 hover:bg-slate-700 border border-slate-600 text-white px-4 py-2 text-sm font-medium transition"
              >
                ↺ Reset All
              </button>
              <button
                onClick={() => {
                  setShowSyncHistory(!showSyncHistory);
                  if (!showSyncHistory) fetchSyncHistory();
                }}
                className="rounded-lg bg-slate-700/50 hover:bg-slate-700 border border-slate-600 text-white px-4 py-2 text-sm font-medium transition"
              >
                📋 Sync History
              </button>
              <select
                value={pageSize}
                onChange={(e) => updateFilter(() => setPageSize(Number(e.target.value)))}
                className="rounded-lg bg-slate-800/50 border border-blue-500/30 text-white px-3 py-2 text-sm"
              >
                {pageSizes.map((size) => (
                  <option key={size} value={size}>
                    {size} per page
                  </option>
                ))}
              </select>
            </div>
            <span className="text-sm text-blue-300">
              {jobsLoading ? "🔄 Loading..." : `${displayJobs.length} of ${total} jobs`}
            </span>
          </div>
        </div>

        {/* Job Listings */}
        {displayJobs.length === 0 ? (
          <div className="rounded-2xl bg-white/10 backdrop-blur border border-blue-500/30 p-12 text-center">
            <p className="text-blue-300/70">
              {viewMode === "saved"
                ? "No saved jobs yet. ❤️ Click the heart icon to save jobs!"
                : "No jobs match your filters. Try adjusting your search."}
            </p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {displayJobs.map((job) => (
              <div
                key={job.id}
                className="rounded-xl bg-white/10 backdrop-blur border border-blue-500/30 p-5 hover:border-blue-500/50 hover:bg-white/15 transition group"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <h3 className="font-bold text-white text-sm group-hover:text-blue-300 transition line-clamp-2">
                      {job.title}
                    </h3>
                    <p className="text-xs text-blue-300/70 mt-1">{job.company}</p>
                  </div>
                  <button
                    onClick={() => toggleSaveJob(job.id)}
                    className={`text-xl transition ${
                      savedJobIds.has(job.id) ? "text-red-400" : "text-slate-500 hover:text-red-400"
                    }`}
                  >
                    ❤️
                  </button>
                </div>

                <div className="flex flex-wrap gap-2 mb-3">
                  <StatusBadge status={job.status} />
                  <SponsorshipBadge sponsorship={job.sponsorship} />
                  {job.location && (
                    <span className="inline-flex text-xs rounded-full bg-blue-500/20 px-2 py-1 text-blue-300 border border-blue-500/30">
                      📍 {job.location}
                    </span>
                  )}
                </div>

                <p className="text-xs text-slate-400 mb-4 line-clamp-2">
                  {job.description || "No description available"}
                </p>

                <div className="flex gap-2 mb-3">
                  {job.department && (
                    <span className="text-xs bg-purple-500/20 text-purple-300 px-2 py-1 rounded">
                      {job.department}
                    </span>
                  )}
                  {job.employmentType && (
                    <span className="text-xs bg-cyan-500/20 text-cyan-300 px-2 py-1 rounded">
                      {job.employmentType}
                    </span>
                  )}
                </div>

                <div className="flex gap-2">
                  <a
                    href={job.applyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 rounded-lg bg-gradient-to-r from-blue-500 to-cyan-500 text-white text-xs font-semibold py-2 text-center hover:shadow-lg hover:shadow-blue-500/50 transition"
                  >
                    View →
                  </a>
                  <select
                    value={job.status}
                    onChange={(e) => updateJobStatus(job.id, e.target.value as JobStatus)}
                    disabled={actionLoadingJobId === job.id}
                    className="flex-1 rounded-lg bg-slate-700/50 border border-slate-600 text-white text-xs px-2 py-2 focus:outline-none disabled:opacity-50"
                  >
                    {(["NEW", "SAVED", "APPLIED", "SKIPPED"] as const).map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pagination Footer */}
        {totalPages > 1 && (
          <div className="mt-8 flex items-center justify-center gap-4">
            {jobsLoading && (
              <svg className="h-5 w-5 animate-spin text-blue-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            )}
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || jobsLoading}
              className="rounded-lg border border-blue-500/50 bg-blue-500/10 px-4 py-2 text-sm font-medium text-blue-300 hover:bg-blue-500/20 disabled:opacity-50"
            >
              ← Previous
            </button>
            <span className="text-sm text-blue-300">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || jobsLoading}
              className="rounded-lg border border-blue-500/50 bg-blue-500/10 px-4 py-2 text-sm font-medium text-blue-300 hover:bg-blue-500/20 disabled:opacity-50"
            >
              Next →
            </button>
          </div>
        )}

        {/* Sync History Modal — always rendered so it can appear over any tab */}
        {showSyncHistory && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="rounded-2xl bg-slate-800 border border-blue-500/30 max-w-4xl w-full max-h-[80vh] overflow-auto p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-2xl font-bold text-white">📋 Sync History</h3>
                <button
                  onClick={() => setShowSyncHistory(false)}
                  className="text-2xl text-blue-300 hover:text-white"
                >
                  ✕
                </button>
              </div>

              {loadingSyncHistory ? (
                <div className="text-center py-8">
                  <p className="text-blue-300">Loading sync history...</p>
                </div>
              ) : syncHistory.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-blue-300/70">No sync history found</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {syncHistory.map((sync) => (
                    <div key={sync.id} className="rounded-lg bg-slate-700/50 border border-blue-500/20 p-4">
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3 text-xs">
                        <div>
                          <span className="text-blue-300">Status:</span>
                          <p className={`font-bold ${sync.status === "SUCCESS" ? "text-emerald-400" : sync.status === "PARTIAL_FAILURE" ? "text-amber-400" : "text-red-400"}`}>
                            {sync.status}
                          </p>
                        </div>
                        <div>
                          <span className="text-blue-300">Date:</span>
                          <p className="font-bold text-white">{new Date(sync.startedAt).toLocaleDateString()}</p>
                        </div>
                        <div>
                          <span className="text-blue-300">Sources:</span>
                          <p className="font-bold text-white">{sync.sourcesSucceeded}/{sync.sourcesProcessed}</p>
                        </div>
                        <div>
                          <span className="text-blue-300">Created:</span>
                          <p className="font-bold text-white">{sync.jobsCreated}</p>
                        </div>
                        <div>
                          <span className="text-blue-300">Updated:</span>
                          <p className="font-bold text-white">{sync.jobsUpdated}</p>
                        </div>
                      </div>
                      {sync.sourceRuns && sync.sourceRuns.length > 0 && (
                        <details className="text-xs text-blue-200 cursor-pointer">
                          <summary className="font-semibold hover:text-blue-300">Details ({sync.sourceRuns.length} sources)</summary>
                          <div className="mt-2 space-y-1 ml-4">
                            {sync.sourceRuns.map((sr: SyncSourceRunItem, i: number) => (
                              <div key={i} className="text-slate-300">
                                {sr.company} ({sr.provider}): {sr.status} - {sr.jobsFetched} fetched, {sr.jobsCreated} new, {sr.jobsUpdated} updated
                                {sr.errorMessage && <p className="text-red-300 text-xs">Error: {sr.errorMessage.slice(0, 100)}</p>}
                              </div>
                            ))}
                          </div>
                        </details>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        </> : null}

        {/* ═══════════════════════════════════════════════════════════════════
            HISTORY TAB
        ════════════════════════════════════════════════════════════════════ */}
        {mainTab === "history" && (
          <div>
            {/* Sub-tab nav */}
            <div className="flex gap-1 mb-6">
              {(["sync", "recs", "notifications"] as const).map((sub) => (
                <button
                  key={sub}
                  onClick={() => setHistorySubTab(sub)}
                  className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${
                    historySubTab === sub
                      ? "bg-blue-500/30 text-white border border-blue-500/50"
                      : "text-blue-300/70 hover:text-white hover:bg-white/10"
                  }`}
                >
                  {sub === "sync" && "🔄 Sync Runs"}
                  {sub === "recs" && "🧠 Rec Runs"}
                  {sub === "notifications" && "🔔 Notifications"}
                </button>
              ))}
            </div>

            {/* ── Sync Runs ── */}
            {historySubTab === "sync" && (
              <div>
                {syncRunsLoading ? (
                  <p className="text-blue-300 text-center py-10">Loading…</p>
                ) : syncRuns.length === 0 ? (
                  <p className="text-blue-300/60 text-center py-10">No sync runs recorded yet.</p>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-blue-500/20">
                    <table className="w-full text-sm text-left">
                      <thead className="bg-slate-800/80 text-blue-300 text-xs uppercase">
                        <tr>
                          <th className="px-4 py-3">Started</th>
                          <th className="px-4 py-3">Duration</th>
                          <th className="px-4 py-3">Status</th>
                          <th className="px-4 py-3">Sources ✓/✗</th>
                          <th className="px-4 py-3">Created</th>
                          <th className="px-4 py-3">Updated</th>
                          <th className="px-4 py-3">Stale</th>
                          <th className="px-4 py-3">Detail</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-700/50">
                        {syncRuns.map((run) => (
                          <>
                            <tr key={run.id} className="bg-slate-800/40 hover:bg-slate-800/70">
                              <td className="px-4 py-3 text-white">{timeAgo(run.startedAt)}<br /><span className="text-xs text-blue-300/60">{new Date(run.startedAt).toLocaleString()}</span></td>
                              <td className="px-4 py-3 text-slate-300">{run.durationMs != null ? `${(run.durationMs / 1000).toFixed(1)}s` : "—"}</td>
                              <td className="px-4 py-3">
                                <span className={`font-semibold ${run.status === "SUCCESS" ? "text-emerald-400" : run.status === "PARTIAL_FAILURE" ? "text-amber-400" : "text-red-400"}`}>{run.status}</span>
                              </td>
                              <td className="px-4 py-3 text-white">{run.sourcesSucceeded}<span className="text-slate-500">/</span><span className="text-red-400">{run.sourcesFailed}</span></td>
                              <td className="px-4 py-3 text-emerald-300">{run.jobsCreated}</td>
                              <td className="px-4 py-3 text-blue-300">{run.jobsUpdated}</td>
                              <td className="px-4 py-3 text-slate-400">{run.jobsMarkedStale}</td>
                              <td className="px-4 py-3">
                                <button onClick={() => fetchSyncRunDetail(run.id)} className="text-xs text-blue-400 hover:text-blue-200 transition">
                                  {expandedSyncRun === run.id ? "▲ Hide" : "▼ Expand"}
                                </button>
                              </td>
                            </tr>
                            {expandedSyncRun === run.id && (
                              <tr key={`${run.id}-detail`} className="bg-slate-900/60">
                                <td colSpan={8} className="px-6 py-4">
                                  {!syncRunDetail ? (
                                    <p className="text-blue-300 text-xs">Loading detail…</p>
                                  ) : (
                                    <div>
                                      {syncRunDetail.failedSources.length > 0 && (
                                        <div className="mb-3">
                                          <p className="text-red-400 text-xs font-semibold mb-1">Failed sources ({syncRunDetail.failedSources.length}):</p>
                                          <div className="space-y-1">
                                            {syncRunDetail.failedSources.map((s) => (
                                              <div key={s.id} className="text-xs text-slate-300">
                                                <span className="text-white font-medium">{s.company}</span> ({s.provider}): <span className="text-red-300">{s.errorMessage?.slice(0, 120)}</span>
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      )}
                                      <details className="text-xs">
                                        <summary className="text-blue-300 cursor-pointer hover:text-blue-100">All sources ({syncRunDetail.sourceRuns.length})</summary>
                                        <div className="mt-2 space-y-1 max-h-60 overflow-y-auto">
                                          {syncRunDetail.sourceRuns.map((sr) => (
                                            <div key={sr.id} className={`text-xs ${sr.status === "FAILED" ? "text-red-300" : sr.status === "SUCCESS" ? "text-emerald-300" : "text-slate-400"}`}>
                                              {sr.company} ({sr.provider}): {sr.status} — {sr.jobsFetched} fetched, {sr.jobsCreated} new
                                              {sr.errorMessage && <span className="text-red-400 ml-1">• {sr.errorMessage.slice(0, 80)}</span>}
                                            </div>
                                          ))}
                                        </div>
                                      </details>
                                    </div>
                                  )}
                                </td>
                              </tr>
                            )}
                          </>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="flex justify-between items-center mt-4 text-xs text-blue-300/60">
                  <span>{syncRunsTotal} total runs</span>
                  <div className="flex gap-2">
                    <button onClick={() => fetchSyncRuns(syncRunsPage - 1)} disabled={syncRunsPage <= 1} className="px-3 py-1 rounded bg-slate-700/50 disabled:opacity-30 hover:bg-slate-700">← Prev</button>
                    <button onClick={() => fetchSyncRuns(syncRunsPage + 1)} disabled={syncRunsPage * 15 >= syncRunsTotal} className="px-3 py-1 rounded bg-slate-700/50 disabled:opacity-30 hover:bg-slate-700">Next →</button>
                  </div>
                </div>
              </div>
            )}

            {/* ── Rec Runs ── */}
            {historySubTab === "recs" && (
              <div>
                {recRunsLoading ? (
                  <p className="text-blue-300 text-center py-10">Loading…</p>
                ) : recRuns.length === 0 ? (
                  <p className="text-blue-300/60 text-center py-10">No recommendation runs recorded yet.</p>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-blue-500/20">
                    <table className="w-full text-sm text-left">
                      <thead className="bg-slate-800/80 text-blue-300 text-xs uppercase">
                        <tr>
                          <th className="px-4 py-3">Started</th>
                          <th className="px-4 py-3">Window</th>
                          <th className="px-4 py-3">Duration</th>
                          <th className="px-4 py-3">Status</th>
                          <th className="px-4 py-3">Scanned</th>
                          <th className="px-4 py-3">Created</th>
                          <th className="px-4 py-3">Note</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-700/50">
                        {recRuns.map((run) => (
                          <tr key={run.id} className="bg-slate-800/40 hover:bg-slate-800/70">
                            <td className="px-4 py-3 text-white">{timeAgo(run.startedAt)}<br /><span className="text-xs text-blue-300/60">{new Date(run.startedAt).toLocaleString()}</span></td>
                            <td className="px-4 py-3 text-slate-300">{run.windowHours}h</td>
                            <td className="px-4 py-3 text-slate-300">{run.durationMs != null ? `${(run.durationMs / 1000).toFixed(1)}s` : "—"}</td>
                            <td className="px-4 py-3">
                              <span className={`font-semibold ${run.status === "SUCCESS" ? "text-emerald-400" : run.status === "FAILED" ? "text-red-400" : "text-amber-400"}`}>{run.status}</span>
                            </td>
                            <td className="px-4 py-3 text-white">{run.jobsScanned}</td>
                            <td className="px-4 py-3 text-emerald-300">{run.recommendationsCreated}</td>
                            <td className="px-4 py-3 text-slate-400 text-xs">{run.errorSummary ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="flex justify-between items-center mt-4 text-xs text-blue-300/60">
                  <span>{recRunsTotal} total runs</span>
                  <div className="flex gap-2">
                    <button onClick={() => fetchRecRuns(recRunsPage - 1)} disabled={recRunsPage <= 1} className="px-3 py-1 rounded bg-slate-700/50 disabled:opacity-30 hover:bg-slate-700">← Prev</button>
                    <button onClick={() => fetchRecRuns(recRunsPage + 1)} disabled={recRunsPage * 15 >= recRunsTotal} className="px-3 py-1 rounded bg-slate-700/50 disabled:opacity-30 hover:bg-slate-700">Next →</button>
                  </div>
                </div>
              </div>
            )}

            {/* ── Notifications ── */}
            {historySubTab === "notifications" && (
              <div>
                {/* Notification settings panel */}
                <div className="rounded-xl border border-blue-500/20 bg-slate-800/50 p-4 mb-6 text-sm">
                  <p className="text-blue-300 font-semibold mb-2">⚙️ Notification Settings</p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                    <div>
                      <span className="text-blue-300/60">Enabled:</span>
                      <p className={`font-semibold ${notifs.some(n => n.status === "SENT") ? "text-emerald-400" : "text-slate-400"}`}>
                        {notifs.some(n => n.channel !== "NONE" && n.status !== "SKIPPED") ? "Yes" : "No / SKIPPED"}
                      </p>
                    </div>
                    <div>
                      <span className="text-blue-300/60">Active channel:</span>
                      <p className="text-white font-semibold">{notifs[0]?.channel ?? "—"}</p>
                    </div>
                    <div>
                      <span className="text-blue-300/60">Last status:</span>
                      <p className={`font-semibold ${notifs[0]?.status === "SENT" ? "text-emerald-400" : notifs[0]?.status === "FAILED" ? "text-red-400" : "text-slate-400"}`}>
                        {notifs[0]?.status ?? "—"}
                      </p>
                    </div>
                    <div>
                      <span className="text-blue-300/60">Last sent:</span>
                      <p className="text-white">{notifs[0]?.sentAt ? timeAgo(notifs[0].sentAt) : "—"}</p>
                    </div>
                  </div>
                  {notifs[0]?.errorMessage && (
                    <p className="mt-2 text-xs text-red-400">Last error: {notifs[0].errorMessage.slice(0, 120)}</p>
                  )}
                  <p className="mt-2 text-xs text-blue-300/40">Configure via NOTIFICATIONS_ENABLED, NOTIFICATION_CHANNEL, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID env vars.</p>
                </div>

                {notifsLoading ? (
                  <p className="text-blue-300 text-center py-10">Loading…</p>
                ) : notifs.length === 0 ? (
                  <p className="text-blue-300/60 text-center py-10">No notification records yet.</p>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-blue-500/20">
                    <table className="w-full text-sm text-left">
                      <thead className="bg-slate-800/80 text-blue-300 text-xs uppercase">
                        <tr>
                          <th className="px-4 py-3">Time</th>
                          <th className="px-4 py-3">Channel</th>
                          <th className="px-4 py-3">Status</th>
                          <th className="px-4 py-3">Window</th>
                          <th className="px-4 py-3">Recs</th>
                          <th className="px-4 py-3">Preview / Error</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-700/50">
                        {notifs.map((n) => (
                          <tr key={n.id} className="bg-slate-800/40 hover:bg-slate-800/70">
                            <td className="px-4 py-3 text-white">{timeAgo(n.createdAt)}<br /><span className="text-xs text-blue-300/60">{new Date(n.createdAt).toLocaleString()}</span></td>
                            <td className="px-4 py-3 text-slate-300">{n.channel}</td>
                            <td className="px-4 py-3">
                              <span className={`font-semibold text-xs px-2 py-0.5 rounded-full ${n.status === "SENT" ? "bg-emerald-500/20 text-emerald-300" : n.status === "FAILED" ? "bg-red-500/20 text-red-300" : "bg-slate-700/50 text-slate-400"}`}>
                                {n.status}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-slate-300">{n.windowHours}h</td>
                            <td className="px-4 py-3 text-white">{n.recommendationCount}</td>
                            <td className="px-4 py-3 text-xs text-slate-400 max-w-xs truncate">
                              {n.errorMessage ? <span className="text-red-400">{n.errorMessage.slice(0, 80)}</span> : (n.messagePreview ?? "—")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="flex justify-between items-center mt-4 text-xs text-blue-300/60">
                  <span>{notifsTotal} total records</span>
                  <div className="flex gap-2">
                    <button onClick={() => fetchNotifs(notifsPage - 1)} disabled={notifsPage <= 1} className="px-3 py-1 rounded bg-slate-700/50 disabled:opacity-30 hover:bg-slate-700">← Prev</button>
                    <button onClick={() => fetchNotifs(notifsPage + 1)} disabled={notifsPage * 15 >= notifsTotal} className="px-3 py-1 rounded bg-slate-700/50 disabled:opacity-30 hover:bg-slate-700">Next →</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            SOURCES TAB
        ════════════════════════════════════════════════════════════════════ */}
        {mainTab === "sources" && (
          <div>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold text-white">🏢 Source Health</h2>
              <button onClick={fetchSourceHealth} className="text-xs text-blue-400 hover:text-blue-200">↺ Refresh</button>
            </div>
            {sourceHealthLoading ? (
              <p className="text-blue-300 text-center py-10">Loading…</p>
            ) : sourceHealth.length === 0 ? (
              <p className="text-blue-300/60 text-center py-10">No sources found.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-blue-500/20">
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-800/80 text-blue-300 text-xs uppercase">
                    <tr>
                      <th className="px-4 py-3">Company</th>
                      <th className="px-4 py-3">Provider</th>
                      <th className="px-4 py-3">Enabled</th>
                      <th className="px-4 py-3">Last Sync</th>
                      <th className="px-4 py-3">Last Status</th>
                      <th className="px-4 py-3">Active Jobs</th>
                      <th className="px-4 py-3">Total Jobs</th>
                      <th className="px-4 py-3">Latest Seen</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700/50">
                    {sourceHealth.map((s) => {
                      const isOk = s.lastSyncStatus?.startsWith("OK");
                      const isErr = s.lastSyncStatus?.startsWith("ERROR");
                      return (
                        <tr key={s.id} className="bg-slate-800/40 hover:bg-slate-800/70">
                          <td className="px-4 py-3 font-medium text-white">{s.company}</td>
                          <td className="px-4 py-3 text-slate-400 text-xs uppercase">{s.provider}</td>
                          <td className="px-4 py-3">
                            <span className={`text-xs font-semibold ${s.enabled ? "text-emerald-400" : "text-slate-500"}`}>
                              {s.enabled ? "✓" : "✗"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-slate-300 text-xs">{s.lastSyncAt ? timeAgo(s.lastSyncAt) : "—"}</td>
                          <td className="px-4 py-3 text-xs max-w-xs truncate">
                            <span className={isOk ? "text-emerald-400" : isErr ? "text-red-400" : "text-slate-400"}>
                              {s.lastSyncStatus?.slice(0, 60) ?? "—"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-white">{s.activeJobCount}</td>
                          <td className="px-4 py-3 text-slate-400">{s.totalJobCount}</td>
                          <td className="px-4 py-3 text-slate-400 text-xs">{s.latestJobSeenAt ? timeAgo(s.latestJobSeenAt) : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            TIMELINE MODAL — always rendered so it overlays any tab
        ════════════════════════════════════════════════════════════════════ */}
        {timelineJobId && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setTimelineJobId(null)}>
            <div className="rounded-2xl bg-slate-800 border border-violet-500/30 max-w-2xl w-full max-h-[85vh] overflow-auto p-6" onClick={(e) => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold text-white">🕐 Job Timeline</h3>
                <button onClick={() => setTimelineJobId(null)} className="text-2xl text-blue-300 hover:text-white">✕</button>
              </div>
              {timelineLoading || !timelineJob ? (
                <p className="text-blue-300 py-8 text-center">Loading…</p>
              ) : (
                <div>
                  <div className="mb-4">
                    <p className="text-white font-bold text-lg">{timelineJob.title}</p>
                    <p className="text-blue-300">{timelineJob.company} {timelineJob.location ? `· ${timelineJob.location}` : ""}</p>
                    <a href={timelineJob.applyUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-cyan-400 hover:underline mt-1 inline-block">Open Job →</a>
                  </div>
                  <div className="grid grid-cols-2 gap-3 mb-6 text-xs">
                    {[
                      { label: "Posted", val: timelineJob.postedAt ? new Date(timelineJob.postedAt).toLocaleDateString() : "Unknown" },
                      { label: "First Discovered", val: new Date(timelineJob.firstSeenAt).toLocaleDateString() },
                      { label: "Effective New At", val: timelineJob.effectiveNewAt ? new Date(timelineJob.effectiveNewAt).toLocaleDateString() : "—" },
                      { label: "Last Seen", val: timeAgo(timelineJob.lastSeenAt) },
                      { label: "Status", val: timelineJob.status },
                      { label: "Sponsorship", val: timelineJob.sponsorship },
                      { label: "Active", val: timelineJob.isActive ? "Yes" : "No (stale)" },
                    ].map(({ label, val }) => (
                      <div key={label} className="rounded-lg bg-slate-700/50 p-2">
                        <span className="text-blue-300/60">{label}</span>
                        <p className="font-semibold text-white mt-0.5">{val}</p>
                      </div>
                    ))}
                  </div>
                  {timelineJob.recommendations.length > 0 && (
                    <div>
                      <p className="text-blue-300 font-semibold text-sm mb-2">Recommendations ({timelineJob.recommendations.length})</p>
                      <div className="space-y-2">
                        {timelineJob.recommendations.map((r) => (
                          <div key={r.id} className="rounded-lg bg-slate-700/40 border border-blue-500/20 p-3 text-xs">
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-semibold text-white">{r.roleProfile.name}</span>
                              <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${r.score >= 70 ? "bg-emerald-500/20 text-emerald-300" : r.score >= 50 ? "bg-blue-500/20 text-blue-300" : "bg-slate-600/50 text-slate-400"}`}>
                                {r.score}
                              </span>
                            </div>
                            <div className="flex gap-3 text-blue-300/60">
                              <span>Status: <span className="text-white">{r.status}</span></span>
                              <span>Matched: {timeAgo(r.recommendedAt)}</span>
                            </div>
                            {r.reason && <p className="text-slate-400 mt-1 leading-relaxed">{r.reason}</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// ── helper ─────────────────────────────────────────────────────────────────

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "unknown";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
