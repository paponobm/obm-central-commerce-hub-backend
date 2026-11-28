import { Injectable } from '@nestjs/common';
import { Channel } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TrackEventDto } from './dto/track-event.dto';
import { resolveDateRange } from '../common/business-date.util';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  // Public, unauthenticated, called from every page view/search/add-to-cart
  // on either storefront. Never throws back a validation shape the caller
  // would need to handle — the storefront fires this and moves on.
  async record(channel: Channel, dto: TrackEventDto) {
    await this.prisma.analyticsEvent.create({
      data: {
        channelId: channel.id,
        type: dto.type,
        path: dto.path,
        productId: dto.productId,
        searchQuery: dto.searchQuery,
        sessionId: dto.sessionId,
        referrer: dto.referrer,
        utmSource: dto.utmSource,
        utmMedium: dto.utmMedium,
        utmCampaign: dto.utmCampaign,
      },
    });
    return { success: true };
  }

  // Central — every storefront's traffic in one place, optionally narrowed
  // to one via channelId (same "All Stores vs one store" shape as the rest
  // of the admin). from/to default to the trailing 30 days.
  async getOverview(filters: { channelId?: string; from?: string; to?: string }) {
    // Plain `new Date("2026-11-28")` parses as UTC midnight — for a same-day
    // range (from === to, e.g. "Today") that made `lte` cut off at the very
    // start of the day, before any event that day could match. Shared
    // business-day helper gives a real end-of-day bound instead.
    const { gte, lte } = resolveDateRange(filters.from, filters.to);
    const where = {
      createdAt: { gte, lte },
      ...(filters.channelId ? { channelId: filters.channelId } : {}),
    };

    const [
      totalPageViews,
      uniqueSessionRows,
      topPaths,
      topSearches,
      topReferrers,
      topUtmSources,
    ] = await Promise.all([
      this.prisma.analyticsEvent.count({
        where: { ...where, type: { in: ['PAGE_VIEW', 'PRODUCT_VIEW'] } },
      }),
      this.prisma.analyticsEvent.findMany({
        where,
        distinct: ['sessionId'],
        select: { sessionId: true },
      }),
      this.prisma.analyticsEvent.groupBy({
        by: ['path'],
        where: { ...where, type: { in: ['PAGE_VIEW', 'PRODUCT_VIEW'] } },
        _count: { _all: true },
        orderBy: { _count: { path: 'desc' } },
        take: 10,
      }),
      this.prisma.analyticsEvent.groupBy({
        by: ['searchQuery'],
        where: { ...where, type: 'SEARCH', searchQuery: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { searchQuery: 'desc' } },
        take: 10,
      }),
      this.prisma.analyticsEvent.groupBy({
        by: ['referrer'],
        where: {
          ...where,
          type: { in: ['PAGE_VIEW', 'PRODUCT_VIEW'] },
          // Direct traffic (no referrer) is reported as its own "Direct"
          // bucket below, not mixed into this grouped list.
          referrer: { not: null },
        },
        _count: { _all: true },
        orderBy: { _count: { referrer: 'desc' } },
        take: 10,
      }),
      this.prisma.analyticsEvent.groupBy({
        by: ['utmSource'],
        where: { ...where, utmSource: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { utmSource: 'desc' } },
        take: 10,
      }),
    ]);

    const directCount = await this.prisma.analyticsEvent.count({
      where: {
        ...where,
        type: { in: ['PAGE_VIEW', 'PRODUCT_VIEW'] },
        referrer: null,
      },
    });

    return {
      range: { from: gte.toISOString(), to: lte.toISOString() },
      totalPageViews,
      uniqueVisitors: uniqueSessionRows.length,
      topPaths: topPaths.map((p) => ({ path: p.path, count: p._count._all })),
      topSearches: topSearches.map((s) => ({
        query: s.searchQuery as string,
        count: s._count._all,
      })),
      // "Direct" is its own row — a referrer of null isn't absence of data,
      // it's the real, common case of someone typing the URL or using a
      // bookmark/app, and deserves to be seen as its own number rather than
      // silently dropped from the list.
      topReferrers: [
        ...(directCount > 0 ? [{ referrer: 'Direct', count: directCount }] : []),
        ...topReferrers.map((r) => ({ referrer: r.referrer as string, count: r._count._all })),
      ],
      topUtmSources: topUtmSources.map((u) => ({
        source: u.utmSource as string,
        count: u._count._all,
      })),
    };
  }

  // One product's own view count over time — feeds the Performance card's
  // "Page views" slot (see products/[id]/orders/page.tsx). Daily buckets,
  // same trailing-30-days default as the central overview.
  async getProductAnalytics(productId: string, filters: { from?: string; to?: string }) {
    const { gte: from, lte: to } = resolveDateRange(filters.from, filters.to);

    const [totalViews, uniqueSessionRows, rows] = await Promise.all([
      this.prisma.analyticsEvent.count({
        where: { productId, type: 'PRODUCT_VIEW', createdAt: { gte: from, lte: to } },
      }),
      this.prisma.analyticsEvent.findMany({
        where: { productId, type: 'PRODUCT_VIEW', createdAt: { gte: from, lte: to } },
        distinct: ['sessionId'],
        select: { sessionId: true },
      }),
      this.prisma.$queryRaw<{ day: Date; count: bigint }[]>`
        SELECT date_trunc('day', "createdAt") AS day, count(*)::bigint AS count
        FROM analytics_events
        WHERE "productId" = ${productId}
          AND "type" = 'PRODUCT_VIEW'
          AND "createdAt" BETWEEN ${from} AND ${to}
        GROUP BY day
        ORDER BY day ASC
      `,
    ]);

    return {
      range: { from: from.toISOString(), to: to.toISOString() },
      totalViews,
      uniqueVisitors: uniqueSessionRows.length,
      byDay: rows.map((r) => ({ day: r.day.toISOString().slice(0, 10), count: Number(r.count) })),
    };
  }
}
