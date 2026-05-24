/**
 * Shared user-ID resolver for API route handlers.
 *
 * Priority:
 *   1. Valid session cookie  → returns session.sub (the logged-in user's id)
 *   2. No session            → falls back to the default user (isDefault=true)
 *                              (supports scheduler / CLI / bootstrap contexts
 *                               that call APIs without a browser session)
 *
 * Throws if neither a session nor a default user can be found.
 */
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function getSessionUserId(): Promise<string> {
  // 1. Try session
  const session = await getSession().catch(() => null);
  if (session?.sub) return session.sub;

  // 2. Fall back to default user
  const defaultUser = await prisma.user.findFirst({
    where:  { isDefault: true },
    select: { id: true },
  });
  if (defaultUser) return defaultUser.id;

  throw new Error("No authenticated user and no default user found.");
}

/**
 * Same as getSessionUserId but returns null instead of throwing.
 * Use when you want to return 401 rather than 500.
 */
export async function tryGetSessionUserId(): Promise<string | null> {
  try { return await getSessionUserId(); } catch { return null; }
}
