import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { groupUserRecommendations } from "@/lib/recommendation/group-user-recommendations";
import { getDefaultUserId } from "@/lib/services/user-recommendation-service";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

const WINDOW_MAP: Record<string, number> = {
  "1h": 1, "2h": 2, "3h": 3, "6h": 6, "12h": 12,
  "1d": 24, "2d": 48, "7d": 168, "30d": 720, "all": 0,
};

const VALID_STATUSES = new Set(["UNSEEN", "SEEN", "SAVED", "APPLIED", "SKIPPED"]);

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;

  // Resolve user (default user for now — future: extract from session)
  let userId: string;
  try {
    userId = await getDefaultUserId();
  } catch {
    return NextResponse.json({ error: "No default user. Run db:seed-user." }, { status: 500 });
  }

  // Pagination
  const page     = Math.max(1, Number(sp.get("page")) || 1);
  const pageSize = Math.min(Math.max(1, Number(sp.get("pageSize")) || 25), 100);
  const skip     = (page - 1) * pageSize;

  // Filters
  const windowParam      = sp.get("window") ?? "7d";
  const windowHours      = WINDOW_MAP[windowParam] ?? 168;
  const windowStart      = new Date(Date.now() - windowHours * 60 * 60 * 1000);
  const statusParam      = sp.get("status") ?? "ALL";
  const roleProfileId    = sp.get("roleProfileId") ?? "all"; // userRoleProfile.id
  const sponsorshipParam = sp.get("sponsorship") ?? "ANY";
  const locationParam    = sp.get("location") ?? "";
  const minScore         = Number(sp.get("minScore") ?? "0") || 0;
  const groupByJob       = sp.get("groupByJob") !== "false";

  // Build where clause
  const where: Prisma.UserJobRecommendationWhereInput = {
    userId,
    ...(windowParam !== "all" ? { recommendedAt: { gte: windowStart } } : {}),
  };

  if (statusParam !== "ALL" && VALID_STATUSES.has(statusParam)) {
    where.status = statusParam;
  }
  if (roleProfileId !== "all") where.userRoleProfileId = roleProfileId;
  if (minScore > 0) where.score = { gte: minScore };

  // Job-level sub-filter
  const jobFilter: Prisma.JobWhereInput = {};
  if (sponsorshipParam !== "ANY") jobFilter.sponsorship = sponsorshipParam;
  if (locationParam) {
    if (locationParam.toUpperCase() === "US") {
      jobFilter.OR = [
        { location: { contains: "United States" } },
        { location: { contains: ", US" } },
        { location: { contains: "U.S." } },
        { location: { contains: ", NY" } },
        { location: { contains: ", CA" } },
        { location: { contains: ", TX" } },
        { location: { contains: ", WA" } },
        { location: { contains: ", IL" } },
        { location: { contains: ", MA" } },
        { location: { contains: ", CO" } },
        { location: { contains: ", GA" } },
        { location: { contains: ", FL" } },
        { location: { contains: ", VA" } },
        { location: { contains: ", NC" } },
        { location: { contains: ", AZ" } },
        { location: { contains: ", NJ" } },
        { location: { contains: ", OH" } },
        { location: { contains: ", PA" } },
        { location: { contains: ", MN" } },
      ];
    } else {
      jobFilter.location = { contains: locationParam };
    }
  }
  if (Object.keys(jobFilter).length > 0) where.job = jobFilter;

  // ── Grouped mode (default) ────────────────────────────────────────────────
  if (groupByJob) {
    const allRecs = await prisma.userJobRecommendation.findMany({
      where,
      orderBy: [{ score: "desc" }, { recommendedAt: "desc" }],
      take: 2000,
      include: {
        userRoleProfile: { select: { id: true, name: true, priority: true, minScore: true } },
        job: {
          select: {
            id: true, title: true, company: true, location: true, department: true,
            employmentType: true, applyUrl: true, postedAt: true, firstSeenAt: true,
            effectiveNewAt: true, status: true, sponsorship: true, isActive: true,
          },
        },
      },
    });

    const grouped        = groupUserRecommendations(allRecs);
    const totalUniqueJobs = grouped.length;
    const pagedGroups    = grouped.slice(skip, skip + pageSize);

    return NextResponse.json({
      jobs: pagedGroups,
      page,
      pageSize,
      total:      totalUniqueJobs,
      totalPages: Math.max(1, Math.ceil(totalUniqueJobs / pageSize)),
      totalRecommendations: allRecs.length,
      groupByJob: true,
    });
  }

  // ── Flat mode ─────────────────────────────────────────────────────────────
  const [total, recommendations] = await Promise.all([
    prisma.userJobRecommendation.count({ where }),
    prisma.userJobRecommendation.findMany({
      where, skip, take: pageSize,
      orderBy: [{ recommendedAt: "desc" }, { score: "desc" }],
      include: {
        userRoleProfile: { select: { id: true, name: true, priority: true, minScore: true } },
        job: {
          select: {
            id: true, title: true, company: true, location: true, department: true,
            employmentType: true, applyUrl: true, postedAt: true, firstSeenAt: true,
            effectiveNewAt: true, status: true, sponsorship: true, isActive: true,
          },
        },
      },
    }),
  ]);

  return NextResponse.json({
    recommendations: recommendations.map((r) => ({
      id: r.id, score: r.score, reason: r.reason,
      matched:   parseJsonArray(r.matched),
      negatives: parseJsonArray(r.negatives),
      status: r.status, recommendedAt: r.recommendedAt.toISOString(),
      roleProfile: r.userRoleProfile, // kept as "roleProfile" for UI compat
      job: {
        ...r.job,
        postedAt:       r.job.postedAt?.toISOString() ?? null,
        firstSeenAt:    r.job.firstSeenAt.toISOString(),
        effectiveNewAt: r.job.effectiveNewAt?.toISOString() ?? null,
      },
    })),
    page, pageSize, total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    groupByJob: false,
  });
}

function parseJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}
