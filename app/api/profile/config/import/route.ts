/**
 * POST /api/profile/config/import
 * Body: { yaml: string, type: "user" | "companies" | "all" }
 *
 * Imports user preferences, role profiles, and/or company job sources
 * from a YAML string into the database.
 */
import { NextResponse, type NextRequest } from "next/server";
import yaml from "yaml";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/get-user-id";

export const dynamic = "force-dynamic";

const PROVIDER_URL_TEMPLATES: Record<string, string> = {
  GREENHOUSE: "https://boards-api.greenhouse.io/v1/boards/{boardToken}/jobs?content=true",
  LEVER: "https://api.lever.co/v0/postings/{boardToken}",
  ASHBY: "https://api.ashbyhq.com/posting-api/job-board/{boardToken}",
};

function normalizeProvider(raw: string): string {
  const up = (raw ?? "").toUpperCase();
  if (["GREENHOUSE", "LEVER", "ASHBY"].includes(up)) return up;
  return "CUSTOM";
}

function buildUrl(provider: string, boardToken?: string, explicitUrl?: string): string | null {
  if (explicitUrl) return explicitUrl;
  const template = PROVIDER_URL_TEMPLATES[provider];
  if (template && boardToken) {
    return template.replace("{boardToken}", boardToken);
  }
  return null;
}

function safeArray(val: unknown): string[] {
  if (Array.isArray(val)) return val.map(String);
  return [];
}

async function importUser(
  parsed: Record<string, unknown>,
  userId: string,
  errors: string[],
): Promise<Record<string, number>> {
  const counts: Record<string, number> = { prefsUpserted: 0, profilesUpserted: 0 };

  // Upsert preferences
  const prefs = parsed.preferences as Record<string, unknown> | undefined;
  if (prefs) {
    try {
      await prisma.userJobPreference.upsert({
        where: { userId },
        create: {
          userId,
          targetLocations: JSON.stringify(safeArray(prefs.targetLocations)),
          targetRoles: JSON.stringify(safeArray(prefs.targetRoles)),
          blockedCompanies: JSON.stringify(safeArray(prefs.blockedCompanies)),
          preferredCompanies: JSON.stringify(safeArray(prefs.preferredCompanies)),
          requiresSponsorship: Boolean(prefs.requiresSponsorship ?? false),
          minScore: typeof prefs.minScore === "number" ? prefs.minScore : 45,
        },
        update: {
          targetLocations: JSON.stringify(safeArray(prefs.targetLocations)),
          targetRoles: JSON.stringify(safeArray(prefs.targetRoles)),
          blockedCompanies: JSON.stringify(safeArray(prefs.blockedCompanies)),
          preferredCompanies: JSON.stringify(safeArray(prefs.preferredCompanies)),
          requiresSponsorship: Boolean(prefs.requiresSponsorship ?? false),
          minScore: typeof prefs.minScore === "number" ? prefs.minScore : 45,
        },
      });
      counts.prefsUpserted = 1;
    } catch (err) {
      errors.push(`Failed to upsert preferences: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Upsert role profiles
  const roleProfiles = safeArray(parsed.roleProfiles as unknown[] | undefined)
    .map((p) => p as unknown)
    .filter((p): p is Record<string, unknown> => typeof p === "object" && p !== null);

  for (const profile of roleProfiles) {
    const name = typeof profile.name === "string" ? profile.name.trim() : null;
    if (!name) {
      errors.push("Skipped role profile with missing name");
      continue;
    }
    try {
      await prisma.userRoleProfile.upsert({
        where: { userId_name: { userId, name } },
        create: {
          userId,
          name,
          enabled: profile.enabled !== false,
          priority: typeof profile.priority === "number" ? profile.priority : 0,
          minScore: typeof profile.minScore === "number" ? profile.minScore : 50,
          requiresSponsorship: Boolean(profile.requiresSponsorship ?? false),
          preferredTitles: JSON.stringify(safeArray(profile.preferredTitles)),
          preferredLocations: JSON.stringify(safeArray(profile.preferredLocations)),
          mustHaveKeywords: JSON.stringify(safeArray(profile.mustHaveKeywords)),
          niceHaveKeywords: JSON.stringify(safeArray(profile.niceHaveKeywords)),
          negativeKeywords: JSON.stringify(safeArray(profile.negativeKeywords)),
        },
        update: {
          enabled: profile.enabled !== false,
          priority: typeof profile.priority === "number" ? profile.priority : 0,
          minScore: typeof profile.minScore === "number" ? profile.minScore : 50,
          requiresSponsorship: Boolean(profile.requiresSponsorship ?? false),
          preferredTitles: JSON.stringify(safeArray(profile.preferredTitles)),
          preferredLocations: JSON.stringify(safeArray(profile.preferredLocations)),
          mustHaveKeywords: JSON.stringify(safeArray(profile.mustHaveKeywords)),
          niceHaveKeywords: JSON.stringify(safeArray(profile.niceHaveKeywords)),
          negativeKeywords: JSON.stringify(safeArray(profile.negativeKeywords)),
        },
      });
      counts.profilesUpserted++;
    } catch (err) {
      errors.push(`Failed to upsert profile "${name}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return counts;
}

async function importCompanies(
  parsed: Record<string, unknown>,
  userId: string,
  errors: string[],
): Promise<Record<string, number>> {
  const counts: Record<string, number> = { sourcesUpserted: 0, userSourcesUpserted: 0 };

  const sources = (parsed.sources as unknown[] | undefined) ?? [];
  if (!Array.isArray(sources)) {
    errors.push("sources field must be an array");
    return counts;
  }

  for (const s of sources) {
    if (typeof s !== "object" || s === null) continue;
    const src = s as Record<string, unknown>;

    const company = typeof src.company === "string" ? src.company.trim() : null;
    if (!company) {
      errors.push("Skipped source with missing company name");
      continue;
    }

    const provider = normalizeProvider(String(src.provider ?? ""));
    const boardToken = typeof src.boardToken === "string" ? src.boardToken.trim() : undefined;
    const explicitUrl = typeof src.url === "string" ? src.url.trim() : undefined;
    const url = buildUrl(provider, boardToken, explicitUrl);

    if (!url) {
      errors.push(`Skipped "${company}": cannot build URL (no url or boardToken)`);
      continue;
    }

    try {
      // Upsert global JobSource by url
      const jobSource = await prisma.jobSource.upsert({
        where: { url },
        create: {
          company,
          provider,
          boardToken: boardToken ?? null,
          url,
          enabled: src.enabled !== false,
          priority: typeof src.priority === "number" ? src.priority : 0,
          tags: JSON.stringify(safeArray(src.tags)),
        },
        update: {
          company,
          provider,
          boardToken: boardToken ?? null,
          enabled: src.enabled !== false,
          priority: typeof src.priority === "number" ? src.priority : 0,
          tags: JSON.stringify(safeArray(src.tags)),
        },
      });
      counts.sourcesUpserted++;

      // Upsert UserJobSource for session user
      await prisma.userJobSource.upsert({
        where: { userId_sourceId: { userId, sourceId: jobSource.id } },
        create: {
          userId,
          sourceId: jobSource.id,
          enabled: src.enabled !== false,
          priority: typeof src.priority === "number" ? src.priority : 0,
          tags: JSON.stringify(safeArray(src.tags)),
        },
        update: {
          enabled: src.enabled !== false,
          priority: typeof src.priority === "number" ? src.priority : 0,
          tags: JSON.stringify(safeArray(src.tags)),
        },
      });
      counts.userSourcesUpserted++;
    } catch (err) {
      errors.push(`Failed to upsert source "${company}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return counts;
}

export async function POST(request: NextRequest) {
  const userId = await getSessionUserId().catch(() => null);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { yaml?: string; type?: string };
  try {
    body = await request.json() as { yaml?: string; type?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const yamlStr = body.yaml;
  const type = body.type ?? "user";

  if (!yamlStr || typeof yamlStr !== "string") {
    return NextResponse.json({ error: "Missing yaml field" }, { status: 400 });
  }

  if (!["user", "companies", "all"].includes(type)) {
    return NextResponse.json({ error: "type must be user, companies, or all" }, { status: 400 });
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = yaml.load(yamlStr) as Record<string, unknown>;
    if (typeof parsed !== "object" || parsed === null) {
      return NextResponse.json({ error: "YAML must be an object" }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: `YAML parse error: ${err instanceof Error ? err.message : String(err)}` }, { status: 400 });
  }

  const errors: string[] = [];
  const imported: {
    userProfile?: Record<string, number>;
    companies?: Record<string, number>;
  } = {};

  if (type === "user" || type === "all") {
    imported.userProfile = await importUser(parsed, userId, errors);
  }

  if (type === "companies" || type === "all") {
    imported.companies = await importCompanies(parsed, userId, errors);
  }

  return NextResponse.json({ ok: true, imported, errors });
}
