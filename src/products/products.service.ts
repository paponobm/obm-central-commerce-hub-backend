import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { runTransaction } from '../common/prisma-transaction.util';
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
import { SetProductCategoriesDto } from './dto/set-product-categories.dto';
import { CreateProductVariantDto } from './dto/create-product-variant.dto';
import { UpdateProductVariantDto } from './dto/update-product-variant.dto';

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
    const {
      variants,
      channelIds,
      categoryIds,
      initialStock,
      specifications,
      ...productData
    } = dto;
    const createData: Prisma.ProductUncheckedCreateInput = {
      ...productData,
      ...(specifications !== undefined
        ? { specifications: specifications as unknown as Prisma.InputJsonValue }
        : {}),
    };

    // Validate every foreign reference up front — a stale id (e.g. a
    // category removed in another tab after this form was opened) would
    // otherwise fail deep inside the transaction below as a raw Prisma
    // foreign-key error, surfacing to the admin as an unhelpful 500
    // instead of a clear "not found".
    if (productData.categoryId) {
      const found = await this.prisma.category.count({
        where: { id: productData.categoryId, deletedAt: null },
      });
      if (!found) {
        throw new NotFoundException(
          `Category ${productData.categoryId} not found`,
        );
      }
    }
    if (productData.brandId) {
      const found = await this.prisma.brand.count({
        where: { id: productData.brandId, deletedAt: null },
      });
      if (!found) {
        throw new NotFoundException(`Brand ${productData.brandId} not found`);
      }
    }
    if (categoryIds?.length) {
      const uniqueIds = [...new Set(categoryIds)];
      const found = await this.prisma.category.count({
        where: { id: { in: uniqueIds }, deletedAt: null },
      });
      if (found !== uniqueIds.length) {
        throw new NotFoundException('One or more categories were not found');
      }
    }
    if (channelIds?.length) {
      const uniqueIds = [...new Set(channelIds)];
      const found = await this.prisma.channel.count({
        where: { id: { in: uniqueIds }, deletedAt: null, isActive: true },
      });
      if (found !== uniqueIds.length) {
        throw new NotFoundException(
          'One or more channels were not found or are inactive',
        );
      }
    }

    return this.handleUniqueConstraints(() =>
      // A product and its inventory row are created together — there is
      // never a moment where a Product exists without an Inventory row to
      // reserve/deduct against later.
      this.prisma.$transaction(async (tx) => {
        const { defaultLowStockThreshold } = await this.settings.get();
        const product = await tx.product.create({ data: createData });

        if (variants?.length) {
          // At most one default — the admin UI enforces this with a radio
          // button, but a request sending more than one still only keeps
          // the first rather than leaving an ambiguous multi-default state.
          let defaultClaimed = false;
          await tx.productVariant.createMany({
            data: variants.map((v, i) => {
              const isDefault = !!v.isDefault && !defaultClaimed;
              if (isDefault) defaultClaimed = true;
              return {
                productId: product.id,
                sku: v.sku,
                unitLabel: v.unitLabel,
                basePrice: v.basePrice,
                compareAtPrice: v.compareAtPrice,
                stock: v.stock ?? 0,
                imageUrl: v.imageUrl,
                isDefault,
                sortOrder: i,
              };
            }),
          });
        }

        // A variant product's real stock lives per-row above; the master
        // Inventory row (still required — see Inventory.productId @unique)
        // is kept as their sum so existing stock-aware screens stay correct
        // without knowing about variants.
        const startingStock = variants?.length
          ? variants.reduce((sum, v) => sum + (v.stock ?? 0), 0)
          : (initialStock ?? 0);

        const inventory = await tx.inventory.create({
          data: {
            productId: product.id,
            currentStock: startingStock,
            reservedStock: 0,
            lowStockThreshold: defaultLowStockThreshold,
          },
        });

        if (startingStock > 0) {
          await tx.stockMovement.create({
            data: {
              productId: product.id,
              type: 'ADJUSTMENT',
              quantity: startingStock,
              balanceAfter: inventory.currentStock,
              referenceType: 'MANUAL_ADJUSTMENT',
              note: 'Initial stock on product creation',
            },
          });
        }

        if (categoryIds?.length) {
          const uniqueIds = [...new Set(categoryIds)];
          await tx.productCategory.createMany({
            data: uniqueIds.map((categoryId) => ({
              productId: product.id,
              categoryId,
            })),
            skipDuplicates: true,
          });
        }

        if (channelIds?.length) {
          for (const channelId of channelIds) {
            const slug =
              productData.slug?.trim() ||
              slugify(productData.name) ||
              `product-${product.id.slice(-8)}`;
            await tx.productChannel.create({
              data: {
                productId: product.id,
                channelId,
                slug,
                price: productData.basePrice,
                isPublished: true,
              },
            });
          }
        }

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
      relationLoadStrategy: 'join',
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
        variants: {
          where: { deletedAt: null },
          orderBy: { sortOrder: 'asc' },
        },
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
    // variants/channelIds/categoryIds/initialStock are create-only (not
    // Product scalar columns) — editing variants happens through the
    // dedicated variant endpoints below instead, so they're dropped here
    // rather than passed through to Prisma.
    /* eslint-disable @typescript-eslint/no-unused-vars */
    const {
      variants,
      channelIds,
      categoryIds,
      initialStock,
      specifications,
      ...productData
    } = dto;
    /* eslint-enable @typescript-eslint/no-unused-vars */
    const updateData: Prisma.ProductUncheckedUpdateInput = {
      ...productData,
      ...(specifications !== undefined
        ? { specifications: specifications as unknown as Prisma.InputJsonValue }
        : {}),
    };
    return this.handleUniqueConstraints(() =>
      this.prisma.product.update({ where: { id }, data: updateData }),
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

  // Applies a stock delta from a variant add/edit/remove to the product's
  // own master Inventory row — see the ProductVariant schema comment for
  // why that row is kept as the sum of all variant stocks. Same
  // check-and-update shape as InventoryService.adjust(): a conditional
  // UPDATE that refuses to take currentStock below zero, paired with a
  // StockMovement row in the same transaction (the ledger invariant every
  // other stock change in this codebase follows).
  private async applyVariantStockDelta(
    tx: Prisma.TransactionClient,
    productId: string,
    delta: number,
    note: string,
  ) {
    if (delta === 0) return;
    const rows = await tx.$queryRaw<{ currentStock: number }[]>`
      UPDATE inventory
      SET "currentStock" = "currentStock" + ${delta}, "updatedAt" = now()
      WHERE "productId" = ${productId} AND ("currentStock" + ${delta}) >= 0
      RETURNING "currentStock"
    `;
    if (rows.length === 0) {
      throw new ConflictException(
        'This change would take stock below zero for this product',
      );
    }
    await tx.stockMovement.create({
      data: {
        productId,
        type: 'ADJUSTMENT',
        quantity: delta,
        balanceAfter: rows[0].currentStock,
        referenceType: 'MANUAL_ADJUSTMENT',
        note,
      },
    });
  }

  // Keeps Product.basePrice — the fallback price shown wherever nothing
  // more specific overrides it — as the cheapest active variant, same rule
  // create() uses when a variant product is first made.
  private async recomputeBasePriceFromVariants(
    tx: Prisma.TransactionClient,
    productId: string,
  ) {
    const variants = await tx.productVariant.findMany({
      where: { productId, deletedAt: null, isActive: true },
      select: { basePrice: true },
    });
    if (variants.length === 0) return;
    const min = variants.reduce(
      (m, v) => (Number(v.basePrice) < m ? Number(v.basePrice) : m),
      Number(variants[0].basePrice),
    );
    await tx.product.update({
      where: { id: productId },
      data: { basePrice: min },
    });
  }

  // Keeps "at most one default variant" true at the data layer — the admin
  // UI's radio button already enforces single-select, but a variant added
  // or edited with isDefault: true here always wins over whichever one
  // held it before.
  private async clearOtherDefaults(
    tx: Prisma.TransactionClient,
    productId: string,
    exceptVariantId?: string,
  ) {
    await tx.productVariant.updateMany({
      where: {
        productId,
        deletedAt: null,
        isDefault: true,
        ...(exceptVariantId ? { id: { not: exceptVariantId } } : {}),
      },
      data: { isDefault: false },
    });
  }

  async addVariant(
    productId: string,
    dto: CreateProductVariantDto,
    user: JwtPayload,
  ) {
    await this.requireActiveProduct(productId);
    await this.assertVisibleById(user, productId);
    return this.handleUniqueConstraints(() =>
      runTransaction(this.prisma, async (tx) => {
        const maxSort = await tx.productVariant.aggregate({
          where: { productId, deletedAt: null },
          _max: { sortOrder: true },
        });
        if (dto.isDefault) {
          await this.clearOtherDefaults(tx, productId);
        }
        const variant = await tx.productVariant.create({
          data: {
            productId,
            sku: dto.sku,
            unitLabel: dto.unitLabel,
            basePrice: dto.basePrice,
            compareAtPrice: dto.compareAtPrice,
            stock: dto.stock ?? 0,
            imageUrl: dto.imageUrl,
            isDefault: !!dto.isDefault,
            isActive: dto.isActive ?? true,
            sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
          },
        });
        await this.applyVariantStockDelta(
          tx,
          productId,
          dto.stock ?? 0,
          `Variant added: ${dto.sku}`,
        );
        await this.recomputeBasePriceFromVariants(tx, productId);
        return variant;
      }),
    );
  }

  async updateVariant(
    productId: string,
    variantId: string,
    dto: UpdateProductVariantDto,
    user: JwtPayload,
  ) {
    await this.requireActiveProduct(productId);
    await this.assertVisibleById(user, productId);
    const existing = await this.prisma.productVariant.findFirst({
      where: { id: variantId, productId, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException(`Variant ${variantId} not found`);
    }
    return this.handleUniqueConstraints(() =>
      runTransaction(this.prisma, async (tx) => {
        if (dto.isDefault) {
          await this.clearOtherDefaults(tx, productId, variantId);
        }
        const updated = await tx.productVariant.update({
          where: { id: variantId },
          data: dto,
        });
        if (dto.stock !== undefined && dto.stock !== existing.stock) {
          await this.applyVariantStockDelta(
            tx,
            productId,
            dto.stock - existing.stock,
            `Variant stock adjusted: ${updated.sku}`,
          );
        }
        if (dto.basePrice !== undefined) {
          await this.recomputeBasePriceFromVariants(tx, productId);
        }
        return updated;
      }),
    );
  }

  async removeVariant(productId: string, variantId: string, user: JwtPayload) {
    await this.requireActiveProduct(productId);
    await this.assertVisibleById(user, productId);
    const existing = await this.prisma.productVariant.findFirst({
      where: { id: variantId, productId, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException(`Variant ${variantId} not found`);
    }
    return runTransaction(this.prisma, async (tx) => {
      const updated = await tx.productVariant.update({
        where: { id: variantId },
        data: { deletedAt: new Date() },
      });
      await this.applyVariantStockDelta(
        tx,
        productId,
        -existing.stock,
        `Variant removed: ${existing.sku}`,
      );
      await this.recomputeBasePriceFromVariants(tx, productId);
      return updated;
    });
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

    // slugify strips non-ASCII, so Bengali names come out empty — fall back to
    // a per-product suffix so two such products never share a slug in a channel.
    const slug =
      dto.slug?.trim() ||
      existing?.slug ||
      slugify(dto.name ?? product.name) ||
      `product-${productId.slice(-8)}`;
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

  // Extra storefront categories (on top of Product.categoryId) — lets a
  // product show up under several category pages at once.
  async getProductCategories(productId: string, user: JwtPayload) {
    await this.requireActiveProduct(productId);
    await this.assertVisibleById(user, productId);
    const rows = await this.prisma.productCategory.findMany({
      where: { productId },
      include: { category: true },
      orderBy: { category: { name: 'asc' } },
    });
    return rows.map((r) => r.category);
  }

  async setProductCategories(
    productId: string,
    dto: SetProductCategoriesDto,
    user: JwtPayload,
  ) {
    await this.requireActiveProduct(productId);
    await this.assertVisibleById(user, productId);
    const categoryIds = [...new Set(dto.categoryIds)];
    if (categoryIds.length > 0) {
      const found = await this.prisma.category.count({
        where: { id: { in: categoryIds }, deletedAt: null },
      });
      if (found !== categoryIds.length) {
        throw new NotFoundException('One or more categories were not found');
      }
    }
    await this.prisma.$transaction([
      this.prisma.productCategory.deleteMany({ where: { productId } }),
      this.prisma.productCategory.createMany({
        data: categoryIds.map((categoryId) => ({ productId, categoryId })),
      }),
    ]);
    return this.getProductCategories(productId, user);
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
