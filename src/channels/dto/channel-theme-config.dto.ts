import { IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { HeroCouponDto } from './hero-coupon.dto';

// Grows as more per-storefront cosmetic config lands (banner, WhatsApp
// number, etc.) — each a validated optional sub-object here, merged (not
// replaced) into Channel.themeConfig by ChannelsService.update.
export class ChannelThemeConfigDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => HeroCouponDto)
  heroCoupon?: HeroCouponDto;
}
