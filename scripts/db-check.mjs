import { PrismaClient } from '/app/node_modules/@prisma/client/default.js';
const p = new PrismaClient();
const [sr, rr, totalSr, totalRr] = await Promise.all([
  p.syncRun.findMany({ where: { status: 'RUNNING' }, orderBy: { startedAt: 'asc' } }),
  p.recommendationRun.findMany({ where: { status: 'RUNNING' }, orderBy: { startedAt: 'asc' } }),
  p.syncRun.count(),
  p.recommendationRun.count(),
]);
console.log(JSON.stringify({ stuckSyncRuns: sr.length, stuckRecRuns: rr.length, totalSyncRuns: totalSr, totalRecRuns: totalRr, syncSample: sr.slice(0,3).map(r => ({ id: r.id, startedAt: r.startedAt })), recSample: rr.map(r => ({ id: r.id, startedAt: r.startedAt })) }, null, 2));
await p.$disconnect();
