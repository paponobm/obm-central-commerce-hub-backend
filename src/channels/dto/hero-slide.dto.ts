import {
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { HeroCouponDto } from './hero-coupon.dto';

// One hero slideshow image, with its own optional title/description/coupon
// overrides. Any field left unset falls back to the storefront's default
// (the hardcoded title, the configured default description, the channel's
// default heroCoupon) — see StorefrontService.getConfig.
export class HeroSlideDto {
  @IsUrl({ require_tld: false })
  image: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(220)
  description?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => HeroCouponDto)
  coupon?: HeroCouponDto;
}
