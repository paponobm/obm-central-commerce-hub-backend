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

  async findAll(filters: {
    lowStockOnly?: boolean;
    search?: string;
    // Opt-in only (the Inventory page's own list) — everything else calling
    // this (the summary cards, Low Stock page, channel Inventory page)
    // keeps getting exactly one row per product, same as before this
    // existed.
    expandVariants?: boolean;
  }) {
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
      include: {
        product: {
          select: {
            id: true,
            sku: true,
            name: true,
            thumbnailUrl: true,
            isActive: true,
            images: { take: 1, orderBy: { sortOrder: 'asc' } },
            hasVariants: true,
            variants: {
              where: { deletedAt: null, isActive: true },
              orderBy: { sortOrder: 'asc' },
            },
          },
        },
      },
      orderBy: { product: { name: 'asc' } },
    });

    const withAvailable = rows.flatMap((row) => {
      const baseImageUrl =
        row.product.thumbnailUrl ?? row.product.images[0]?.url ?? null;

      // A variant product's real stock lives per-variant (see
      // ProductsService.applyVariantStockDelta, which keeps this row's own
      // currentStock as their sum) — expanding here surfaces that real
      // breakdown instead of just the one combined number. reservedStock
      // has no per-variant equivalent in the schema, so each variant row
      // only ever shows its own stock as "available."
      if (filters.expandVariants && row.product.hasVariants && row.product.variants.length > 0) {
        return row.product.variants.map((v) => ({
          productId: row.productId,
          variantId: v.id,
          sku: v.sku,
          name: v.unitLabel ? `${row.product.name} (${v.unitLabel})` : row.product.name,
          imageUrl: v.imageUrl ?? baseImageUrl,
          isActive: row.product.isActive,
          currentStock: v.stock,
          reservedStock: 0,
          availableStock: v.stock,
          lowStockThreshold: row.lowStockThreshold,
          isLowStock: v.stock <= row.lowStockThreshold,
          updatedAt: v.updatedAt,
        }));
      }

      return [
        {
          productId: row.productId,
          variantId: null as string | null,
          sku: row.product.sku,
          name: row.product.name,
          imageUrl: baseImageUrl,
          isActive: row.product.isActive,
          currentStock: row.currentStock,
          reservedStock: row.reservedStock,
          availableStock: row.currentStock - row.reservedStock,
          lowStockThreshold: row.lowStockThreshold,
          isLowStock: row.currentStock <= row.lowStockThreshold,
          updatedAt: row.updatedAt,
        },
      ];
    });

    return filters.lowStockOnly
      ? withAvailable.filter((r) => r.isLowStock)
      : withAvailable;
  }

  async findOne(productId: string) {
    const row = await this.prisma.inventory.findUnique({
      where: { productId },
      include: {
        product: {
          select: {
            id: true,
            sku: true,
            name: true,
            thumbnailUrl: true,
            isActive: true,
            images: { take: 1, orderBy: { sortOrder: 'asc' } },
          },
        },
      },
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
      imageUrl: row.product.thumbnailUrl ?? row.product.images[0]?.url ?? null,
      isActive: row.product.isActive,
      currentStock: row.currentStock,
      reservedStock: row.reservedStock,
      availableStock: row.currentStock - row.reservedStock,
      lowStockThreshold: row.lowStockThreshold,
      isLowStock: row.currentStock <= row.lowStockThreshold,
      updatedAt: row.updatedAt,
    };
  }

  // Ledger across every product, newest first — the "Stock Movements" page.
  async getAllMovements(take = 100) {
    const rows = await this.prisma.stockMovement.findMany({
      orderBy: { createdAt: 'desc' },
      take,
      include: {
        createdBy: { select: { id: true, name: true } },
        product: {
          select: {
            id: true,
            sku: true,
            name: true,
            thumbnailUrl: true,
            images: { take: 1, orderBy: { sortOrder: 'asc' } },
          },
        },
      },
    });
    return rows.map((row) => ({
      ...row,
      product: row.product && {
        id: row.product.id,
        sku: row.product.sku,
        name: row.product.name,
        imageUrl: row.product.thumbnailUrl ?? row.product.images[0]?.url ?? null,
      },
    }));
  }

  async getMovements(productId: string, take = 50) {
    await this.assertInventoryExists(productId);
    const rows = await this.prisma.stockMovement.findMany({
      where: { productId },
      orderBy: { createdAt: 'desc' },
      take,
      include: {
        createdBy: { select: { id: true, name: true } },
        product: {
          select: {
            id: true,
            sku: true,
            name: true,
            thumbnailUrl: true,
            images: { take: 1, orderBy: { sortOrder: 'asc' } },
          },
        },
      },
    });
    return rows.map((row) => ({
      ...row,
      product: row.product && {
        id: row.product.id,
        sku: row.product.sku,
        name: row.product.name,
        imageUrl: row.product.thumbnailUrl ?? row.product.images[0]?.url ?? null,
      },
    }));
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

  async updateThreshold(productId: string, lowStockThreshold: number) {
    await this.assertInventoryExists(productId);
    const row = await this.prisma.inventory.update({
      where: { productId },
      data: { lowStockThreshold },
    });
    return {
      productId: row.productId,
      lowStockThreshold: row.lowStockThreshold,
    };
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
