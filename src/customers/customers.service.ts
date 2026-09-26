import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { toNumber } from '../common/decimal.util';
import {
  ALL_ACCESS_PERMISSION,
  ChannelScopeService,
} from '../common/channel-scope/channel-scope.service';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

type DbClient = PrismaService | Prisma.TransactionClient;

export interface ResolveCustomerInput {
  customerId?: string;
  name?: string;
  phone?: string;
  email?: string;
}

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly channelScope: ChannelScopeService,
  ) {}

  // Customer has no channelId column — a customer belongs to a store only
  // through having ordered there (ARCHITECTURE.md §19), so a restricted
  // user's visibility is "has at least one order in my channel(s)". Never
  // add a direct column to Customer to short-circuit this.
  private async visibleWhere(
    user: JwtPayload,
    requestedChannelId?: string,
  ): Promise<Prisma.CustomerWhereInput> {
    const resolved = await this.channelScope.resolveDirectFilter(
      user,
      requestedChannelId,
    );
    if (!resolved.channelId) return {};
    return { orders: { some: { channelId: resolved.channelId } } };
  }

  async create(dto: CreateCustomerDto) {
    return this.handleUniqueConstraints(() =>
      this.prisma.customer.create({ data: dto }),
    );
  }

  async findAll(user: JwtPayload, search?: string, channelId?: string) {
    const visible = await this.visibleWhere(user, channelId);
    return this.prisma.customer.findMany({
      where: {
        deletedAt: null,
        ...visible,
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { phone: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async requireCustomer(id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, deletedAt: null },
    });
    if (!customer) {
      throw new NotFoundException(`Customer ${id} not found`);
    }
    return customer;
  }

  private async assertVisible(user: JwtPayload, customerId: string) {
    if (user.permissions.includes(ALL_ACCESS_PERMISSION)) return;
    const visible = await this.visibleWhere(user);
    const count = await this.prisma.customer.count({
      where: { id: customerId, ...visible },
    });
    if (count === 0) {
      throw new ForbiddenException(
        'This customer has no orders on any of your assigned stores',
      );
    }
  }

  // Detail page: the customer plus order history, totals, and a per-store
  // breakdown — all computed over only the orders the caller may see, so a
  // restricted user never learns what a shared customer spent elsewhere.
  async findOne(id: string, user: JwtPayload) {
    const customer = await this.requireCustomer(id);
    await this.assertVisible(user, id);

    const scope = await this.channelScope.resolveDirectFilter(user);
    const orders = await this.prisma.order.findMany({
      where: { customerId: id, ...scope },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        paymentStatus: true,
        total: true,
        createdAt: true,
        channelId: true,
        channel: { select: { id: true, name: true } },
      },
    });

    const counted = orders.filter((o) => o.status !== 'CANCELLED');
    const byChannel = new Map<
      string,
      {
        channelId: string | null;
        channelName: string;
        orderCount: number;
        totalSpent: number;
      }
    >();
    for (const o of orders) {
      const key = o.channelId ?? 'none';
      const row = byChannel.get(key) ?? {
        channelId: o.channelId,
        channelName: o.channel?.name ?? 'No channel (manual)',
        orderCount: 0,
        totalSpent: 0,
      };
      row.orderCount += 1;
      if (o.status !== 'CANCELLED') row.totalSpent += toNumber(o.total);
      byChannel.set(key, row);
    }

    return {
      ...customer,
      stats: {
        totalOrders: orders.length,
        totalSpent: counted.reduce((sum, o) => sum + toNumber(o.total), 0),
        lastOrderAt: orders[0]?.createdAt ?? null,
      },
      ordersByChannel: [...byChannel.values()].sort(
        (a, b) => b.orderCount - a.orderCount,
      ),
      orders: orders.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        paymentStatus: o.paymentStatus,
        total: toNumber(o.total),
        createdAt: o.createdAt,
        channelName: o.channel?.name ?? 'No channel (manual)',
      })),
    };
  }

  async update(id: string, dto: UpdateCustomerDto, user: JwtPayload) {
    await this.requireCustomer(id);
    await this.assertVisible(user, id);
    return this.handleUniqueConstraints(() =>
      this.prisma.customer.update({ where: { id }, data: dto }),
    );
  }

  // A customer is shared across every store, so deleting one is a
  // cross-store action — only unrestricted users may do it.
  async remove(id: string, user: JwtPayload) {
    if (!user.permissions.includes(ALL_ACCESS_PERMISSION)) {
      throw new ForbiddenException(
        'Only unrestricted users can delete a customer shared across stores',
      );
    }
    await this.requireCustomer(id);
    return this.prisma.customer.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // Used by order creation: an explicit customerId wins; otherwise reuse
  // an existing customer by phone (a manual order for a phone number that
  // already exists should link to that customer, not fork a duplicate),
  // and only create a new row when the phone is genuinely new. Accepts an
  // optional transaction client so order creation can do this atomically
  // alongside the rest of the order.
  async resolveCustomer(
    input: ResolveCustomerInput,
    db: DbClient = this.prisma,
  ) {
    if (input.customerId) {
      const customer = await db.customer.findFirst({
        where: { id: input.customerId, deletedAt: null },
      });
      if (!customer) {
        throw new NotFoundException(`Customer ${input.customerId} not found`);
      }
      return customer;
    }

    if (!input.phone) {
      throw new BadRequestException(
        'Either customerId or a phone number is required to create an order',
      );
    }

    const existing = await db.customer.findUnique({
      where: { phone: input.phone },
    });
    if (existing) {
      return existing;
    }

    if (!input.name) {
      throw new BadRequestException(
        'name is required when creating a new customer',
      );
    }

    return db.customer.create({
      data: { name: input.name, phone: input.phone, email: input.email },
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
        throw new ConflictException(
          'Customer with this phone number already exists',
        );
      }
      throw err;
    }
  }
}
