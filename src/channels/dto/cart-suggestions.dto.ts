import { ArrayMaxSize, IsArray, IsOptional, IsString } from 'class-validator';

// The storefront cart drawer's "Suggested Products for you" row — which
// products show, in what order. Same pattern as FlashSaleDto (plain ids,
// resolved against this channel's live ProductChannel rows at read time —
// see StorefrontService.getCartSuggestions), but no `enabled` flag or
// countdown: an empty list already means nothing shows, same honesty rule
// as trustBadges/comboBanners.
export class CartSuggestionsDto {
  // Order here IS the display order (Settings → Badge & Category → Cart
  // Suggestions, numbered list).
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  productIds?: string[];
}
