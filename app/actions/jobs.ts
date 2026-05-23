"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import type { JobStatus } from "@/lib/types";

const VALID_STATUSES = new Set<JobStatus>([
  "NEW",
  "SAVED",
  "APPLIED",
  "SKIPPED",
]);

export async function markJobStatus(jobId: string, status: JobStatus) {
  if (!VALID_STATUSES.has(status)) {
    throw new Error(`Invalid job status: ${status}`);
  }

  const job = await prisma.job.update({
    where: { id: jobId },
    data: { status },
  });

  revalidatePath("/");
  return job;
}
