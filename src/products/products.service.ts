import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { runTransaction } from '../common/prisma-transaction.util';
import { slugify } from '../common/utils/slugify';
import {
  ALL_ACCESS_PERMISSION,
  ChannelScopeService,
} from '../common/channel-scope/channel-scope.service';
import { FileStorageService } from '../common/file-storage/file-storage.service';
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
    private readonly fileStorage: FileStorageService,
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

  async create(dto: CreateProductDto, user?: JwtPayload) {
    const {
      variants,
      channelIds,
      categoryIds,
      initialStock,
      specifications,
      manufacturingDate,
      expiryDate,
      expiryAlertDays,
      lowStockThreshold,
      ...productData
    } = dto;
    const createData: Prisma.ProductUncheckedCreateInput = {
      ...productData,
      ...(specifications !== undefined
        ? { specifications: specifications as unknown as Prisma.InputJsonValue }
        : {}),
    };
    // A draft is never active and never published, no matter what the
    // client sent for isActive/channelIds — never trust that pairing from
    // the frontend alone.
    if (createData.isDraft) {
      createData.isActive = false;
    }
    const effectiveChannelIds = createData.isDraft ? undefined : channelIds;

    if (productData.slug) {
      await this.assertSlugAvailable(productData.slug);
    }

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
    if (effectiveChannelIds?.length) {
      const uniqueIds = [...new Set(effectiveChannelIds)];
      const found = await this.prisma.channel.count({
        where: { id: { in: uniqueIds }, deletedAt: null, isActive: true },
      });
      if (found !== uniqueIds.length) {
        throw new NotFoundException(
          'One or more channels were not found or are inactive',
        );
      }
      // Same slug gets reused across every channelId below — check it
      // against each channel up front, before anything is created.
      const channelSlug = productData.slug?.trim() || slugify(productData.name);
      if (channelSlug) {
        for (const channelId of uniqueIds) {
          await this.assertChannelSlugAvailable(channelId, channelSlug);
        }
      }
    }

    return this.handleUniqueConstraints(() =>
      // A product and its inventory row are created together — there is
      // never a moment where a Product exists without an Inventory row to
      // reserve/deduct against later.
      this.prisma.$transaction(async (tx) => {
        const { defaultLowStockThreshold } = await this.settings.get();
        // Lands at the top of the admin Products list's manual order —
        // same "newest first" spot createdAt-based ordering already put it
        // in before sortOrder existed (see the Product.sortOrder comment).
        const { _max } = await tx.product.aggregate({ _max: { sortOrder: true } });
        createData.sortOrder = (_max.sortOrder ?? 0) + 1;
        const product = await tx.product.create({ data: createData });
        await tx.auditLog.create({
          data: {
            userId: user?.sub,
            action: 'product.create',
            entityType: 'Product',
            entityId: product.id,
            after: { name: product.name, isDraft: product.isDraft },
          },
        });

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
            lowStockThreshold: lowStockThreshold ?? defaultLowStockThreshold,
            manufacturingDate: manufacturingDate
              ? new Date(manufacturingDate)
              : undefined,
            expiryDate: expiryDate ? new Date(expiryDate) : undefined,
            expiryAlertDays,
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

        if (effectiveChannelIds?.length) {
          for (const channelId of effectiveChannelIds) {
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

  // "Duplicate" button on the New/Edit Product page's Stock & Delivery+
  // header cluster — copies everything about a product (master fields,
  // variants, images, extra categories, Stock & Delivery settings) into a
  // brand-new DRAFT product, except its stock (starts at 0 — a duplicate
  // hasn't actually been received) and its channel publishing (stays
  // unpublished everywhere, so it never silently goes live). Images are
  // physically copied (FileStorageService.duplicateUploadedFile), not just
  // re-pointed at the same URL — the original's own cleanup on a later
  // delete/replace has no reference counting, so sharing a URL would let
  // editing either product's image quietly break the other's.
  async duplicate(productId: string, user: JwtPayload) {
    const source = await this.requireActiveProduct(productId);
    await this.assertVisibleById(user, productId);
    const [variants, images, extraCategories, sourceInventory] =
      await Promise.all([
        this.prisma.productVariant.findMany({
          where: { productId, deletedAt: null },
          orderBy: { sortOrder: 'asc' },
        }),
        this.prisma.productImage.findMany({
          where: { productId },
          orderBy: { sortOrder: 'asc' },
        }),
        this.prisma.productCategory.findMany({ where: { productId } }),
        this.prisma.inventory.findUnique({ where: { productId } }),
      ]);

    const suffix = randomBytes(3).toString('hex').toUpperCase();
    const newSku = `${source.sku}-COPY-${suffix}`;

    const [newThumbnailUrl, newImageUrls, newVariantImageUrls] =
      await Promise.all([
        source.thumbnailUrl
          ? this.fileStorage.duplicateUploadedFile(source.thumbnailUrl)
          : Promise.resolve(null),
        Promise.all(
          images.map((img) => this.fileStorage.duplicateUploadedFile(img.url)),
        ),
        Promise.all(
          variants.map((v) =>
            v.imageUrl
              ? this.fileStorage.duplicateUploadedFile(v.imageUrl)
              : Promise.resolve(null),
          ),
        ),
      ]);

    return this.handleUniqueConstraints(() =>
      this.prisma.$transaction(async (tx) => {
        // Same "lands at the top" rule as a brand-new product (see create()).
        const { _max } = await tx.product.aggregate({ _max: { sortOrder: true } });
        const duplicated = await tx.product.create({
          data: {
            sortOrder: (_max.sortOrder ?? 0) + 1,
            sku: newSku,
            name: `${source.name} (duplicate)`,
            slogan: source.slogan,
            shortDescription: source.shortDescription,
            description: source.description,
            specifications: (source.specifications ??
              undefined) as Prisma.InputJsonValue,
            forWho: source.forWho,
            costPrice: source.costPrice,
            basePrice: source.basePrice,
            compareAtPrice: source.compareAtPrice,
            unit: source.unit,
            importCountry: source.importCountry,
            categoryId: source.categoryId,
            brandId: source.brandId,
            hasVariants: source.hasVariants,
            variantOptionLabel: source.variantOptionLabel,
            thumbnailUrl: newThumbnailUrl,
            // Always a fresh, unpublished draft — regardless of whether
            // the source was already live.
            isActive: false,
            isDraft: true,
            metaTitle: source.metaTitle,
            metaDescription: source.metaDescription,
            focusKeywords: source.focusKeywords,
          },
        });

        await tx.inventory.create({
          data: {
            productId: duplicated.id,
            currentStock: 0,
            reservedStock: 0,
            lowStockThreshold: sourceInventory?.lowStockThreshold ?? 10,
            manufacturingDate: sourceInventory?.manufacturingDate ?? null,
            expiryDate: sourceInventory?.expiryDate ?? null,
            expiryAlertDays: sourceInventory?.expiryAlertDays ?? null,
          },
        });

        if (variants.length) {
          await tx.productVariant.createMany({
            data: variants.map((v, i) => ({
              productId: duplicated.id,
              sku: `${v.sku}-COPY-${suffix}`,
              unitLabel: v.unitLabel,
              basePrice: v.basePrice,
              compareAtPrice: v.compareAtPrice,
              stock: 0,
              imageUrl: newVariantImageUrls[i],
              isDefault: v.isDefault,
              isActive: v.isActive,
              sortOrder: v.sortOrder,
            })),
          });
        }

        if (images.length) {
          await tx.productImage.createMany({
            data: images.map((img, i) => ({
              productId: duplicated.id,
              url: newImageUrls[i],
              sortOrder: img.sortOrder,
            })),
          });
        }

        if (extraCategories.length) {
          await tx.productCategory.createMany({
            data: extraCategories.map((c) => ({
              productId: duplicated.id,
              categoryId: c.categoryId,
            })),
          });
        }

        await tx.auditLog.create({
          data: {
            userId: user.sub,
            action: 'product.duplicate',
            entityType: 'Product',
            entityId: duplicated.id,
            before: { sourceProductId: productId, sourceSku: source.sku },
            after: { name: duplicated.name, sku: duplicated.sku },
          },
        });

        return duplicated;
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
        // not just the join — small, bounded per product (one row more per
        // channel that exists), so this is cheap even at full catalog size.
        channels: {
          where: { isPublished: true },
          select: { channelId: true, channel: { select: { name: true } } },
        },
        // The list page needs this for the variant count (shown next to
        // the name) and price range (min-max across variants) on a
        // variable product.
        variants: { where: { deletedAt: null } },
      },
      orderBy: [{ sortOrder: 'desc' }, { createdAt: 'desc' }],
    });
  }

  // Moves one product to a new 1-indexed position among active products
  // only — the "#" column is only ever editable with the Products list's
  // Status filter set to Active and no search/category filter (see the
  // frontend), so the position math here has to be scoped to exactly that
  // same set, or a typed position wouldn't line up with what's on screen.
  // Shifts everything between the old and new spot accordingly. Reassigns
  // sortOrder across the WHOLE active set rather than just the affected
  // range — simplest way to keep values dense and collision-free, and cheap
  // enough at any catalog size this admin UI is meant for.
  async reorder(productId: string, position: number, user: JwtPayload) {
    const channelWhere = await this.channelWhereFilter(user, undefined);
    const products = await this.prisma.product.findMany({
      where: { deletedAt: null, isActive: true, ...channelWhere },
      select: { id: true },
      orderBy: [{ sortOrder: 'desc' }, { createdAt: 'desc' }],
    });
    const ids = products.map((p) => p.id);
    const fromIndex = ids.indexOf(productId);
    if (fromIndex === -1) {
      throw new NotFoundException(`Product ${productId} not found`);
    }
    const toIndex = Math.min(Math.max(position - 1, 0), ids.length - 1);
    if (toIndex === fromIndex) return { success: true };
    ids.splice(fromIndex, 1);
    ids.splice(toIndex, 0, productId);

    // One statement, not one UPDATE per product — a few hundred sequential
    // round trips to the (remote, pooled) database here was slow enough to
    // blow past the interactive transaction's own time budget. Highest
    // sortOrder = top of the list, so the first id in the new order gets
    // the largest value, counting down to 1 for the last.
    const rows = Prisma.join(
      ids.map((id, i) => Prisma.sql`(${id}::text, ${ids.length - i}::int)`),
    );
    await this.prisma.$executeRaw`
      UPDATE products AS p
      SET "sortOrder" = v.sort_order
      FROM (VALUES ${rows}) AS v(id, sort_order)
      WHERE p.id = v.id
    `;
    return { success: true };
  }

  // The New/Edit Product form's "For Who" checkbox list — not a fixed enum,
  // just the distinct, non-empty tags already used across every product.
  // Typing a brand new one on a product and saving makes it a real option
  // here for every product after that.
  async listForWhoTags(): Promise<string[]> {
    const rows = await this.prisma.product.findMany({
      where: { deletedAt: null, forWho: { isEmpty: false } },
      select: { forWho: true },
    });
    const tags = new Set<string>();
    for (const row of rows) {
      for (const tag of row.forWho) tags.add(tag);
    }
    return [...tags].sort((a, b) => a.localeCompare(b));
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
    const existing = await this.requireActiveProduct(id);
    await this.assertVisibleById(user, id);
    if (dto.slug && dto.slug !== existing.slug) {
      await this.assertSlugAvailable(dto.slug, id);
    }
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
      manufacturingDate,
      expiryDate,
      expiryAlertDays,
      lowStockThreshold,
      ...productData
    } = dto;
    /* eslint-enable @typescript-eslint/no-unused-vars */
    const updateData: Prisma.ProductUncheckedUpdateInput = {
      ...productData,
      ...(specifications !== undefined
        ? { specifications: specifications as unknown as Prisma.InputJsonValue }
        : {}),
    };
    // Same pairing as create() — a draft is never active, regardless of
    // what isActive was sent alongside it.
    if (updateData.isDraft === true) {
      updateData.isActive = false;
    }
    const result = await this.handleUniqueConstraints(() =>
      runTransaction(this.prisma, async (tx) => {
        const updated = await tx.product.update({
          where: { id },
          data: updateData,
        });
        // No UI sets a channel's own price separately from the product's
        // anymore (Publish is just a checkbox + category now) — so every
        // channel this product is on just tracks basePrice/compareAtPrice
        // here, instead of freezing at whatever price it had when first
        // published.
        if (dto.basePrice !== undefined || dto.compareAtPrice !== undefined) {
          await tx.productChannel.updateMany({
            where: { productId: id },
            data: {
              ...(dto.basePrice !== undefined
                ? { price: updated.basePrice }
                : {}),
              ...(dto.compareAtPrice !== undefined
                ? { compareAtPrice: updated.compareAtPrice }
                : {}),
            },
          });
        }
        // Stock & Delivery tab fields all live on Inventory, not Product —
        // only touch the row when at least one of them was actually sent.
        if (
          manufacturingDate !== undefined ||
          expiryDate !== undefined ||
          expiryAlertDays !== undefined ||
          lowStockThreshold !== undefined
        ) {
          await tx.inventory.update({
            where: { productId: id },
            data: {
              ...(manufacturingDate !== undefined
                ? {
                    manufacturingDate: manufacturingDate
                      ? new Date(manufacturingDate)
                      : null,
                  }
                : {}),
              ...(expiryDate !== undefined
                ? { expiryDate: expiryDate ? new Date(expiryDate) : null }
                : {}),
              ...(expiryAlertDays !== undefined ? { expiryAlertDays } : {}),
              ...(lowStockThreshold !== undefined ? { lowStockThreshold } : {}),
            },
          });
        }
        return updated;
      }),
    );
    // A replaced (or cleared) thumbnail leaves its old file orphaned on
    // disk/Cloudinary otherwise — only the old file, never the new one,
    // and only once the swap has actually succeeded.
    if (
      dto.thumbnailUrl !== undefined &&
      dto.thumbnailUrl !== existing.thumbnailUrl
    ) {
      this.fileStorage.deleteUploadedFile(existing.thumbnailUrl);
    }
    await this.logProductFieldChanges(existing, result, user.sub);
    return result;
  }

  // Activity Log entry for a product.update — only the handful of fields an
  // admin actually cares to see change, compared before vs after the write
  // actually persisted (not the raw dto, since isDraft/isActive get paired
  // server-side). Silent no-op when nothing tracked actually changed, so a
  // save that only touched SEO/specifications doesn't add log noise.
  private async logProductFieldChanges(
    existing: Prisma.ProductGetPayload<object>,
    updated: Prisma.ProductGetPayload<object>,
    userId: string,
  ) {
    // Every admin-editable Product column — String() comparison below
    // naturally stringifies arrays (forWho/focusKeywords) too, so a single
    // pass covers every field type here. Only specifications/Origin (a
    // nested JSON blob) needs its own handling, just below.
    const trackedFields = [
      'sku',
      'name',
      'slogan',
      'shortDescription',
      'description',
      'slug',
      'forWho',
      'costPrice',
      'basePrice',
      'compareAtPrice',
      'unit',
      'importCountry',
      'categoryId',
      'brandId',
      'hasVariants',
      'variantOptionLabel',
      'thumbnailUrl',
      'isActive',
      'isDraft',
      'metaTitle',
      'metaDescription',
      'focusKeywords',
    ] as const;
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const key of trackedFields) {
      const beforeVal = existing[key];
      const afterVal = updated[key];
      if (String(beforeVal) !== String(afterVal)) {
        before[key] = beforeVal;
        after[key] = afterVal;
      }
    }
    // Origin lives inside the `specifications` JSON blob (not its own
    // column — see CreateProductDto's comment), so it needs its own
    // extraction rather than a plain existing[key]/updated[key] compare.
    const originBefore = this.extractOrigin(existing.specifications);
    const originAfter = this.extractOrigin(updated.specifications);
    if (originBefore !== originAfter) {
      before.origin = originBefore;
      after.origin = originAfter;
    }
    if (Object.keys(after).length === 0) return;
    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'product.update',
        entityType: 'Product',
        entityId: updated.id,
        before: before as Prisma.InputJsonValue,
        after: after as Prisma.InputJsonValue,
      },
    });
  }

  private extractOrigin(specifications: Prisma.JsonValue): string | null {
    if (!Array.isArray(specifications)) return null;
    const entry = specifications.find(
      (s): s is { key: string; value: string } =>
        typeof s === 'object' &&
        s !== null &&
        'key' in s &&
        typeof (s as { key: unknown }).key === 'string' &&
        /^origin$/i.test((s as { key: string }).key),
    );
    return typeof entry?.value === 'string' ? entry.value : null;
  }

  // The master product is shared by every store, so deleting it is a
  // cross-store action — unrestricted users only.
  async remove(id: string, user: JwtPayload) {
    if (!user.permissions.includes(ALL_ACCESS_PERMISSION)) {
      throw new ForbiddenException(
        'Only unrestricted users can delete a product shared across stores',
      );
    }
    const existing = await this.requireActiveProduct(id);
    const [images, variants] = await Promise.all([
      this.prisma.productImage.findMany({
        where: { productId: id },
        select: { url: true },
      }),
      this.prisma.productVariant.findMany({
        where: { productId: id, deletedAt: null },
        select: { imageUrl: true },
      }),
    ]);
    const deleted = await this.prisma.product.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    this.fileStorage.deleteUploadedFile(existing.thumbnailUrl);
    images.forEach((image) => this.fileStorage.deleteUploadedFile(image.url));
    variants.forEach((variant) =>
      this.fileStorage.deleteUploadedFile(variant.imageUrl),
    );
    return deleted;
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
    this.fileStorage.deleteUploadedFile(image.url);
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

  // A variant photo is also a real product photo — mirrors it into the
  // product's own gallery (ProductImage) so it shows up there too, instead
  // of being visible only inside that one variant's row. Dedupes on the
  // URL itself, so re-saving a variant that already contributed its image
  // never creates a second gallery row for the same file.
  private async ensureImageInGallery(
    tx: Prisma.TransactionClient,
    productId: string,
    url: string | null | undefined,
  ) {
    if (!url) return;
    const exists = await tx.productImage.findFirst({
      where: { productId, url },
    });
    if (exists) return;
    const maxSort = await tx.productImage.aggregate({
      where: { productId },
      _max: { sortOrder: true },
    });
    await tx.productImage.create({
      data: { productId, url, sortOrder: (maxSort._max.sortOrder ?? -1) + 1 },
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
        await this.ensureImageInGallery(tx, productId, dto.imageUrl);
        await tx.auditLog.create({
          data: {
            userId: user.sub,
            action: 'variant.create',
            entityType: 'Product',
            entityId: productId,
            after: {
              sku: variant.sku,
              unitLabel: variant.unitLabel,
              basePrice: variant.basePrice.toString(),
            },
          },
        });
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
    const result = await this.handleUniqueConstraints(() =>
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
        // Unconditional on any truthy imageUrl (not just a change) —
        // ensureImageInGallery is a no-op if it's already there, and this
        // is also how a variant image set before this sync existed gets
        // backfilled into the gallery the next time its row is saved.
        if (dto.imageUrl) {
          await this.ensureImageInGallery(tx, productId, dto.imageUrl);
        }
        if (
          dto.basePrice !== undefined &&
          dto.basePrice !== Number(existing.basePrice)
        ) {
          await tx.auditLog.create({
            data: {
              userId: user.sub,
              action: 'variant.price_change',
              entityType: 'Product',
              entityId: productId,
              before: {
                sku: existing.sku,
                basePrice: existing.basePrice.toString(),
              },
              after: {
                sku: existing.sku,
                basePrice: updated.basePrice.toString(),
              },
            },
          });
        }
        return updated;
      }),
    );
    // Same orphan-file cleanup as the product thumbnail — only the
    // replaced old image, only once the swap has actually succeeded.
    if (dto.imageUrl !== undefined && dto.imageUrl !== existing.imageUrl) {
      this.fileStorage.deleteUploadedFile(existing.imageUrl);
    }
    return result;
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
    const result = await runTransaction(this.prisma, async (tx) => {
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
      await tx.auditLog.create({
        data: {
          userId: user.sub,
          action: 'variant.remove',
          entityType: 'Product',
          entityId: productId,
          before: {
            sku: existing.sku,
            basePrice: existing.basePrice.toString(),
          },
        },
      });
      return updated;
    });
    this.fileStorage.deleteUploadedFile(existing.imageUrl);
    return result;
  }

  // Product Details tab's Activity Log — merges this product's AuditLog
  // trail (create/update/variant/publish events) with its StockMovement
  // ledger into one human-readable timeline, newest first.
  async getActivity(
    productId: string,
    user: JwtPayload,
    page: number,
    pageSize: number,
  ) {
    await this.requireActiveProduct(productId);
    await this.assertVisibleById(user, productId);
    const [logs, movements] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: { entityType: 'Product', entityId: productId },
        include: {
          user: { select: { name: true, role: { select: { name: true } } } },
        },
      }),
      this.prisma.stockMovement.findMany({
        where: { productId },
        include: {
          createdBy: {
            select: { name: true, role: { select: { name: true } } },
          },
        },
      }),
    ]);
    const fromLogs = logs.map((log) => ({
      id: `log-${log.id}`,
      actorName: log.user?.name ?? 'System',
      actorRole: log.user?.role?.name ?? null,
      message: this.formatActivityMessage(log),
      createdAt: log.createdAt,
    }));
    const fromMovements = movements.map((m) => ({
      id: `move-${m.id}`,
      actorName: m.createdBy?.name ?? 'System',
      actorRole: m.createdBy?.role?.name ?? null,
      message: `Stock ${m.quantity >= 0 ? 'added' : 'removed'} (${m.quantity >= 0 ? '+' : ''}${m.quantity})${m.note ? ` — ${m.note}` : ''}`,
      createdAt: m.createdAt,
    }));
    const merged = [...fromLogs, ...fromMovements].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
    const total = merged.length;
    const start = (page - 1) * pageSize;
    return { items: merged.slice(start, start + pageSize), total };
  }

  private formatActivityMessage(log: {
    action: string;
    before: Prisma.JsonValue;
    after: Prisma.JsonValue;
  }): string {
    const before = (log.before ?? {}) as Record<string, unknown>;
    const after = (log.after ?? {}) as Record<string, unknown>;
    switch (log.action) {
      case 'product.create':
        return after.isDraft ? 'Created as draft' : 'Created product';
      case 'product.duplicate':
        return `Duplicated from ${before.sourceSku}`;
      case 'product.publish':
        return `Published to ${after.channelName}`;
      case 'product.unpublish':
        return `Unpublished from ${after.channelName}`;
      case 'variant.create':
        return `Added variant ${after.sku}${after.unitLabel ? ` (${after.unitLabel})` : ''}`;
      case 'variant.remove':
        return `Removed variant ${before.sku}`;
      case 'variant.price_change':
        return `Variant price changed: ৳${before.basePrice} → ৳${after.basePrice} (${after.sku})`;
      case 'product.update': {
        const labels: Record<string, string> = {
          sku: 'SKU',
          name: 'Name',
          slogan: 'Slogan',
          shortDescription: 'Short Description',
          description: 'Description',
          slug: 'URL Slug',
          forWho: 'For Who',
          basePrice: 'Sell Price',
          compareAtPrice: 'Regular Price',
          costPrice: 'Cost Price',
          unit: 'Unit',
          importCountry: 'Import Country',
          isActive: 'Active',
          isDraft: 'Draft',
          categoryId: 'Category',
          brandId: 'Brand',
          hasVariants: 'Variant mode',
          variantOptionLabel: 'Variant Option Label',
          thumbnailUrl: 'Thumbnail',
          metaTitle: 'Meta Title',
          metaDescription: 'Meta Description',
          focusKeywords: 'Focus Keywords',
          origin: 'Origin',
        };
        const priceKeys = new Set(['basePrice', 'compareAtPrice', 'costPrice']);
        const display = (key: string, v: unknown) => {
          if (v === null || v === undefined || v === '') return '—';
          // Rich-text HTML — strip tags so the log doesn't dump raw markup.
          let text =
            key === 'description'
              ? String(v)
                  .replace(/<[^>]+>/g, ' ')
                  .trim()
              : String(v);
          if (text.length > 50) text = `${text.slice(0, 50)}…`;
          return `${priceKeys.has(key) ? '৳' : ''}${text || '—'}`;
        };
        const parts = Object.keys(after).map((key) => {
          const label = labels[key] ?? key;
          return `${label}: ${display(key, before[key])} → ${display(key, after[key])}`;
        });
        return `Updated ${parts.join(', ')}`;
      }
      default:
        return log.action;
    }
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
    if (slug !== existing?.slug) {
      await this.assertChannelSlugAvailable(channelId, slug, productId);
    }
    const price = dto.price ?? existing?.price ?? product.basePrice;
    const compareAtPrice =
      dto.compareAtPrice ?? existing?.compareAtPrice ?? product.compareAtPrice;

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
          compareAtPrice,
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
          compareAtPrice,
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
    const result = await this.upsertChannelOverride(
      user,
      productId,
      channelId,
      {
        isPublished: true,
      },
    );
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { name: true },
    });
    await this.prisma.auditLog.create({
      data: {
        userId: user.sub,
        action: 'product.publish',
        entityType: 'Product',
        entityId: productId,
        after: { channelName: channel?.name ?? channelId },
      },
    });
    return result;
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
    const result = await this.prisma.productChannel.update({
      where: { productId_channelId: { productId, channelId } },
      data: { isPublished: false },
    });
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { name: true },
    });
    await this.prisma.auditLog.create({
      data: {
        userId: user.sub,
        action: 'product.unpublish',
        entityType: 'Product',
        entityId: productId,
        after: { channelName: channel?.name ?? channelId },
      },
    });
    return result;
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

  // slug has no DB-level unique constraint (see the schema comment) — only
  // an ACTIVE product can block another one from taking its slug; a
  // soft-deleted one's slug is free to reuse. excludeId skips the product
  // being updated itself, so leaving its own slug untouched never
  // conflicts with itself. Mirrors CategoriesService.assertSlugAvailable.
  private async assertSlugAvailable(slug: string, excludeId?: string) {
    const conflict = await this.prisma.product.findFirst({
      where: {
        slug,
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (conflict) {
      throw new ConflictException('Product with this slug already exists');
    }
  }

  // Same idea, one level down: a ProductChannel row survives its parent
  // product being soft-deleted (no cascade on soft delete), so without
  // this a deleted product's old channel slug would block a different
  // product from ever publishing under that slug on the same channel.
  // excludeProductId skips the product being published itself, so
  // re-publishing with its own unchanged slug never conflicts with itself.
  private async assertChannelSlugAvailable(
    channelId: string,
    slug: string,
    excludeProductId?: string,
  ) {
    const conflict = await this.prisma.productChannel.findFirst({
      where: {
        channelId,
        slug,
        ...(excludeProductId ? { productId: { not: excludeProductId } } : {}),
        product: { deletedAt: null },
      },
      select: { id: true },
    });
    if (conflict) {
      throw new ConflictException(
        'Another product already uses this slug on this store',
      );
    }
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
