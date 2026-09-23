import { Injectable, NotFoundException } from '@nestjs/common';
import { Channel, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from '../orders/orders.service';
import { toNumber } from '../common/decimal.util';
import { StorefrontCreateOrderDto } from './dto/storefront-create-order.dto';

const productChannelWithProduct =
  Prisma.validator<Prisma.ProductChannelDefaultArgs>()({
    include: {
      product: {
        include: {
          images: { orderBy: { sortOrder: 'asc' } },
          category: true,
          brand: true,
          inventory: true,
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

  // Categories are a shared, global taxonomy in this schema (not
  // channel-scoped) — every storefront sees the same category tree. Simple
  // and correct for now; scoping to "only categories with a published
  // product on this channel" is a reasonable future refinement, not needed
  // to launch.
  async getCategories() {
    return this.prisma.category.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, slug: true, parentId: true },
      orderBy: { name: 'asc' },
    });
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
        ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
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

    return this.ordersService.createOrder(
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
      images: pc.product.images.map((i) => i.url),
      category: pc.product.category
        ? { id: pc.product.category.id, name: pc.product.category.name }
        : null,
      brand: pc.product.brand
        ? { id: pc.product.brand.id, name: pc.product.brand.name }
        : null,
      inStock: available > 0,
    };
  }
}
