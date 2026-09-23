import { IsIn, IsInt, IsOptional, IsString, NotEquals } from 'class-validator';

// Manual stock-count correction ("Stock Adjustment" screen) is the only
// thing this endpoint drives. PURCHASE/RETURN/RESERVE/DEDUCT movements are
// written by their own workflows (purchases, orders) — never through here.
export class AdjustInventoryDto {
  @IsInt()
  @NotEquals(0, { message: 'delta must be a non-zero integer' })
  delta: number;

  @IsOptional()
  @IsIn(['ADJUSTMENT', 'DAMAGE'])
  type?: 'ADJUSTMENT' | 'DAMAGE';

  @IsOptional()
  @IsString()
  note?: string;
}
