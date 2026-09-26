import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Permission keys are "<module>.<action>" — the exact string a route's
// @RequirePermissions() decorator checks against once RBAC guards land.
const PERMISSIONS: { key: string; label: string }[] = [
  { key: 'channels.view', label: 'View storefronts' },
  { key: 'channels.manage', label: 'Create/edit storefronts' },
  {
    key: 'channels.all_access',
    label: 'Unrestricted access to every store (ignores per-user channel assignment)',
  },
  { key: 'products.view', label: 'View products' },
  { key: 'products.manage', label: 'Create/edit products' },
  { key: 'products.publish', label: 'Publish/unpublish products to channels' },
  { key: 'inventory.view', label: 'View stock & movements' },
  { key: 'inventory.adjust', label: 'Adjust stock' },
  { key: 'orders.view', label: 'View orders' },
  { key: 'orders.create', label: 'Create orders (manual/phone/etc.)' },
  { key: 'orders.update_status', label: 'Change order status' },
  { key: 'customers.view', label: 'View customers' },
  { key: 'customers.manage', label: 'Create/edit customers' },
  { key: 'payments.view', label: 'View payments' },
  { key: 'payments.manage', label: 'Record payments' },
  { key: 'shipments.view', label: 'View shipments' },
  { key: 'shipments.manage', label: 'Update shipments' },
  { key: 'suppliers.manage', label: 'Manage suppliers & purchases' },
  { key: 'reports.view', label: 'View reports & dashboard' },
  { key: 'users.manage', label: 'Manage staff users & roles' },
];

const ROLE_PERMISSIONS: Record<string, string[] | '*'> = {
  Owner: '*',
  Manager: [
    'channels.view',
    'products.view',
    'products.manage',
    'products.publish',
    'inventory.view',
    'inventory.adjust',
    'orders.view',
    'orders.create',
    'orders.update_status',
    'customers.view',
    'customers.manage',
    'payments.view',
    'payments.manage',
    'shipments.view',
    'shipments.manage',
    'suppliers.manage',
    'reports.view',
  ],
  Staff: [
    'products.view',
    'inventory.view',
    'orders.view',
    'orders.create',
    'orders.update_status',
    'customers.view',
    'customers.manage',
    'payments.view',
    'shipments.view',
  ],
  // Read-only across the board — every `.view` permission, none of the
  // `.manage`/`.create`/`.update_status`/`.adjust`/`.publish` ones.
  // Deliberately does NOT include channels.all_access, so a Viewer is still
  // scoped to whichever stores they're assigned via UserChannel.
  Viewer: [
    'channels.view',
    'products.view',
    'inventory.view',
    'orders.view',
    'customers.view',
    'payments.view',
    'shipments.view',
    'reports.view',
  ],
};

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
  console.log('Seeding permissions...');
  for (const permission of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: permission.key },
      update: { label: permission.label },
      create: permission,
    });
  }

  console.log('Seeding roles...');
  for (const [roleName, permissionKeys] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName },
    });

    const keys =
      permissionKeys === '*'
        ? PERMISSIONS.map((p) => p.key)
        : permissionKeys;

    const permissions = await prisma.permission.findMany({
      where: { key: { in: keys } },
    });

    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: permissions.map((p) => ({
        roleId: role.id,
        permissionId: p.id,
      })),
      skipDuplicates: true,
    });
  }

  console.log('Seeding default channel...');
  await prisma.channel.upsert({
    where: { slug: DEFAULT_CHANNEL.slug },
    update: {},
    create: DEFAULT_CHANNEL,
  });

  console.log('Seeding owner admin user...');
  const ownerRole = await prisma.role.findUniqueOrThrow({
    where: { name: 'Owner' },
  });
  const passwordHash = await bcrypt.hash(DEFAULT_ADMIN.password, 10);
  await prisma.user.upsert({
    where: { email: DEFAULT_ADMIN.email },
    update: {},
    create: {
      name: DEFAULT_ADMIN.name,
      email: DEFAULT_ADMIN.email,
      passwordHash,
      roleId: ownerRole.id,
    },
  });

  console.log('\nSeed complete.');
  console.log(`  Owner login: ${DEFAULT_ADMIN.email}`);
  console.log(`  Owner password: ${DEFAULT_ADMIN.password} (change after first login)`);
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
