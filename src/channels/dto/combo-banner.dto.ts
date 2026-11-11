import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

// One pricing-tier card in the homepage "Build your own combo" banner
// (e.g. "৳১,২০০+" / "ফ্রি ডেলিভারি").
export class ComboTierDto {
  @IsString()
  @MaxLength(60)
  title: string;

  // Multi-line — the storefront renders each \n as its own line in the card.
  @IsString()
  @MaxLength(160)
  description: string;

  // Off tiers stay in the admin's list (so they can be re-enabled) but are
  // never shown on the storefront — same convention as trust badges.
  @IsBoolean()
  enabled: boolean;

  // The real discount this tier applies (e.g. 6 for "+ ৬% ছাড়"), off the
  // amount parsed from `title` (e.g. "৳১,২০০+" -> 1200). Checked against the
  // combo-builder group's own server-computed subtotal when the order is
  // actually created (StorefrontService.createOrder) — the only thing that
  // discounts a combo line (its own quantity-tier discount never also
  // applies once it's in a combo). Optional/0 keeps the card purely
  // informational, same as before this field existed.
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  discountPercent?: number;

  // Waives Settings → Other Settings → Delivery charge for the whole order
  // once this combo group's own subtotal reaches this tier — same real
  // server-enforced waiver as a spend-more reward's own `freeDelivery` (see
  // SpendingRewardDto). Optional/false keeps the card's "ফ্রি ডেলিভারি" text
  // purely cosmetic, same as before this field existed.
  @IsOptional()
  @IsBoolean()
  freeDelivery?: boolean;
}

export class ComboBannerDto {
  // The red "নতুন" eyebrow tag above the title.
  @IsBoolean()
  newBadge: boolean;

  @IsString()
  @MaxLength(80)
  title: string;

  @IsString()
  @MaxLength(160)
  description: string;

  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ComboTierDto)
  tiers: ComboTierDto[];

  // Off combos stay in the admin's list (so they can be re-enabled) but are
  // never shown on the storefront — same convention as trust badges/tiers.
  @IsBoolean()
  enabled: boolean;
}
