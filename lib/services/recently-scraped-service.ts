/**
 * recently-scraped-service.ts
 *
 * Profile-free, score-free query for the "Recently Scraped Jobs" feed.
 * Sorts by firstSeenAt DESC (= scrape timestamp) with createdAt as tie-breaker.
 * No user-preference predicates are applied here.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const VALID_PROVIDERS = new Set(["GREENHOUSE", "LEVER", "ASHBY", "CUSTOM"]);

export type RecentlyScrapedJob = {
  id:             string;
  title:          string;
  company:        string;
  location:       string | null;
  employmentType: string | null;
  department:     string | null;
  applyUrl:       string;
  sponsorship:    string;
  postedAt:       string | null;
  /** When our system first scraped this job */
  firstSeenAt:    string;
  lastSeenAt:     string;
  provider:       string;
  sourceCompany:  string;
  /** Short snippet from description (first 200 chars) */
  snippet:        string | null;
};

export type RecentlyScrapedResult = {
  jobs:       RecentlyScrapedJob[];
  page:       number;
  limit:      number;
  total:      number;
  totalPages: number;
};

export type RecentlyScrapedParams = {
  limit:    number;
  page:     number;
  q?:       string;
  provider?: string;
  company?:  string;
};

export async function getRecentlyScrapedJobs(
  params: RecentlyScrapedParams,
): Promise<RecentlyScrapedResult> {
  const { limit, page, q, provider, company } = params;
  const skip = (page - 1) * limit;

  // Only exclude hard-inactive (soft-deleted) jobs
  // No user filters, no score filters, no preference filters
  const where: Prisma.JobWhereInput = { isActive: true };

  if (provider && VALID_PROVIDERS.has(provider.toUpperCase())) {
    where.source = { provider: provider.toUpperCase() };
  }

  if (company) {
    where.company = { contains: company };
  }

  if (q) {
    where.OR = [
      { title:    { contains: q } },
      { company:  { contains: q } },
      { location: { contains: q } },
      { description: { contains: q } },
    ];
  }

  const [rows, total] = await Promise.all([
    prisma.job.findMany({
      where,
      skip,
      take: limit,
      orderBy: [
        { firstSeenAt: "desc" },
        { postedAt:    "desc" },
      ],
      select: {
        id:             true,
        title:          true,
        company:        true,
        location:       true,
        employmentType: true,
        department:     true,
        applyUrl:       true,
        sponsorship:    true,
        postedAt:       true,
        firstSeenAt:    true,
        lastSeenAt:     true,
        description:    true,
        source: {
          select: {
            company:  true,
            provider: true,
          },
        },
      },
    }),
    prisma.job.count({ where }),
  ]);

  return {
    jobs: rows.map((j) => ({
      id:             j.id,
      title:          j.title,
      company:        j.company,
      location:       j.location,
      employmentType: j.employmentType,
      department:     j.department,
      applyUrl:       j.applyUrl,
      sponsorship:    j.sponsorship,
      postedAt:       j.postedAt?.toISOString() ?? null,
      firstSeenAt:    j.firstSeenAt.toISOString(),
      lastSeenAt:     j.lastSeenAt.toISOString(),
      provider:       j.source.provider,
      sourceCompany:  j.source.company,
      snippet:        j.description
        ? j.description.replace(/<[^>]+>/g, "").slice(0, 200).trim()
        : null,
    })),
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}
