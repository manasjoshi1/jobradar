/**
 * npm run db:backfill-effective-new-at
 *
 * Sets effectiveNewAt = COALESCE(postedAt, firstSeenAt) for any Job row
 * where effectiveNewAt IS NULL.
 *
 * Safe to re-run: only updates NULL rows, never overwrites valid values.
 * Preserves postedAt-derived effectiveNewAt — does not touch rows already set.
 */

// Allow running with either local node_modules or Docker /app path
const clientPath = process.env.PRISMA_CLIENT_PATH ??
  (process.env.NODE_ENV === 'production'
    ? '/app/node_modules/@prisma/client/default.js'
    : new URL('../node_modules/@prisma/client/default.js', import.meta.url).pathname);

const { PrismaClient } = await import(clientPath).catch(() =>
  import('../node_modules/@prisma/client/default.js')
);

const prisma = new PrismaClient();

const before = await prisma.job.count({ where: { effectiveNewAt: null } });
console.log(`Jobs with NULL effectiveNewAt before backfill: ${before}`);

if (before === 0) {
  console.log('✅ Nothing to backfill — all jobs already have effectiveNewAt set.');
  await prisma.$disconnect();
  process.exit(0);
}

const updated = await prisma.$executeRaw`
  UPDATE "Job"
  SET "effectiveNewAt" = COALESCE("postedAt", "firstSeenAt")
  WHERE "effectiveNewAt" IS NULL
`;

const after = await prisma.job.count({ where: { effectiveNewAt: null } });
const total = await prisma.job.count();

console.log(`✅ Backfilled ${updated} jobs (${before} had NULL, ${after} remain NULL)`);
console.log(`   Total jobs: ${total} | Jobs with effectiveNewAt: ${total - after}`);

await prisma.$disconnect();
