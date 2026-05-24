#!/usr/bin/env node
/**
 * E2E seed script — inserts deterministic test data into the E2E SQLite DB.
 *
 * SAFETY GUARD: only runs when E2E_TEST=true AND NODE_ENV=test.
 * Never runs against the production database.
 *
 * Usage:
 *   DATABASE_URL=file:./prisma/e2e.db E2E_TEST=true NODE_ENV=test node scripts/e2e-seed.mjs
 *   npm run e2e:seed   (sets the env vars via package.json script)
 *
 * What it creates:
 *   1. 3 JobSource rows (Acme Corp, Beta Inc, Gamma Ltd)
 *   2. Default User with password "JobRadarE2E!"
 *   3. 3 UserRoleProfile rows (Backend Java, Full Stack React, Payments)
 *   4. UserJobPreference row
 *   5. 8 deterministic Job rows:
 *      - backend-1  : Senior Java Backend Engineer @ Acme (should match Backend Java)
 *      - backend-2  : Spring Boot / AWS Platform Engineer @ Beta (should match Backend Java + Payments)
 *      - fullstack-1: Full Stack TypeScript Engineer @ Acme (should match Full Stack)
 *      - payments-1 : Payments Platform Engineer @ Gamma (should match Payments)
 *      - irrelevant : WordPress PHP Developer @ Beta (should NOT match any profile)
 *      - dup-a      : Senior Software Engineer @ Gamma (same fingerprint as dup-b)
 *      - dup-b      : Senior Software Engineer @ Acme (same fingerprint, cross-source dup)
 *      - old-job    : Old Backend Engineer (effectiveNewAt 72h ago — outside 48h rec window)
 *   6. Runs user recommendation engine for default user (48h window)
 *   7. Verifies ≥3 recommendations were created
 */

// ── Safety guard ────────────────────────────────────────────────────────────

if (process.env.E2E_TEST !== "true" || process.env.NODE_ENV !== "test") {
  console.error("❌ e2e-seed.mjs REFUSED: E2E_TEST and NODE_ENV=test must both be set.");
  console.error("   This script only runs against the E2E test database.");
  console.error("   Usage: E2E_TEST=true NODE_ENV=test node scripts/e2e-seed.mjs");
  process.exit(1);
}

const dbUrl = process.env.DATABASE_URL ?? "";
if (!dbUrl.includes("e2e") && !dbUrl.includes(":memory:")) {
  console.error(`❌ e2e-seed.mjs REFUSED: DATABASE_URL does not look like an e2e DB.`);
  console.error(`   Got: ${dbUrl}`);
  console.error("   Expected something containing 'e2e' (e.g. file:./prisma/e2e.db).");
  process.exit(1);
}

// ── Imports ─────────────────────────────────────────────────────────────────

import { createRequire } from "module";
const require = createRequire(import.meta.url);

const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient({
  datasources: { db: { url: dbUrl } },
  log: ["warn", "error"],
});

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Return a Date that is `hours` hours ago. */
function hoursAgo(hours) {
  return new Date(Date.now() - hours * 3_600_000);
}

/** Stringify a JSON array field (Prisma stores these as JSON strings in SQLite). */
function j(arr) {
  return JSON.stringify(arr);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🌱 E2E seed started");
  console.log(`   DB: ${dbUrl}`);

  // ── 1. Clear E2E tables ──────────────────────────────────────────────────
  // Delete in dependency order to respect foreign keys.
  console.log("🗑️  Clearing tables…");

  await prisma.userJobRecommendation.deleteMany();
  await prisma.userRecommendationRun.deleteMany();
  await prisma.userJobStatus.deleteMany();
  await prisma.userJobPreference.deleteMany();
  await prisma.userRoleProfile.deleteMany();
  await prisma.userNotificationPreference.deleteMany();
  await prisma.notificationDelivery.deleteMany();
  await prisma.jobRecommendation.deleteMany();
  await prisma.recommendationRun.deleteMany();
  await prisma.syncSourceRun.deleteMany();
  await prisma.syncRun.deleteMany();
  await prisma.job.deleteMany();
  await prisma.jobSource.deleteMany();
  await prisma.user.deleteMany();
  await prisma.roleProfile.deleteMany();

  console.log("   ✓ Tables cleared");

  // ── 2. Create JobSources ─────────────────────────────────────────────────
  console.log("🏭 Creating job sources…");

  const sourceAcme = await prisma.jobSource.create({
    data: {
      id:       "e2e-source-acme",
      company:  "Acme Corp",
      provider: "greenhouse",
      boardToken: "acmecorp-e2e",
      url:      "https://boards.greenhouse.io/acmecorp-e2e",
      enabled:  true,
    },
  });

  const sourceBeta = await prisma.jobSource.create({
    data: {
      id:       "e2e-source-beta",
      company:  "Beta Inc",
      provider: "lever",
      boardToken: "betainc-e2e",
      url:      "https://jobs.lever.co/betainc-e2e",
      enabled:  true,
    },
  });

  const sourceGamma = await prisma.jobSource.create({
    data: {
      id:       "e2e-source-gamma",
      company:  "Gamma Ltd",
      provider: "ashby",
      boardToken: "gammaltd-e2e",
      url:      "https://jobs.ashbyhq.com/gammaltd-e2e",
      enabled:  true,
    },
  });

  console.log("   ✓ 3 job sources created");

  // ── 3. Create User ───────────────────────────────────────────────────────
  console.log("👤 Creating default user…");

  const passwordHash = await bcrypt.hash("JobRadarE2E!", 10);

  const user = await prisma.user.create({
    data: {
      id:           "e2e-user-default",
      name:         "Default User",
      email:        "e2e@jobradar.test",
      isDefault:    true,
      passwordHash,
    },
  });

  console.log(`   ✓ User "${user.name}" (id: ${user.id})`);

  // ── 4. Create UserJobPreference ──────────────────────────────────────────
  await prisma.userJobPreference.create({
    data: {
      userId:             user.id,
      targetLocations:    j(["remote", "united states", "new york", "san francisco", "chicago", "hybrid"]),
      targetRoles:        j(["backend engineer", "software engineer", "java developer", "platform engineer", "full stack engineer", "payments engineer"]),
      blockedCompanies:   j([]),
      preferredCompanies: j(["Stripe", "Datadog"]),
      minScore:           40,
      requiresSponsorship: false,
    },
  });

  console.log("   ✓ User preferences created");

  // ── 5. Create UserRoleProfiles ───────────────────────────────────────────
  console.log("📋 Creating role profiles…");

  const profileBackend = await prisma.userRoleProfile.create({
    data: {
      id:       "e2e-profile-backend",
      userId:   user.id,
      name:     "Backend Java / Spring / AWS",
      enabled:  true,
      priority: 10,
      minScore: 45,
      requiresSponsorship: false,
      preferredTitles:    j(["Backend Engineer", "Software Engineer", "Java Engineer", "Java Developer", "Platform Engineer"]),
      preferredLocations: j(["remote", "united states", "hybrid"]),
      mustHaveKeywords:   j(["java", "spring"]),
      niceHaveKeywords:   j(["aws", "kubernetes", "microservices", "kafka"]),
      negativeKeywords:   j(["wordpress", "php", "intern"]),
    },
  });

  const profileFullStack = await prisma.userRoleProfile.create({
    data: {
      id:       "e2e-profile-fullstack",
      userId:   user.id,
      name:     "Full Stack React + Backend",
      enabled:  true,
      priority: 8,
      minScore: 45,
      requiresSponsorship: false,
      preferredTitles:    j(["Full Stack Engineer", "Software Engineer", "Full Stack Developer"]),
      preferredLocations: j(["remote", "united states", "hybrid"]),
      mustHaveKeywords:   j(["react", "typescript"]),
      niceHaveKeywords:   j(["node", "nextjs", "postgres", "graphql"]),
      negativeKeywords:   j(["wordpress", "php", "intern"]),
    },
  });

  const profilePayments = await prisma.userRoleProfile.create({
    data: {
      id:       "e2e-profile-payments",
      userId:   user.id,
      name:     "Payments / Platform Engineer",
      enabled:  true,
      priority: 9,
      minScore: 45,
      requiresSponsorship: false,
      preferredTitles:    j(["Payments Engineer", "Platform Engineer", "Software Engineer"]),
      preferredLocations: j(["remote", "united states", "hybrid"]),
      mustHaveKeywords:   j(["payments"]),
      niceHaveKeywords:   j(["stripe", "fintech", "api", "distributed systems"]),
      negativeKeywords:   j(["wordpress", "php", "intern"]),
    },
  });

  console.log(`   ✓ 3 role profiles created`);

  // ── 6. Create Jobs ───────────────────────────────────────────────────────
  console.log("💼 Creating deterministic jobs…");

  const now = new Date();

  const jobs = [
    // Should match Backend Java profile (java + spring in description/title)
    {
      id:             "e2e-job-backend-1",
      sourceId:       sourceAcme.id,
      externalId:     "acme-be-001",
      company:        "Acme Corp",
      title:          "Senior Java Backend Engineer",
      location:       "Remote, US",
      department:     "Engineering",
      employmentType: "Full-time",
      applyUrl:       "https://boards.greenhouse.io/acmecorp-e2e/jobs/001",
      description:    "We are looking for a Senior Java Backend Engineer with Spring Boot, AWS, and microservices experience. Kafka and Kubernetes a plus.",
      sponsorship:    "UNKNOWN",
      jobFingerprint: "greenhouse|acme-be-001",
      postedAt:       hoursAgo(12),
      firstSeenAt:    hoursAgo(12),
      effectiveNewAt: hoursAgo(12),
      isActive:       true,
    },
    // Should match Backend Java + Payments profiles
    {
      id:             "e2e-job-backend-2",
      sourceId:       sourceBeta.id,
      externalId:     "beta-be-002",
      company:        "Beta Inc",
      title:          "Spring Boot Platform Engineer — Payments",
      location:       "New York, NY (Hybrid)",
      department:     "Platform",
      employmentType: "Full-time",
      applyUrl:       "https://jobs.lever.co/betainc-e2e/002",
      description:    "Build and scale our payments platform using Java, Spring Boot, and AWS. You will own the full lifecycle of critical payments infrastructure.",
      sponsorship:    "YES",
      jobFingerprint: "lever|beta-be-002",
      postedAt:       hoursAgo(6),
      firstSeenAt:    hoursAgo(6),
      effectiveNewAt: hoursAgo(6),
      isActive:       true,
    },
    // Should match Full Stack React profile
    {
      id:             "e2e-job-fullstack-1",
      sourceId:       sourceAcme.id,
      externalId:     "acme-fs-001",
      company:        "Acme Corp",
      title:          "Full Stack TypeScript Engineer",
      location:       "Remote",
      department:     "Product Engineering",
      employmentType: "Full-time",
      applyUrl:       "https://boards.greenhouse.io/acmecorp-e2e/jobs/002",
      description:    "Join our product team building full-stack features with React, TypeScript, Node.js, and PostgreSQL. Experience with Next.js is a bonus.",
      sponsorship:    "UNKNOWN",
      jobFingerprint: "greenhouse|acme-fs-001",
      postedAt:       hoursAgo(8),
      firstSeenAt:    hoursAgo(8),
      effectiveNewAt: hoursAgo(8),
      isActive:       true,
    },
    // Should match Payments profile
    {
      id:             "e2e-job-payments-1",
      sourceId:       sourceGamma.id,
      externalId:     "gamma-pay-001",
      company:        "Gamma Ltd",
      title:          "Payments Platform Engineer",
      location:       "San Francisco, CA (Remote OK)",
      department:     "Fintech",
      employmentType: "Full-time",
      applyUrl:       "https://jobs.ashbyhq.com/gammaltd-e2e/001",
      description:    "Design and build distributed payments systems handling billions in annual volume. Deep knowledge of payments APIs and fintech infrastructure required.",
      sponsorship:    "YES",
      jobFingerprint: "ashby|gamma-pay-001",
      postedAt:       hoursAgo(3),
      firstSeenAt:    hoursAgo(3),
      effectiveNewAt: hoursAgo(3),
      isActive:       true,
    },
    // Should NOT match any profile (has negative keywords, wrong skills)
    {
      id:             "e2e-job-irrelevant",
      sourceId:       sourceBeta.id,
      externalId:     "beta-php-001",
      company:        "Beta Inc",
      title:          "WordPress PHP Developer",
      location:       "Chicago, IL",
      department:     "Web",
      employmentType: "Full-time",
      applyUrl:       "https://jobs.lever.co/betainc-e2e/003",
      description:    "Looking for a WordPress developer with PHP, MySQL, and WooCommerce skills.",
      sponsorship:    "NO",
      jobFingerprint: "lever|beta-php-001",
      postedAt:       hoursAgo(5),
      firstSeenAt:    hoursAgo(5),
      effectiveNewAt: hoursAgo(5),
      isActive:       true,
    },
    // Cross-source duplicate pair — same fingerprint prefix for dedup testing
    // dup-a comes from Gamma, dup-b comes from Acme — same logical role
    {
      id:             "e2e-job-dup-a",
      sourceId:       sourceGamma.id,
      externalId:     "gamma-se-001",
      company:        "Gamma Ltd",
      title:          "Senior Software Engineer — Backend",
      location:       "Remote",
      department:     "Engineering",
      employmentType: "Full-time",
      applyUrl:       "https://jobs.ashbyhq.com/gammaltd-e2e/002",
      description:    "Senior backend engineer role. Java, Spring, AWS, distributed systems.",
      sponsorship:    "UNKNOWN",
      jobFingerprint: "e2e-cross-source-dup",   // same fingerprint as dup-b
      postedAt:       hoursAgo(10),
      firstSeenAt:    hoursAgo(10),
      effectiveNewAt: hoursAgo(10),
      isActive:       true,
    },
    {
      id:             "e2e-job-dup-b",
      sourceId:       sourceAcme.id,
      externalId:     "acme-se-002",
      company:        "Acme Corp",
      title:          "Senior Software Engineer — Backend",
      location:       "Remote",
      department:     "Engineering",
      employmentType: "Full-time",
      applyUrl:       "https://boards.greenhouse.io/acmecorp-e2e/jobs/003",
      description:    "Senior backend engineer role. Java, Spring, AWS, distributed systems. Duplicate listing.",
      sponsorship:    "UNKNOWN",
      jobFingerprint: "e2e-cross-source-dup",   // same fingerprint as dup-a
      postedAt:       hoursAgo(10),
      firstSeenAt:    hoursAgo(10),
      effectiveNewAt: hoursAgo(10),
      isActive:       true,
    },
    // Old job — effectiveNewAt 72h ago, outside 48h rec window — should NOT be recommended
    {
      id:             "e2e-job-old",
      sourceId:       sourceBeta.id,
      externalId:     "beta-old-001",
      company:        "Beta Inc",
      title:          "Backend Java Engineer (Old)",
      location:       "Remote",
      department:     "Engineering",
      employmentType: "Full-time",
      applyUrl:       "https://jobs.lever.co/betainc-e2e/old001",
      description:    "Old Java and Spring Boot role that fell outside the recommendation window.",
      sponsorship:    "UNKNOWN",
      jobFingerprint: "lever|beta-old-001",
      postedAt:       hoursAgo(72),
      firstSeenAt:    hoursAgo(72),
      effectiveNewAt: hoursAgo(72),   // 72h ago — outside 48h window
      isActive:       true,
    },
  ];

  for (const job of jobs) {
    await prisma.job.create({ data: job });
  }

  console.log(`   ✓ ${jobs.length} jobs created`);

  // ── 7. Run recommendation engine ─────────────────────────────────────────
  console.log("🧠 Running recommendation engine (48h window)…");

  // Import the recommendation service dynamically
  // We use a subprocess instead of a direct import to avoid Prisma singleton issues
  // when DATABASE_URL may be different from what the compiled module cached.
  const { runUserRecommendations } = await import("../lib/services/user-recommendation-service.js");

  const recResult = await runUserRecommendations(user.id, 48);

  console.log(`   ✓ Recommendation run: status=${recResult.status}`);
  console.log(`     jobsScanned=${recResult.jobsScanned}`);
  console.log(`     recommendationsCreated=${recResult.recommendationsCreated}`);

  if (recResult.errorSummary) {
    console.warn(`   ⚠ Error summary: ${recResult.errorSummary}`);
  }

  // ── 8. Verify recommendations were created ───────────────────────────────
  const recCount = await prisma.userJobRecommendation.count({ where: { userId: user.id } });
  console.log(`\n📊 Verification:`);
  console.log(`   UserJobRecommendation rows: ${recCount}`);

  if (recCount < 3) {
    console.error(`❌ Expected at least 3 recommendations, got ${recCount}`);
    console.error("   Check that scoring thresholds match seed job data.");
    await prisma.$disconnect();
    process.exit(1);
  }

  // Show what was recommended
  const recs = await prisma.userJobRecommendation.findMany({
    where:   { userId: user.id },
    include: { job: { select: { title: true, company: true } }, userRoleProfile: { select: { name: true } } },
    orderBy: { score: "desc" },
  });

  for (const r of recs) {
    console.log(`   ✓ [score=${r.score}] ${r.job.title} @ ${r.job.company} → ${r.userRoleProfile.name}`);
  }

  const jobCount   = await prisma.job.count();
  const srcCount   = await prisma.jobSource.count();
  const userCount  = await prisma.user.count();
  const profCount  = await prisma.userRoleProfile.count();

  console.log(`\n✅ E2E seed complete!`);
  console.log(`   Jobs: ${jobCount}  Sources: ${srcCount}  Users: ${userCount}  Profiles: ${profCount}  Recs: ${recCount}`);
  console.log(`   Login password: JobRadarE2E!`);
}

main()
  .catch((err) => {
    console.error("❌ E2E seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
