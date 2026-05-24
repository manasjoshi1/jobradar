#!/usr/bin/env node
/**
 * npm run auth:set-password -- --password <yourpassword>
 *
 * Sets or updates the password for the default user.
 * Safe to run multiple times — idempotent.
 *
 * Usage:
 *   node scripts/set-password.mjs --password "my-secret-password"
 *
 * Or interactively (reads from env var):
 *   JOBRADAR_PASSWORD="my-secret-password" node scripts/set-password.mjs
 */

import { createRequire } from 'module';
import { PrismaClient } from '@prisma/client';

const require = createRequire(import.meta.url);
const bcrypt  = require('bcryptjs');

const args = process.argv.slice(2);
const pwIdx = args.indexOf('--password');
const password = pwIdx >= 0
  ? args[pwIdx + 1]
  : process.env.JOBRADAR_PASSWORD;

if (!password || password.trim().length === 0) {
  console.error('Usage: node scripts/set-password.mjs --password <yourpassword>');
  console.error('  Or:  JOBRADAR_PASSWORD="..." node scripts/set-password.mjs');
  process.exit(1);
}

if (password.length < 8) {
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findFirst({ where: { isDefault: true } });
  if (!user) {
    console.error('No default user found. Run: npm run db:seed-user');
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 12);
  await prisma.user.update({
    where: { id: user.id },
    data:  { passwordHash: hash },
  });

  console.log(`✅ Password set for user: ${user.name ?? user.id} (${user.email ?? 'no email'})`);
  console.log('   You can now log in at /login');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
