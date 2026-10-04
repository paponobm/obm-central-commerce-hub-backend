import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  OrderSource,
  OrderStatus,
  PaymentStatus,
  Prisma,
  ShipmentStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { runTransaction } from '../common/prisma-transaction.util';
import { toNumber } from '../common/decimal.util';
import {
  ALL_ACCESS_PERMISSION,
  ChannelScopeService,
} from '../common/channel-scope/channel-scope.service';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { CustomersService } from '../customers/customers.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { UpdateCustomerResponseDto } from './dto/update-customer-response.dto';
import { RecordPaymentDto } from './dto/record-payment.dto';

// The order lifecycle (ARCHITECTURE.md §7.2). Empty array = terminal state.
// PENDING_CANCEL/PARTIAL/PENDING_RETURN/LOST/PREORDER are additive labels —
// none of them trigger a stock movement on their own (see the dispatch
// below): PENDING_CANCEL keeps stock reserved until the cancellation is
// actually finalized, PARTIAL/LOST/PENDING_RETURN all follow SHIPPED (which
// already deducted stock), and PREORDER reserves stock exactly like PENDING.
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ['CONFIRMED', 'PREORDER', 'PENDING_CANCEL', 'CANCELLED'],
  CONFIRMED: ['PROCESSING', 'PENDING_CANCEL', 'CANCELLED'],
  PROCESSING: ['READY_TO_SHIP', 'PENDING_CANCEL', 'CANCELLED'],
  READY_TO_SHIP: ['SHIPPED', 'PENDING_CANCEL', 'CANCELLED'],
  SHIPPED: ['DELIVERED', 'PARTIAL', 'PENDING_RETURN', 'LOST'],
  PARTIAL: ['DELIVERED', 'PENDING_RETURN', 'RETURNED'],
  DELIVERED: ['PENDING_RETURN', 'RETURNED'],
  PENDING_RETURN: ['RETURNED'],
  RETURNED: [],
  PENDING_CANCEL: ['PENDING', 'CANCELLED'],
  CANCELLED: [],
  PREORDER: ['PENDING', 'CANCELLED'],
  LOST: [],
};

// Content editing (items/customer/discount/etc, via updateOrder) is only
// safe while stock is merely *reserved* — the same set the frontend uses
// to decide when the row-level Cancel action is offered. Once SHIPPED,
// stock has actually been deducted, so changing items would silently
// desync the reservation/deduction accounting.
const EDITABLE_STATUSES = new Set<OrderStatus>([
  'PENDING',
  'CONFIRMED',
  'PROCESSING',
  'READY_TO_SHIP',
  'PENDING_CANCEL',
  'PREORDER',
]);

interface StockRow {
  currentStock: number;
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customersService: CustomersService,
    private readonly channelScope: ChannelScopeService,
  ) {}

  async findAll(
    filters: {
      channelId?: string;
      status?: OrderStatus;
      source?: OrderSource;
      paymentStatus?: PaymentStatus;
      shipmentStatus?: ShipmentStatus;
      customerId?: string;
      productId?: string;
      from?: string;
      to?: string;
      search?: string;
    },
    user: JwtPayload,
  ) {
    const channelFilter = await this.channelScope.resolveDirectFilter(
      user,
      filters.channelId,
    );
    const orders = await this.prisma.order.findMany({
      where: {
        ...channelFilter,
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.source ? { source: filters.source } : {}),
        ...(filters.paymentStatus
          ? { paymentStatus: filters.paymentStatus }
          : {}),
        ...(filters.shipmentStatus
          ? { shipmentStatus: filters.shipmentStatus }
          : {}),
        ...(filters.customerId ? { customerId: filters.customerId } : {}),
        ...(filters.productId
          ? { items: { some: { productId: filters.productId } } }
          : {}),
        ...(filters.from || filters.to
          ? {
              createdAt: {
                ...(filters.from ? { gte: new Date(filters.from) } : {}),
                ...(filters.to ? { lte: new Date(filters.to) } : {}),
              },
            }
          : {}),
        ...(filters.search
          ? {
              OR: [
                {
                  orderNumber: {
                    contains: filters.search,
                    mode: 'insensitive',
                  },
                },
                {
                  shippingName: {
                    contains: filters.search,
                    mode: 'insensitive',
                  },
                },
                {
                  shippingPhone: {
                    contains: filters.search,
                    mode: 'insensitive',
                  },
                },
                {
                  customer: {
                    name: { contains: filters.search, mode: 'insensitive' },
                  },
                },
                {
                  customer: {
                    phone: { contains: filters.search, mode: 'insensitive' },
                  },
                },
              ],
            }
          : {}),
      },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        channel: { select: { id: true, name: true, slug: true } },
        createdBy: { select: { id: true, name: true } },
        items: {
          include: {
            product: {
              select: {
                images: {
                  take: 1,
                  orderBy: { sortOrder: 'asc' },
                  select: { url: true },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const customerIds = orders.map((o) => o.customerId);
    const successRateByCustomer =
      await this.getCustomerSuccessRates(customerIds);
    const orderCountByCustomer = await this.getCustomerOrderCounts(customerIds);
    return orders.map((o) => ({
      ...o,
      customer: {
        ...o.customer,
        successRate: successRateByCustomer.get(o.customerId) ?? null,
        orderCount: orderCountByCustomer.get(o.customerId) ?? 0,
      },
    }));
  }

  private async getCustomerOrderCounts(
    customerIds: string[],
  ): Promise<Map<string, number>> {
    const uniqueIds = [...new Set(customerIds)];
    if (uniqueIds.length === 0) return new Map();

    const grouped = await this.prisma.order.groupBy({
      by: ['customerId'],
      where: { customerId: { in: uniqueIds } },
      _count: true,
    });
    return new Map(grouped.map((row) => [row.customerId, row._count]));
  }

  // Delivered orders as a share of that customer's own past orders, with
  // CANCELLED/LOST excluded from both sides — those never had a real chance
  // to be delivered, so counting them would understate an otherwise-reliable
  // customer's rate. Scoped to only the customerIds actually on this page
  // rather than the whole table, since this runs on every order-list fetch.
  private async getCustomerSuccessRates(
    customerIds: string[],
  ): Promise<Map<string, number>> {
    const uniqueIds = [...new Set(customerIds)];
    if (uniqueIds.length === 0) return new Map();

    const grouped = await this.prisma.order.groupBy({
      by: ['customerId', 'status'],
      where: {
        customerId: { in: uniqueIds },
        status: { notIn: ['CANCELLED', 'LOST'] },
      },
      _count: true,
    });

    const totals = new Map<string, { delivered: number; eligible: number }>();
    for (const row of grouped) {
      const entry = totals.get(row.customerId) ?? {
        delivered: 0,
        eligible: 0,
      };
      entry.eligible += row._count;
      if (row.status === 'DELIVERED') entry.delivered += row._count;
      totals.set(row.customerId, entry);
    }

    const rates = new Map<string, number>();
    for (const [customerId, { delivered, eligible }] of totals) {
      if (eligible > 0) {
        rates.set(customerId, Math.round((delivered / eligible) * 100));
      }
    }
    return rates;
  }

  async findOne(id: string, user: JwtPayload) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        customer: true,
        channel: true,
        items: {
          include: {
            product: {
              select: {
                images: {
                  take: 1,
                  orderBy: { sortOrder: 'asc' },
                  select: { url: true },
                },
              },
            },
          },
        },
        statusHistory: {
          orderBy: { createdAt: 'asc' },
          include: { changedBy: { select: { id: true, name: true } } },
        },
        payments: true,
        shipment: true,
      },
    });
    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }
    // Direct-ID access must be scope-checked too, not just the list
    // endpoint — otherwise a restricted user could reach another store's
    // order simply by guessing/enumerating its id.
    await this.assertChannelAccess(user, order.channelId);

    const timeline = await this.buildTimeline(order.id, order.statusHistory);
    return { ...order, timeline };
  }

  // Merges OrderStatusHistory (dedicated table) with CustomerResponse
  // changes (logged to the generic AuditLog, not a second history table —
  // ARCHITECTURE.md §17) into one chronological feed for the Order Detail
  // page. Each entry carries its own `type` so the frontend can render the
  // two kinds of change differently without losing the shared timeline.
  private async buildTimeline(
    orderId: string,
    statusHistory: {
      id: string;
      fromStatus: OrderStatus | null;
      toStatus: OrderStatus;
      note: string | null;
      createdAt: Date;
      changedBy: { id: string; name: string } | null;
    }[],
  ) {
    const responseLogs = await this.prisma.auditLog.findMany({
      where: {
        entityType: 'Order',
        entityId: orderId,
        action: 'order.customer_response_change',
      },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { id: true, name: true } } },
    });

    const statusEntries = statusHistory.map((h) => ({
      type: 'status' as const,
      id: h.id,
      fromStatus: h.fromStatus,
      toStatus: h.toStatus,
      note: h.note,
      changedBy: h.changedBy,
      createdAt: h.createdAt,
    }));

    const responseEntries = responseLogs.map((l) => {
      const before = l.before as { customerResponse?: string } | null;
      const after = l.after as {
        customerResponse?: string;
        note?: string;
      } | null;
      return {
        type: 'customer_response' as const,
        id: l.id,
        fromResponse: before?.customerResponse ?? null,
        toResponse: after?.customerResponse ?? null,
        note: after?.note ?? null,
        changedBy: l.user,
        createdAt: l.createdAt,
      };
    });

    return [...statusEntries, ...responseEntries].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
  }

  // A channel-restricted user can only touch orders whose channel is in
  // their assigned set; a null-channel (manual, no-store) order is only
  // reachable by an unrestricted (`channels.all_access`) user, per
  // ARCHITECTURE.md §26 — it doesn't belong to any store a restricted
  // user could be assigned to.
  private async assertChannelAccess(
    user: JwtPayload,
    channelId: string | null,
  ) {
    if (user.permissions.includes(ALL_ACCESS_PERMISSION)) return;
    if (!channelId) {
      throw new ForbiddenException(
        'This order has no store — restricted to unrestricted users',
      );
    }
    const allowed = await this.channelScope.getAssignedChannelIds(user.sub);
    if (!allowed.includes(channelId)) {
      throw new ForbiddenException('You are not assigned to this store');
    }
  }

  // The single entry point for every order regardless of where it comes
  // from — website checkout (Phase 9) and manual/phone/Facebook/WhatsApp
  // orders created from the admin all call this same method, differing
  // only in `source`/`channelId`/`createdById`. That guarantees a manual
  // order can never accidentally bypass the stock-reservation logic that
  // protects the website.
  // `user` is only present for admin-created orders (manual/phone/etc.) —
  // the storefront's own guest checkout calls this with no admin user at
  // all (it's unauthenticated), so the channel-access check below only
  // runs when there's actually an admin identity to check it against. A
  // restricted admin user needs `dto.channelId` set to one of their
  // assigned stores; they can't create a no-store order either, since
  // they'd then be unable to see it again (findOne enforces the same rule).
  async createOrder(
    dto: CreateOrderDto,
    actorUserId?: string,
    user?: JwtPayload,
  ) {
    if (user) {
      await this.assertChannelAccess(user, dto.channelId ?? null);
    }

    let channel = null;
    if (dto.channelId) {
      channel = await this.prisma.channel.findFirst({
        where: { id: dto.channelId, deletedAt: null, isActive: true },
      });
      if (!channel) {
        throw new NotFoundException(
          `Channel ${dto.channelId} not found or inactive`,
        );
      }
    }

    const productIds = [...new Set(dto.items.map((i) => i.productId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, deletedAt: null },
    });
    const productMap = new Map(products.map((p) => [p.id, p]));
    for (const item of dto.items) {
      if (!productMap.has(item.productId)) {
        throw new NotFoundException(`Product ${item.productId} not found`);
      }
    }

    const channelPrices = new Map<string, number>();
    if (dto.channelId) {
      const overrides = await this.prisma.productChannel.findMany({
        where: { channelId: dto.channelId, productId: { in: productIds } },
      });
      for (const o of overrides) {
        channelPrices.set(o.productId, toNumber(o.price));
      }
    }

    const lineItems = dto.items.map((item) => {
      const product = productMap.get(item.productId)!;
      const unitPrice =
        item.unitPrice ??
        channelPrices.get(item.productId) ??
        toNumber(product.basePrice);
      const discount = item.discount ?? 0;
      const total = item.quantity * unitPrice - discount;
      if (total < 0) {
        throw new BadRequestException(
          `Discount exceeds line total for ${product.sku}`,
        );
      }
      return {
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        quantity: item.quantity,
        unitPrice,
        discount,
        total,
      };
    });

    const subtotal = lineItems.reduce((sum, li) => sum + li.total, 0);
    const orderDiscount = dto.discount ?? 0;
    const shippingFee = dto.shippingFee ?? 0;
    const total = subtotal - orderDiscount + shippingFee;
    if (total < 0) {
      throw new BadRequestException('Order total cannot be negative');
    }

    // advanceAmount is the richer primitive; isPaid (full payment) is just
    // "advance == total" expressed as a boolean, kept for the storefront's
    // guest checkout which only ever sends `isPaid: false`.
    const advanceAmount = dto.advanceAmount ?? (dto.isPaid ? total : 0);
    const paymentStatus =
      advanceAmount <= 0
        ? 'UNPAID'
        : advanceAmount >= total
          ? 'PAID'
          : 'PARTIAL';

    return runTransaction(
      this.prisma,
      async (tx) => {
        const customer = await this.customersService.resolveCustomer(
          {
            customerId: dto.customerId,
            name: dto.customerName,
            phone: dto.customerPhone,
            email: dto.customerEmail,
          },
          tx,
        );

        const shippingName = dto.shippingName ?? customer.name;
        const shippingPhone = dto.shippingPhone ?? customer.phone;
        const shippingAddress = dto.shippingAddress ?? customer.address;
        if (!shippingAddress) {
          throw new BadRequestException(
            'shippingAddress is required (customer has no default address on file)',
          );
        }

        const orderNumber = await this.generateOrderNumber(tx);

        const order = await tx.order.create({
          data: {
            orderNumber,
            channelId: dto.channelId ?? null,
            source: dto.source,
            customerId: customer.id,
            status: 'PENDING',
            paymentStatus,
            shipmentStatus: 'NOT_SHIPPED',
            subtotal,
            discount: orderDiscount,
            shippingFee,
            total,
            shippingName,
            shippingPhone,
            shippingAddress,
            notes: dto.notes,
            deliveryMethod: dto.deliveryMethod,
            createdById: actorUserId,
            items: {
              create: lineItems.map((li) => ({
                productId: li.productId,
                productName: li.productName,
                sku: li.sku,
                quantity: li.quantity,
                unitPrice: li.unitPrice,
                discount: li.discount,
                total: li.total,
              })),
            },
          },
          include: { items: true },
        });

        // Reserve stock per item, all-or-nothing within this transaction —
        // if any item is short, the throw below rolls back everything
        // already written above (including the Order/OrderItem rows). Each
        // item still needs its own atomic conditional UPDATE (that's the
        // actual safety mechanism), but the resulting StockMovement rows are
        // batched into one createMany below rather than N separate round
        // trips — every extra sequential query here is real network latency
        // against a remote database, and this transaction has a wall-clock
        // budget (see the timeout passed to runTransaction below).
        const movements: Prisma.StockMovementCreateManyInput[] = [];
        for (const item of order.items) {
          const rows = await tx.$queryRaw<StockRow[]>`
          UPDATE inventory
          SET "reservedStock" = "reservedStock" + ${item.quantity}, "updatedAt" = now()
          WHERE "productId" = ${item.productId}
            AND ("currentStock" - "reservedStock") >= ${item.quantity}
          RETURNING "currentStock"
        `;
          if (rows.length === 0) {
            throw new ConflictException(
              `Insufficient stock for ${item.sku} (${item.productName})`,
            );
          }
          movements.push({
            productId: item.productId,
            type: 'RESERVE',
            quantity: item.quantity,
            balanceAfter: rows[0].currentStock,
            referenceType: 'ORDER',
            referenceId: order.id,
            note: `Reserved for order ${order.orderNumber}`,
            createdById: actorUserId,
          });
        }
        await tx.stockMovement.createMany({ data: movements });

        let payment = null;
        if (advanceAmount > 0) {
          payment = await tx.payment.create({
            data: {
              orderId: order.id,
              method: dto.paymentMethod ?? 'OTHER',
              amount: advanceAmount,
              status: paymentStatus === 'PAID' ? 'PAID' : 'PARTIAL',
              transactionId: dto.transactionId,
              paidAt: new Date(),
            },
          });
        }

        await tx.orderStatusHistory.create({
          data: {
            orderId: order.id,
            fromStatus: null,
            toStatus: 'PENDING',
            note: 'Order created',
            changedById: actorUserId,
          },
        });

        // Assembled from data already in hand rather than a final refetch —
        // one less round trip on the hot path.
        return {
          ...order,
          customer,
          channel,
          payments: payment ? [payment] : [],
        };
      },
      { timeout: 15000, maxWait: 5000 },
    );
  }

  // Content-only edit — customer/shipping info, line items, discount,
  // delivery charge. Mirrors createOrder's pricing/stock logic exactly
  // (same channel-price fallback, same reserve-per-item loop) since it's
  // effectively re-deriving the order from a new item set. Status and
  // payments are untouched here — status has its own endpoint, and a
  // payment is only ever added via recordPayment, never overwritten.
  async updateOrder(
    id: string,
    dto: UpdateOrderDto,
    actorUserId: string | undefined,
    user: JwtPayload,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { items: true, payments: true },
    });
    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }
    await this.assertChannelAccess(user, order.channelId);

    if (!EDITABLE_STATUSES.has(order.status)) {
      throw new BadRequestException(
        `Order ${order.orderNumber} can no longer be edited (status: ${order.status})`,
      );
    }

    const productIds = [...new Set(dto.items.map((i) => i.productId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, deletedAt: null },
    });
    const productMap = new Map(products.map((p) => [p.id, p]));
    for (const item of dto.items) {
      if (!productMap.has(item.productId)) {
        throw new NotFoundException(`Product ${item.productId} not found`);
      }
    }

    const channelPrices = new Map<string, number>();
    if (order.channelId) {
      const overrides = await this.prisma.productChannel.findMany({
        where: { channelId: order.channelId, productId: { in: productIds } },
      });
      for (const o of overrides) {
        channelPrices.set(o.productId, toNumber(o.price));
      }
    }

    const lineItems = dto.items.map((item) => {
      const product = productMap.get(item.productId)!;
      const unitPrice =
        item.unitPrice ??
        channelPrices.get(item.productId) ??
        toNumber(product.basePrice);
      const discount = item.discount ?? 0;
      const total = item.quantity * unitPrice - discount;
      if (total < 0) {
        throw new BadRequestException(
          `Discount exceeds line total for ${product.sku}`,
        );
      }
      return {
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        quantity: item.quantity,
        unitPrice,
        discount,
        total,
      };
    });

    const subtotal = lineItems.reduce((sum, li) => sum + li.total, 0);
    const orderDiscount = dto.discount ?? toNumber(order.discount);
    const shippingFee = dto.shippingFee ?? toNumber(order.shippingFee);
    const total = subtotal - orderDiscount + shippingFee;
    if (total < 0) {
      throw new BadRequestException('Order total cannot be negative');
    }

    // The edit itself never touches payments, but a smaller total after
    // editing (e.g. removing an item) can turn an already-PARTIAL order
    // PAID, or vice versa — so paymentStatus is re-derived against the
    // existing payments rather than left stale.
    const paidSoFar = order.payments
      .filter((p) => p.status !== 'REFUNDED')
      .reduce((sum, p) => sum + toNumber(p.amount), 0);
    const paymentStatus: PaymentStatus =
      paidSoFar <= 0 ? 'UNPAID' : paidSoFar >= total ? 'PAID' : 'PARTIAL';

    return runTransaction(
      this.prisma,
      async (tx) => {
        let customerId = order.customerId;
        if (dto.customerId || dto.customerName || dto.customerPhone) {
          const customer = await this.customersService.resolveCustomer(
            {
              customerId: dto.customerId,
              name: dto.customerName,
              phone: dto.customerPhone,
              email: dto.customerEmail,
            },
            tx,
          );
          customerId = customer.id;
        }

        // Release the OLD reservation, then re-reserve for the NEW item set
        // — both inside this one transaction, so a failed re-reservation
        // rolls back the release too (never left holding neither the old
        // nor the new stock).
        await this.releaseReservation(tx, order, actorUserId);

        await tx.orderItem.deleteMany({ where: { orderId: id } });
        await tx.orderItem.createMany({
          data: lineItems.map((li) => ({
            orderId: id,
            productId: li.productId,
            productName: li.productName,
            sku: li.sku,
            quantity: li.quantity,
            unitPrice: li.unitPrice,
            discount: li.discount,
            total: li.total,
          })),
        });

        const movements: Prisma.StockMovementCreateManyInput[] = [];
        for (const li of lineItems) {
          const rows = await tx.$queryRaw<StockRow[]>`
            UPDATE inventory
            SET "reservedStock" = "reservedStock" + ${li.quantity}, "updatedAt" = now()
            WHERE "productId" = ${li.productId}
              AND ("currentStock" - "reservedStock") >= ${li.quantity}
            RETURNING "currentStock"
          `;
          if (rows.length === 0) {
            throw new ConflictException(
              `Insufficient stock for ${li.sku} (${li.productName})`,
            );
          }
          movements.push({
            productId: li.productId,
            type: 'RESERVE',
            quantity: li.quantity,
            balanceAfter: rows[0].currentStock,
            referenceType: 'ORDER',
            referenceId: id,
            note: `Reserved for order ${order.orderNumber} (edited)`,
            createdById: actorUserId,
          });
        }
        await tx.stockMovement.createMany({ data: movements });

        const updated = await tx.order.update({
          where: { id },
          data: {
            customerId,
            shippingName: dto.customerName ?? order.shippingName,
            shippingPhone: dto.customerPhone ?? order.shippingPhone,
            shippingAddress: dto.shippingAddress ?? order.shippingAddress,
            deliveryMethod: dto.deliveryMethod ?? order.deliveryMethod,
            notes: dto.notes ?? order.notes,
            subtotal,
            discount: orderDiscount,
            shippingFee,
            total,
            paymentStatus,
          },
          include: {
            items: true,
            customer: true,
            channel: true,
            payments: true,
          },
        });

        await tx.auditLog.create({
          data: {
            userId: actorUserId,
            action: 'order.edited',
            entityType: 'Order',
            entityId: id,
            before: {
              subtotal: toNumber(order.subtotal),
              total: toNumber(order.total),
            },
            after: { subtotal, total },
          },
        });

        return updated;
      },
      { timeout: 15000, maxWait: 5000 },
    );
  }

  // Adds a payment against an existing order without touching its items or
  // status — the counterpart to createOrder's initial-advance handling, for
  // money collected after the fact (e.g. a bKash advance sent later, or a
  // COD balance settled on delivery). paymentStatus is re-derived from the
  // running total of every non-refunded payment, not just this one.
  async recordPayment(
    id: string,
    dto: RecordPaymentDto,
    actorUserId: string | undefined,
    user: JwtPayload,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { payments: true },
    });
    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }
    await this.assertChannelAccess(user, order.channelId);

    if (order.status === 'CANCELLED') {
      throw new BadRequestException(
        'Cannot record a payment on a cancelled order',
      );
    }

    const total = toNumber(order.total);
    const paidSoFar = order.payments
      .filter((p) => p.status !== 'REFUNDED')
      .reduce((sum, p) => sum + toNumber(p.amount), 0);
    const newPaidTotal = paidSoFar + dto.amount;
    const paymentStatus: PaymentStatus =
      newPaidTotal <= 0 ? 'UNPAID' : newPaidTotal >= total ? 'PAID' : 'PARTIAL';

    const [, updatedOrder] = await this.prisma.$transaction([
      this.prisma.payment.create({
        data: {
          orderId: id,
          method: dto.method,
          amount: dto.amount,
          status: paymentStatus === 'PAID' ? 'PAID' : 'PARTIAL',
          transactionId: dto.transactionId,
          paidAt: new Date(),
        },
      }),
      this.prisma.order.update({
        where: { id },
        data: { paymentStatus },
        include: { items: true, customer: true, channel: true, payments: true },
      }),
    ]);

    return updatedOrder;
  }

  async updateStatus(
    id: string,
    dto: UpdateOrderStatusDto,
    actorUserId: string | undefined,
    user: JwtPayload,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }
    await this.assertChannelAccess(user, order.channelId);

    const allowed = TRANSITIONS[order.status];
    if (!allowed.includes(dto.status)) {
      throw new BadRequestException(
        `Cannot transition order from ${order.status} to ${dto.status}`,
      );
    }

    return runTransaction(
      this.prisma,
      async (tx) => {
        if (dto.status === 'CANCELLED') {
          await this.releaseReservation(tx, order, actorUserId);
        } else if (dto.status === 'SHIPPED') {
          await this.deductOnShip(tx, order, actorUserId);
        } else if (dto.status === 'RETURNED') {
          await this.restockOnReturn(
            tx,
            order,
            dto.returnAction ?? 'restock',
            actorUserId,
          );
        }

        const shipmentStatus =
          dto.status === 'SHIPPED'
            ? 'SHIPPED'
            : dto.status === 'DELIVERED'
              ? 'DELIVERED'
              : dto.status === 'RETURNED'
                ? 'RETURNED'
                : dto.status === 'LOST'
                  ? 'FAILED'
                  : undefined;

        const updated = await tx.order.update({
          where: { id },
          data: {
            status: dto.status,
            ...(shipmentStatus ? { shipmentStatus } : {}),
          },
          include: { items: true, customer: true, channel: true },
        });

        const note =
          dto.status === 'RETURNED'
            ? [dto.note, `[${dto.returnAction ?? 'restock'}]`]
                .filter(Boolean)
                .join(' ')
            : dto.note;

        await tx.orderStatusHistory.create({
          data: {
            orderId: id,
            fromStatus: order.status,
            toStatus: dto.status,
            note,
            changedById: actorUserId,
          },
        });

        return updated;
      },
      { timeout: 10000, maxWait: 5000 },
    );
  }

  // Independent of Order.status — a plain field update with no state
  // machine (any value can follow any value, ARCHITECTURE.md §17). Never
  // touches status, stock, or the shipment/payment state; logged to the
  // generic AuditLog rather than a dedicated history table so the Order
  // Detail timeline can merge it with OrderStatusHistory by timestamp.
  async updateCustomerResponse(
    id: string,
    dto: UpdateCustomerResponseDto,
    actorUserId: string | undefined,
    user: JwtPayload,
  ) {
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }
    await this.assertChannelAccess(user, order.channelId);

    const [updated] = await this.prisma.$transaction([
      this.prisma.order.update({
        where: { id },
        data: { customerResponse: dto.customerResponse },
      }),
      this.prisma.auditLog.create({
        data: {
          userId: actorUserId,
          action: 'order.customer_response_change',
          entityType: 'Order',
          entityId: id,
          before: { customerResponse: order.customerResponse },
          after: {
            customerResponse: dto.customerResponse,
            note: dto.note ?? null,
          },
        },
      }),
    ]);
    return updated;
  }

  private async releaseReservation(
    tx: Prisma.TransactionClient,
    order: {
      id: string;
      orderNumber: string;
      items: { productId: string; quantity: number; sku: string }[];
    },
    actorUserId?: string,
  ) {
    const movements: Prisma.StockMovementCreateManyInput[] = [];
    for (const item of order.items) {
      const rows = await tx.$queryRaw<StockRow[]>`
        UPDATE inventory
        SET "reservedStock" = "reservedStock" - ${item.quantity}, "updatedAt" = now()
        WHERE "productId" = ${item.productId} AND "reservedStock" >= ${item.quantity}
        RETURNING "currentStock"
      `;
      if (rows.length === 0) {
        throw new ConflictException(
          `Reservation inconsistency releasing stock for ${item.sku}`,
        );
      }
      movements.push({
        productId: item.productId,
        type: 'RELEASE',
        quantity: -item.quantity,
        balanceAfter: rows[0].currentStock,
        referenceType: 'ORDER',
        referenceId: order.id,
        note: `Released — order ${order.orderNumber} cancelled`,
        createdById: actorUserId,
      });
    }
    await tx.stockMovement.createMany({ data: movements });
  }

  private async deductOnShip(
    tx: Prisma.TransactionClient,
    order: {
      id: string;
      orderNumber: string;
      items: {
        productId: string;
        quantity: number;
        sku: string;
        productName: string;
      }[];
    },
    actorUserId?: string,
  ) {
    const movements: Prisma.StockMovementCreateManyInput[] = [];
    for (const item of order.items) {
      const rows = await tx.$queryRaw<StockRow[]>`
        UPDATE inventory
        SET "currentStock" = "currentStock" - ${item.quantity},
            "reservedStock" = "reservedStock" - ${item.quantity},
            "updatedAt" = now()
        WHERE "productId" = ${item.productId}
          AND "currentStock" >= ${item.quantity}
          AND "reservedStock" >= ${item.quantity}
        RETURNING "currentStock"
      `;
      if (rows.length === 0) {
        throw new ConflictException(
          `Cannot ship — insufficient stock/reservation for ${item.sku} (${item.productName})`,
        );
      }
      movements.push({
        productId: item.productId,
        type: 'DEDUCT',
        quantity: -item.quantity,
        balanceAfter: rows[0].currentStock,
        referenceType: 'ORDER',
        referenceId: order.id,
        note: `Shipped — order ${order.orderNumber}`,
        createdById: actorUserId,
      });
    }
    await tx.stockMovement.createMany({ data: movements });
  }

  private async restockOnReturn(
    tx: Prisma.TransactionClient,
    order: {
      id: string;
      orderNumber: string;
      items: { productId: string; quantity: number }[];
    },
    action: 'restock' | 'write_off',
    actorUserId?: string,
  ) {
    // write_off intentionally writes no StockMovement — nothing changed in
    // Inventory, so there's nothing to log in a ledger whose whole purpose
    // is explaining currentStock changes. The write-off itself is recorded
    // on the OrderStatusHistory note instead.
    if (action === 'write_off') return;

    const movements: Prisma.StockMovementCreateManyInput[] = [];
    for (const item of order.items) {
      const rows = await tx.$queryRaw<StockRow[]>`
        UPDATE inventory
        SET "currentStock" = "currentStock" + ${item.quantity}, "updatedAt" = now()
        WHERE "productId" = ${item.productId}
        RETURNING "currentStock"
      `;
      movements.push({
        productId: item.productId,
        type: 'RETURN',
        quantity: item.quantity,
        balanceAfter: rows[0].currentStock,
        referenceType: 'ORDER',
        referenceId: order.id,
        note: `Returned & restocked — order ${order.orderNumber}`,
        createdById: actorUserId,
      });
    }
    await tx.stockMovement.createMany({ data: movements });
  }

  private async generateOrderNumber(
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    const result = await tx.$queryRaw<{ nextval: bigint }[]>`
      SELECT nextval('order_number_seq') as nextval
    `;
    return `OBM-${result[0].nextval.toString()}`;
  }
}
