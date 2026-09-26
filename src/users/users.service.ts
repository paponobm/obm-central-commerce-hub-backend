import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

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

  // Staff management (§21) — deliberately simple: no channel-scoping of
  // this list itself. `users.manage` is only ever granted to unrestricted
  // (Owner-shaped) roles in the seed, so there's no restricted user who
  // could reach this in the first place.
  async findAll() {
    const users = await this.prisma.user.findMany({
      where: { deletedAt: null },
      include: {
        role: { select: { id: true, name: true } },
        channels: { select: { channelId: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return users.map((u) => this.toListItem(u));
  }

  async create(dto: CreateUserDto) {
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.handleUniqueConstraints(() =>
      this.prisma.user.create({
        data: {
          name: dto.name,
          email: dto.email,
          passwordHash,
          roleId: dto.roleId,
          isActive: dto.isActive ?? true,
          channels: dto.channelIds?.length
            ? {
                createMany: {
                  data: dto.channelIds.map((channelId) => ({ channelId })),
                },
              }
            : undefined,
        },
        include: {
          role: { select: { id: true, name: true } },
          channels: { select: { channelId: true } },
        },
      }),
    );
    return this.toListItem(user);
  }

  async update(id: string, dto: UpdateUserDto) {
    const existing = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new NotFoundException(`User ${id} not found`);

    const passwordHash = dto.password
      ? await bcrypt.hash(dto.password, 10)
      : undefined;

    const user = await this.handleUniqueConstraints(() =>
      this.prisma.$transaction(async (tx) => {
        if (dto.channelIds) {
          await tx.userChannel.deleteMany({ where: { userId: id } });
          if (dto.channelIds.length) {
            await tx.userChannel.createMany({
              data: dto.channelIds.map((channelId) => ({
                userId: id,
                channelId,
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
          },
        });
      }),
    );
    return this.toListItem(user);
  }

  private toListItem(user: {
    id: string;
    name: string;
    email: string;
    isActive: boolean;
    createdAt: Date;
    role: { id: string; name: string };
    channels: { channelId: string }[];
  }) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      isActive: user.isActive,
      createdAt: user.createdAt,
      role: user.role,
      channelIds: user.channels.map((c) => c.channelId),
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
