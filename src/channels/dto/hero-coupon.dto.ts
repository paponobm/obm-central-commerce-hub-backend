import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

// The promo pill shown in the storefront hero banner (label + code), with
// its own on/off switch so it can be hidden without deleting the saved
// label/code.
export class HeroCouponDto {
  @IsBoolean()
  enabled: boolean;

  @IsString()
  @MaxLength(80)
  label: string;

  @IsString()
  @MaxLength(20)
  @Matches(/^[A-Za-z0-9]+$/, {
    message: 'code must contain only letters and numbers',
  })
  code: string;

  // The real discount this code applies at checkout (e.g. 10 for "১০%
  // ছাড়"). Optional/0 keeps this coupon purely cosmetic — it still shows
  // in the hero banner, but typing its code at checkout matches nothing.
  // Checked the same way as Settings → Other Settings → Coupons (see
  // CouponDto) — StorefrontService merges both into one lookup.
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  discountPercent?: number;
}
