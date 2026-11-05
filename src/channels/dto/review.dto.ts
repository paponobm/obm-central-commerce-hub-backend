import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

// Admin-entered customer testimonials for the storefront's "কাস্টমারদের
// অভিজ্ঞতা" section — not a public review-submission form; the admin types
// in reviews they've actually collected (e.g. over WhatsApp/phone), same
// curated-content pattern as comboBanners/flashSale. `productId` is
// optional and resolved against this channel's live products at read time
// (see StorefrontService), so a product that's since been removed just
// drops the link instead of showing a dead one.
export class ReviewDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  customerName: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  location?: string;

  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  text: string;

  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
