import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
} from 'class-validator';

// The homepage "Flash Deal" section — which products show, in what order,
// and the countdown deadline. Product selection/order lives here as plain
// ids (not a separate table) since it's purely admin-curated display state,
// the same pattern as comboBanners. The storefront resolves each id against
// this channel's live ProductChannel rows at read time, so a product that's
// since been unpublished or deleted just silently drops out — never a dead
// link.
export class FlashSaleDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  // ISO datetime string — the countdown's deadline. Null/omitted means the
  // section still shows (if enabled) but without a countdown.
  @IsOptional()
  @IsString()
  endsAt?: string | null;

  // Order here IS the display order (Settings → Flash Sale, numbered list).
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  productIds?: string[];
}
