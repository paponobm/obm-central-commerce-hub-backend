// The 5-role hierarchy: Super Admin has every permission, fixed, never
// editable. Admin, Manager, Member and Agent each get their own
// permissions toggled individually per user (see
// UsersService.sanitizePermissions) — these constants govern who's
// allowed to create/edit a user of which role, and which permission keys
// a given role is even allowed to hold.

export const ROLE_SUPER_ADMIN = 'Super Admin';
export const ROLE_ADMIN = 'Admin';
export const ROLE_MANAGER = 'Manager';
export const ROLE_MEMBER = 'Member';
// Works like Member (single store, individually-toggled permissions) —
// the one difference is order visibility, enforced in OrdersService/
// ReportsService, not here: an Agent only ever sees orders they
// personally created (Order.createdById), on both the Orders list and
// the Dashboard, while Web Orders stays unrestricted like every other
// role. See isSingleStoreRole below for the part that IS shared with
// Member.
export const ROLE_AGENT = 'Agent';

// Which roles a given actor role is allowed to create/edit users as.
// Manager, Member and Agent grant no user-management capability at all —
// they're simply absent as keys here, so assignableRoleNames() returns []
// for them.
const ASSIGNABLE_ROLES: Record<string, string[]> = {
  [ROLE_SUPER_ADMIN]: [
    ROLE_SUPER_ADMIN,
    ROLE_ADMIN,
    ROLE_MANAGER,
    ROLE_MEMBER,
    ROLE_AGENT,
  ],
  [ROLE_ADMIN]: [ROLE_MANAGER, ROLE_MEMBER, ROLE_AGENT],
};

// Member and Agent are both always scoped to exactly one assigned store —
// everywhere the old "=== ROLE_MEMBER" check applied, it now applies to
// either.
export function isSingleStoreRole(roleName: string): boolean {
  return roleName === ROLE_MEMBER || roleName === ROLE_AGENT;
}

export function assignableRoleNames(actorRoleName: string): string[] {
  return ASSIGNABLE_ROLES[actorRoleName] ?? [];
}

// users.manage lets its holder create/edit other users — reserved for
// Admin and Super Admin by design (Super Admin always has it via '*';
// Admin may have it toggled on/off per user). Never offered to, or
// accepted for, Manager/Member — granting it would let them route around
// the hierarchy above by creating users through the same endpoint.
export const ADMIN_ONLY_PERMISSION = 'users.manage';

// A Member is always scoped to exactly one assigned store — this
// permission would let them see every store instead, so it's never
// offered/accepted for that role.
export const NOT_FOR_MEMBER_PERMISSION = 'channels.all_access';
