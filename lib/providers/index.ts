import type { JobSource } from "@prisma/client";
import type { NormalizedJob } from "../types";
import { fetchJobsFromAshby } from "./ashby";
import { fetchJobsFromCustom } from "./custom";
import { fetchJobsFromGreenhouse } from "./greenhouse";
import { fetchJobsFromLever } from "./lever";

export async function fetchJobsFromSource(
  source: JobSource,
): Promise<NormalizedJob[]> {
  switch (source.provider) {
    case "GREENHOUSE":
      return fetchJobsFromGreenhouse(source);
    case "LEVER":
      return fetchJobsFromLever(source);
    case "ASHBY":
      return fetchJobsFromAshby(source);
    case "CUSTOM":
      return fetchJobsFromCustom(source);
    default:
      throw new Error(`Unsupported provider: ${source.provider}`);
  }
}
