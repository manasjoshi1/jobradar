import type { JobSource } from "@prisma/client";
import { cleanHtmlToText, normalizeLocation, parseDateSafe } from "../normalizers";
import type { NormalizedJob } from "../types";
import { fetchJson } from "./shared";

type AshbyJob = {
  id?: string;
  title?: string;
  department?: string;
  departmentName?: string;
  team?: string;
  employmentType?: string;
  location?: string;
  locationName?: string;
  publishedAt?: string;
  jobUrl?: string;
  applyUrl?: string;
  descriptionHtml?: string;
  descriptionPlain?: string;
};

type AshbyResponse = {
  jobs?: AshbyJob[];
};

export async function fetchJobsFromAshby(
  source: JobSource,
): Promise<NormalizedJob[]> {
  const response = await fetchJson<AshbyResponse>(source.url);
  const jobs = response.jobs ?? [];

  return jobs.flatMap((job) => {
      const applyUrl = (job.jobUrl ?? job.applyUrl ?? "").trim();
      const title = job.title?.trim();
      if (!applyUrl || !title) return [];

      return [{
        externalId: job.id,
        company: source.company,
        title,
        location: normalizeLocation(job.locationName ?? job.location),
        department:
          job.departmentName?.trim() ||
          job.department?.trim() ||
          job.team?.trim() ||
          undefined,
        employmentType: job.employmentType?.trim() || undefined,
        applyUrl,
        description: job.descriptionPlain ?? cleanHtmlToText(job.descriptionHtml),
        postedAt: parseDateSafe(job.publishedAt),
      }];
    });
}
