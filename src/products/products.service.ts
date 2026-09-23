import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { slugify } from '../common/utils/slugify';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { AddProductImageDto } from './dto/add-product-image.dto';
import { UpsertProductChannelDto } from './dto/upsert-product-channel.dto';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateProductDto) {
    return this.handleUniqueConstraints(() =>
      // A product and its (zero-stock) inventory row are created together —
      // there is never a moment where a Product exists without an
      // Inventory row to reserve/deduct against later.
      this.prisma.$transaction(async (tx) => {
        const product = await tx.product.create({ data: dto });
        await tx.inventory.create({
          data: { productId: product.id, currentStock: 0, reservedStock: 0 },
        });
        return product;
      }),
    );
  }

  async findAll(filters: {
    categoryId?: string;
    brandId?: string;
    search?: string;
    includeInactive?: boolean;
  }) {
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
      },
      include: {
        category: true,
        brand: true,
        inventory: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
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

  async update(id: string, dto: UpdateProductDto) {
    await this.requireActiveProduct(id);
    return this.handleUniqueConstraints(() =>
      this.prisma.product.update({ where: { id }, data: dto }),
    );
  }

  async remove(id: string) {
    await this.requireActiveProduct(id);
    return this.prisma.product.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  async addImage(productId: string, dto: AddProductImageDto) {
    await this.requireActiveProduct(productId);
    return this.prisma.productImage.create({
      data: { productId, url: dto.url, sortOrder: dto.sortOrder ?? 0 },
    });
  }

  async removeImage(productId: string, imageId: string) {
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
  async getChannelOverrides(productId: string) {
    await this.requireActiveProduct(productId);
    const [channels, overrides] = await Promise.all([
      this.prisma.channel.findMany({
        where: { deletedAt: null, isActive: true },
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

  async upsertChannelOverride(
    productId: string,
    channelId: string,
    dto: UpsertProductChannelDto,
  ) {
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
  async publish(productId: string, channelId: string) {
    return this.upsertChannelOverride(productId, channelId, {
      isPublished: true,
    });
  }

  async unpublish(productId: string, channelId: string) {
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
