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
    const { themeConfig, ...rest } = dto;
    const data: Prisma.ChannelCreateInput = { ...rest };
    if (themeConfig !== undefined) {
      data.themeConfig = themeConfig as unknown as Prisma.InputJsonValue;
    }
    return this.handleUniqueConstraints(() =>
      this.prisma.channel.create({ data }),
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
    if (channels.length === 0) return [];

    // Two grouped queries cover every channel, instead of two counts per channel.
    const channelIds = channels.map((c) => c.id);
    const [productRows, orderRows] = await Promise.all([
      this.prisma.productChannel.groupBy({
        by: ['channelId'],
        where: { channelId: { in: channelIds }, isPublished: true },
        _count: true,
      }),
      this.prisma.order.groupBy({
        by: ['channelId'],
        where: { channelId: { in: channelIds } },
        _count: true,
      }),
    ]);
    const productCounts = new Map(
      productRows.map((r) => [r.channelId, r._count]),
    );
    const orderCounts = new Map(orderRows.map((r) => [r.channelId, r._count]));

    return channels.map((channel) => ({
      ...channel,
      productCount: productCounts.get(channel.id) ?? 0,
      orderCount: orderCounts.get(channel.id) ?? 0,
    }));
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

  // Settings → VIP কুপন's list — every coupon the backend has ever
  // auto-generated for this channel (see StorefrontService.createOrder),
  // newest first, with which order earned it and which order (if any) spent
  // it, so the admin can see what's outstanding vs. already redeemed.
  async listVipCoupons(id: string, user: JwtPayload) {
    await this.findOne(id, user);
    return this.prisma.vipCoupon.findMany({
      where: { channelId: id },
      orderBy: { createdAt: 'desc' },
      include: {
        grantedOrder: { select: { orderNumber: true, shippingName: true } },
        usedOrder: { select: { orderNumber: true, shippingName: true } },
      },
    });
  }

  private async visibleChannelWhere(
    user: JwtPayload,
  ): Promise<{ id?: { in: string[] } }> {
    if (user.permissions.includes(ALL_ACCESS_PERMISSION)) return {};
    const allowed = await this.channelScope.getAssignedChannelIds(user.sub);
    return { id: { in: allowed } };
  }

  async update(id: string, dto: UpdateChannelDto, user: JwtPayload) {
    const existing = await this.findOne(id, user);
    const { themeConfig, ...rest } = dto;
    const data: Prisma.ChannelUpdateInput = { ...rest };
    // Merge, not replace — themeConfig will grow more sub-keys (banner,
    // WhatsApp number, ...) over time, and a partial save here must not
    // wipe sub-keys this request didn't touch.
    if (themeConfig !== undefined) {
      const existingConfig =
        (existing.themeConfig as Prisma.JsonObject | null) ?? {};
      data.themeConfig = {
        ...existingConfig,
        ...themeConfig,
      } as Prisma.InputJsonValue;
    }
    return this.handleUniqueConstraints(() =>
      this.prisma.channel.update({ where: { id }, data }),
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
