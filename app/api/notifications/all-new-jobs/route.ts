/**
 * POST /api/notifications/all-new-jobs
 *
 * Manually trigger the all-new-jobs digest notification.
 *
 * Body (optional):
 *   { "lookbackHours": 1 }
 *
 * Response:
 *   { "ok": true }
 */
import { NextResponse, type NextRequest } from "next/server";
import { sendAllNewJobsNotification } from "@/lib/services/all-new-jobs-notification-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let lookbackHours: number | undefined;

  try {
    const body = await request.json() as { lookbackHours?: number };
    if (typeof body.lookbackHours === "number" && body.lookbackHours > 0) {
      lookbackHours = body.lookbackHours;
    }
  } catch {
    // body is optional — ignore parse errors
  }

  await sendAllNewJobsNotification({ lookbackHours });
  return NextResponse.json({ ok: true });
}
