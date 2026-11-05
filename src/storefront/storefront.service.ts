import { Injectable, NotFoundException } from '@nestjs/common';
import { Channel, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from '../orders/orders.service';
import { toNumber } from '../common/decimal.util';
import { StorefrontCreateOrderDto } from './dto/storefront-create-order.dto';
import { StorefrontCheckoutLeadDto } from './dto/storefront-checkout-lead.dto';

// Join loading: the product, its images, category, brand and stock come back
// in one round trip instead of one query per relation.
const productChannelWithProduct =
  Prisma.validator<Prisma.ProductChannelDefaultArgs>()({
    include: {
      product: {
        include: {
          images: { orderBy: { sortOrder: 'asc' } },
          category: true,
          brand: true,
          inventory: true,
          // Extra categories (on top of the single `category` above) — lets
          // a product show up under more than one storefront category page.
          categories: { include: { category: true } },
          // Only for the Flash Deal card's "৳min–৳max" range on variant
          // products — negligible extra cost on a single-product join.
          variants: { where: { deletedAt: null, isActive: true } },
        },
      },
    },
  });

type ProductChannelWithProduct = Prisma.ProductChannelGetPayload<
  typeof productChannelWithProduct
>;

@Injectable()
export class StorefrontService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ordersService: OrdersService,
  ) {}

  // Public-safe subset of the channel row — never the full record (no
  // domain/soft-delete internals leaking to an unauthenticated storefront
  // request). themeConfig itself is internal shape; only known, validated
  // sub-keys are ever surfaced, and only when their own enabled flag is set.
  getConfig(channel: Channel) {
    type RawCoupon = { enabled: boolean; label: string; code: string };
    // Older saves stored trustBadges as plain strings (fixed 4 slots, no
    // icon choice) or objects without an `enabled` flag yet; normalized
    // below so a channel saved before an upgrade still renders correctly
    // until it's saved again. Missing `enabled` defaults to on, matching
    // pre-toggle behavior.
    type RawTrustBadge =
      string | { text?: string; icon?: string; enabled?: boolean };
    const DEFAULT_ICONS = ['shield', 'cash', 'truck', 'clock'];
    type RawComboTier = {
      title?: string;
      description?: string;
      enabled?: boolean;
    };
    type RawComboBanner = {
      newBadge?: boolean;
      title?: string;
      description?: string;
      tiers?: RawComboTier[];
      enabled?: boolean;
    };
    const theme = channel.themeConfig as {
      heroCoupon?: RawCoupon;
      heroSlides?: {
        image: string;
        title?: string;
        description?: string;
        coupon?: RawCoupon;
      }[];
      trustBadges?: RawTrustBadge[];
      comboBanners?: RawComboBanner[];
    } | null;

    const toPublicCoupon = (c?: RawCoupon) =>
      c?.enabled ? { label: c.label, code: c.code } : null;

    const trustBadges = (theme?.trustBadges ?? [])
      .map((b, i) =>
        typeof b === 'string'
          ? {
              text: b,
              icon: DEFAULT_ICONS[i % DEFAULT_ICONS.length],
              enabled: true,
            }
          : {
              text: b.text ?? '',
              icon: b.icon ?? DEFAULT_ICONS[i % DEFAULT_ICONS.length],
              enabled: b.enabled ?? true,
            },
      )
      // Off badges never reach the storefront at all.
      .filter((b) => b.text.trim() && b.enabled)
      .map((b) => ({ text: b.text, icon: b.icon }));

    // No hardcoded fallback — empty/omitted means no banner renders at all,
    // same honesty rule as trustBadges. Up to 2 (enforced on write by the
    // DTO; capped again here defensively).
    // Off combos never reach the storefront at all — missing `enabled`
    // defaults to on, matching pre-toggle behavior.
    const comboBanners = (theme?.comboBanners ?? [])
      .filter((c) => c.title?.trim() && (c.enabled ?? true))
      .slice(0, 2)
      .map((c) => ({
        newBadge: c.newBadge ?? false,
        title: c.title ?? '',
        description: c.description ?? '',
        tiers: (c.tiers ?? [])
          .filter((t) => t.enabled && t.title?.trim())
          .map((t) => ({
            title: t.title ?? '',
            description: t.description ?? '',
          })),
      }));

    return {
      name: channel.name,
      logoUrl: channel.logoUrl,
      heroCoupon: toPublicCoupon(theme?.heroCoupon),
      heroSlides: (theme?.heroSlides ?? []).map((s) => ({
        image: s.image,
        title: s.title || undefined,
        description: s.description || undefined,
        coupon: toPublicCoupon(s.coupon),
      })),
      trustBadges,
      comboBanners,
    };
  }

  // Categories are a shared, global taxonomy in this schema (not
  // channel-scoped) — every storefront sees the same category tree, filtered
  // to published ones via the admin's publish toggle. On top of that, a
  // channel can optionally curate its own subset via
  // themeConfig.categorySlugs (set from that channel's Settings page) —
  // omitted/empty means no restriction, so channels that have never touched
  // this (e.g. Online Burmese Market) keep seeing every published category.
  async getCategories(channel: Channel) {
    const theme = channel.themeConfig as { categorySlugs?: string[] } | null;
    const slugs = theme?.categorySlugs;
    const categories = await this.prisma.category.findMany({
      where: {
        deletedAt: null,
        isPublished: true,
        ...(slugs && slugs.length > 0 ? { slug: { in: slugs } } : {}),
      },
      select: {
        id: true,
        name: true,
        slug: true,
        parentId: true,
        imageUrl: true,
      },
      orderBy: { name: 'asc' },
    });
    if (slugs && slugs.length > 0) {
      // Once a channel has explicitly ordered its categories (Settings →
      // Badge & Category, drag/reorder), that order — not the alphabetical
      // default — is what the storefront's category grid shows.
      const order = new Map(slugs.map((s, i) => [s, i]));
      categories.sort(
        (a, b) => (order.get(a.slug) ?? 0) - (order.get(b.slug) ?? 0),
      );
    }
    return categories;
  }

  async getProducts(
    channelId: string,
    filters: {
      categoryId?: string;
      search?: string;
      featured?: boolean;
      page?: number;
      limit?: number;
    },
  ) {
    const page = filters.page && filters.page > 0 ? filters.page : 1;
    const limit =
      filters.limit && filters.limit > 0 && filters.limit <= 100
        ? filters.limit
        : 20;

    const where: Prisma.ProductChannelWhereInput = {
      channelId,
      isPublished: true,
      ...(filters.featured !== undefined
        ? { isFeatured: filters.featured }
        : {}),
      product: {
        isActive: true,
        deletedAt: null,
        // A product matches a category page either via its single primary
        // categoryId, or via the extra ProductCategory tags set in the
        // admin's Publishing tab.
        ...(filters.categoryId
          ? {
              OR: [
                { categoryId: filters.categoryId },
                { categories: { some: { categoryId: filters.categoryId } } },
              ],
            }
          : {}),
      },
      ...(filters.search
        ? {
            OR: [
              { name: { contains: filters.search, mode: 'insensitive' } },
              {
                product: {
                  name: { contains: filters.search, mode: 'insensitive' },
                },
              },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.productChannel.findMany({
        where,
        ...productChannelWithProduct,
        // Join loading: the product, images, category, brand and stock come back
        // in one round trip instead of one query per relation.
        relationLoadStrategy: 'join',
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.productChannel.count({ where }),
    ]);

    return {
      items: rows.map((pc) => this.toPublicProduct(pc)),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getProductBySlug(channelId: string, slug: string) {
    const pc = await this.prisma.productChannel.findFirst({
      where: {
        channelId,
        slug,
        isPublished: true,
        product: { isActive: true, deletedAt: null },
      },
      ...productChannelWithProduct,
      // Join loading: the product, images, category, brand and stock come back
      // in one round trip instead of one query per relation.
      relationLoadStrategy: 'join',
    });
    if (!pc) {
      throw new NotFoundException(`Product "${slug}" not found`);
    }
    return {
      ...this.toPublicProduct(pc),
      seoTitle: pc.seoTitle,
      seoDescription: pc.seoDescription,
    };
  }

  // Guest checkout — the one mutating, unauthenticated endpoint in the
  // whole API. Two layers of protection before it ever reaches the shared
  // order engine: (1) every item must be actively published on *this*
  // channel — a guessed/leaked productId from another channel's catalog
  // is rejected here, never reaching OrdersService; (2) the DTO has no
  // price field at all, so OrdersService always derives price from this
  // channel's ProductChannel.price server-side, never from client input.
  async createOrder(channel: Channel, dto: StorefrontCreateOrderDto) {
    for (const item of dto.items) {
      const pc = await this.prisma.productChannel.findUnique({
        where: {
          productId_channelId: {
            productId: item.productId,
            channelId: channel.id,
          },
        },
        include: { product: { select: { isActive: true, deletedAt: true } } },
      });
      if (
        !pc ||
        !pc.isPublished ||
        !pc.product.isActive ||
        pc.product.deletedAt
      ) {
        throw new NotFoundException(
          `Product ${item.productId} is not available on this storefront`,
        );
      }
    }

    const order = await this.ordersService.createOrder(
      {
        source: 'WEBSITE',
        channelId: channel.id,
        customerName: dto.customerName,
        customerPhone: dto.customerPhone,
        customerEmail: dto.customerEmail,
        shippingAddress: dto.shippingAddress,
        items: dto.items.map((i) => ({
          productId: i.productId,
          quantity: i.quantity,
        })),
        paymentMethod: dto.paymentMethod,
        notes: dto.notes,
        isPaid: false,
      },
      undefined,
    );

    // The order is placed, so this phone's Incomplete lead is no longer needed.
    await this.prisma.checkoutLead.deleteMany({
      where: { channelId: channel.id, phone: dto.customerPhone },
    });
    return order;
  }

  // Keeps a checkout in progress as an Incomplete lead on Web Orders. Stores
  // the price as the channel would charge it, so the admin total matches.
  async saveCheckoutLead(channel: Channel, dto: StorefrontCheckoutLeadDto) {
    const items: { productId: string; quantity: number; unitPrice: number }[] =
      [];
    for (const item of dto.items) {
      const pc = await this.prisma.productChannel.findUnique({
        where: {
          productId_channelId: {
            productId: item.productId,
            channelId: channel.id,
          },
        },
        include: { product: { select: { isActive: true, deletedAt: true } } },
      });
      if (
        !pc ||
        !pc.isPublished ||
        !pc.product.isActive ||
        pc.product.deletedAt
      ) {
        throw new NotFoundException(
          `Product ${item.productId} is not available on this storefront`,
        );
      }
      items.push({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: toNumber(pc.price),
      });
    }

    const lead = await this.prisma.checkoutLead.upsert({
      where: {
        channelId_phone: { channelId: channel.id, phone: dto.customerPhone },
      },
      create: {
        channelId: channel.id,
        phone: dto.customerPhone,
        name: dto.customerName ?? null,
        address: dto.shippingAddress ?? null,
        items: items as Prisma.InputJsonValue,
      },
      update: {
        name: dto.customerName ?? null,
        address: dto.shippingAddress ?? null,
        items: items as Prisma.InputJsonValue,
      },
      select: { id: true, updatedAt: true },
    });
    return { id: lead.id, updatedAt: lead.updatedAt };
  }

  private toPublicProduct(pc: ProductChannelWithProduct) {
    const inventory = pc.product.inventory;
    const available = inventory
      ? inventory.currentStock - inventory.reservedStock
      : 0;
    return {
      productId: pc.productId,
      name: pc.name ?? pc.product.name,
      slug: pc.slug,
      description: pc.description ?? pc.product.description,
      price: toNumber(pc.price),
      compareAtPrice: pc.compareAtPrice ? toNumber(pc.compareAtPrice) : null,
      isFeatured: pc.isFeatured,
      // The single cover image shown in listing cards, the cart, and as
      // the main product-page image — falls back to the gallery's first
      // shot for products that haven't had one set yet.
      thumbnailUrl:
        pc.product.thumbnailUrl ?? pc.product.images[0]?.url ?? null,
      images: pc.product.images.map((i) => i.url),
      category: pc.product.category
        ? { id: pc.product.category.id, name: pc.product.category.name }
        : null,
      // Every category this product is tagged under (primary + extras) —
      // used by category pages to decide what belongs there, and available
      // for display wherever a product needs to show all its categories.
      categories: [
        ...(pc.product.category
          ? [{ id: pc.product.category.id, name: pc.product.category.name }]
          : []),
        ...pc.product.categories.map((pcat) => ({
          id: pcat.category.id,
          name: pcat.category.name,
        })),
      ].filter(
        (cat, idx, arr) => arr.findIndex((c) => c.id === cat.id) === idx,
      ),
      brand: pc.product.brand
        ? { id: pc.product.brand.id, name: pc.product.brand.name }
        : null,
      inStock: available > 0,
      slogan: pc.product.slogan,
      specifications:
        (pc.product.specifications as
          { key: string; value: string }[] | null) ?? null,
      hasVariants: pc.product.hasVariants,
      // Flash Deal's "৳min–৳max" range and "২টি সাইজ"-style button label —
      // only meaningful (and only sent) for a variant product; a simple
      // product always just uses `price` and a plain add-to-cart button.
      ...(pc.product.hasVariants && pc.product.variants.length > 0
        ? {
            minPrice: Math.min(
              ...pc.product.variants.map((v) => toNumber(v.basePrice)),
            ),
            maxPrice: Math.max(
              ...pc.product.variants.map((v) => toNumber(v.basePrice)),
            ),
            variantCount: pc.product.variants.length,
            variantOptionLabel: pc.product.variantOptionLabel,
          }
        : {}),
    };
  }

  // The homepage Flash Deal section: admin-curated product ids + order,
  // resolved against this channel's live, published products at read
  // time — a product that's since been unpublished, deactivated, or
  // deleted just silently drops out rather than showing a dead card.
  async getFlashSale(channel: Channel) {
    type RawFlashSale = {
      enabled?: boolean;
      endsAt?: string | null;
      productIds?: string[];
    };
    const theme = channel.themeConfig as { flashSale?: RawFlashSale } | null;
    const flashSale = theme?.flashSale;
    const productIds = flashSale?.productIds ?? [];
    if (!flashSale?.enabled || productIds.length === 0) {
      return { enabled: false, endsAt: null, items: [] };
    }

    const rows = await this.prisma.productChannel.findMany({
      where: {
        channelId: channel.id,
        isPublished: true,
        productId: { in: productIds },
        product: { isActive: true, deletedAt: null },
      },
      ...productChannelWithProduct,
      relationLoadStrategy: 'join',
    });

    // The query above doesn't preserve `productIds`' order, so re-sort to
    // match the admin's numbered list — that order IS the display order.
    const byId = new Map(rows.map((r) => [r.productId, r]));
    const items = productIds
      .map((id) => byId.get(id))
      .filter((r): r is ProductChannelWithProduct => !!r)
      .map((pc) => this.toPublicProduct(pc));

    return {
      enabled: true,
      endsAt: flashSale.endsAt ?? null,
      items,
    };
  }

  // "কাস্টমারদের অভিজ্ঞতা" — admin-entered testimonials (Settings → Review).
  // Each review's linked product, if any, is resolved against this
  // channel's live, published products at read time — same reasoning as
  // getFlashSale: a product that's since been unpublished/deleted just
  // drops the link instead of showing a dead one.
  async getReviews(channel: Channel) {
    type RawReview = {
      customerName?: string;
      location?: string | null;
      rating?: number;
      text?: string;
      productId?: string;
      enabled?: boolean;
    };
    const theme = channel.themeConfig as { reviews?: RawReview[] } | null;
    const reviews = (theme?.reviews ?? []).filter(
      (r) =>
        (r.enabled ?? true) &&
        r.customerName?.trim() &&
        r.text?.trim() &&
        r.rating,
    );
    if (reviews.length === 0) return [];

    const productIds = [
      ...new Set(
        reviews.map((r) => r.productId).filter((id): id is string => !!id),
      ),
    ];
    const productRows = productIds.length
      ? await this.prisma.productChannel.findMany({
          where: {
            channelId: channel.id,
            isPublished: true,
            productId: { in: productIds },
            product: { isActive: true, deletedAt: null },
          },
          select: {
            productId: true,
            slug: true,
            name: true,
            product: { select: { name: true } },
          },
        })
      : [];
    const productById = new Map(
      productRows.map((p) => [
        p.productId,
        { slug: p.slug, name: p.name ?? p.product.name },
      ]),
    );

    return reviews.map((r) => {
      const product = r.productId ? productById.get(r.productId) : undefined;
      return {
        customerName: r.customerName!.trim(),
        location: r.location?.trim() || null,
        rating: Math.min(5, Math.max(1, Math.round(r.rating!))),
        text: r.text!.trim(),
        product: product ? { name: product.name, slug: product.slug } : null,
      };
    });
  }
}
