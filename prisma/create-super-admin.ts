// Bootstraps a working login after the database's been wiped clean —
// seeds the permissions/roles foundation (same as seed.ts, just without
// its demo channel/account) and creates one Super Admin from whatever
// email/password/name you pass in, instead of a hardcoded default.
//
// Usage: npm run create-super-admin -- <email> <password> ["Full Name"]
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { seedPermissionsAndRoles } from './rbac-seed-data';

const prisma = new PrismaClient();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function main() {
  const [email, password, name] = process.argv.slice(2);

  if (!email || !password) {
    console.error(
      'Usage: npm run create-super-admin -- <email> <password> ["Full Name"]',
    );
    process.exit(1);
  }
  if (!EMAIL_RE.test(email)) {
    console.error(`"${email}" doesn't look like a valid email.`);
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }

  console.log('Seeding permissions & roles...');
  await seedPermissionsAndRoles(prisma);

  const superAdminRole = await prisma.role.findUniqueOrThrow({
    where: { name: 'Super Admin' },
  });

  // There is exactly one Super Admin, ever. The first run of this script
  // creates it; every run after that against a DIFFERENT email is refused —
  // re-run with the SAME email to reset that one account's password/name
  // instead (the upsert below still supports that recovery case).
  const existingSuperAdmin = await prisma.user.findFirst({
    where: { roleId: superAdminRole.id, deletedAt: null },
  });
  if (existingSuperAdmin && existingSuperAdmin.email !== email) {
    console.error(
      `A Super Admin already exists: ${existingSuperAdmin.email}.\n` +
        `Re-run with that same email to reset its password, or change it directly in the database.`,
    );
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.upsert({
    where: { email },
    // Re-running against an existing email resets the password/role/name
    // rather than erroring — useful for recovering a locked-out account
    // without clearing data, not just bootstrapping a wiped one.
    update: { name: name ?? 'Super Admin', passwordHash, roleId: superAdminRole.id, isActive: true, deletedAt: null },
    create: {
      name: name ?? 'Super Admin',
      email,
      passwordHash,
      roleId: superAdminRole.id,
    },
  });

  console.log('\nSuper Admin ready.');
  console.log(`  Email: ${email}`);
  console.log('  Log in with the password you just set.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
