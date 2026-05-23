import type { JobSource } from "@prisma/client";
import { cleanHtmlToText, normalizeLocation, parseDateSafe } from "../normalizers";
import type { NormalizedJob } from "../types";
import { fetchJson } from "./shared";

type GreenhouseJob = {
  absolute_url?: string;
  id?: string | number;
  internal_job_id?: string | number;
  title?: string;
  company_name?: string;
  location?: { name?: string } | string;
  departments?: Array<{ name?: string }>;
  metadata?: Array<{ name?: string; value?: unknown }>;
  content?: string;
  first_published?: string;
  updated_at?: string;
};

type GreenhouseResponse = {
  jobs?: GreenhouseJob[];
};

export async function fetchJobsFromGreenhouse(
  source: JobSource,
): Promise<NormalizedJob[]> {
  const url = new URL(source.url);
  url.searchParams.set("content", "true");

  const response = await fetchJson<GreenhouseResponse>(url.toString());
  const jobs = response.jobs ?? [];

  return jobs.flatMap((job) => {
      const applyUrl = job.absolute_url?.trim();
      const title = job.title?.trim();
      if (!applyUrl || !title) return [];

      const department =
        job.departments?.map((department) => department.name).filter(Boolean).join(", ") ??
        metadataValue(job.metadata, "External Department");

      return [{
        externalId: String(job.id ?? job.internal_job_id ?? ""),
        company: job.company_name?.trim() || source.company,
        title,
        location: normalizeLocation(job.location),
        department: department || undefined,
        applyUrl,
        description: cleanHtmlToText(job.content),
        postedAt: parseDateSafe(job.first_published ?? job.updated_at),
      }];
    });
}

function metadataValue(
  metadata: GreenhouseJob["metadata"],
  name: string,
): string | undefined {
  const item = metadata?.find(
    (entry) => entry.name?.toLowerCase() === name.toLowerCase(),
  );
  return typeof item?.value === "string" ? item.value : undefined;
}
