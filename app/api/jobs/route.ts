import { NextResponse, type NextRequest } from "next/server";
import { getPaginatedJobs, parseJobQueryParams } from "@/lib/jobs-query";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const result = await getPaginatedJobs(
    parseJobQueryParams(request.nextUrl.searchParams),
  );

  return NextResponse.json(result);
}
