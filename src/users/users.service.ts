import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto, PermissionsByScopeDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import {
  ADMIN_ONLY_PERMISSION,
  NOT_FOR_MEMBER_PERMISSION,
  ROLE_ADMIN,
  ROLE_MEMBER,
  ROLE_SUPER_ADMIN,
  assignableRoleNames,
} from './role-hierarchy';

const userWithRoleAndPermissions = Prisma.validator<Prisma.UserDefaultArgs>()({
  include: {
    role: { include: { permissions: { include: { permission: true } } } },
    permissions: { include: { permission: true } },
    channelPermissions: { include: { permission: true } },
  },
});

type UserWithRoleAndPermissions = Prisma.UserGetPayload<
  typeof userWithRoleAndPermissions
>;

// The shape auth/guards actually need: a user plus their effective flat
// permission-key list — Super Admin's role-wide set, or everyone else's
// UNION of their "All Stores" grants (UserPermission) and every per-store
// grant (UserChannelPermission) across every channel. This is deliberately
// the union, not either set alone: it answers "can this user reach this
// feature AT ALL, in some scope" for the app-wide JWT permission gate,
// which doesn't know which store is active. Code that needs to know
// whether a permission applies to the SPECIFIC active scope (e.g. the
// Dashboard endpoint) uses ChannelScopeService.hasPermissionForScope
// instead of this flat list.
export type UserWithPermissions = {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  isActive: boolean;
  deletedAt: Date | null;
  roleId: string;
  roleName: string;
  permissions: string[];
};

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findByEmailWithPermissions(
    email: string,
  ): Promise<UserWithPermissions | null> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      ...userWithRoleAndPermissions,
    });
    if (!user) return null;
    return this.toUserWithPermissions(user);
  }

  async findByIdWithPermissions(
    id: string,
  ): Promise<UserWithPermissions | null> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      ...userWithRoleAndPermissions,
    });
    if (!user) return null;
    return this.toUserWithPermissions(user);
  }

  private toUserWithPermissions(
    user: UserWithRoleAndPermissions,
  ): UserWithPermissions {
    const permissions =
      user.role.name === ROLE_SUPER_ADMIN
        ? user.role.permissions.map((rp) => rp.permission.key)
        : Array.from(
            new Set([
              ...user.permissions.map((up) => up.permission.key),
              ...user.channelPermissions.map((cp) => cp.permission.key),
            ]),
          );
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      passwordHash: user.passwordHash,
      isActive: user.isActive,
      deletedAt: user.deletedAt,
      roleId: user.roleId,
      roleName: user.role.name,
      permissions,
    };
  }

  // Staff management (§21) — deliberately simple: no channel-scoping of
  // this list itself. `users.manage` is only ever held by Admin/Super
  // Admin (see role-hierarchy.ts), so there's no store-restricted user who
  // could reach this in the first place.
  async findAll() {
    const users = await this.prisma.user.findMany({
      where: { deletedAt: null },
      include: {
        role: { select: { id: true, name: true } },
        channels: { select: { channelId: true } },
        permissions: { select: { permission: { select: { key: true } } } },
        channelPermissions: {
          select: { channelId: true, permission: { select: { key: true } } },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    return users.map((u) => this.toListItem(u));
  }

  async create(dto: CreateUserDto, actorRoleName: string) {
    const targetRole = await this.prisma.role.findUnique({
      where: { id: dto.roleId },
    });
    if (!targetRole) {
      throw new NotFoundException(`Role ${dto.roleId} not found`);
    }
    if (!assignableRoleNames(actorRoleName).includes(targetRole.name)) {
      throw new ForbiddenException(
        `You cannot create a ${targetRole.name} user`,
      );
    }
    const permissionIds = await this.resolvePermissionIds(
      this.sanitizePermissions(dto.permissions?.allStores, targetRole.name),
    );
    const channelPermissionRows = await this.resolveChannelPermissionRows(
      dto.permissions?.byChannel,
      targetRole.name,
    );
    // Store assignment isn't picked separately — a user is considered
    // assigned to whichever stores they actually ended up with a
    // permission granted for, derived straight from the rows above (after
    // sanitizing and resolving to real Permission ids) rather than from a
    // separate checkbox list.
    const derivedChannelIds = Array.from(
      new Set(channelPermissionRows.map((r) => r.channelId)),
    );
    // A Member may be created bare (no store yet — configured right after
    // via the access panel) but never with more than one; 0 or 1 is fine.
    if (targetRole.name === ROLE_MEMBER && derivedChannelIds.length > 1) {
      throw new BadRequestException(
        'A Member can only be assigned to one store',
      );
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.handleUniqueConstraints(() =>
      this.prisma.user.create({
        data: {
          name: dto.name,
          email: dto.email,
          passwordHash,
          roleId: dto.roleId,
          isActive: dto.isActive ?? true,
          channels: derivedChannelIds.length
            ? {
                createMany: {
                  data: derivedChannelIds.map((channelId) => ({ channelId })),
                },
              }
            : undefined,
          permissions: permissionIds.length
            ? {
                createMany: {
                  data: permissionIds.map((permissionId) => ({ permissionId })),
                },
              }
            : undefined,
          channelPermissions: channelPermissionRows.length
            ? { createMany: { data: channelPermissionRows } }
            : undefined,
        },
        include: {
          role: { select: { id: true, name: true } },
          channels: { select: { channelId: true } },
          permissions: { select: { permission: { select: { key: true } } } },
          channelPermissions: {
            select: { channelId: true, permission: { select: { key: true } } },
          },
        },
      }),
    );
    return this.toListItem(user);
  }

  async update(
    id: string,
    dto: UpdateUserDto,
    actorUserId: string,
    actorRoleName: string,
  ) {
    const existing = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      include: { role: { select: { name: true } } },
    });
    if (!existing) throw new NotFoundException(`User ${id} not found`);

    const allowed = assignableRoleNames(actorRoleName);
    // The target's CURRENT role must be one this actor can manage — this is
    // what stops an Admin from touching a Super Admin or another Admin
    // account via this endpoint at all, edit or not.
    if (!allowed.includes(existing.role.name)) {
      throw new ForbiddenException(
        `You cannot edit a ${existing.role.name} user`,
      );
    }

    if (id === actorUserId && (dto.roleId || dto.permissions)) {
      throw new ForbiddenException(
        'You cannot change your own role or permissions',
      );
    }

    let targetRoleName = existing.role.name;
    if (dto.roleId) {
      const targetRole = await this.prisma.role.findUnique({
        where: { id: dto.roleId },
      });
      if (!targetRole)
        throw new NotFoundException(`Role ${dto.roleId} not found`);
      if (!allowed.includes(targetRole.name)) {
        throw new ForbiddenException(
          `You cannot assign the ${targetRole.name} role`,
        );
      }
      // A Super Admin account's role is never changeable through this
      // endpoint, by anyone, including another Super Admin — demoting one
      // by accident here has happened enough that it's worth a hard stop;
      // only a direct database change can do it.
      if (
        existing.role.name === ROLE_SUPER_ADMIN &&
        targetRole.name !== ROLE_SUPER_ADMIN
      ) {
        throw new ForbiddenException(
          "A Super Admin's role can't be changed here",
        );
      }
      targetRoleName = targetRole.name;
    }

    const permissionIds =
      dto.permissions !== undefined
        ? await this.resolvePermissionIds(
            this.sanitizePermissions(dto.permissions.allStores, targetRoleName),
          )
        : undefined;
    const channelPermissionRows =
      dto.permissions !== undefined
        ? await this.resolveChannelPermissionRows(
            dto.permissions.byChannel,
            targetRoleName,
          )
        : undefined;
    // Store assignment is derived from the per-channel grants above, same
    // as create() — only recomputed when permissions were actually sent.
    const derivedChannelIds =
      channelPermissionRows !== undefined
        ? Array.from(new Set(channelPermissionRows.map((r) => r.channelId)))
        : undefined;

    if (
      targetRoleName === ROLE_MEMBER &&
      derivedChannelIds !== undefined &&
      derivedChannelIds.length > 1
    ) {
      throw new BadRequestException(
        'A Member can only be assigned to one store',
      );
    }

    const passwordHash = dto.password
      ? await bcrypt.hash(dto.password, 10)
      : undefined;

    const user = await this.handleUniqueConstraints(() =>
      this.prisma.$transaction(async (tx) => {
        if (derivedChannelIds) {
          await tx.userChannel.deleteMany({ where: { userId: id } });
          if (derivedChannelIds.length) {
            await tx.userChannel.createMany({
              data: derivedChannelIds.map((channelId) => ({
                userId: id,
                channelId,
              })),
              skipDuplicates: true,
            });
          }
        }
        if (permissionIds) {
          await tx.userPermission.deleteMany({ where: { userId: id } });
          if (permissionIds.length) {
            await tx.userPermission.createMany({
              data: permissionIds.map((permissionId) => ({
                userId: id,
                permissionId,
              })),
              skipDuplicates: true,
            });
          }
        }
        if (channelPermissionRows) {
          await tx.userChannelPermission.deleteMany({ where: { userId: id } });
          if (channelPermissionRows.length) {
            await tx.userChannelPermission.createMany({
              data: channelPermissionRows.map((row) => ({
                userId: id,
                ...row,
              })),
              skipDuplicates: true,
            });
          }
        }
        return tx.user.update({
          where: { id },
          data: {
            name: dto.name,
            email: dto.email,
            roleId: dto.roleId,
            isActive: dto.isActive,
            ...(passwordHash ? { passwordHash } : {}),
          },
          include: {
            role: { select: { id: true, name: true } },
            channels: { select: { channelId: true } },
            permissions: { select: { permission: { select: { key: true } } } },
            channelPermissions: {
              select: {
                channelId: true,
                permission: { select: { key: true } },
              },
            },
          },
        });
      }),
    );
    return this.toListItem(user);
  }

  async remove(id: string, actorUserId: string, actorRoleName: string) {
    const existing = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      include: { role: { select: { name: true } } },
    });
    if (!existing) throw new NotFoundException(`User ${id} not found`);

    if (id === actorUserId) {
      throw new ForbiddenException('You cannot delete your own account');
    }
    // Same hard stop as the role-change guard in update(): a Super Admin
    // account is never removable through this endpoint, by anyone.
    if (existing.role.name === ROLE_SUPER_ADMIN) {
      throw new ForbiddenException(
        "A Super Admin account can't be deleted here",
      );
    }
    if (!assignableRoleNames(actorRoleName).includes(existing.role.name)) {
      throw new ForbiddenException(
        `You cannot delete a ${existing.role.name} user`,
      );
    }

    // email has a hard DB-level unique constraint that a soft delete alone
    // doesn't relax, so without this a deleted user's email would stay
    // permanently unusable for a brand-new account.
    await this.prisma.user.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        isActive: false,
        email: `deleted-${Date.now()}-${existing.email}`,
      },
    });
    return { id };
  }

  // Enforces the two rules no caller is ever allowed to work around via the
  // requested permission list, regardless of role: users.manage stays
  // Admin/Super-Admin-only, and Member never gets cross-store access.
  // Super Admin ignores the requested list entirely — its permissions are
  // always the fixed role-wide '*' set.
  private sanitizePermissions(
    requested: string[] | undefined,
    roleName: string,
  ): string[] {
    if (roleName === ROLE_SUPER_ADMIN) return [];
    const keys = new Set(requested ?? []);
    if (roleName !== ROLE_ADMIN) keys.delete(ADMIN_ONLY_PERMISSION);
    // Never trust a client-sent "All Stores" flag directly — it's derived
    // below from whether any real permission was granted, same spirit as
    // store assignment being derived from the per-channel grants.
    keys.delete(NOT_FOR_MEMBER_PERMISSION);
    // Baseline, not a meaningful toggle on its own: the storefront picker
    // (and a Member's auto-selected single store) both work by listing
    // GET /admin/channels, which itself requires channels.view — without
    // it nobody can ever select or land on a specific store, so every
    // store-scoped permission granted above would be unreachable in
    // practice. Always included for any role that isn't Super Admin.
    keys.add('channels.view');
    // Granting ANY real "All Stores" permission makes this user
    // unrestricted — able to reach "All Stores" in their own topbar — same
    // as checking the old "All Stores" box used to, just derived now
    // instead of picked separately. Member never gets this, regardless.
    const hasRealGrant = Array.from(keys).some((k) => k !== 'channels.view');
    if (hasRealGrant && roleName !== ROLE_MEMBER) {
      keys.add(NOT_FOR_MEMBER_PERMISSION);
    }
    return Array.from(keys);
  }

  // Per-store grants only ever cover store-scoped nav-group permissions —
  // the baseline/global flags (channels.view, channels.all_access) and the
  // Admin-only Users/Roles/Settings permission belong to the "All Stores"
  // bucket only, so they're stripped here even if a client sends them.
  private sanitizeChannelPermissions(requested: string[]): string[] {
    const keys = new Set(requested);
    keys.delete(ADMIN_ONLY_PERMISSION);
    keys.delete(NOT_FOR_MEMBER_PERMISSION);
    keys.delete('channels.view');
    return Array.from(keys);
  }

  private async resolveChannelPermissionRows(
    byChannel: PermissionsByScopeDto['byChannel'],
    roleName: string,
  ): Promise<{ channelId: string; permissionId: string }[]> {
    if (!byChannel || roleName === ROLE_SUPER_ADMIN) return [];
    const rows: { channelId: string; permissionId: string }[] = [];
    for (const [channelId, requested] of Object.entries(byChannel)) {
      const ids = await this.resolvePermissionIds(
        this.sanitizeChannelPermissions(requested),
      );
      for (const permissionId of ids) rows.push({ channelId, permissionId });
    }
    return rows;
  }

  async permissionsCatalog() {
    return this.prisma.permission.findMany({
      select: { key: true, label: true },
      orderBy: { key: 'asc' },
    });
  }

  private async resolvePermissionIds(keys: string[]): Promise<string[]> {
    if (keys.length === 0) return [];
    const rows = await this.prisma.permission.findMany({
      where: { key: { in: keys } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  private toListItem(user: {
    id: string;
    name: string;
    email: string;
    isActive: boolean;
    createdAt: Date;
    role: { id: string; name: string };
    channels: { channelId: string }[];
    permissions: { permission: { key: string } }[];
    channelPermissions: {
      channelId: string;
      permission: { key: string };
    }[];
  }) {
    const allStores = user.permissions.map((p) => p.permission.key);
    const byChannel: Record<string, string[]> = {};
    for (const cp of user.channelPermissions) {
      (byChannel[cp.channelId] ??= []).push(cp.permission.key);
    }
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      isActive: user.isActive,
      createdAt: user.createdAt,
      role: user.role,
      channelIds: user.channels.map((c) => c.channelId),
      // Flat union — "can this user do this ANYWHERE" — kept for the
      // existing Stores-column/unrestricted checks the UI already does.
      permissions: Array.from(
        new Set([...allStores, ...Object.values(byChannel).flat()]),
      ),
      permissionsByScope: { allStores, byChannel },
    };
  }

  private async handleUniqueConstraints<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('A user with this email already exists');
      }
      throw err;
    }
  }
}
