import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type RecStatus = "UNSEEN" | "SEEN" | "SAVED" | "APPLIED" | "SKIPPED";

const VALID_STATUSES = new Set<RecStatus>(["UNSEEN", "SEEN", "SAVED", "APPLIED", "SKIPPED"]);

/**
 * Recommendation → Job status mirroring rules:
 * - SAVED   → Job.status = SAVED   only if current Job.status is NEW
 * - APPLIED → Job.status = APPLIED unless already APPLIED
 * - SKIPPED → Job.status = SKIPPED only if current Job.status is NEW or SAVED
 * - SEEN / UNSEEN → no change to Job.status
 * APPLIED is highest priority — never downgrade from APPLIED.
 */
async function mirrorToJob(
  jobId: string,
  recStatus: RecStatus,
): Promise<void> {
  if (recStatus === "SEEN" || recStatus === "UNSEEN") return;

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { status: true },
  });
  if (!job) return;

  const current = job.status;

  // Never downgrade APPLIED
  if (current === "APPLIED") return;

  if (recStatus === "APPLIED") {
    await prisma.job.update({ where: { id: jobId }, data: { status: "APPLIED" } });
    return;
  }

  if (recStatus === "SAVED" && current === "NEW") {
    await prisma.job.update({ where: { id: jobId }, data: { status: "SAVED" } });
    return;
  }

  if (recStatus === "SKIPPED" && (current === "NEW" || current === "SAVED")) {
    await prisma.job.update({ where: { id: jobId }, data: { status: "SKIPPED" } });
    return;
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let status: RecStatus;
  try {
    const body = await request.json() as { status?: unknown };
    if (!body.status || !VALID_STATUSES.has(body.status as RecStatus)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${[...VALID_STATUSES].join(", ")}` },
        { status: 400 },
      );
    }
    status = body.status as RecStatus;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const rec = await prisma.jobRecommendation.findUnique({
    where: { id },
    select: { id: true, jobId: true },
  });

  if (!rec) {
    return NextResponse.json({ error: "Recommendation not found" }, { status: 404 });
  }

  await prisma.jobRecommendation.update({
    where: { id },
    data: { status },
  });

  // Mirror status to job
  await mirrorToJob(rec.jobId, status);

  return NextResponse.json({ id, status });
}
