import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { runTransaction } from '../common/prisma-transaction.util';
import { AdjustInventoryDto } from './dto/adjust-inventory.dto';

interface InventoryRow {
  id: string;
  productId: string;
  currentStock: number;
  reservedStock: number;
  lowStockThreshold: number;
  updatedAt: Date;
}

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(filters: { lowStockOnly?: boolean; search?: string }) {
    const rows = await this.prisma.inventory.findMany({
      where: {
        ...(filters.search
          ? {
              product: {
                OR: [
                  { name: { contains: filters.search, mode: 'insensitive' } },
                  { sku: { contains: filters.search, mode: 'insensitive' } },
                ],
              },
            }
          : {}),
      },
      include: { product: { select: { id: true, sku: true, name: true } } },
      orderBy: { product: { name: 'asc' } },
    });

    const withAvailable = rows.map((row) => ({
      productId: row.productId,
      sku: row.product.sku,
      name: row.product.name,
      currentStock: row.currentStock,
      reservedStock: row.reservedStock,
      availableStock: row.currentStock - row.reservedStock,
      lowStockThreshold: row.lowStockThreshold,
      isLowStock: row.currentStock <= row.lowStockThreshold,
      updatedAt: row.updatedAt,
    }));

    return filters.lowStockOnly
      ? withAvailable.filter((r) => r.isLowStock)
      : withAvailable;
  }

  async findOne(productId: string) {
    const row = await this.prisma.inventory.findUnique({
      where: { productId },
      include: { product: { select: { id: true, sku: true, name: true } } },
    });
    if (!row) {
      throw new NotFoundException(
        `No inventory record for product ${productId}`,
      );
    }
    return {
      productId: row.productId,
      sku: row.product.sku,
      name: row.product.name,
      currentStock: row.currentStock,
      reservedStock: row.reservedStock,
      availableStock: row.currentStock - row.reservedStock,
      lowStockThreshold: row.lowStockThreshold,
      isLowStock: row.currentStock <= row.lowStockThreshold,
      updatedAt: row.updatedAt,
    };
  }

  async getMovements(productId: string, take = 50) {
    await this.assertInventoryExists(productId);
    return this.prisma.stockMovement.findMany({
      where: { productId },
      orderBy: { createdAt: 'desc' },
      take,
      include: { createdBy: { select: { id: true, name: true } } },
    });
  }

  // The only sanctioned way to touch currentStock outside the order-reserve
  // flow. Uses an atomic conditional UPDATE (see ARCHITECTURE.md §7.3) so
  // two concurrent adjustments on the same product can never both succeed
  // past zero stock — Postgres serializes the two UPDATEs on the row, the
  // second re-evaluates the WHERE clause against the first's committed
  // result and simply matches no rows if it would go negative.
  async adjust(
    productId: string,
    dto: AdjustInventoryDto,
    actorUserId: string,
  ) {
    await this.assertInventoryExists(productId);

    const type = dto.type ?? 'ADJUSTMENT';
    if (type === 'DAMAGE' && dto.delta > 0) {
      throw new BadRequestException('DAMAGE adjustments must be negative');
    }

    return runTransaction(this.prisma, async (tx) => {
      const rows = await tx.$queryRaw<InventoryRow[]>`
        UPDATE inventory
        SET "currentStock" = "currentStock" + ${dto.delta}, "updatedAt" = now()
        WHERE "productId" = ${productId}
          AND ("currentStock" + ${dto.delta}) >= 0
        RETURNING *
      `;

      if (rows.length === 0) {
        throw new ConflictException(
          'Adjustment would take stock below zero for this product',
        );
      }

      const updated = rows[0];
      const movement = await tx.stockMovement.create({
        data: {
          productId,
          type,
          quantity: dto.delta,
          balanceAfter: updated.currentStock,
          referenceType: 'MANUAL_ADJUSTMENT',
          note: dto.note,
          createdById: actorUserId,
        },
      });

      return {
        inventory: {
          productId: updated.productId,
          currentStock: updated.currentStock,
          reservedStock: updated.reservedStock,
          availableStock: updated.currentStock - updated.reservedStock,
        },
        movement,
      };
    });
  }

  private async assertInventoryExists(productId: string) {
    const exists = await this.prisma.inventory.findUnique({
      where: { productId },
      select: { productId: true },
    });
    if (!exists) {
      throw new NotFoundException(
        `No inventory record for product ${productId}`,
      );
    }
  }
}
