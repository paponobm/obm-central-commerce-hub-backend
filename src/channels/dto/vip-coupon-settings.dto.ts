import { IsNumber, IsOptional, Max, Min } from 'class-validator';

// Settings → VIP কুপন — the one real, admin-set number behind every
// auto-generated VIP coupon (see VipCoupon): the discount percent each new
// code carries. The codes themselves are never admin-typed — the backend
// generates a fresh, unique one the moment an order qualifies (its own
// combo group reaching a VIP-flagged pricing tier — see ComboTierDto.vip).
export class VipCouponSettingsDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  discountPercent?: number;
}
