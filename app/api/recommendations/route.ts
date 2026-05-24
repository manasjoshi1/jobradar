import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

const WINDOW_MAP: Record<string, number> = {
  "1h": 1,
  "2h": 2,
  "3h": 3,
  "6h": 6,
  "12h": 12,
  "1d": 24,
  "2d": 48,
  "7d": 168,
  "30d": 720,
  "all": 0, // special — no date filter applied
};

const VALID_STATUSES = new Set(["UNSEEN", "SEEN", "SAVED", "APPLIED", "SKIPPED"]);

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;

  // Pagination
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const pageSize = Math.min(Math.max(1, Number(sp.get("pageSize")) || 50), 100);
  const skip = (page - 1) * pageSize;

  // Filters
  const windowParam = sp.get("window") ?? "7d";
  const windowHours = WINDOW_MAP[windowParam] ?? 168;
  const windowStart = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  const statusParam = sp.get("status") ?? "ALL";
  const roleProfileId = sp.get("roleProfileId") ?? "all";
  const sponsorshipParam = sp.get("sponsorship") ?? "ANY";
  const locationParam = sp.get("location") ?? "";
  const minScore = Number(sp.get("minScore") ?? "0") || 0;

  // Build where clause
  const where: Prisma.JobRecommendationWhereInput = {
    ...(windowParam !== "all" ? { recommendedAt: { gte: windowStart } } : {}),
  };

  if (statusParam !== "ALL" && VALID_STATUSES.has(statusParam)) {
    where.status = statusParam;
  }

  if (roleProfileId !== "all" && roleProfileId) {
    where.roleProfileId = roleProfileId;
  }

  if (minScore > 0) {
    where.score = { gte: minScore };
  }

  // Build job-level sub-filter combining sponsorship + location
  const jobFilter: Prisma.JobWhereInput = {};
  if (sponsorshipParam !== "ANY") {
    jobFilter.sponsorship = sponsorshipParam;
  }
  if (locationParam) {
    // "US" is a special alias that matches US-based locations broadly
    if (locationParam.toUpperCase() === "US") {
      jobFilter.OR = [
        { location: { contains: "United States", mode: "insensitive" } },
        { location: { contains: ", US", mode: "insensitive" } },
        { location: { contains: "U.S.", mode: "insensitive" } },
        // Match common US state abbreviations at end: "New York, NY"
        { location: { contains: ", NY", mode: "insensitive" } },
        { location: { contains: ", CA", mode: "insensitive" } },
        { location: { contains: ", TX", mode: "insensitive" } },
        { location: { contains: ", WA", mode: "insensitive" } },
        { location: { contains: ", IL", mode: "insensitive" } },
        { location: { contains: ", MA", mode: "insensitive" } },
        { location: { contains: ", CO", mode: "insensitive" } },
        { location: { contains: ", GA", mode: "insensitive" } },
        { location: { contains: ", FL", mode: "insensitive" } },
        { location: { contains: ", VA", mode: "insensitive" } },
        { location: { contains: ", NC", mode: "insensitive" } },
        { location: { contains: ", AZ", mode: "insensitive" } },
        { location: { contains: ", NJ", mode: "insensitive" } },
        { location: { contains: ", OH", mode: "insensitive" } },
        { location: { contains: ", PA", mode: "insensitive" } },
        { location: { contains: ", MN", mode: "insensitive" } },
      ];
    } else {
      jobFilter.location = { contains: locationParam, mode: "insensitive" };
    }
  }
  if (Object.keys(jobFilter).length > 0) {
    where.job = jobFilter;
  }

  const [total, recommendations] = await Promise.all([
    prisma.jobRecommendation.count({ where }),
    prisma.jobRecommendation.findMany({
      where,
      skip,
      take: pageSize,
      orderBy: [{ recommendedAt: "desc" }, { score: "desc" }],
      include: {
        roleProfile: {
          select: {
            id: true,
            name: true,
            priority: true,
            minScore: true,
          },
        },
        job: {
          select: {
            id: true,
            title: true,
            company: true,
            location: true,
            department: true,
            employmentType: true,
            applyUrl: true,
            postedAt: true,
            firstSeenAt: true,
            effectiveNewAt: true,
            status: true,
            sponsorship: true,
            isActive: true,
          },
        },
      },
    }),
  ]);

  return NextResponse.json({
    recommendations: recommendations.map((r) => ({
      id: r.id,
      score: r.score,
      reason: r.reason,
      matched: parseJsonArray(r.matched),
      negatives: parseJsonArray(r.negatives),
      status: r.status,
      recommendedAt: r.recommendedAt.toISOString(),
      roleProfile: r.roleProfile,
      job: {
        ...r.job,
        postedAt: r.job.postedAt?.toISOString() ?? null,
        firstSeenAt: r.job.firstSeenAt.toISOString(),
        effectiveNewAt: r.job.effectiveNewAt?.toISOString() ?? null,
      },
    })),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
}

function parseJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
