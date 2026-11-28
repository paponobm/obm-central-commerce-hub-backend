// Shared by seed.ts (full demo seed) and create-super-admin.ts (bootstrap
// a login after the data's been wiped) — both need the same
// permissions/roles foundation, so it's defined once here rather than
// risking the two copies drifting apart.

// Permission keys are "<module>.<action>" — the exact string a route's
// @RequirePermissions() decorator checks against.
export const PERMISSIONS: { key: string; label: string }[] = [
  { key: 'channels.view', label: 'View storefronts' },
  { key: 'channels.manage', label: 'Create/edit storefronts' },
  {
    key: 'channels.all_access',
    label:
      'Unrestricted access to every store (ignores per-user channel assignment)',
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
  { key: 'counseling.view', label: 'View counseling (call-back) requests' },
  { key: 'counseling.manage', label: 'Resolve counseling requests' },
  { key: 'analytics.view', label: 'View site analytics (page views, searches, traffic sources)' },
  { key: 'payments.view', label: 'View payments' },
  { key: 'payments.manage', label: 'Record payments' },
  { key: 'shipments.view', label: 'View shipments' },
  { key: 'shipments.manage', label: 'Update shipments' },
  { key: 'suppliers.manage', label: 'Manage suppliers & purchases' },
  {
    key: 'integrations.manage',
    label: 'Manage courier integrations & credentials',
  },
  { key: 'reports.view', label: 'View reports' },
  // Independent of reports.view on purpose — a user can have one without
  // the other (e.g. Dashboard summary access without the deeper sales
  // analytics on the Reports page, or vice versa).
  { key: 'dashboard.view', label: 'View dashboard' },
  { key: 'users.manage', label: 'Manage staff users & roles' },
  // Nav-visibility-only — never checked by a route guard. Users/Roles/
  // Settings pages (and their APIs) are still gated solely by users.manage
  // above; these three just control which of the three links a given user
  // sees in the sidebar, independent of each other.
  { key: 'nav.users', label: 'Show "Users" in the sidebar' },
  { key: 'nav.roles', label: 'Show "Roles" in the sidebar' },
  { key: 'nav.settings', label: 'Show "Settings" in the sidebar' },
];

// Only Super Admin has a fixed, role-wide permission set ('*' — every
// permission, every store, not editable). Admin, Manager, Member and
// Agent each get their own individually-toggled permissions on the
// UserPermission table instead (see UsersService) — their role-level set
// here is deliberately empty so reseeding never resurrects a shared fixed
// list for them or clobbers what's actually been granted per user.
export const ROLE_PERMISSIONS: Record<string, string[] | '*'> = {
  'Super Admin': '*',
  Admin: [],
  Manager: [],
  Member: [],
  Agent: [],
};

// Idempotent — safe to call against an already-seeded database (plain
// upserts) or a freshly wiped one (creates everything from scratch).
export async function seedPermissionsAndRoles(
  prisma: import('@prisma/client').PrismaClient,
) {
  for (const permission of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: permission.key },
      update: { label: permission.label },
      create: permission,
    });
  }

  for (const [roleName, permissionKeys] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName },
    });

    const keys =
      permissionKeys === '*' ? PERMISSIONS.map((p) => p.key) : permissionKeys;

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
}
