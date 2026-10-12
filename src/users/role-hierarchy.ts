// The 4-role hierarchy: Super Admin has every permission, fixed, never
// editable. Admin, Manager and Member each get their own permissions
// toggled individually per user (see UsersService.sanitizePermissions) —
// these constants govern who's allowed to create/edit a user of which
// role, and which permission keys a given role is even allowed to hold.

export const ROLE_SUPER_ADMIN = 'Super Admin';
export const ROLE_ADMIN = 'Admin';
export const ROLE_MANAGER = 'Manager';
export const ROLE_MEMBER = 'Member';

// Which roles a given actor role is allowed to create/edit users as.
// Manager and Member grant no user-management capability at all — they're
// simply absent as keys here, so assignableRoleNames() returns [] for them.
const ASSIGNABLE_ROLES: Record<string, string[]> = {
  [ROLE_SUPER_ADMIN]: [ROLE_SUPER_ADMIN, ROLE_ADMIN, ROLE_MANAGER, ROLE_MEMBER],
  [ROLE_ADMIN]: [ROLE_MANAGER, ROLE_MEMBER],
};

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
