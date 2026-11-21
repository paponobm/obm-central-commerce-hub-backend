import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FileStorageService } from '../common/file-storage/file-storage.service';
import { CreateBrandDto } from './dto/create-brand.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';

@Injectable()
export class BrandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fileStorage: FileStorageService,
  ) {}

  async create(dto: CreateBrandDto) {
    return this.handleUniqueConstraints(() =>
      this.prisma.brand.create({ data: dto }),
    );
  }

  async findAll() {
    return this.prisma.brand.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string) {
    const brand = await this.prisma.brand.findFirst({
      where: { id, deletedAt: null },
    });
    if (!brand) {
      throw new NotFoundException(`Brand ${id} not found`);
    }
    return brand;
  }

  async update(id: string, dto: UpdateBrandDto) {
    const existing = await this.findOne(id);
    const updated = await this.handleUniqueConstraints(() =>
      this.prisma.brand.update({ where: { id }, data: dto }),
    );
    if (dto.logoUrl !== undefined && dto.logoUrl !== existing.logoUrl) {
      this.fileStorage.deleteUploadedFile(existing.logoUrl);
    }
    return updated;
  }

  async remove(id: string) {
    const existing = await this.findOne(id);
    const deleted = await this.prisma.brand.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    this.fileStorage.deleteUploadedFile(existing.logoUrl);
    return deleted;
  }

  private async handleUniqueConstraints<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('Brand with this name already exists');
      }
      throw err;
    }
  }
}
