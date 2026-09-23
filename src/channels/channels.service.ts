import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateChannelDto } from './dto/create-channel.dto';
import { UpdateChannelDto } from './dto/update-channel.dto';

@Injectable()
export class ChannelsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateChannelDto) {
    return this.handleUniqueConstraints(() =>
      this.prisma.channel.create({ data: dto }),
    );
  }

  async findAll(includeInactive = false) {
    return this.prisma.channel.findMany({
      where: {
        deletedAt: null,
        ...(includeInactive ? {} : { isActive: true }),
      },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string) {
    const channel = await this.prisma.channel.findFirst({
      where: { id, deletedAt: null },
    });
    if (!channel) {
      throw new NotFoundException(`Channel ${id} not found`);
    }
    return channel;
  }

  async update(id: string, dto: UpdateChannelDto) {
    await this.findOne(id);
    return this.handleUniqueConstraints(() =>
      this.prisma.channel.update({ where: { id }, data: dto }),
    );
  }

  // Soft delete: sets deletedAt + isActive=false. Never a hard delete — a
  // channel a customer once ordered from must keep resolving on old orders.
  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.channel.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
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
        const target = (err.meta?.target as string[] | undefined)?.join(', ');
        throw new ConflictException(
          `Channel with this ${target ?? 'slug/domain'} already exists`,
        );
      }
      throw err;
    }
  }
}
