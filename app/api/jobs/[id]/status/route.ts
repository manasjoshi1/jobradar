/**
 * PATCH /api/jobs/[id]/status
 *
 * Writes to UserJobStatus (per-user), not the legacy global Job.status.
 * User is resolved from session cookie, falling back to default user.
 */
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/get-user-id";
import type { JobStatus } from "@/lib/types";

const VALID_STATUSES = new Set<JobStatus>(["NEW", "SAVED", "APPLIED", "SKIPPED"]);

type RouteContext = { params: Promise<{ id?: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  if (!id) return NextResponse.json({ error: "Job id is required." }, { status: 400 });

  const body = await request.json().catch(() => null) as { status?: unknown } | null;
  const status = body?.status;
  if (typeof status !== "string" || !VALID_STATUSES.has(status as JobStatus)) {
    return NextResponse.json({ error: "Invalid status." }, { status: 400 });
  }

  const userId = await getSessionUserId();

  // Verify job exists
  const job = await prisma.job.findUnique({ where: { id }, select: { id: true } });
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });

  // Write UserJobStatus (upsert)
  await prisma.userJobStatus.upsert({
    where:  { userId_jobId: { userId, jobId: id } },
    update: {
      status,
      appliedAt: status === "APPLIED" ? new Date() : undefined,
    },
    create: {
      userId,
      jobId:     id,
      status,
      appliedAt: status === "APPLIED" ? new Date() : null,
    },
  });

  return NextResponse.json({ id, status });
}
