import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/get-user-id";

export const dynamic = "force-dynamic";

export async function GET() {
  let userId: string;
  try {
    userId = await getSessionUserId();
  } catch {
    // Fall back to global role profiles if no user yet
    const profiles = await prisma.roleProfile.findMany({
      orderBy: [{ priority: "desc" }, { name: "asc" }],
      select: { id: true, name: true, enabled: true, priority: true, minScore: true, requiresSponsorship: true },
    });
    return NextResponse.json({ profiles });
  }

  // Return user's role profiles
  const profiles = await prisma.userRoleProfile.findMany({
    where:   { userId },
    orderBy: [{ priority: "desc" }, { name: "asc" }],
    select:  { id: true, name: true, enabled: true, priority: true, minScore: true, requiresSponsorship: true },
  });

  return NextResponse.json({ profiles });
}
