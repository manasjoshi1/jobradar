/**
 * GET /api/auth/me
 * Returns the currently authenticated user from the session cookie.
 * Used by client components to check auth state.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ user: null }, { status: 401 });
  }
  return NextResponse.json({
    user: {
      id:        session.sub,
      name:      session.name,
      isDefault: session.isDefault,
    },
  });
}
