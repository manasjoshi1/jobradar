/**
 * GET /api/jobs/recently-scraped
 *
 * Returns the most recently scraped jobs, sorted by firstSeenAt DESC.
 * Intentionally profile-free: no user preferences, no scoring, no role match.
 * Auth-gated (session required) but does NOT require onboarding completion.
 *
 * Query params:
 *   limit    – number of jobs to return (default 20, max 100)
 *   page     – 1-based page number (default 1)
 *   q        – keyword search across title / company / location
 *   provider – filter by source provider (GREENHOUSE | LEVER | ASHBY | CUSTOM)
 *   company  – filter by company name (partial match)
 */
import { NextResponse, type NextRequest } from "next/server";
import { getRecentlyScrapedJobs } from "@/lib/services/recently-scraped-service";
import { getSessionUserId } from "@/lib/get-user-id";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT     = 100;

export async function GET(request: NextRequest) {
  // Auth check — require a valid session but NOT profile completion
  try {
    await getSessionUserId();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;

  const limit   = Math.min(MAX_LIMIT, Math.max(1, Number(sp.get("limit"))  || DEFAULT_LIMIT));
  const page    = Math.max(1, Number(sp.get("page")) || 1);
  const q       = sp.get("q")?.trim()       || undefined;
  const provider = sp.get("provider")?.trim() || undefined;
  const company  = sp.get("company")?.trim()  || undefined;

  const result = await getRecentlyScrapedJobs({ limit, page, q, provider, company });
  return NextResponse.json(result);
}
