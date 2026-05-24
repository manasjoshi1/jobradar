import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const profiles = await prisma.roleProfile.findMany({
    orderBy: [{ priority: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      enabled: true,
      priority: true,
      minScore: true,
      requiresSponsorship: true,
    },
  });
  return NextResponse.json({ profiles });
}
