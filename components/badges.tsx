import type { JobStatus, Sponsorship } from "@/lib/types";

const statusStyles: Record<JobStatus, string> = {
  NEW: "border-slate-300 bg-white text-slate-700",
  SAVED: "border-blue-200 bg-blue-50 text-blue-700",
  APPLIED: "border-emerald-200 bg-emerald-50 text-emerald-700",
  SKIPPED: "border-slate-200 bg-slate-100 text-slate-500",
};

const sponsorshipStyles: Record<Sponsorship, string> = {
  YES: "border-emerald-200 bg-emerald-50 text-emerald-700",
  NO: "border-rose-200 bg-rose-50 text-rose-700",
  UNKNOWN: "border-amber-200 bg-amber-50 text-amber-700",
};

export function StatusBadge({ status }: { status: JobStatus }) {
  return (
    <span
      className={`inline-flex rounded border px-2 py-1 text-xs font-semibold ${statusStyles[status]}`}
    >
      {status}
    </span>
  );
}

export function SponsorshipBadge({
  sponsorship,
}: {
  sponsorship: Sponsorship;
}) {
  const icon = sponsorship === "YES" ? "Yes" : sponsorship === "NO" ? "No" : "Unknown";

  return (
    <span
      className={`inline-flex rounded border px-2 py-1 text-xs font-semibold ${sponsorshipStyles[sponsorship]}`}
    >
      {icon}
    </span>
  );
}
