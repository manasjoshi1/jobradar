import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const job = await prisma.job.findUnique({
    where: { id },
    select: {
      id: true,
      company: true,
      title: true,
      location: true,
      applyUrl: true,
      sponsorship: true,
      status: true,
      postedAt: true,
      firstSeenAt: true,
      effectiveNewAt: true,
      lastSeenAt: true,
      isActive: true,
      recommendations: {
        orderBy: { recommendedAt: "desc" },
        select: {
          id: true,
          score: true,
          status: true,
          reason: true,
          matched: true,
          recommendedAt: true,
          roleProfile: {
            select: { id: true, name: true, minScore: true },
          },
        },
      },
    },
  });

  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ job });
}
