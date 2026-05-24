import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/get-user-id";

export const dynamic = "force-dynamic";

type RecStatus = "UNSEEN" | "SEEN" | "SAVED" | "APPLIED" | "SKIPPED";
const VALID_STATUSES = new Set<RecStatus>(["UNSEEN", "SEEN", "SAVED", "APPLIED", "SKIPPED"]);

/** Upsert UserJobStatus for the user/job combination. */
async function upsertUserJobStatus(userId: string, jobId: string, status: RecStatus) {
  if (status === "SEEN" || status === "UNSEEN") return;
  await prisma.userJobStatus.upsert({
    where:  { userId_jobId: { userId, jobId } },
    update: {
      status,
      appliedAt: status === "APPLIED" ? new Date() : undefined,
      updatedAt: new Date(),
    },
    create: {
      userId,
      jobId,
      status,
      appliedAt: status === "APPLIED" ? new Date() : null,
    },
  });
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

  let userId: string;
  try {
    userId = await getSessionUserId();
  } catch {
    return NextResponse.json({ error: "No default user" }, { status: 500 });
  }

  const rec = await prisma.userJobRecommendation.findUnique({
    where: { id },
    select: { id: true, jobId: true, userId: true },
  });

  if (!rec) {
    return NextResponse.json({ error: "Recommendation not found" }, { status: 404 });
  }

  await prisma.userJobRecommendation.update({
    where: { id },
    data:  { status },
  });

  await upsertUserJobStatus(userId, rec.jobId, status);

  return NextResponse.json({ id, status });
}
