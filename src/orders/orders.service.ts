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
import { UpdateCheckoutLeadDto } from './dto/update-checkout-lead.dto';
import { CancelCheckoutLeadDto } from './dto/cancel-checkout-lead.dto';

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
  // Reactivating a cancelled order (see reserveReservation below) re-reserves
  // its stock in the same step, so it is never left "pending" with nothing
  // held for it.
  CANCELLED: ['PENDING'],
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

// Human-readable Activity log lines for the audit rows written by this service.
function describeOrderLog(action: string, after: unknown): string {
  const data = (after ?? {}) as { note?: string; customerResponse?: string };
  switch (action) {
    case 'order.note':
      return `Note added: ${data.note ?? ''}`;
    case 'order.customer_response_change':
      return `Customer response changed to ${(data.customerResponse ?? 'none').replaceAll('_', ' ')}`;
    case 'order.web_approved':
      return 'Approved from Web Orders';
    default:
      return action;
  }
}

function describeLeadLog(action: string, after: unknown): string {
  const data = (after ?? {}) as { note?: string; customerResponse?: string; items?: unknown };
  switch (action) {
    case 'order.note':
      return `Note added: ${data.note ?? ''}`;
    case 'checkout_lead.response_change':
      return `Customer response changed to ${(data.customerResponse ?? 'none').replaceAll('_', ' ')}`;
    case 'checkout_lead.update':
      return data.items ? 'Products edited' : 'Details updated';
    case 'checkout_lead.cancel':
      return 'Checkout cancelled';
    default:
      return action;
  }
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
      // The Web Orders page asks for these; the Order List does not.
      includeWebUnapproved?: boolean;
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
        // A website order stays in Web Orders until it is approved.
        ...(filters.includeWebUnapproved
          ? {}
          : { NOT: { source: 'WEBSITE', status: 'PENDING', webApprovedAt: null } }),
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
      // Join loading fetches the relations in the same round trip instead of
      // one extra query per relation.
      relationLoadStrategy: 'join',
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
    const orderIds = orders.map((o) => o.id);
    // The two lookups are independent, so they run together.
    const [customerStats, auditFlags, adminNotes, lastActivity] =
      await Promise.all([
        this.getCustomerStats(customerIds),
        this.getAuditFlags(orderIds, [
          'order.invoice_printed',
          'order.web_approved',
        ]),
        this.getAdminNotes(orderIds),
        this.getLastOrderActivity(orderIds),
      ]);
    return orders.map((o) => {
      const stats = customerStats.get(o.customerId);
      const flags = auditFlags.get(o.id);
      return {
        ...o,
        invoicePrinted: flags?.has('order.invoice_printed') ?? false,
        webApproved: flags?.has('order.web_approved') ?? false,
        adminNotes: adminNotes.get(o.id) ?? [],
        lastUpdate: lastActivity.get(o.id) ?? { at: o.updatedAt, by: null },
        customer: {
          ...o.customer,
          successRate: stats?.successRate ?? null,
          orderCount: stats?.orderCount ?? 0,
        },
      };
    });
  }

  private async getAuditedOrderIds(
    action: string,
    orderIds: string[],
  ): Promise<Set<string>> {
    if (orderIds.length === 0) return new Set();
    const logs = await this.prisma.auditLog.findMany({
      where: {
        action,
        entityType: 'Order',
        entityId: { in: orderIds },
      },
      select: { entityId: true },
      distinct: ['entityId'],
    });
    return new Set(logs.map((l) => l.entityId));
  }

  // Approving a website order keeps it Pending, so it appears in the Order List's
  // Pending tab; the approval itself is recorded in the audit log.
  async approveWebOrder(
    id: string,
    actorUserId: string | undefined,
    user: JwtPayload,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      select: { id: true, status: true, channelId: true },
    });
    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }
    await this.assertChannelAccess(user, order.channelId);
    if (order.status !== 'PENDING') {
      throw new BadRequestException(
        `Only pending orders can be approved (status: ${order.status})`,
      );
    }
    const already = await this.getAuditedOrderIds('order.web_approved', [id]);
    if (already.has(id)) {
      throw new BadRequestException('This order is already approved');
    }
    // Approval is when the order gets its real OBM number, so it appears in
    // the Pending list with the regular sequence.
    const orderNumber = await this.prisma.$transaction(async (tx) => {
      const next = await this.generateOrderNumber(tx);
      await tx.order.update({
        where: { id },
        data: { orderNumber: next, webApprovedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          userId: actorUserId,
          action: 'order.web_approved',
          entityType: 'Order',
          entityId: id,
        },
      });
      return next;
    });
    return { id, webApproved: true, orderNumber };
  }

  // Free-text notes on an order. Stored as audit rows so no schema change is
  // needed; the order's history shows who wrote each note and when.
  async addOrderNote(
    id: string,
    note: string,
    actorUserId: string | undefined,
    user: JwtPayload,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      select: { id: true, channelId: true },
    });
    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }
    await this.assertChannelAccess(user, order.channelId);
    return this.prisma.auditLog.create({
      data: {
        userId: actorUserId,
        action: 'order.note',
        entityType: 'Order',
        entityId: id,
        after: { note },
      },
      select: {
        id: true,
        createdAt: true,
        after: true,
        user: { select: { id: true, name: true } },
      },
    });
  }

  async listOrderNotes(id: string, user: JwtPayload) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      select: { channelId: true },
    });
    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }
    await this.assertChannelAccess(user, order.channelId);
    return this.prisma.auditLog.findMany({
      where: { entityType: 'Order', entityId: id, action: 'order.note' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        createdAt: true,
        after: true,
        user: { select: { id: true, name: true } },
      },
    });
  }

  // Incomplete storefront checkouts (see StorefrontService.saveCheckoutLead),
  // scoped to the user's stores like the order list.
  async listCheckoutLeads(user: JwtPayload) {
    const channelFilter = await this.channelScope.resolveDirectFilter(user);
    const leads = await this.prisma.checkoutLead.findMany({
      where: channelFilter,
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        channelId: true,
        phone: true,
        name: true,
        address: true,
        items: true,
        adminItems: true,
        customerResponse: true,
        cancelledAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    type StoredLeadItem = { productId: string; quantity: number; unitPrice: number };
    const storedItems = (stored: unknown) => (stored ?? []) as StoredLeadItem[];
    const productIds = [
      ...new Set(
        leads.flatMap((l) => [
          ...storedItems(l.items),
          ...storedItems(l.adminItems),
        ]).map((i) => i.productId),
      ),
    ];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true,
        name: true,
        sku: true,
        images: { orderBy: { sortOrder: 'asc' }, take: 1, select: { url: true } },
      },
    });
    const productById = new Map(products.map((p) => [p.id, p]));
    const leadIds = leads.map((l) => l.id);
    const [responseLogs, noteLogs] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: {
          entityType: 'CheckoutLead',
          entityId: { in: leadIds },
          action: { in: ['checkout_lead.response_change', 'checkout_lead.update'] },
        },
        orderBy: { createdAt: 'desc' },
        distinct: ['entityId'],
        select: {
          entityId: true,
          createdAt: true,
          user: { select: { name: true } },
        },
      }),
      this.prisma.auditLog.findMany({
        where: {
          entityType: 'CheckoutLead',
          entityId: { in: leadIds },
          action: 'order.note',
        },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          entityId: true,
          createdAt: true,
          after: true,
          user: { select: { name: true } },
        },
      }),
    ]);
    const notesByLead = new Map<
      string,
      { id: string; note: string; createdAt: Date; user: { name: string } | null }[]
    >();
    for (const n of noteLogs) {
      const list = notesByLead.get(n.entityId) ?? [];
      list.push({
        id: n.id,
        note: (n.after as { note?: string } | null)?.note ?? '',
        createdAt: n.createdAt,
        user: n.user,
      });
      notesByLead.set(n.entityId, list);
    }
    const lastResponse = new Map(
      responseLogs.map((l) => [
        l.entityId,
        { at: l.createdAt, by: l.user?.name ?? null },
      ]),
    );
    return leads.map((lead) => {
      const toLeadItems = (stored: StoredLeadItem[]) =>
        stored.map((i) => {
          const product = productById.get(i.productId);
          return {
            productId: i.productId,
            productName: product?.name ?? 'Unknown product',
            sku: product?.sku ?? '',
            image: product?.images[0]?.url ?? null,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
          };
        });
      const items = toLeadItems(storedItems(lead.items));
      const adminItems = lead.adminItems
        ? toLeadItems(storedItems(lead.adminItems))
        : null;
      const total = items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
      const lastUpdate = lastResponse.get(lead.id) ?? {
        at: lead.updatedAt,
        by: null,
      };
      return {
        ...lead,
        items,
        adminItems,
        total,
        lastUpdate,
        adminNotes: notesByLead.get(lead.id) ?? [],
        cancelled: lead.cancelledAt !== null,
      };
    });
  }

  // Everything logged against an order, newest first: status changes,
  // customer-response changes, notes and web approval.
  async listOrderActivity(id: string, user: JwtPayload) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      select: { channelId: true },
    });
    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }
    await this.assertChannelAccess(user, order.channelId);

    const [logs, statusChanges] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: {
          entityType: 'Order',
          entityId: id,
          action: {
            in: [
              'order.note',
              'order.customer_response_change',
              'order.web_approved',
            ],
          },
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          action: true,
          after: true,
          createdAt: true,
          user: { select: { name: true } },
        },
      }),
      this.prisma.orderStatusHistory.findMany({
        where: { orderId: id },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          toStatus: true,
          createdAt: true,
          changedBy: { select: { name: true } },
          note: true,
        },
      }),
    ]);

    const entries = [
      ...statusChanges.map((h) => ({
        key: `status-${h.id}`,
        at: h.createdAt,
        by: h.changedBy?.name ?? null,
        text: `Order status changed to ${h.toStatus.replaceAll('_', ' ')}`,
        // Lets the frontend give a cancellation its own highlighted card,
        // with the reason/note recorded on the status change itself.
        toStatus: h.toStatus,
        note: h.note,
      })),
      ...logs.map((l) => ({
        key: `log-${l.id}`,
        at: l.createdAt,
        by: l.user?.name ?? null,
        text: describeOrderLog(l.action, l.after),
      })),
    ];
    return entries.sort((a, b) => b.at.getTime() - a.at.getTime());
  }

  // Everything logged against an Incomplete lead, newest first.
  async listCheckoutLeadActivity(leadId: string, user: JwtPayload) {
    await this.assertCheckoutLeadAccess(leadId, user);
    const logs = await this.prisma.auditLog.findMany({
      where: {
        entityType: 'CheckoutLead',
        entityId: leadId,
        action: {
          in: [
            'order.note',
            'checkout_lead.response_change',
            'checkout_lead.update',
            'checkout_lead.cancel',
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        action: true,
        after: true,
        createdAt: true,
        user: { select: { name: true } },
      },
    });
    return logs.map((l) => {
      const data = (l.after ?? {}) as { note?: string };
      return {
        key: `log-${l.id}`,
        at: l.createdAt,
        by: l.user?.name ?? null,
        text: describeLeadLog(l.action, l.after),
        // Lets the frontend give a cancellation the same highlighted card
        // an order's cancellation gets.
        toStatus: l.action === 'checkout_lead.cancel' ? 'CANCELLED' : undefined,
        note: l.action === 'checkout_lead.cancel' ? data.note : undefined,
      };
    });
  }

  // Notes on an Incomplete lead. They move to the order if it is created
  // from the lead (see createOrder).
  async addCheckoutLeadNote(
    leadId: string,
    note: string,
    actorUserId: string | undefined,
    user: JwtPayload,
  ) {
    await this.assertCheckoutLeadAccess(leadId, user);
    return this.prisma.auditLog.create({
      data: {
        userId: actorUserId,
        action: 'order.note',
        entityType: 'CheckoutLead',
        entityId: leadId,
        after: { note },
      },
      select: {
        id: true,
        createdAt: true,
        after: true,
        user: { select: { id: true, name: true } },
      },
    });
  }

  async listCheckoutLeadNotes(leadId: string, user: JwtPayload) {
    await this.assertCheckoutLeadAccess(leadId, user);
    return this.prisma.auditLog.findMany({
      where: { entityType: 'CheckoutLead', entityId: leadId, action: 'order.note' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        createdAt: true,
        after: true,
        user: { select: { id: true, name: true } },
      },
    });
  }

  async updateCheckoutLeadResponse(
    leadId: string,
    dto: UpdateCustomerResponseDto,
    user: JwtPayload,
  ) {
    await this.assertCheckoutLeadAccess(leadId, user);
    const [lead] = await this.prisma.$transaction([
      this.prisma.checkoutLead.update({
        where: { id: leadId },
        // Picking a response is working the lead again, so it leaves the
        // Cancel tab — same as reactivating a cancelled order does.
        data: { customerResponse: dto.customerResponse, cancelledAt: null },
        select: { id: true, customerResponse: true },
      }),
      this.prisma.auditLog.create({
        data: {
          userId: user.sub,
          action: 'checkout_lead.response_change',
          entityType: 'CheckoutLead',
          entityId: leadId,
          after: { customerResponse: dto.customerResponse },
        },
      }),
    ]);
    return lead;
  }

  // Cancels an Incomplete checkout. The lead is kept (not deleted), so it
  // stays visible, now in the Cancel tab.
  async cancelCheckoutLead(
    leadId: string,
    dto: CancelCheckoutLeadDto,
    actorUserId: string | undefined,
    user: JwtPayload,
  ) {
    await this.assertCheckoutLeadAccess(leadId, user);
    const [lead] = await this.prisma.$transaction([
      this.prisma.checkoutLead.update({
        where: { id: leadId },
        data: { cancelledAt: new Date() },
        select: { id: true, cancelledAt: true },
      }),
      this.prisma.auditLog.create({
        data: {
          userId: actorUserId,
          action: 'checkout_lead.cancel',
          entityType: 'CheckoutLead',
          entityId: leadId,
          after: { note: dto.note },
        },
      }),
    ]);
    return lead;
  }

  // Saves the admin's edits to an Incomplete checkout. The customer's own
  // cart (items) is left as it was; the edits are kept separately as adminItems.
  async updateCheckoutLead(
    leadId: string,
    dto: UpdateCheckoutLeadDto,
    user: JwtPayload,
  ) {
    await this.assertCheckoutLeadAccess(leadId, user);
    const lead = await this.prisma.checkoutLead.findUnique({
      where: { id: leadId },
      select: { channelId: true },
    });
    if (!lead) {
      throw new NotFoundException(`Checkout lead ${leadId} not found`);
    }

    let adminItems: { productId: string; quantity: number; unitPrice: number }[] | undefined;
    if (dto.items) {
      const ids = dto.items.map((i) => i.productId);
      const listed = await this.prisma.productChannel.findMany({
        where: { channelId: lead.channelId, productId: { in: ids } },
        select: { productId: true, price: true },
      });
      const priceById = new Map(listed.map((pc) => [pc.productId, toNumber(pc.price)]));
      adminItems = dto.items.map((i) => {
        const price = priceById.get(i.productId);
        if (price === undefined) {
          throw new BadRequestException(
            `Product ${i.productId} is not available on this store`,
          );
        }
        return {
          productId: i.productId,
          quantity: i.quantity,
          unitPrice: i.unitPrice ?? price,
        };
      });
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.checkoutLead.update({
        where: { id: leadId },
        data: {
          name: dto.customerName,
          address: dto.shippingAddress,
          adminItems: adminItems as Prisma.InputJsonValue | undefined,
        },
        select: { id: true, updatedAt: true },
      }),
      this.prisma.auditLog.create({
        data: {
          userId: user.sub,
          action: 'checkout_lead.update',
          entityType: 'CheckoutLead',
          entityId: leadId,
          after: { items: adminItems ?? null },
        },
      }),
    ]);
    return updated;
  }

  private async assertCheckoutLeadAccess(leadId: string, user: JwtPayload) {
    const lead = await this.prisma.checkoutLead.findUnique({
      where: { id: leadId },
      select: { channelId: true },
    });
    if (!lead) {
      throw new NotFoundException(`Checkout lead ${leadId} not found`);
    }
    await this.assertChannelAccess(user, lead.channelId);
  }

  async markInvoicesPrinted(
    orderIds: string[],
    actorUserId: string | undefined,
    user: JwtPayload,
  ) {
    const orders = await this.prisma.order.findMany({
      where: { id: { in: orderIds } },
      select: { id: true, channelId: true },
    });
    for (const order of orders) {
      await this.assertChannelAccess(user, order.channelId);
    }
    await this.prisma.auditLog.createMany({
      data: orders.map((o) => ({
        userId: actorUserId,
        action: 'order.invoice_printed',
        entityType: 'Order',
        entityId: o.id,
      })),
    });
    return { marked: orders.length };
  }

  // One grouped query gives both figures the order list shows per customer:
  // total orders, and delivery success rate. CANCELLED/LOST are left out of
  // the rate on both sides, since those never had a real chance to be delivered,
  // so counting them would understate an otherwise-reliable customer.
  private async getCustomerStats(
    customerIds: string[],
  ): Promise<Map<string, { successRate: number | null; orderCount: number }>> {
    const stats = new Map<
      string,
      { successRate: number | null; orderCount: number }
    >();
    const uniqueIds = [...new Set(customerIds)];
    if (uniqueIds.length === 0) return stats;

    const grouped = await this.prisma.order.groupBy({
      by: ['customerId', 'status'],
      where: { customerId: { in: uniqueIds } },
      _count: true,
    });

    const totals = new Map<
      string,
      { total: number; eligible: number; delivered: number }
    >();
    for (const row of grouped) {
      const entry = totals.get(row.customerId) ?? {
        total: 0,
        eligible: 0,
        delivered: 0,
      };
      entry.total += row._count;
      if (row.status !== 'CANCELLED' && row.status !== 'LOST') {
        entry.eligible += row._count;
        if (row.status === 'DELIVERED') entry.delivered += row._count;
      }
      totals.set(row.customerId, entry);
    }

    for (const [customerId, t] of totals) {
      stats.set(customerId, {
        successRate:
          t.eligible > 0 ? Math.round((t.delivered / t.eligible) * 100) : null,
        orderCount: t.total,
      });
    }
    return stats;
  }

  // The latest change to each order (status, customer response, note or
  // approval) and who made it. Orders with no logged change fall back to
  // their own updatedAt in the caller.
  private async getLastOrderActivity(orderIds: string[]) {
    const last = new Map<string, { at: Date; by: string | null }>();
    if (orderIds.length === 0) return last;

    const [audits, statusChanges] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: {
          entityType: 'Order',
          entityId: { in: orderIds },
          action: {
            in: [
              'order.note',
              'order.customer_response_change',
              'order.web_approved',
            ],
          },
        },
        orderBy: { createdAt: 'desc' },
        distinct: ['entityId'],
        select: {
          entityId: true,
          createdAt: true,
          user: { select: { name: true } },
        },
      }),
      this.prisma.orderStatusHistory.findMany({
        where: { orderId: { in: orderIds } },
        orderBy: { createdAt: 'desc' },
        distinct: ['orderId'],
        select: {
          orderId: true,
          createdAt: true,
          changedBy: { select: { name: true } },
        },
      }),
    ]);

    const consider = (id: string, at: Date, by: string | null) => {
      const current = last.get(id);
      if (!current || at > current.at) last.set(id, { at, by });
    };
    for (const a of audits) consider(a.entityId, a.createdAt, a.user?.name ?? null);
    for (const c of statusChanges)
      consider(c.orderId, c.createdAt, c.changedBy?.name ?? null);
    return last;
  }

  // Notes added from Order actions, grouped by order, oldest first.
  private async getAdminNotes(orderIds: string[]) {
    const notes = new Map<
      string,
      { id: string; note: string; createdAt: Date; user: { name: string } | null }[]
    >();
    if (orderIds.length === 0) return notes;

    const logs = await this.prisma.auditLog.findMany({
      where: {
        action: 'order.note',
        entityType: 'Order',
        entityId: { in: orderIds },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        entityId: true,
        createdAt: true,
        after: true,
        user: { select: { name: true } },
      },
    });
    for (const log of logs) {
      const note = (log.after as { note?: string } | null)?.note ?? '';
      const list = notes.get(log.entityId) ?? [];
      list.push({ id: log.id, note, createdAt: log.createdAt, user: log.user });
      notes.set(log.entityId, list);
    }
    return notes;
  }

  // Which of the given orders carry each audit action, in one query.
  private async getAuditFlags(
    orderIds: string[],
    actions: string[],
  ): Promise<Map<string, Set<string>>> {
    const flags = new Map<string, Set<string>>();
    if (orderIds.length === 0) return flags;

    const logs = await this.prisma.auditLog.findMany({
      where: {
        action: { in: actions },
        entityType: 'Order',
        entityId: { in: orderIds },
      },
      select: { entityId: true, action: true },
      distinct: ['entityId', 'action'],
    });
    for (const log of logs) {
      const set = flags.get(log.entityId) ?? new Set<string>();
      set.add(log.action);
      flags.set(log.entityId, set);
    }
    return flags;
  }

  async findOne(id: string, user: JwtPayload) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      relationLoadStrategy: 'join',
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

    const [timeline, auditFlags] = await Promise.all([
      this.buildTimeline(order.id, order.statusHistory),
      this.getAuditFlags(
        [order.id],
        ['order.web_approved', 'order.created_from_lead'],
      ),
    ]);
    const flags = auditFlags.get(order.id);
    return {
      ...order,
      timeline,
      webApproved: flags?.has('order.web_approved') ?? false,
      createdFromLead: flags?.has('order.created_from_lead') ?? false,
    };
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

        // Web orders get a temporary WEB- number; the OBM number is assigned
        // when the order is approved (see approveWebOrder).
        const orderNumber =
          dto.source === 'WEBSITE'
            ? await this.generateWebOrderNumber(tx)
            : await this.generateOrderNumber(tx);

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

        // Turning a lead into an order: the lead is removed here, so a second
        // submit of the same lead fails and rolls this whole order back.
        if (dto.checkoutLeadId) {
          const lead = await tx.checkoutLead.findFirst({
            where: { id: dto.checkoutLeadId, channelId: dto.channelId },
            select: { customerResponse: true },
          });
          if (!lead) {
            throw new ConflictException(
              'This checkout is no longer incomplete',
            );
          }
          await tx.checkoutLead.delete({ where: { id: dto.checkoutLeadId } });
          if (lead.customerResponse) {
            await tx.order.update({
              where: { id: order.id },
              data: { customerResponse: lead.customerResponse },
            });
          }
          await tx.auditLog.updateMany({
            where: { entityType: 'CheckoutLead', entityId: dto.checkoutLeadId },
            data: { entityType: 'Order', entityId: order.id },
          });
          // Records where the order first came from: an Incomplete lead.
          await tx.auditLog.create({
            data: {
              userId: actorUserId,
              action: 'order.created_from_lead',
              entityType: 'Order',
              entityId: order.id,
            },
          });
        }

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
        } else if (dto.status === 'PENDING' && order.status === 'CANCELLED') {
          // Reactivating: nothing has been held for this order since it was
          // cancelled, so it needs a fresh reservation, exactly like a new
          // order — same availability check, so this still fails cleanly if
          // the stock has since gone to someone else.
          await this.reserveReservation(tx, order, actorUserId);
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

  private async reserveReservation(
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
        SET "reservedStock" = "reservedStock" + ${item.quantity}, "updatedAt" = now()
        WHERE "productId" = ${item.productId}
          AND ("currentStock" - "reservedStock") >= ${item.quantity}
        RETURNING "currentStock"
      `;
      if (rows.length === 0) {
        throw new ConflictException(
          `Insufficient stock to reactivate ${item.sku}`,
        );
      }
      movements.push({
        productId: item.productId,
        type: 'RESERVE',
        quantity: item.quantity,
        balanceAfter: rows[0].currentStock,
        referenceType: 'ORDER',
        referenceId: order.id,
        note: `Reserved — order ${order.orderNumber} reactivated`,
        createdById: actorUserId,
      });
    }
    await tx.stockMovement.createMany({ data: movements });
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

  private async generateWebOrderNumber(
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    const result = await tx.$queryRaw<{ nextval: bigint }[]>`
      SELECT nextval('web_order_number_seq') as nextval
    `;
    return `WEB-${result[0].nextval.toString()}`;
  }
}
