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

// Admin-entered article teasers for the storefront's "স্বাস্থ্য টিপস"
// section — same curated-content pattern as reviews/comboBanners, not a
// real blog (no article body/page exists yet, just the teaser card).
// `categoryId` is optional and resolved against the shared, global Category
// table at read time (see StorefrontService), the same category set
// products use — so a tip's color/label always matches a real category.
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

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
