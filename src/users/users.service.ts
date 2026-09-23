import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const userWithRoleAndPermissions = Prisma.validator<Prisma.UserDefaultArgs>()({
  include: {
    role: { include: { permissions: { include: { permission: true } } } },
  },
});

type UserWithRoleAndPermissions = Prisma.UserGetPayload<
  typeof userWithRoleAndPermissions
>;

// The shape auth/guards actually need: a user plus their role's flat
// permission-key list. Kept separate from a generic "get User" so callers
// can't accidentally forget to include permissions.
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
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      passwordHash: user.passwordHash,
      isActive: user.isActive,
      deletedAt: user.deletedAt,
      roleId: user.roleId,
      roleName: user.role.name,
      permissions: user.role.permissions.map((rp) => rp.permission.key),
    };
  }
}
