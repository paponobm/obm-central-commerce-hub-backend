import { Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { Channel, CallRequestStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCallRequestDto } from './dto/create-call-request.dto';

@Injectable()
export class CallRequestsService {
  constructor(private readonly prisma: PrismaService) {}

  // Same short, readable, globally-unique code shape as VipCoupon.code —
  // shown to the customer so they have something to reference if they call
  // back themselves, never admin-typed. Collision is astronomically
  // unlikely (16^6 space) but checked and retried anyway, same discipline
  // as any other generated-code field in this codebase.
  private async generateUniqueRequestCode(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = `CB${randomBytes(3).toString('hex').toUpperCase()}`;
      const exists = await this.prisma.callRequest.findUnique({
        where: { requestCode: code },
      });
      if (!exists) return code;
    }
    throw new Error('Failed to generate a unique call request code');
  }

  // Public, unauthenticated — called from the storefront's "ফ্রি
  // কল-পরামর্শ নিন" form. channelId is recorded purely for reference (see
  // the schema comment); it never gates who can see or resolve this later.
  async create(channel: Channel, dto: CreateCallRequestDto) {
    const requestCode = await this.generateUniqueRequestCode();
    return this.prisma.callRequest.create({
      data: {
        requestCode,
        name: dto.name.trim(),
        phone: dto.phone.trim(),
        problem: dto.problem.trim(),
        channelId: channel.id,
      },
    });
  }

  // Central — every call request across every storefront, regardless of
  // which store the admin currently has selected (see the Counseling nav
  // entry, which is centralOnly).
  async findAll(status?: CallRequestStatus) {
    return this.prisma.callRequest.findMany({
      where: status ? { status } : undefined,
      include: { channel: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateStatus(id: string, status: CallRequestStatus) {
    const existing = await this.prisma.callRequest.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException(`Call request ${id} not found`);
    }
    return this.prisma.callRequest.update({
      where: { id },
      data: { status },
    });
  }
}
