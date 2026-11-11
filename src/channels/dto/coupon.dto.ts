import {
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

// One admin-defined, code-redeemable coupon (Settings → Other Settings →
// Coupons) — e.g. { code: 'SAVE10', discountPercent: 10, description: 'নতুন
// গ্রাহক' }. Independent of the hero banner's own promotional coupon
// (HeroCouponDto), but checked together: StorefrontService merges both into
// one code → discountPercent lookup, matched case-insensitively against
// whatever the customer types at checkout.
export class CouponDto {
  @IsString()
  @MaxLength(20)
  code!: string;

  @IsNumber()
  @Min(0)
  @Max(100)
  discountPercent!: number;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  description?: string;
}
