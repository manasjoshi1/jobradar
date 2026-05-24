/**
 * GET /api/health
 *
 * Unauthenticated liveness probe used by the CI deploy script.
 * Returns 200 immediately — no DB query, no auth check.
 * Nginx / load balancers can also poll this endpoint.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ ok: true, service: "jobradar" });
}
