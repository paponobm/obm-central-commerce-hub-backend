import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBrandDto } from './dto/create-brand.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';

@Injectable()
export class BrandsService {
  constructor(private readonly prisma: PrismaService) {}

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
    await this.findOne(id);
    return this.handleUniqueConstraints(() =>
      this.prisma.brand.update({ where: { id }, data: dto }),
    );
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.brand.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
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
