import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { unlink } from 'fs/promises';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { SetCategoryChannelsDto } from './dto/set-category-channels.dto';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateCategoryDto) {
    if (dto.parentId) {
      await this.findOne(dto.parentId);
    }
    return this.handleUniqueConstraints(() =>
      this.prisma.category.create({ data: dto }),
    );
  }

  async findAll() {
    return this.prisma.category.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string) {
    const category = await this.prisma.category.findFirst({
      where: { id, deletedAt: null },
    });
    if (!category) {
      throw new NotFoundException(`Category ${id} not found`);
    }
    return category;
  }

  async update(id: string, dto: UpdateCategoryDto) {
    const existing = await this.findOne(id);

    if (dto.parentId) {
      if (dto.parentId === id) {
        throw new BadRequestException('A category cannot be its own parent');
      }
      await this.findOne(dto.parentId);
      await this.assertNoCycle(id, dto.parentId);
    }

    const updated = await this.handleUniqueConstraints(() =>
      this.prisma.category.update({ where: { id }, data: dto }),
    );
    // A replaced (or cleared) image leaves its old file orphaned on disk
    // otherwise — only once the swap has actually succeeded, and only the
    // old file, never the new one.
    if (dto.imageUrl !== undefined && dto.imageUrl !== existing.imageUrl) {
      this.deleteUploadedFile(existing.imageUrl);
    }
    return updated;
  }

  async remove(id: string) {
    const category = await this.findOne(id);
    const childCount = await this.prisma.category.count({
      where: { parentId: id, deletedAt: null },
    });
    if (childCount > 0) {
      throw new BadRequestException(
        'Cannot delete a category that still has subcategories',
      );
    }
    const deleted = await this.prisma.category.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    this.deleteUploadedFile(category.imageUrl);
    return deleted;
  }

  // Which active channels this category is currently published to —
  // themeConfig.categorySlugs is unset/empty (null here, materialized from
  // either) when a channel is "unrestricted" (every published category
  // shows), so inclusion there means "every published category, including
  // this one" rather than an explicit listing. Mirrors
  // StorefrontService.getCategories' own filter exactly.
  async setCategoryChannels(id: string, dto: SetCategoryChannelsDto) {
    const category = await this.findOne(id);
    const channels = await this.prisma.channel.findMany({
      where: { deletedAt: null, isActive: true },
    });
    const publishedSlugs = (
      await this.prisma.category.findMany({
        where: { deletedAt: null, isPublished: true },
        select: { slug: true },
      })
    ).map((c) => c.slug);
    const wanted = new Set(dto.channelIds);

    const writes = channels
      .map((channel) => {
        const theme = (channel.themeConfig as Prisma.JsonObject | null) ?? {};
        const existingSlugs =
          (theme.categorySlugs as string[] | undefined) ?? null;
        const currentlyIncluded =
          existingSlugs === null ? true : existingSlugs.includes(category.slug);
        const shouldInclude = wanted.has(channel.id);
        if (currentlyIncluded === shouldInclude) return null;

        let nextSlugs: string[];
        if (shouldInclude) {
          // Only reachable when existingSlugs is a real (restricted) array
          // not yet containing this category — null already means included.
          nextSlugs = [...(existingSlugs ?? []), category.slug];
        } else if (existingSlugs === null) {
          // Was unrestricted (every published category shown, this one
          // included) — materialize the full current set minus this
          // category, so every other category's visibility here is
          // unaffected by this one category's publish state changing.
          nextSlugs = publishedSlugs.filter((s) => s !== category.slug);
        } else {
          nextSlugs = existingSlugs.filter((s) => s !== category.slug);
        }

        return this.prisma.channel.update({
          where: { id: channel.id },
          data: {
            themeConfig: {
              ...theme,
              categorySlugs: nextSlugs,
            } as Prisma.InputJsonValue,
          },
        });
      })
      .filter((op): op is NonNullable<typeof op> => op !== null);

    if (writes.length > 0) {
      await this.prisma.$transaction(writes);
    }
    return { success: true };
  }

  // Only ever deletes files this server itself controls (its own
  // /uploads/ directory) — never follows an arbitrary external URL.
  // Missing/already-gone files are silently ignored; this is best-effort
  // disk cleanup, not something that should ever fail the request.
  private deleteUploadedFile(imageUrl: string | null) {
    if (!imageUrl) return;
    const match = imageUrl.match(/\/uploads\/([^/?#]+)$/);
    if (!match) return;
    const filePath = join(process.cwd(), 'uploads', match[1]);
    unlink(filePath).catch(() => undefined);
  }

  // Walk up from the proposed new parent; if we ever reach `id`, setting
  // that parent would make this category an ancestor of itself.
  private async assertNoCycle(id: string, proposedParentId: string) {
    let currentId: string | null = proposedParentId;
    while (currentId) {
      if (currentId === id) {
        throw new BadRequestException(
          'This would create a circular category hierarchy',
        );
      }
      const current: { parentId: string | null } | null =
        await this.prisma.category.findUnique({
          where: { id: currentId },
          select: { parentId: true },
        });
      currentId = current?.parentId ?? null;
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
        throw new ConflictException('Category with this slug already exists');
      }
      throw err;
    }
  }
}
