/**
 * npm run runs:recover [-- --threshold-minutes <N>]
 *
 * Marks SyncRun and RecommendationRun rows that are stuck as RUNNING for
 * longer than --threshold-minutes (default: 30) as FAILED.
 *
 * Safe to re-run. Only touches rows older than the threshold.
 * Active in-progress runs (started recently) are NOT touched.
 */

const args = process.argv.slice(2);
const thresholdIdx = args.indexOf('--threshold-minutes');
const thresholdMinutes = thresholdIdx !== -1 ? parseInt(args[thresholdIdx + 1], 10) : 30;

if (isNaN(thresholdMinutes) || thresholdMinutes < 1) {
  console.error('Invalid --threshold-minutes value. Must be a positive integer.');
  process.exit(1);
}

const clientPath = process.env.NODE_ENV === 'production'
  ? '/app/node_modules/@prisma/client/default.js'
  : new URL('../node_modules/@prisma/client/default.js', import.meta.url).pathname;

const { PrismaClient } = await import(clientPath).catch(() =>
  import('../node_modules/@prisma/client/default.js')
);

const prisma = new PrismaClient();
const cutoff = new Date(Date.now() - thresholdMinutes * 60 * 1000);

console.log(`🔍 Recovering RUNNING rows older than ${thresholdMinutes} minutes (before ${cutoff.toISOString()})`);

const [syncResult, recResult] = await Promise.all([
  prisma.syncRun.updateMany({
    where: { status: 'RUNNING', startedAt: { lt: cutoff } },
    data: {
      status: 'FAILED',
      finishedAt: new Date(),
      errorSummary: `Recovered: run was stuck RUNNING for >${thresholdMinutes}m — likely lost to restart/deploy/crash.`,
    },
  }),
  prisma.recommendationRun.updateMany({
    where: { status: 'RUNNING', startedAt: { lt: cutoff } },
    data: {
      status: 'FAILED',
      finishedAt: new Date(),
      errorSummary: `Recovered: run was stuck RUNNING for >${thresholdMinutes}m — likely lost to restart/deploy/crash.`,
    },
  }),
]);

console.log(`✅ SyncRun rows recovered: ${syncResult.count}`);
console.log(`✅ RecommendationRun rows recovered: ${recResult.count}`);

// Verify no old RUNNING rows remain
const [remainingSr, remainingRr] = await Promise.all([
  prisma.syncRun.count({ where: { status: 'RUNNING', startedAt: { lt: cutoff } } }),
  prisma.recommendationRun.count({ where: { status: 'RUNNING', startedAt: { lt: cutoff } } }),
]);

if (remainingSr > 0 || remainingRr > 0) {
  console.warn(`⚠ ${remainingSr} SyncRun + ${remainingRr} RecommendationRun old RUNNING rows still remain`);
} else {
  console.log('✅ No old stuck RUNNING rows remain.');
}

await prisma.$disconnect();
