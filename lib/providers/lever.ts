import type { JobSource } from "@prisma/client";
import {
  cleanHtmlToText,
  ensureAbsoluteApplyUrl,
  normalizeLocation,
  parseDateSafe,
} from "../normalizers";
import type { NormalizedJob } from "../types";
import { fetchJson, joinText } from "./shared";

type LeverPosting = {
  id?: string;
  text?: string;
  hostedUrl?: string;
  applyUrl?: string;
  categories?: {
    location?: string;
    department?: string;
    commitment?: string;
  };
  createdAt?: number;
  descriptionPlain?: string;
  description?: string;
  additionalPlain?: string;
  additional?: string;
  openingPlain?: string;
  opening?: string;
};

export async function fetchJobsFromLever(
  source: JobSource,
): Promise<NormalizedJob[]> {
  const postings = await fetchJson<LeverPosting[]>(source.url);

  return postings.flatMap((posting) => {
      const applyUrl = ensureAbsoluteApplyUrl(
        posting.hostedUrl ?? posting.applyUrl ?? "",
        source.url,
      );
      const title = posting.text?.trim();
      if (!applyUrl || !title) return [];

      return [{
        externalId: posting.id,
        company: source.company,
        title,
        location: normalizeLocation(posting.categories?.location),
        department: posting.categories?.department?.trim() || undefined,
        employmentType: posting.categories?.commitment?.trim() || undefined,
        applyUrl,
        description: joinText([
          posting.descriptionPlain,
          cleanHtmlToText(posting.description),
          posting.additionalPlain,
          cleanHtmlToText(posting.additional),
          posting.openingPlain,
          cleanHtmlToText(posting.opening),
        ]),
        postedAt: parseDateSafe(posting.createdAt),
      }];
    });
}
