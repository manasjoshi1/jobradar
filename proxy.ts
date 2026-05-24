import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest, redirectToLogin } from "@/lib/auth";

// Routes that are always public (no auth required)
const PUBLIC_PATHS = new Set(["/login", "/register", "/favicon.ico"]);

// Next.js static files, image optimizer, and all auth API endpoints are always public.
// /api/health is also public — it's a liveness probe used by the deploy script.
function isNextInternal(pathname: string): boolean {
  return (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/api/auth/") ||
    pathname === "/api/health"
  );
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isNextInternal(pathname) || PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  const session = await getSessionFromRequest(req);
  if (!session) {
    // API routes → 401 JSON; pages → redirect to /login
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return redirectToLogin(req);
  }

  // ── Onboarding gate ──────────────────────────────────────────────────────────
  // If the user has not completed onboarding, redirect them to /onboarding.
  // Exception: the /onboarding page itself and /api/onboarding are always accessible
  // to an authenticated-but-not-yet-onboarded user.
  const onboardingCompleted = session.onboardingCompleted ?? true; // legacy = true

  if (!onboardingCompleted) {
    // Allow access to the onboarding page and its API
    if (
      pathname === "/onboarding" ||
      pathname.startsWith("/onboarding/") ||
      pathname === "/api/onboarding" ||
      pathname.startsWith("/api/onboarding/")
    ) {
      return NextResponse.next();
    }

    // API calls from onboarding page should get 403 rather than redirect
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Onboarding not complete" }, { status: 403 });
    }

    return NextResponse.redirect(new URL("/onboarding", req.url));
  }

  // Onboarding complete — if they visit /onboarding, send them home
  if (pathname === "/onboarding" || pathname.startsWith("/onboarding/")) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  return NextResponse.next();
}

export const config = {
  // Run on all routes except static assets
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

