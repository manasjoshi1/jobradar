/**
 * GET /api/profile/config/export?type=user|companies|all
 * Returns YAML file attachment.
 */
import { NextResponse, type NextRequest } from "next/server";
import yaml from "yaml";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/get-user-id";

export const dynamic = "force-dynamic";

function safeJson(val: string | null | undefined): string[] {
  if (!val) return [];
  try { return JSON.parse(val) as string[]; } catch { return []; }
}

const PROVIDER_URL_TEMPLATES = {
  greenhouse: "https://boards-api.greenhouse.io/v1/boards/{boardToken}/jobs?content=true",
  lever: "https://api.lever.co/v0/postings/{boardToken}",
  ashby: "https://api.ashbyhq.com/posting-api/job-board/{boardToken}",
};

async function buildUserYaml(userId: string): Promise<string> {
  const [user, prefs, profiles] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }),
    prisma.userJobPreference.findUnique({ where: { userId } }),
    prisma.userRoleProfile.findMany({ where: { userId }, orderBy: [{ priority: "desc" }, { name: "asc" }] }),
  ]);

  const doc = {
    user: {
      name: user?.name ?? "",
      email: user?.email ?? "",
    },
    preferences: {
      targetLocations: safeJson(prefs?.targetLocations),
      targetRoles: safeJson(prefs?.targetRoles),
      blockedCompanies: safeJson(prefs?.blockedCompanies),
      preferredCompanies: safeJson(prefs?.preferredCompanies),
      requiresSponsorship: prefs?.requiresSponsorship ?? false,
      minScore: prefs?.minScore ?? 45,
    },
    roleProfiles: profiles.map((p) => ({
      name: p.name,
      enabled: p.enabled,
      priority: p.priority,
      minScore: p.minScore,
      requiresSponsorship: p.requiresSponsorship,
      preferredTitles: safeJson(p.preferredTitles),
      preferredLocations: safeJson(p.preferredLocations),
      mustHaveKeywords: safeJson(p.mustHaveKeywords),
      niceHaveKeywords: safeJson(p.niceHaveKeywords),
      negativeKeywords: safeJson(p.negativeKeywords),
    })),
  };

  return yaml.stringify(doc, { lineWidth: 120 });
}

async function buildCompaniesYaml(userId: string): Promise<string> {
  const userSources = await prisma.userJobSource.findMany({
    where: { userId },
    include: { source: true },
    orderBy: [{ priority: "desc" }, { source: { company: "asc" } }],
  });

  const doc = {
    providers: PROVIDER_URL_TEMPLATES,
    sources: userSources.map((us) => ({
      company: us.source.company,
      provider: us.source.provider.toLowerCase(),
      boardToken: us.source.boardToken ?? undefined,
      url: us.source.url,
      enabled: us.enabled,
      priority: us.priority,
      tags: safeJson(us.tags),
    })),
  };

  return yaml.stringify(doc, { lineWidth: 120 });
}

export async function GET(request: NextRequest) {
  const userId = await getSessionUserId().catch(() => null);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") ?? "user";

  if (!["user", "companies", "all"].includes(type)) {
    return NextResponse.json({ error: "type must be user, companies, or all" }, { status: 400 });
  }

  let content: string;

  if (type === "user") {
    content = await buildUserYaml(userId);
  } else if (type === "companies") {
    content = await buildCompaniesYaml(userId);
  } else {
    // all — concatenate with separator
    const [userYaml, companiesYaml] = await Promise.all([
      buildUserYaml(userId),
      buildCompaniesYaml(userId),
    ]);
    content = userYaml + "\n---\n\n" + companiesYaml;
  }

  return new NextResponse(content, {
    status: 200,
    headers: {
      "Content-Type": "text/yaml",
      "Content-Disposition": `attachment; filename="jobradar-config-${type}.yml"`,
    },
  });
}
