import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("\nDUPLICATE JOBS INVESTIGATION:");
  console.log("-----------------------------");

  // Find duplicate jobs by company, title, location
  const dupJobs = await prisma.$queryRaw`
    SELECT company, title, location, COUNT(*) as count
    FROM Job
    GROUP BY company, title, location
    HAVING COUNT(*) > 1
    ORDER BY count DESC
    LIMIT 20
  `;

  console.log(`Duplicate Jobs (company + title + location) in DB:`);
  console.table(dupJobs);

  // Find total duplicate job rows
  const dupJobsCount = await prisma.$queryRaw`
    SELECT SUM(count - 1) as totalDupRows
    FROM (
      SELECT COUNT(*) as count
      FROM Job
      GROUP BY company, title, location
      HAVING COUNT(*) > 1
    )
  `;
  console.log(`Total duplicate job rows that could be deduplicated:`, dupJobsCount);

  // Check if jobFingerprint is populated anywhere
  const populatedFingerprints = await prisma.job.count({
    where: { NOT: { jobFingerprint: null } }
  });
  console.log(`\nJobs with populated jobFingerprint: ${populatedFingerprints} / ${await prisma.job.count()}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
