import type { JobSource } from "@prisma/client";
import { cleanHtmlToText, normalizeLocation } from "../normalizers";
import type { NormalizedJob } from "../types";
import { fetchJson } from "./shared";

type SentryJob = {
  id?: string;
  title?: string;
  department?: string;
  team?: string;
  location?: string;
  employmentType?: string;
  description?: string;
  applyUrl?: string;
};

export async function fetchJobsFromCustom(
  source: JobSource,
): Promise<NormalizedJob[]> {
  const host = new URL(source.url).hostname.toLowerCase();

  if (host.includes("sentry.io")) {
    return fetchSentryJobs(source);
  }

  if (host.includes("sendcloud.com")) {
    throw new Error("Sendcloud feed is HTML in MVP; custom adapter not supported yet");
  }

  throw new Error(`Unsupported custom provider: ${host}`);
}

async function fetchSentryJobs(source: JobSource) {
  const jobs = await fetchJson<SentryJob[]>(source.url);

  return jobs.flatMap((job) => {
      const applyUrl = job.applyUrl?.trim();
      const title = job.title?.trim();
      if (!applyUrl || !title) return [];

      return [{
        externalId: job.id,
        company: source.company,
        title,
        location: normalizeLocation(job.location),
        department: job.department?.trim() || job.team?.trim() || undefined,
        employmentType: job.employmentType?.trim() || undefined,
        applyUrl,
        description: cleanHtmlToText(job.description),
      }];
    });
}
