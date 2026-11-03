import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { HeroCouponDto } from './hero-coupon.dto';
import { HeroSlideDto } from './hero-slide.dto';
import { TrustBadgeDto } from './trust-badge.dto';
import { ComboBannerDto } from './combo-banner.dto';

// Grows as more per-storefront cosmetic config lands (WhatsApp number,
// etc.) — each a validated optional sub-object here, merged (not replaced)
// into Channel.themeConfig by ChannelsService.update.
export class ChannelThemeConfigDto {
  // Default coupon pill — used whenever a hero slide doesn't define its own.
  @IsOptional()
  @ValidateNested()
  @Type(() => HeroCouponDto)
  heroCoupon?: HeroCouponDto;

  // Hero banner slideshow — each image optionally overrides the title,
  // description and/or coupon shown while it's active; unset fields fall
  // back to the storefront's defaults. Empty/omitted means the hero stays
  // the plain color background with just the default text.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => HeroSlideDto)
  heroSlides?: HeroSlideDto[];

  // The trust badges under the hero (e.g. "১০০% আসল পণ্য", delivery fee,
  // free-delivery threshold) — admin-controlled text + an icon picked from
  // TrustBadgeDto's fixed palette. Empty/omitted falls back to the
  // storefront's own defaults.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => TrustBadgeDto)
  trustBadges?: TrustBadgeDto[];

  // Which of the shared, global categories (Category is not channel-scoped
  // in this schema) this storefront's category grid/filters include.
  // Omitted/empty means "no restriction" — every published category shows,
  // matching the original behavior before this field existed.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  categorySlugs?: string[];

  // The homepage "Build your own combo" promo banner — admin-controlled
  // title/description, the "নতুন" badge toggle, and its pricing-tier cards.
  // Omitted entirely means the banner doesn't render at all (no hardcoded
  // fallback — see StorefrontService.getConfig).
  @IsOptional()
  @ValidateNested()
  @Type(() => ComboBannerDto)
  comboBanner?: ComboBannerDto;
}
