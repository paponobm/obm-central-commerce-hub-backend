import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsString,
  MaxLength,
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
