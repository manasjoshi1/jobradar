import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { JobStatus, Sponsorship } from "@/lib/types";

export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

export type JobQueryParams = {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  sponsorship?: string;
  provider?: string;
  location?: string;
  active?: string;
};

export type SerializedJob = {
  id: string;
  company: string;
  title: string;
  location: string | null;
  department: string | null;
  employmentType: string | null;
  provider: string;
  sourceCompany: string;
  description: string | null;
  applyUrl: string;
  postedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  status: JobStatus;
  sponsorship: Sponsorship;
  isActive: boolean;
};

export type PaginatedJobs = {
  jobs: SerializedJob[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

const validStatuses = new Set(["NEW", "SAVED", "APPLIED", "SKIPPED"]);
const validSponsorships = new Set(["YES", "NO", "UNKNOWN"]);
const validProviders = new Set(["GREENHOUSE", "LEVER", "ASHBY", "CUSTOM"]);

export async function getPaginatedJobs(
  params: JobQueryParams,
): Promise<PaginatedJobs> {
  const page = clampPositiveInt(params.page, DEFAULT_PAGE);
  const pageSize = Math.min(
    clampPositiveInt(params.pageSize, DEFAULT_PAGE_SIZE),
    MAX_PAGE_SIZE,
  );
  const where = buildJobWhere(params);
  const skip = (page - 1) * pageSize;

  const [jobs, total] = await Promise.all([
    prisma.job.findMany({
      where,
      skip,
      take: pageSize,
      include: {
        source: {
          select: {
            company: true,
            provider: true,
          },
        },
      },
      orderBy: [{ postedAt: "desc" }, { firstSeenAt: "desc" }],
    }),
    prisma.job.count({ where }),
  ]);

  return {
    jobs: jobs.map((job) => ({
      id: job.id,
      company: job.company,
      title: job.title,
      location: job.location,
      department: job.department,
      employmentType: job.employmentType,
      provider: job.source.provider,
      sourceCompany: job.source.company,
      description: job.description,
      applyUrl: job.applyUrl,
      postedAt: job.postedAt?.toISOString() ?? null,
      firstSeenAt: job.firstSeenAt.toISOString(),
      lastSeenAt: job.lastSeenAt.toISOString(),
      status: job.status as JobStatus,
      sponsorship: job.sponsorship as Sponsorship,
      isActive: job.isActive,
    })),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export function parseJobQueryParams(searchParams: URLSearchParams): JobQueryParams {
  return {
    page: numberParam(searchParams.get("page")),
    pageSize: numberParam(searchParams.get("pageSize")),
    search: stringParam(searchParams.get("search")),
    status: stringParam(searchParams.get("status")),
    sponsorship: stringParam(searchParams.get("sponsorship")),
    provider: stringParam(searchParams.get("provider")),
    location: stringParam(searchParams.get("location")),
    active: stringParam(searchParams.get("active")),
  };
}

function buildJobWhere(params: JobQueryParams): Prisma.JobWhereInput {
  const where: Prisma.JobWhereInput = {};
  const search = params.search?.trim();
  const location = params.location?.trim();

  if (params.active === undefined || params.active === "" || params.active === "true") {
    where.isActive = true;
  } else if (params.active === "false") {
    where.isActive = false;
  }

  if (params.status && params.status !== "ALL" && validStatuses.has(params.status)) {
    where.status = params.status;
  }

  if (
    params.sponsorship &&
    params.sponsorship !== "ANY" &&
    validSponsorships.has(params.sponsorship)
  ) {
    where.sponsorship = params.sponsorship;
  }

  if (params.provider && params.provider !== "ALL" && validProviders.has(params.provider)) {
    where.source = { provider: params.provider };
  }

  if (location) {
    where.location = { contains: location };
  }

  if (search) {
    where.OR = [
      { title: { contains: search } },
      { company: { contains: search } },
      { location: { contains: search } },
      { department: { contains: search } },
      { employmentType: { contains: search } },
      { description: { contains: search } },
      { applyUrl: { contains: search } },
    ];
  }

  return where;
}

function clampPositiveInt(value: number | undefined, fallback: number) {
  if (!value || !Number.isInteger(value) || value < 1) return fallback;
  return value;
}

function numberParam(value: string | null) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
}

function stringParam(value: string | null) {
  return value?.trim() || undefined;
}
