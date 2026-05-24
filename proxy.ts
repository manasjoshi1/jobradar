import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest, redirectToLogin } from "@/lib/auth";

// Routes that are always public (no auth required)
const PUBLIC_PATHS = new Set(["/login", "/favicon.ico"]);

// Next.js static files and image optimizer are always public
function isNextInternal(pathname: string): boolean {
  return pathname.startsWith("/_next/") || pathname.startsWith("/api/auth/");
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

  return NextResponse.next();
}

export const config = {
  // Run on all routes except static assets
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
