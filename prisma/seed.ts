import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { seedPermissionsAndRoles } from './rbac-seed-data';

const prisma = new PrismaClient();

const DEFAULT_ADMIN = {
  name: 'Papon',
  email: 'obmall.ai@gmail.com',
  password: 'ChangeMe123!', // seed-only default — rotate immediately after first login
};

const DEFAULT_CHANNEL = {
  name: 'Online Burmese Market',
  slug: 'online-burmese-market',
};

async function main() {
  console.log('Seeding permissions & roles...');
  await seedPermissionsAndRoles(prisma);

  console.log('Seeding default channel...');
  await prisma.channel.upsert({
    where: { slug: DEFAULT_CHANNEL.slug },
    update: {},
    create: DEFAULT_CHANNEL,
  });

  console.log('Seeding super admin user...');
  const superAdminRole = await prisma.role.findUniqueOrThrow({
    where: { name: 'Super Admin' },
  });
  const passwordHash = await bcrypt.hash(DEFAULT_ADMIN.password, 10);
  await prisma.user.upsert({
    where: { email: DEFAULT_ADMIN.email },
    update: {},
    create: {
      name: DEFAULT_ADMIN.name,
      email: DEFAULT_ADMIN.email,
      passwordHash,
      roleId: superAdminRole.id,
    },
  });

  console.log('\nSeed complete.');
  console.log(`  Super Admin login: ${DEFAULT_ADMIN.email}`);
  console.log(
    `  Super Admin password: ${DEFAULT_ADMIN.password} (change after first login)`,
  );
  console.log(`  Channel: ${DEFAULT_CHANNEL.name} (${DEFAULT_CHANNEL.slug})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
