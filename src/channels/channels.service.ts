import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  ALL_ACCESS_PERMISSION,
  ChannelScopeService,
} from '../common/channel-scope/channel-scope.service';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { CreateChannelDto } from './dto/create-channel.dto';
import { UpdateChannelDto } from './dto/update-channel.dto';

@Injectable()
export class ChannelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly channelScope: ChannelScopeService,
  ) {}

  async create(dto: CreateChannelDto) {
    return this.handleUniqueConstraints(() =>
      this.prisma.channel.create({ data: dto }),
    );
  }

  // A restricted user (no channels.all_access) only ever sees the stores
  // they're assigned to — everywhere channels are listed, not just orders.
  async findAll(user: JwtPayload, includeInactive = false) {
    return this.prisma.channel.findMany({
      where: {
        deletedAt: null,
        ...(includeInactive ? {} : { isActive: true }),
        ...(await this.visibleChannelWhere(user)),
      },
      orderBy: { name: 'asc' },
    });
  }

  // For the /channels cards UI: same visibility scoping, plus per-store
  // product/order counts.
  async findAllWithStats(user: JwtPayload, includeInactive = false) {
    const channels = await this.findAll(user, includeInactive);

    return Promise.all(
      channels.map(async (channel) => {
        const [productCount, orderCount] = await Promise.all([
          this.prisma.productChannel.count({
            where: { channelId: channel.id, isPublished: true },
          }),
          this.prisma.order.count({ where: { channelId: channel.id } }),
        ]);
        return { ...channel, productCount, orderCount };
      }),
    );
  }

  async findOne(id: string, user: JwtPayload) {
    const channel = await this.prisma.channel.findFirst({
      where: { id, deletedAt: null },
    });
    if (!channel) {
      throw new NotFoundException(`Channel ${id} not found`);
    }
    if (!user.permissions.includes(ALL_ACCESS_PERMISSION)) {
      const allowed = await this.channelScope.getAssignedChannelIds(user.sub);
      if (!allowed.includes(channel.id)) {
        throw new ForbiddenException('You are not assigned to this store');
      }
    }
    return channel;
  }

  private async visibleChannelWhere(
    user: JwtPayload,
  ): Promise<{ id?: { in: string[] } }> {
    if (user.permissions.includes(ALL_ACCESS_PERMISSION)) return {};
    const allowed = await this.channelScope.getAssignedChannelIds(user.sub);
    return { id: { in: allowed } };
  }

  async update(id: string, dto: UpdateChannelDto, user: JwtPayload) {
    await this.findOne(id, user);
    return this.handleUniqueConstraints(() =>
      this.prisma.channel.update({ where: { id }, data: dto }),
    );
  }

  // Soft delete: sets deletedAt + isActive=false. Never a hard delete — a
  // channel a customer once ordered from must keep resolving on old orders.
  async remove(id: string, user: JwtPayload) {
    await this.findOne(id, user);
    return this.prisma.channel.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  private async handleUniqueConstraints<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const target = (err.meta?.target as string[] | undefined)?.join(', ');
        throw new ConflictException(
          `Channel with this ${target ?? 'slug/domain'} already exists`,
        );
      }
      throw err;
    }
  }
}
