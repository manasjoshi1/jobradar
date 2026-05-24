import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const run = await prisma.syncRun.findUnique({
    where: { id },
    include: {
      sourceRuns: {
        orderBy: [{ status: "asc" }, { company: "asc" }],
      },
    },
  });

  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const durationMs =
    run.finishedAt ? run.finishedAt.getTime() - run.startedAt.getTime() : null;

  const failed = run.sourceRuns.filter((s) => s.status === "FAILED");

  return NextResponse.json({ ...run, durationMs, failedSources: failed });
}
