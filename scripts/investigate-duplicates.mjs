#!/usr/bin/env node
/**
 * Investigates duplicate job sources and recommendations.
 * Run against production DB:
 *   DATABASE_URL=file:/app/data/jobradar.db node scripts/investigate-duplicates.mjs
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("\n══════════════════════════════════════════");
  console.log(" JobRadar — Duplicate Investigation Report");
  console.log("══════════════════════════════════════════\n");

  // 1. Navan sources
  const navanSources = await prisma.$queryRaw`
    SELECT id, company, provider, boardToken, url, enabled, lastSyncStatus
    FROM JobSource
    WHERE lower(company) LIKE '%navan%' OR lower(url) LIKE '%navan%'
  `;
  console.log(`── Navan JobSource rows: ${navanSources.length}`);
  console.table(navanSources);

  // 2. Navan jobs (recent)
  const navanJobs = await prisma.$queryRaw`
    SELECT id, company, title, location, applyUrl, effectiveNewAt, status, sponsorship
    FROM Job
    WHERE lower(company) LIKE '%navan%'
    ORDER BY effectiveNewAt DESC
    LIMIT 30
  `;
  console.log(`\n── Navan Job rows (last 30): ${navanJobs.length}`);
  console.table(navanJobs);

  // 3. Duplicate Navan titles
  const dupTitles = await prisma.$queryRaw`
    SELECT company, title, location, COUNT(*) as count
    FROM Job
    WHERE lower(company) LIKE '%navan%'
    GROUP BY company, title, location
    HAVING COUNT(*) > 1
    ORDER BY count DESC
  `;
  console.log(`\n── Duplicate Navan titles: ${dupTitles.length}`);
  if (dupTitles.length) console.table(dupTitles);

  // 4. Navan recommendations
  const navanRecs = await prisma.$queryRaw`
    SELECT jr.id, jr.jobId, jr.score, jr.status, jr.recommendedAt, jr.notifiedAt,
           j.title, j.company,
           rp.name as profileName
    FROM JobRecommendation jr
    JOIN Job j ON j.id = jr.jobId
    JOIN RoleProfile rp ON rp.id = jr.roleProfileId
    WHERE lower(j.company) LIKE '%navan%'
    ORDER BY jr.recommendedAt DESC, jr.score DESC
    LIMIT 50
  `;
  console.log(`\n── Navan recommendations: ${navanRecs.length}`);
  console.table(navanRecs);

  // 5. Unique Navan jobs in recommendations
  const uniqueNavanJobs = await prisma.$queryRaw`
    SELECT COUNT(DISTINCT jr.jobId) as uniqueJobs, COUNT(*) as totalRecs
    FROM JobRecommendation jr
    JOIN Job j ON j.id = jr.jobId
    WHERE lower(j.company) LIKE '%navan%'
  `;
  console.log(`\n── Navan unique jobs vs total recs:`);
  console.table(uniqueNavanJobs);

  // 6. Global duplicate sources by URL
  const dupSourceUrls = await prisma.$queryRaw`
    SELECT url, COUNT(*) as count
    FROM JobSource
    GROUP BY url
    HAVING COUNT(*) > 1
    ORDER BY count DESC
    LIMIT 20
  `;
  console.log(`\n── Global duplicate source URLs: ${dupSourceUrls.length}`);
  if (dupSourceUrls.length) console.table(dupSourceUrls);

  // 7. Companies with most sources
  const companySources = await prisma.$queryRaw`
    SELECT lower(company) as company, COUNT(*) as sources
    FROM JobSource
    GROUP BY lower(company)
    HAVING COUNT(*) > 1
    ORDER BY sources DESC
    LIMIT 20
  `;
  console.log(`\n── Companies with multiple sources (top 20): ${companySources.length}`);
  if (companySources.length) console.table(companySources);

  // 8. Jobs with most recommendations (noise indicator)
  const topReced = await prisma.$queryRaw`
    SELECT j.company, j.title, COUNT(jr.id) as recCount
    FROM JobRecommendation jr
    JOIN Job j ON j.id = jr.jobId
    GROUP BY jr.jobId
    ORDER BY recCount DESC
    LIMIT 10
  `;
  console.log(`\n── Jobs with most recommendation rows (cross-profile noise):`);
  console.table(topReced);

  // 9. Unnotified recommendation summary
  const unnotified = await prisma.$queryRaw`
    SELECT
      COUNT(*) as totalUnnotified,
      COUNT(DISTINCT jobId) as uniqueJobsUnnotified
    FROM JobRecommendation
    WHERE notifiedAt IS NULL AND status = 'UNSEEN'
  `;
  console.log(`\n── Unnotified recommendations:`);
  console.table(unnotified);

  console.log("\n══════════════════════════════════════════");
  console.log(" End of report");
  console.log("══════════════════════════════════════════\n");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
