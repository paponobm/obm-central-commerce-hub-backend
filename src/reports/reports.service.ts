import { Injectable } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { toNumber } from '../common/decimal.util';
import { ChannelScopeService } from '../common/channel-scope/channel-scope.service';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import {
  BUSINESS_TIMEZONE,
  businessToday,
  resolveDateRange,
} from '../common/business-date.util';

const ALL_STATUSES: OrderStatus[] = [
  'PENDING',
  'CONFIRMED',
  'PROCESSING',
  'READY_TO_SHIP',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
  'RETURNED',
];

export type SalesPeriodUnit = 'day' | 'week' | 'month';
export type TopProductsSortBy = 'quantity' | 'revenue';

interface TodayRow {
  orderCount: bigint;
  salesTotal: string | null;
}

interface DailySalesRow {
  day: Date;
  orderCount: bigint;
  salesTotal: string | null;
}

interface PeriodSalesRow {
  period: Date;
  orderCount: bigint;
  salesTotal: string | null;
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryService: InventoryService,
    private readonly channelScope: ChannelScopeService,
  ) {}

  // Every report is order- or product-driven, so scoping comes down to two
  // shapes: a Prisma `where` fragment for orders (channelId column exists
  // directly), and a raw-SQL fragment for the two $queryRaw dashboard
  // queries that can't take a Prisma where object — both derived from the
  // one `ChannelScopeService.resolveDirectFilter()` resolution (the same
  // resolver Orders/Channels use) so a requested `channelId` (the Store
  // Selector narrowing to one specific store) and the "all my assigned
  // stores" default can never drift out of sync between endpoints.
  private async orderWhereFilter(
    user: JwtPayload,
    requestedChannelId?: string,
  ): Promise<Prisma.OrderWhereInput> {
    return this.channelScope.resolveDirectFilter(user, requestedChannelId);
  }

  private async orderChannelSqlFragment(
    user: JwtPayload,
    requestedChannelId?: string,
  ): Promise<Prisma.Sql> {
    const resolved = await this.channelScope.resolveDirectFilter(
      user,
      requestedChannelId,
    );
    if (!resolved.channelId) return Prisma.empty;
    if (typeof resolved.channelId === 'string') {
      return Prisma.sql`AND "channelId" = ${resolved.channelId}`;
    }
    // Empty set must exclude every row, not match every row — an
    // unassigned/zero-channel restricted user must see zero orders here,
    // same fail-closed rule as everywhere else channel scope applies.
    return Prisma.sql`AND "channelId" = ANY(${resolved.channelId.in})`;
  }

  // Stock valuation has no channelId column (inventory is centralized) —
  // scoping goes through the same EXISTS(ProductChannel) rule Products/
  // Customers use elsewhere (ARCHITECTURE.md §16), not a direct column.
  private async productWhereFilter(
    user: JwtPayload,
    requestedChannelId?: string,
  ): Promise<Prisma.ProductWhereInput> {
    const resolved = await this.channelScope.resolveDirectFilter(
      user,
      requestedChannelId,
    );
    if (!resolved.channelId) return {};
    const channelFilter =
      typeof resolved.channelId === 'string'
        ? resolved.channelId
        : { in: resolved.channelId.in };
    return {
      channels: { some: { channelId: channelFilter, isPublished: true } },
    };
  }

  // Every query here either hits an indexed column (createdAt, status,
  // channelId — see schema) or scans a small, bounded result set (recent
  // orders, low stock). At real scale this is the first thing worth
  // moving to a materialized view refreshed on a schedule rather than
  // computed live on every dashboard load — not needed at current volume.
  async getDashboard(user: JwtPayload, channelId?: string) {
    const [orderWhere, channelSql] = await Promise.all([
      this.orderWhereFilter(user, channelId),
      this.orderChannelSqlFragment(user, channelId),
    ]);

    const [
      todayRows,
      statusGroups,
      channelGroups,
      channels,
      sourceGroups,
      lowStock,
      recentOrders,
      dailySales,
    ] = await Promise.all([
      this.prisma.$queryRaw<TodayRow[]>`
        SELECT COUNT(*) as "orderCount", SUM(total) as "salesTotal"
        FROM orders
        WHERE status != 'CANCELLED'
          AND ("createdAt" AT TIME ZONE ${BUSINESS_TIMEZONE})::date
              = (now() AT TIME ZONE ${BUSINESS_TIMEZONE})::date
          ${channelSql}
      `,
      this.prisma.order.groupBy({
        by: ['status'],
        where: orderWhere,
        _count: true,
      }),
      this.prisma.order.groupBy({
        by: ['channelId'],
        where: orderWhere,
        _count: true,
        _sum: { total: true },
      }),
      this.prisma.channel.findMany({ select: { id: true, name: true } }),
      this.prisma.order.groupBy({
        by: ['source'],
        where: orderWhere,
        _count: true,
        _sum: { total: true },
      }),
      this.inventoryService.findAll({ lowStockOnly: true }),
      this.prisma.order.findMany({
        where: orderWhere,
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: { select: { name: true } },
          channel: { select: { name: true } },
        },
      }),
      this.prisma.$queryRaw<DailySalesRow[]>`
        SELECT (("createdAt" AT TIME ZONE ${BUSINESS_TIMEZONE})::date) as day,
               COUNT(*) as "orderCount",
               SUM(total) as "salesTotal"
        FROM orders
        WHERE status != 'CANCELLED'
          AND ("createdAt" AT TIME ZONE ${BUSINESS_TIMEZONE})
              >= (now() AT TIME ZONE ${BUSINESS_TIMEZONE})::date - interval '6 days'
          ${channelSql}
        GROUP BY day
        ORDER BY day ASC
      `,
    ]);

    const channelNameById = new Map(channels.map((c) => [c.id, c.name]));
    const todayRow = todayRows[0];

    return {
      today: {
        orderCount: Number(todayRow?.orderCount ?? 0),
        salesTotal: Number(todayRow?.salesTotal ?? 0),
      },
      ordersByStatus: this.fillStatusCounts(statusGroups),
      ordersByChannel: channelGroups
        .map((g) => ({
          channelId: g.channelId,
          channelName: g.channelId
            ? (channelNameById.get(g.channelId) ?? 'Unknown channel')
            : 'No channel (manual)',
          orderCount: g._count,
          salesTotal: toNumber(g._sum.total),
        }))
        .sort((a, b) => b.orderCount - a.orderCount),
      ordersBySource: sourceGroups
        .map((g) => ({
          source: g.source,
          orderCount: g._count,
          salesTotal: toNumber(g._sum.total),
        }))
        .sort((a, b) => b.orderCount - a.orderCount),
      lowStock: {
        count: lowStock.length,
        products: lowStock.slice(0, 10),
      },
      recentOrders: recentOrders.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        paymentStatus: o.paymentStatus,
        total: toNumber(o.total),
        customerName: o.customer?.name ?? null,
        channelName: o.channel?.name ?? 'No channel (manual)',
        source: o.source,
        createdAt: o.createdAt,
      })),
      salesLast7Days: this.fillDailySales(dailySales),
    };
  }

  // Revenue by channel over an arbitrary date range (business-timezone
  // aware — see common/business-date.util.ts). Distinct from the
  // dashboard's ordersByChannel, which intentionally includes cancelled
  // orders for activity visibility; this is a sales/revenue report, so
  // cancelled orders are excluded here, same as "today's sales".
  async getSalesByChannel(
    user: JwtPayload,
    from?: string,
    to?: string,
    channelId?: string,
  ) {
    const range = resolveDateRange(from, to);
    const orderWhere = await this.orderWhereFilter(user, channelId);
    const [groups, channels] = await Promise.all([
      this.prisma.order.groupBy({
        by: ['channelId'],
        where: {
          ...orderWhere,
          status: { not: 'CANCELLED' },
          createdAt: { gte: range.gte, lte: range.lte },
        },
        _count: true,
        _sum: { total: true },
      }),
      this.prisma.channel.findMany({ select: { id: true, name: true } }),
    ]);
    const channelNameById = new Map(channels.map((c) => [c.id, c.name]));

    return {
      range: { from: range.gte.toISOString(), to: range.lte.toISOString() },
      channels: groups
        .map((g) => ({
          channelId: g.channelId,
          channelName: g.channelId
            ? (channelNameById.get(g.channelId) ?? 'Unknown channel')
            : 'No channel (manual)',
          orderCount: g._count,
          salesTotal: toNumber(g._sum.total),
        }))
        .sort((a, b) => b.salesTotal - a.salesTotal),
    };
  }

  // Sales bucketed into day/week/month periods over an arbitrary range —
  // the flexible counterpart to the dashboard's fixed last-7-days trend.
  // date_trunc does the calendar-period bucketing in Postgres (correct
  // week/month boundaries are genuinely fiddly to replicate correctly in
  // JS); AT TIME ZONE keeps those boundaries Dhaka-local.
  async getSalesByPeriod(
    user: JwtPayload,
    from?: string,
    to?: string,
    groupBy: SalesPeriodUnit = 'day',
    channelId?: string,
  ) {
    const range = resolveDateRange(from, to);
    const channelSql = await this.orderChannelSqlFragment(user, channelId);
    const rows = await this.prisma.$queryRaw<PeriodSalesRow[]>`
      SELECT date_trunc(${groupBy}, "createdAt" AT TIME ZONE ${BUSINESS_TIMEZONE}) as period,
             COUNT(*) as "orderCount",
             SUM(total) as "salesTotal"
      FROM orders
      WHERE status != 'CANCELLED'
        AND "createdAt" >= ${range.gte} AND "createdAt" <= ${range.lte}
        ${channelSql}
      GROUP BY period
      ORDER BY period ASC
    `;

    return {
      range: { from: range.gte.toISOString(), to: range.lte.toISOString() },
      groupBy,
      periods: rows.map((r) => ({
        period: r.period.toISOString().slice(0, 10),
        orderCount: Number(r.orderCount),
        salesTotal: Number(r.salesTotal ?? 0),
      })),
    };
  }

  // Best-selling products by quantity or revenue over a date range.
  async getTopProducts(
    user: JwtPayload,
    from?: string,
    to?: string,
    limit = 10,
    sortBy: TopProductsSortBy = 'revenue',
    channelId?: string,
  ) {
    const range = resolveDateRange(from, to);
    const orderWhere = await this.orderWhereFilter(user, channelId);
    const rows = await this.prisma.orderItem.groupBy({
      by: ['productId'],
      where: {
        order: {
          ...orderWhere,
          status: { not: 'CANCELLED' },
          createdAt: { gte: range.gte, lte: range.lte },
        },
      },
      _sum: { quantity: true, total: true },
      orderBy:
        sortBy === 'quantity'
          ? { _sum: { quantity: 'desc' } }
          : { _sum: { total: 'desc' } },
      take: limit,
    });

    const products = await this.prisma.product.findMany({
      where: { id: { in: rows.map((r) => r.productId) } },
      select: { id: true, sku: true, name: true },
    });
    const productById = new Map(products.map((p) => [p.id, p]));

    return {
      range: { from: range.gte.toISOString(), to: range.lte.toISOString() },
      sortBy,
      products: rows.map((r) => ({
        productId: r.productId,
        sku: productById.get(r.productId)?.sku ?? null,
        name: productById.get(r.productId)?.name ?? 'Unknown product',
        quantitySold: r._sum.quantity ?? 0,
        revenue: toNumber(r._sum.total),
      })),
    };
  }

  // currentStock × costPrice per product — "how much money is sitting on
  // the shelves right now." A point-in-time snapshot, not date-ranged.
  async getStockValuation(user: JwtPayload, channelId?: string) {
    const productWhere = await this.productWhereFilter(user, channelId);
    const products = await this.prisma.product.findMany({
      where: { deletedAt: null, ...productWhere },
      include: { inventory: true },
    });

    const items = products
      .map((p) => {
        const currentStock = p.inventory?.currentStock ?? 0;
        const costPrice = toNumber(p.costPrice);
        return {
          productId: p.id,
          sku: p.sku,
          name: p.name,
          currentStock,
          costPrice,
          value: currentStock * costPrice,
        };
      })
      .sort((a, b) => b.value - a.value);

    return {
      asOf: new Date().toISOString(),
      totalValue: items.reduce((sum, i) => sum + i.value, 0),
      itemCount: items.length,
      items,
    };
  }

  private fillStatusCounts(
    groups: { status: OrderStatus; _count: number }[],
  ): Record<OrderStatus, number> {
    const counts = Object.fromEntries(
      ALL_STATUSES.map((s) => [s, 0]),
    ) as Record<OrderStatus, number>;
    for (const g of groups) {
      counts[g.status] = g._count;
    }
    return counts;
  }

  // Backfills days with zero orders so the response is always exactly 7
  // consecutive dates — a frontend chart shouldn't have to guess about
  // gaps. `day` comes back from Postgres as a plain `date` (no time
  // component, already Dhaka-local per the query above), so
  // toISOString().slice(0,10) is safe here — there's no timezone left to
  // shift it.
  private fillDailySales(rows: DailySalesRow[]) {
    const byDate = new Map(
      rows.map((r) => [
        r.day.toISOString().slice(0, 10),
        {
          orderCount: Number(r.orderCount),
          salesTotal: Number(r.salesTotal ?? 0),
        },
      ]),
    );

    const todayKey = businessToday();
    const result: { date: string; orderCount: number; salesTotal: number }[] =
      [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(`${todayKey}T00:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() - i);
      const key = d.toISOString().slice(0, 10);
      const found = byDate.get(key);
      result.push({
        date: key,
        orderCount: found?.orderCount ?? 0,
        salesTotal: found?.salesTotal ?? 0,
      });
    }
    return result;
  }
}
