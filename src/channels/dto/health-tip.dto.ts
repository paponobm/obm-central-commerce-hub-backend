import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

// Admin-entered articles for the storefront's "স্বাস্থ্য টিপস" section — a
// teaser card (title/category/read time) that now links to a real detail
// page: an intro description plus a numbered list of points. Still not a
// full blog (no rich text/images), same curated-content pattern as
// reviews/comboBanners. `categoryId` is optional and resolved against the
// shared, global Category table at read time (see StorefrontService), the
// same category set products use. The detail page's "এই সমস্যায় কাজে লাগবে"
// row prefers `productIds` (specific, admin-picked products, resolved the
// same way as Cart Suggestions/Quiz) when set, falling back to the tip's
// own category otherwise — so a tip gets a real, relevant row even before
// anyone picks exact products for it.
export class HealthTipDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  readMinutes?: number;

  // The detail page's intro paragraph, under the title.
  @IsOptional()
  @IsString()
  @MaxLength(600)
  description?: string;

  // The detail page's numbered list (১, ২, ৩…) — display order is array
  // order, same convention as every other admin-ordered list in this app.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  points?: string[];

  // The detail page's "এই সমস্যায় কাজে লাগবে" row — specific products,
  // resolved against this channel's live ProductChannel rows at read time,
  // same pattern as Cart Suggestions. Order here IS display order.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  productIds?: string[];

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
