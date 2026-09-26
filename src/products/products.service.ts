import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { slugify } from '../common/utils/slugify';
import {
  ALL_ACCESS_PERMISSION,
  ChannelScopeService,
} from '../common/channel-scope/channel-scope.service';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { SettingsService } from '../settings/settings.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { AddProductImageDto } from './dto/add-product-image.dto';
import { UpsertProductChannelDto } from './dto/upsert-product-channel.dto';

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly channelScope: ChannelScopeService,
    private readonly settings: SettingsService,
  ) {}

  // Product has no channelId column — visibility for a restricted user
  // goes through the ProductChannel join instead: "published on at least
  // one of my assigned stores" (ARCHITECTURE.md §16). Never add a direct
  // column to Product to short-circuit this.
  private async channelWhereFilter(
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

  private async assertProductVisible(
    user: JwtPayload,
    product: { channels: { channelId: string; isPublished: boolean }[] },
  ) {
    if (user.permissions.includes(ALL_ACCESS_PERMISSION)) return;
    const allowed = await this.channelScope.getAssignedChannelIds(user.sub);
    const visible = product.channels.some(
      (pc) => pc.isPublished && allowed.includes(pc.channelId),
    );
    if (!visible) {
      throw new ForbiddenException(
        'This product is not published on any of your assigned stores',
      );
    }
  }

  // Write-side counterpart of the read scoping: a restricted user can only
  // modify a product that's published on one of their stores.
  private async assertVisibleById(user: JwtPayload, productId: string) {
    if (user.permissions.includes(ALL_ACCESS_PERMISSION)) return;
    const channels = await this.prisma.productChannel.findMany({
      where: { productId },
      select: { channelId: true, isPublished: true },
    });
    await this.assertProductVisible(user, { channels });
  }

  async create(dto: CreateProductDto) {
    return this.handleUniqueConstraints(() =>
      // A product and its (zero-stock) inventory row are created together —
      // there is never a moment where a Product exists without an
      // Inventory row to reserve/deduct against later.
      this.prisma.$transaction(async (tx) => {
        const { defaultLowStockThreshold } = await this.settings.get();
        const product = await tx.product.create({ data: dto });
        await tx.inventory.create({
          data: {
            productId: product.id,
            currentStock: 0,
            reservedStock: 0,
            lowStockThreshold: defaultLowStockThreshold,
          },
        });
        return product;
      }),
    );
  }

  async findAll(
    user: JwtPayload,
    filters: {
      categoryId?: string;
      brandId?: string;
      search?: string;
      includeInactive?: boolean;
      channelId?: string;
    },
  ) {
    const channelWhere = await this.channelWhereFilter(user, filters.channelId);
    return this.prisma.product.findMany({
      where: {
        deletedAt: null,
        ...(filters.includeInactive ? {} : { isActive: true }),
        ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
        ...(filters.brandId ? { brandId: filters.brandId } : {}),
        ...(filters.search
          ? {
              OR: [
                { name: { contains: filters.search, mode: 'insensitive' } },
                { sku: { contains: filters.search, mode: 'insensitive' } },
              ],
            }
          : {}),
        ...channelWhere,
      },
      include: {
        category: true,
        brand: true,
        inventory: true,
        // Just the cover image — list views only ever show one thumbnail
        // per product, so there's no reason to ship the full gallery here.
        images: { take: 1, orderBy: { sortOrder: 'asc' } },
        // Published-stores badges on the list page need the channel names,
        // not just the join — small, bounded per product (one row per
        // channel that exists), so this is cheap even at full catalog size.
        channels: {
          where: { isPublished: true },
          select: { channelId: true, channel: { select: { name: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, user: JwtPayload) {
    const product = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      include: {
        category: true,
        brand: true,
        images: { orderBy: { sortOrder: 'asc' } },
        inventory: true,
        channels: { include: { channel: true } },
      },
    });
    if (!product) {
      throw new NotFoundException(`Product ${id} not found`);
    }
    await this.assertProductVisible(user, { channels: product.channels });
    return product;
  }

  // Internal helper — throws if missing, but doesn't load the relations
  // findOne() does, since most callers here only need the base row.
  private async requireActiveProduct(id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
    });
    if (!product) {
      throw new NotFoundException(`Product ${id} not found`);
    }
    return product;
  }

  async update(id: string, dto: UpdateProductDto, user: JwtPayload) {
    await this.requireActiveProduct(id);
    await this.assertVisibleById(user, id);
    return this.handleUniqueConstraints(() =>
      this.prisma.product.update({ where: { id }, data: dto }),
    );
  }

  // The master product is shared by every store, so deleting it is a
  // cross-store action — unrestricted users only.
  async remove(id: string, user: JwtPayload) {
    if (!user.permissions.includes(ALL_ACCESS_PERMISSION)) {
      throw new ForbiddenException(
        'Only unrestricted users can delete a product shared across stores',
      );
    }
    await this.requireActiveProduct(id);
    return this.prisma.product.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  async addImage(productId: string, dto: AddProductImageDto, user: JwtPayload) {
    await this.requireActiveProduct(productId);
    await this.assertVisibleById(user, productId);
    return this.prisma.productImage.create({
      data: { productId, url: dto.url, sortOrder: dto.sortOrder ?? 0 },
    });
  }

  async removeImage(productId: string, imageId: string, user: JwtPayload) {
    await this.assertVisibleById(user, productId);
    const image = await this.prisma.productImage.findFirst({
      where: { id: imageId, productId },
    });
    if (!image) {
      throw new NotFoundException(`Image ${imageId} not found on this product`);
    }
    await this.prisma.productImage.delete({ where: { id: imageId } });
    return { success: true };
  }

  // One row per active channel, merged with this product's ProductChannel
  // override if one exists — gives the admin UI everything it needs to
  // render the "[ ] Burmese Market [x] Shutki Market" checkbox grid in one
  // call, without a separate round trip per channel.
  async getChannelOverrides(user: JwtPayload, productId: string) {
    await this.requireActiveProduct(productId);
    // Channel's own primary key is `id`, not `channelId` — resolveDirectFilter
    // is shaped for filtering a *different* model's channelId foreign key,
    // so its result has to be remapped onto `id` here, not spread directly.
    const resolved = await this.channelScope.resolveDirectFilter(user);
    const idFilter = resolved.channelId ? { id: resolved.channelId } : {};
    const [channels, overrides] = await Promise.all([
      this.prisma.channel.findMany({
        where: { deletedAt: null, isActive: true, ...idFilter },
        orderBy: { name: 'asc' },
      }),
      this.prisma.productChannel.findMany({ where: { productId } }),
    ]);

    return channels.map((channel) => {
      const override = overrides.find((o) => o.channelId === channel.id);
      return {
        channelId: channel.id,
        channelName: channel.name,
        channelSlug: channel.slug,
        linked: !!override,
        isPublished: override?.isPublished ?? false,
        name: override?.name ?? null,
        slug: override?.slug ?? null,
        price: override?.price ?? null,
        compareAtPrice: override?.compareAtPrice ?? null,
        isFeatured: override?.isFeatured ?? false,
        sortOrder: override?.sortOrder ?? 0,
      };
    });
  }

  // Publishing a product onto a store is a write against THAT store, same
  // as creating an order there — a restricted user must be assigned to
  // channelId, not merely permitted to view/manage products in general.
  // Without this, any products.publish holder could publish to a store
  // they don't manage.
  private async assertChannelAssigned(user: JwtPayload, channelId: string) {
    if (user.permissions.includes(ALL_ACCESS_PERMISSION)) return;
    const allowed = await this.channelScope.getAssignedChannelIds(user.sub);
    if (!allowed.includes(channelId)) {
      throw new ForbiddenException('You are not assigned to this store');
    }
  }

  async upsertChannelOverride(
    user: JwtPayload,
    productId: string,
    channelId: string,
    dto: UpsertProductChannelDto,
  ) {
    await this.assertChannelAssigned(user, channelId);
    const product = await this.requireActiveProduct(productId);
    await this.requireActiveChannel(channelId);
    const existing = await this.prisma.productChannel.findUnique({
      where: { productId_channelId: { productId, channelId } },
    });

    const slug =
      dto.slug ?? existing?.slug ?? slugify(dto.name ?? product.name);
    const price = dto.price ?? existing?.price ?? product.basePrice;

    return this.handleUniqueConstraints(() =>
      this.prisma.productChannel.upsert({
        where: { productId_channelId: { productId, channelId } },
        create: {
          productId,
          channelId,
          name: dto.name,
          slug,
          description: dto.description,
          price,
          compareAtPrice: dto.compareAtPrice,
          isPublished: dto.isPublished ?? false,
          isFeatured: dto.isFeatured ?? false,
          sortOrder: dto.sortOrder ?? 0,
          seoTitle: dto.seoTitle,
          seoDescription: dto.seoDescription,
        },
        update: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          slug,
          ...(dto.description !== undefined
            ? { description: dto.description }
            : {}),
          price,
          ...(dto.compareAtPrice !== undefined
            ? { compareAtPrice: dto.compareAtPrice }
            : {}),
          ...(dto.isPublished !== undefined
            ? { isPublished: dto.isPublished }
            : {}),
          ...(dto.isFeatured !== undefined
            ? { isFeatured: dto.isFeatured }
            : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
          ...(dto.seoTitle !== undefined ? { seoTitle: dto.seoTitle } : {}),
          ...(dto.seoDescription !== undefined
            ? { seoDescription: dto.seoDescription }
            : {}),
        },
      }),
    );
  }

  // Publishing with no prior override just creates one with sane defaults
  // (name/slug/price fall back to the product master) — matches the
  // "tick the checkbox, it just works" UX from the product spec. Admin can
  // fine-tune name/price afterward via upsertChannelOverride.
  async publish(user: JwtPayload, productId: string, channelId: string) {
    return this.upsertChannelOverride(user, productId, channelId, {
      isPublished: true,
    });
  }

  async unpublish(user: JwtPayload, productId: string, channelId: string) {
    await this.assertChannelAssigned(user, channelId);
    const existing = await this.prisma.productChannel.findUnique({
      where: { productId_channelId: { productId, channelId } },
    });
    if (!existing) {
      throw new NotFoundException(
        'This product has never been published to that channel',
      );
    }
    return this.prisma.productChannel.update({
      where: { productId_channelId: { productId, channelId } },
      data: { isPublished: false },
    });
  }

  private async requireActiveChannel(channelId: string) {
    const channel = await this.prisma.channel.findFirst({
      where: { id: channelId, deletedAt: null },
    });
    if (!channel) {
      throw new NotFoundException(`Channel ${channelId} not found`);
    }
    return channel;
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
          `Conflict on unique field(s): ${target ?? 'sku/slug'}`,
        );
      }
      throw err;
    }
  }
}
