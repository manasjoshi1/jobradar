/**
 * npm run config:import
 *
 * Reads config/job-sources.yml and config/role-profiles.yml
 * Upserts JobSource and RoleProfile rows into SQLite.
 * Never deletes existing jobs, history, or recommendations.
 */
import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// ── types ──────────────────────────────────────────────────────────────────

type ProviderConfig = {
  enabled?: boolean;
  jobsUrlTemplate?: string;
};

type SourceEntry = {
  company: string;
  provider: string;
  boardToken?: string;
  url?: string;
  enabled?: boolean;
  priority?: number;
  tags?: string[];
};

type JobSourcesConfig = {
  providers?: Record<string, ProviderConfig>;
  sources?: SourceEntry[];
};

type ProfileEntry = {
  name: string;
  enabled?: boolean;
  priority?: number;
  minScore?: number;
  requiresSponsorship?: boolean;
  preferredTitles?: string[];
  preferredLocations?: string[];
  mustHaveKeywords?: string[];
  niceHaveKeywords?: string[];
  negativeKeywords?: string[];
};

type RoleProfilesConfig = {
  profiles?: ProfileEntry[];
};

// ── helpers ────────────────────────────────────────────────────────────────

function readYaml<T>(relPath: string): T {
  const abs = path.resolve(process.cwd(), relPath);
  if (!fs.existsSync(abs)) {
    throw new Error(`Config file not found: ${abs}`);
  }
  return parse(fs.readFileSync(abs, "utf8")) as T;
}

function normalizeProvider(p: string): string {
  const u = p.toUpperCase();
  if (u === "GREENHOUSE") return "GREENHOUSE";
  if (u === "LEVER") return "LEVER";
  if (u === "ASHBY") return "ASHBY";
  return "CUSTOM";
}

function buildUrl(
  entry: SourceEntry,
  providers: Record<string, ProviderConfig>,
): string {
  // Explicit URL always wins
  if (entry.url) return entry.url.trim();

  const provKey = entry.provider.toLowerCase();
  const provConf = providers[provKey];
  const template = provConf?.jobsUrlTemplate;

  if (!template) {
    throw new Error(
      `Source "${entry.company}" has no url and provider "${entry.provider}" has no jobsUrlTemplate`,
    );
  }
  if (!entry.boardToken) {
    throw new Error(
      `Source "${entry.company}" uses provider "${entry.provider}" but has no boardToken`,
    );
  }

  return template.replace("{boardToken}", entry.boardToken);
}

// ── import job sources ─────────────────────────────────────────────────────

async function importJobSources(cfg: JobSourcesConfig): Promise<void> {
  const providers = cfg.providers ?? {};
  const sources = cfg.sources ?? [];

  console.log(`\n📦 Importing ${sources.length} job sources...`);
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const entry of sources) {
    let url: string;
    try {
      url = buildUrl(entry, providers);
    } catch (err) {
      console.warn(`  ⚠ Skipping "${entry.company}": ${(err as Error).message}`);
      skipped++;
      continue;
    }

    const provider = normalizeProvider(entry.provider);
    const tags = entry.tags ? JSON.stringify(entry.tags) : null;

    const existing = await prisma.jobSource.findUnique({ where: { url } });

    if (existing) {
      await prisma.jobSource.update({
        where: { url },
        data: {
          company: entry.company,
          provider,
          boardToken: entry.boardToken ?? null,
          enabled: entry.enabled ?? true,
          priority: entry.priority ?? 0,
          tags,
        },
      });
      updated++;
      console.log(`  ✏ Updated: ${entry.company} (${provider})`);
    } else {
      await prisma.jobSource.create({
        data: {
          company: entry.company,
          provider,
          boardToken: entry.boardToken ?? null,
          url,
          enabled: entry.enabled ?? true,
          priority: entry.priority ?? 0,
          tags,
        },
      });
      created++;
      console.log(`  ✅ Created: ${entry.company} (${provider})`);
    }
  }

  console.log(
    `\n  Job Sources — Created: ${created}, Updated: ${updated}, Skipped: ${skipped}`,
  );
}

// ── import role profiles ───────────────────────────────────────────────────

async function importRoleProfiles(cfg: RoleProfilesConfig): Promise<void> {
  const profiles = cfg.profiles ?? [];

  console.log(`\n🎯 Importing ${profiles.length} role profiles...`);
  let created = 0;
  let updated = 0;

  for (const entry of profiles) {
    if (!entry.name) {
      console.warn("  ⚠ Skipping profile with no name");
      continue;
    }

    const data = {
      enabled: entry.enabled ?? true,
      priority: entry.priority ?? 0,
      minScore: entry.minScore ?? 50,
      requiresSponsorship: entry.requiresSponsorship ?? false,
      preferredTitles: JSON.stringify(entry.preferredTitles ?? []),
      preferredLocations: JSON.stringify(entry.preferredLocations ?? []),
      mustHaveKeywords: JSON.stringify(entry.mustHaveKeywords ?? []),
      niceHaveKeywords: JSON.stringify(entry.niceHaveKeywords ?? []),
      negativeKeywords: JSON.stringify(entry.negativeKeywords ?? []),
    };

    const existing = await prisma.roleProfile.findUnique({
      where: { name: entry.name },
    });

    if (existing) {
      await prisma.roleProfile.update({ where: { name: entry.name }, data });
      updated++;
      console.log(`  ✏ Updated: ${entry.name}`);
    } else {
      await prisma.roleProfile.create({ data: { name: entry.name, ...data } });
      created++;
      console.log(`  ✅ Created: ${entry.name}`);
    }
  }

  console.log(`\n  Role Profiles — Created: ${created}, Updated: ${updated}`);
}

// ── main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("🚀 JobRadar config import starting...\n");

  const sourcesPath = "config/job-sources.yml";
  const profilesPath = "config/role-profiles.yml";

  let sourcesImported = false;
  let profilesImported = false;

  if (fs.existsSync(path.resolve(process.cwd(), sourcesPath))) {
    const cfg = readYaml<JobSourcesConfig>(sourcesPath);
    await importJobSources(cfg);
    sourcesImported = true;
  } else {
    console.warn(`⚠ ${sourcesPath} not found — skipping job sources import`);
  }

  if (fs.existsSync(path.resolve(process.cwd(), profilesPath))) {
    const cfg = readYaml<RoleProfilesConfig>(profilesPath);
    await importRoleProfiles(cfg);
    profilesImported = true;
  } else {
    console.warn(`⚠ ${profilesPath} not found — skipping role profiles import`);
  }

  console.log("\n✅ Config import complete");
  if (!sourcesImported && !profilesImported) {
    console.log("   No config files found — nothing was imported.");
  }
}

main()
  .catch((err) => {
    console.error("❌ Config import failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
