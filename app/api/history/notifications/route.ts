import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const page = Math.max(1, Number(sp.get("page") || 1));
  const pageSize = Math.min(Math.max(1, Number(sp.get("pageSize") || 20)), 100);
  const skip = (page - 1) * pageSize;
  const channel = sp.get("channel");
  const status = sp.get("status");

  const where: Record<string, unknown> = {};
  if (channel) where.channel = channel;
  if (status) where.status = status;

  const [total, notifications] = await Promise.all([
    prisma.notificationDelivery.count({ where }),
    prisma.notificationDelivery.findMany({
      where,
      skip,
      take: pageSize,
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return NextResponse.json({ total, page, pageSize, notifications });
}
