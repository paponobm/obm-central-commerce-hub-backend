import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { HeroCouponDto } from './hero-coupon.dto';
import { HeroSlideDto } from './hero-slide.dto';

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
}
