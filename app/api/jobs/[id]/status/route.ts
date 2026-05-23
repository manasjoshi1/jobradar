import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import type { JobStatus } from "@/lib/types";

const VALID_STATUSES = new Set<JobStatus>([
  "NEW",
  "SAVED",
  "APPLIED",
  "SKIPPED",
]);

type RouteContext = {
  params: Promise<{ id?: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  if (!id) {
    return NextResponse.json({ error: "Job id is required." }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as {
    status?: unknown;
  } | null;
  const status = body?.status;

  if (typeof status !== "string" || !VALID_STATUSES.has(status as JobStatus)) {
    return NextResponse.json({ error: "Invalid status." }, { status: 400 });
  }

  const existing = await prisma.job.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!existing) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  const job = await prisma.job.update({
    where: { id },
    data: { status },
    select: {
      id: true,
      status: true,
    },
  });

  return NextResponse.json(job);
}
