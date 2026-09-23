import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

type DbClient = PrismaService | Prisma.TransactionClient;

export interface ResolveCustomerInput {
  customerId?: string;
  name?: string;
  phone?: string;
  email?: string;
}

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateCustomerDto) {
    return this.handleUniqueConstraints(() =>
      this.prisma.customer.create({ data: dto }),
    );
  }

  async findAll(search?: string) {
    return this.prisma.customer.findMany({
      where: {
        deletedAt: null,
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { phone: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, deletedAt: null },
    });
    if (!customer) {
      throw new NotFoundException(`Customer ${id} not found`);
    }
    return customer;
  }

  async update(id: string, dto: UpdateCustomerDto) {
    await this.findOne(id);
    return this.handleUniqueConstraints(() =>
      this.prisma.customer.update({ where: { id }, data: dto }),
    );
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.customer.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // Used by order creation: an explicit customerId wins; otherwise reuse
  // an existing customer by phone (a manual order for a phone number that
  // already exists should link to that customer, not fork a duplicate),
  // and only create a new row when the phone is genuinely new. Accepts an
  // optional transaction client so order creation can do this atomically
  // alongside the rest of the order.
  async resolveCustomer(
    input: ResolveCustomerInput,
    db: DbClient = this.prisma,
  ) {
    if (input.customerId) {
      const customer = await db.customer.findFirst({
        where: { id: input.customerId, deletedAt: null },
      });
      if (!customer) {
        throw new NotFoundException(`Customer ${input.customerId} not found`);
      }
      return customer;
    }

    if (!input.phone) {
      throw new BadRequestException(
        'Either customerId or a phone number is required to create an order',
      );
    }

    const existing = await db.customer.findUnique({
      where: { phone: input.phone },
    });
    if (existing) {
      return existing;
    }

    if (!input.name) {
      throw new BadRequestException(
        'name is required when creating a new customer',
      );
    }

    return db.customer.create({
      data: { name: input.name, phone: input.phone, email: input.email },
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
        throw new ConflictException(
          'Customer with this phone number already exists',
        );
      }
      throw err;
    }
  }
}
