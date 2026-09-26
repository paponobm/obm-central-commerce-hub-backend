import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { runTransaction } from '../common/prisma-transaction.util';
import { CreatePurchaseDto, PurchaseItemDto } from './dto/create-purchase.dto';

interface InventoryRow {
  currentStock: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

@Injectable()
export class PurchasesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreatePurchaseDto, actorUserId: string) {
    await this.assertSupplier(dto.supplierId);
    await this.assertProducts(dto.items.map((i) => i.productId));

    const items = dto.items.map((i) => this.toItemData(i));
    return this.prisma.purchase.create({
      data: {
        supplierId: dto.supplierId,
        createdById: actorUserId,
        totalCost: items.reduce((sum, i) => sum + i.total, 0),
        items: { create: items },
      },
      include: this.detailInclude,
    });
  }

  findAll() {
    return this.prisma.purchase.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        supplier: { select: { id: true, name: true } },
        _count: { select: { items: true } },
      },
    });
  }

  async findOne(id: string) {
    const purchase = await this.prisma.purchase.findUnique({
      where: { id },
      include: this.detailInclude,
    });
    if (!purchase) throw new NotFoundException(`Purchase ${id} not found`);
    return purchase;
  }

  async addItem(id: string, dto: PurchaseItemDto) {
    await this.assertProducts([dto.productId]);
    return this.mutateDraft(id, async (tx) => {
      await tx.purchaseItem.create({
        data: { purchaseId: id, ...this.toItemData(dto) },
      });
    });
  }

  async removeItem(id: string, itemId: string) {
    return this.mutateDraft(id, async (tx) => {
      const result = await tx.purchaseItem.deleteMany({
        where: { id: itemId, purchaseId: id },
      });
      if (result.count === 0) {
        throw new NotFoundException(
          `Item ${itemId} not found on this purchase`,
        );
      }
      const remaining = await tx.purchaseItem.count({
        where: { purchaseId: id },
      });
      if (remaining === 0) {
        throw new BadRequestException('A purchase needs at least one item');
      }
    });
  }

  async markOrdered(id: string) {
    return this.transition(id, ['DRAFT'], 'ORDERED');
  }

  async cancel(id: string) {
    return this.transition(id, ['DRAFT', 'ORDERED'], 'CANCELLED');
  }

  // Receiving stock: every line item's stock increment, its PURCHASE ledger
  // row, and the status flip all happen in ONE transaction — a failure on
  // any line rolls back all of it, so a purchase can never be half-received.
  // The status claim goes first as an atomic conditional UPDATE: two
  // concurrent receive calls serialize on that row, and the loser matches
  // zero rows (already RECEIVED) instead of double-incrementing stock.
  // The claim is inside the transaction, so a later failure un-claims it.
  async receive(id: string, actorUserId: string) {
    const purchase = await this.findOne(id);
    if (!['DRAFT', 'ORDERED'].includes(purchase.status)) {
      throw new ConflictException(
        `Cannot receive a purchase that is ${purchase.status}`,
      );
    }

    return runTransaction(
      this.prisma,
      async (tx) => {
        const claimed = await tx.$queryRaw<{ id: string }[]>`
          UPDATE purchases
          SET status = 'RECEIVED', "receivedAt" = now()
          WHERE id = ${id} AND status IN ('DRAFT', 'ORDERED')
          RETURNING id
        `;
        if (claimed.length === 0) {
          throw new ConflictException('This purchase was already received');
        }

        for (const item of purchase.items) {
          const rows = await tx.$queryRaw<InventoryRow[]>`
            UPDATE inventory
            SET "currentStock" = "currentStock" + ${item.quantity}, "updatedAt" = now()
            WHERE "productId" = ${item.productId}
            RETURNING "currentStock"
          `;
          if (rows.length === 0) {
            throw new ConflictException(
              `No inventory record for product ${item.product.sku}`,
            );
          }
          await tx.stockMovement.create({
            data: {
              productId: item.productId,
              type: 'PURCHASE',
              quantity: item.quantity,
              balanceAfter: rows[0].currentStock,
              referenceType: 'PURCHASE',
              referenceId: id,
              createdById: actorUserId,
            },
          });
        }

        return tx.purchase.findUniqueOrThrow({
          where: { id },
          include: this.detailInclude,
        });
      },
      { timeout: 15000, maxWait: 5000 },
    );
  }

  private readonly detailInclude = {
    supplier: { select: { id: true, name: true } },
    createdBy: { select: { id: true, name: true } },
    items: {
      include: { product: { select: { id: true, sku: true, name: true } } },
    },
  } satisfies Prisma.PurchaseInclude;

  private toItemData(i: PurchaseItemDto) {
    return {
      productId: i.productId,
      quantity: i.quantity,
      unitCost: i.unitCost,
      total: round2(i.quantity * i.unitCost),
    };
  }

  // Items are only editable while DRAFT. Recomputes totalCost from the
  // actual rows inside the same transaction so it can't drift from them.
  private async mutateDraft(
    id: string,
    change: (tx: Prisma.TransactionClient) => Promise<void>,
  ) {
    const purchase = await this.findOne(id);
    if (purchase.status !== 'DRAFT') {
      throw new ConflictException('Only a DRAFT purchase can be edited');
    }
    await this.prisma.$transaction(async (tx) => {
      await change(tx);
      const agg = await tx.purchaseItem.aggregate({
        where: { purchaseId: id },
        _sum: { total: true },
      });
      await tx.purchase.update({
        where: { id },
        data: { totalCost: agg._sum.total ?? 0 },
      });
    });
    return this.findOne(id);
  }

  private async transition(
    id: string,
    from: string[],
    to: 'ORDERED' | 'CANCELLED',
  ) {
    const claimed = await this.prisma.purchase.updateMany({
      where: { id, status: { in: from as ('DRAFT' | 'ORDERED')[] } },
      data: { status: to },
    });
    if (claimed.count === 0) {
      await this.findOne(id);
      throw new ConflictException(
        `Purchase cannot move to ${to} from its current status`,
      );
    }
    return this.findOne(id);
  }

  private async assertSupplier(supplierId: string) {
    const s = await this.prisma.supplier.findFirst({
      where: { id: supplierId, deletedAt: null },
    });
    if (!s) throw new NotFoundException(`Supplier ${supplierId} not found`);
  }

  private async assertProducts(productIds: string[]) {
    const unique = [...new Set(productIds)];
    const count = await this.prisma.product.count({
      where: { id: { in: unique }, deletedAt: null },
    });
    if (count !== unique.length) {
      throw new NotFoundException('One or more products were not found');
    }
  }
}
