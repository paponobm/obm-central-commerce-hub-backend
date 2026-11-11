import {
  ArrayMaxSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { HeroCouponDto } from './hero-coupon.dto';
import { HeroSlideDto } from './hero-slide.dto';
import { TrustBadgeDto } from './trust-badge.dto';
import { ComboBannerDto } from './combo-banner.dto';
import { FlashSaleDto } from './flash-sale.dto';
import { ReviewDto } from './review.dto';
import { HealthTipDto } from './health-tip.dto';
import { SocialLinkDto } from './social-link.dto';
import { SpendingRewardDto } from './spending-reward.dto';
import { QuantityDiscountDto } from './quantity-discount.dto';
import { CouponDto } from './coupon.dto';

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

  // The homepage "Build your own combo" promo banner(s) — admin-controlled
  // title/description, the "নতুন" badge toggle, and pricing-tier cards, up
  // to 2 separate combos (shown side by side on larger screens once there
  // are 2). Omitted/empty means no banner renders at all (no hardcoded
  // fallback — see StorefrontService.getConfig).
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => ComboBannerDto)
  comboBanners?: ComboBannerDto[];

  // The homepage "Flash Deal" section — which products, in what order, and
  // the countdown deadline. Omitted means the section doesn't render.
  @IsOptional()
  @ValidateNested()
  @Type(() => FlashSaleDto)
  flashSale?: FlashSaleDto;

  // Admin-entered customer testimonials — "কাস্টমারদের অভিজ্ঞতা" on the
  // homepage. Omitted/empty means the section doesn't render (no sample
  // reviews are ever shipped — see ReviewDto).
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ReviewDto)
  reviews?: ReviewDto[];

  // Admin-entered article teasers — "স্বাস্থ্য টিপস" on the homepage.
  // Omitted/empty means the section doesn't render.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => HealthTipDto)
  healthTips?: HealthTipDto[];

  // The side menu's "কাস্টমার কেয়ার" box — a single phone number shown
  // (and WhatsApp-linked/copyable) on the storefront. Omitted/blank hides
  // that box entirely.
  @IsOptional()
  @IsString()
  @MaxLength(30)
  customerCarePhone?: string;

  // The side menu's "আমাদের ফলো করুন" row — admin-picked platform (fixed
  // palette, see SocialLinkDto) + its URL. Omitted/empty means no row
  // renders.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => SocialLinkDto)
  socialLinks?: SocialLinkDto[];

  // The storefront cart's minimum order gate, in taka — the cart drawer
  // nudges the customer toward it, and StorefrontService.createOrder
  // rejects any order whose server-computed subtotal falls short.
  // Omitted/0 means no minimum.
  @IsOptional()
  @IsNumber()
  @Min(0)
  minimumOrderAmount?: number;

  // The storefront cart's stacked spend-more nudges, e.g.
  // { amount: 1300, description: 'ফ্রি ডেলিভারি', freeDelivery: true },
  // { amount: 2000, description: '১০% ছাড়', discountPercent: 10 } — the cart
  // drawer shows a progress bar toward whichever is next, and a standing
  // "অভিনন্দন…" success bar for each one already reached (stacked, lowest
  // amount first). `description` is just display text; `discountPercent`
  // and `freeDelivery` are real — see SpendingRewardDto. Omitted/empty
  // shows nothing.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => SpendingRewardDto)
  spendingRewards?: SpendingRewardDto[];

  // The product page's buy-box quantity tiers (and the cart drawer's "আর
  // ১টা নিলে …" hint) — e.g. { quantity: 2, discountPercent: 5 },
  // { quantity: 3, discountPercent: 10 }. Real: StorefrontService recomputes
  // and applies it server-side per line on order creation, same as
  // spendingRewards' discountPercent. Omitted/empty means every product's
  // buy-box only ever shows the single, undiscounted quantity-1 tile.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => QuantityDiscountDto)
  quantityDiscounts?: QuantityDiscountDto[];

  // The flat delivery charge (taka) the cart drawer and the real order
  // both add, unless the order already qualifies for a spendingRewards
  // tier with `freeDelivery` on — then it's waived in both places.
  // Omitted/0 means no delivery charge is ever added (same as today,
  // before this field existed).
  @IsOptional()
  @IsNumber()
  @Min(0)
  deliveryCharge?: number;

  // Settings → Other Settings → Coupons — admin-defined codes a customer
  // can type at checkout for a real, server-enforced percent off (see
  // CouponDto). Checked together with the hero banner's own coupon code
  // above (StorefrontService.createOrder merges both). Omitted/empty means
  // the checkout coupon field never matches anything.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => CouponDto)
  coupons?: CouponDto[];
}
