/**
 * docker-seed-profiles.mjs
 * Upserts all 7 role profiles directly (no YAML parsing needed).
 * Run inside Docker: node /tmp/docker-seed-profiles.mjs
 */
import { PrismaClient } from '/app/node_modules/@prisma/client/default.js';

const prisma = new PrismaClient();

const profiles = [
  {
    name: "Backend Java / Spring / AWS",
    enabled: true,
    priority: 10,
    minScore: 48,
    requiresSponsorship: false,
    preferredTitles: JSON.stringify(["software engineer","backend engineer","java developer","platform engineer","api engineer","senior engineer"]),
    preferredLocations: JSON.stringify(["remote","united states","chicago","hybrid"]),
    mustHaveKeywords: JSON.stringify(["java","spring","spring boot","backend","api","rest","microservices"]),
    niceHaveKeywords: JSON.stringify(["aws","docker","kubernetes","postgresql","postgres","mongodb","redis","payments","stripe","distributed systems","kafka"]),
    negativeKeywords: JSON.stringify(["wordpress","php","salesforce admin","ios only","android only","manual tester only"]),
  },
  {
    name: "Full Stack React + Backend",
    enabled: true,
    priority: 8,
    minScore: 46,
    requiresSponsorship: false,
    preferredTitles: JSON.stringify(["full stack engineer","software engineer","frontend engineer","web engineer","fullstack engineer"]),
    preferredLocations: JSON.stringify(["remote","united states","chicago"]),
    mustHaveKeywords: JSON.stringify(["react","typescript","javascript","api","backend"]),
    niceHaveKeywords: JSON.stringify(["next.js","node","java","spring","aws","postgresql","docker","graphql"]),
    negativeKeywords: JSON.stringify(["wordpress","shopify only","php only","manual tester"]),
  },
  {
    name: "Cloud / DevOps / SRE",
    enabled: true,
    priority: 7,
    minScore: 46,
    requiresSponsorship: false,
    preferredTitles: JSON.stringify(["cloud engineer","devops engineer","site reliability engineer","infrastructure engineer","platform engineer","sre"]),
    preferredLocations: JSON.stringify(["remote","united states","chicago"]),
    mustHaveKeywords: JSON.stringify(["aws","cloud","docker","kubernetes","linux"]),
    niceHaveKeywords: JSON.stringify(["terraform","ci/cd","observability","prometheus","grafana","monitoring","helm","ansible"]),
    negativeKeywords: JSON.stringify(["desktop support","help desk","hardware technician","manual tester"]),
  },
  {
    name: "Payments / Platform Engineer",
    enabled: true,
    priority: 9,
    minScore: 48,
    requiresSponsorship: false,
    preferredTitles: JSON.stringify(["platform engineer","backend engineer","payments engineer","software engineer","senior engineer"]),
    preferredLocations: JSON.stringify(["remote","united states","chicago"]),
    mustHaveKeywords: JSON.stringify(["backend","api","payments","platform"]),
    niceHaveKeywords: JSON.stringify(["stripe","fintech","ledger","billing","checkout","risk","fraud","java","spring","aws"]),
    negativeKeywords: JSON.stringify(["sales","account executive","customer support","manual tester"]),
  },
  {
    name: "Application Developer Java/Python/.NET",
    enabled: true,
    priority: 6,
    minScore: 42,
    requiresSponsorship: false,
    preferredTitles: JSON.stringify(["application developer","software developer","software engineer","backend developer"]),
    preferredLocations: JSON.stringify(["remote","united states","chicago"]),
    mustHaveKeywords: JSON.stringify(["software","application","developer"]),
    niceHaveKeywords: JSON.stringify(["java","python",".net","c#","sql","api","cloud"]),
    negativeKeywords: JSON.stringify(["wordpress","php only","manual tester only"]),
  },
  {
    name: "QA / Automation Engineer",
    enabled: true,
    priority: 5,
    minScore: 40,
    requiresSponsorship: false,
    preferredTitles: JSON.stringify(["qa automation engineer","software development engineer in test","sdet","test automation engineer","quality engineer","qa engineer"]),
    preferredLocations: JSON.stringify(["remote","united states","chicago"]),
    mustHaveKeywords: JSON.stringify(["automation","testing","qa"]),
    niceHaveKeywords: JSON.stringify(["selenium","playwright","cypress","java","python","api testing","ci/cd"]),
    negativeKeywords: JSON.stringify(["manual only","call center"]),
  },
  {
    name: "Data / Systems Engineer",
    enabled: true,
    priority: 5,
    minScore: 40,
    requiresSponsorship: false,
    preferredTitles: JSON.stringify(["systems engineer","data engineer","integration engineer","software engineer","data platform engineer"]),
    preferredLocations: JSON.stringify(["chicago","remote","united states"]),
    mustHaveKeywords: JSON.stringify(["data","systems","integration"]),
    niceHaveKeywords: JSON.stringify(["transit","transportation","monitoring","telemetry","linux","python","cloud","aws","spark","kafka"]),
    negativeKeywords: JSON.stringify(["civil engineer","mechanical engineer","manual tester"]),
  },
];

let created = 0, updated = 0;
for (const p of profiles) {
  const existing = await prisma.roleProfile.findUnique({ where: { name: p.name } });
  if (existing) {
    await prisma.roleProfile.update({ where: { name: p.name }, data: p });
    updated++;
  } else {
    await prisma.roleProfile.create({ data: p });
    created++;
  }
}
console.log(`Profiles: ${created} created, ${updated} updated`);

// Backfill effectiveNewAt for existing jobs
const result = await prisma.$executeRaw`
  UPDATE "Job" SET "effectiveNewAt" = COALESCE("postedAt", "firstSeenAt")
  WHERE "effectiveNewAt" IS NULL
`;
console.log(`Backfilled effectiveNewAt for ${result} jobs`);

const stats = await Promise.all([
  prisma.roleProfile.count({ where: { enabled: true } }),
  prisma.job.count({ where: { effectiveNewAt: { not: null } } }),
  prisma.job.count({ where: { isActive: true, effectiveNewAt: { gte: new Date(Date.now() - 7*24*60*60*1000) } } }),
]);
console.log(`Enabled profiles: ${stats[0]}, Jobs with effectiveNewAt: ${stats[1]}, Active jobs last 7d: ${stats[2]}`);

await prisma.$disconnect();
