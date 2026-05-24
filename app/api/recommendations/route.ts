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
};

const VALID_STATUSES = new Set(["UNSEEN", "SEEN", "SAVED", "APPLIED", "SKIPPED"]);

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;

  // Pagination
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const pageSize = Math.min(Math.max(1, Number(sp.get("pageSize")) || 50), 100);
  const skip = (page - 1) * pageSize;

  // Filters
  const windowParam = sp.get("window") ?? "1d";
  const windowHours = WINDOW_MAP[windowParam] ?? 24;
  const windowStart = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  const statusParam = sp.get("status") ?? "ALL";
  const roleProfileId = sp.get("roleProfileId") ?? "all";
  const sponsorshipParam = sp.get("sponsorship") ?? "ANY";

  // Build where clause
  const where: Prisma.JobRecommendationWhereInput = {
    recommendedAt: { gte: windowStart },
  };

  if (statusParam !== "ALL" && VALID_STATUSES.has(statusParam)) {
    where.status = statusParam;
  }

  if (roleProfileId !== "all" && roleProfileId) {
    where.roleProfileId = roleProfileId;
  }

  if (sponsorshipParam !== "ANY") {
    where.job = { sponsorship: sponsorshipParam };
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
