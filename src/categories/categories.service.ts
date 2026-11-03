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
