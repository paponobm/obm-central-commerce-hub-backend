import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CreateProductVariantDto } from './create-product-variant.dto';
import { SpecificationDto } from './specification.dto';

export class CreateProductDto {
  @IsString()
  @MinLength(1)
  sku: string;

  @IsString()
  @MinLength(1)
  name: string;

  @IsOptional()
  @IsString()
  slogan?: string;

  @IsOptional()
  @IsString()
  shortDescription?: string;

  // Rich-text HTML from the admin's description editor.
  @IsOptional()
  @IsString()
  description?: string;

  // Admin-chosen default URL slug — used as the fallback when publishing to
  // a channel that doesn't already have its own ProductChannel.slug.
  @IsOptional()
  @IsString()
  slug?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => SpecificationDto)
  specifications?: SpecificationDto[];

  // "কার জন্য" tags (e.g. "পরিবারের জন্য") — multi-select, unlike Origin.
  // Not a fixed enum: any string is accepted, since the admin UI's own
  // checkbox list is just the distinct set already used across every
  // product (see ProductsService.listForWhoTags).
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  forWho?: string[];

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  costPrice: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  basePrice: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  compareAtPrice?: number;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsString()
  importCountry?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  brandId?: string;

  @IsOptional()
  @IsString()
  thumbnailUrl?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  // Set by the New Product page's "Save as Draft" button. The service
  // forces isActive to false whenever this is true, regardless of what
  // isActive was sent as — never trust the client for that pairing.
  @IsOptional()
  @IsBoolean()
  isDraft?: boolean;

  @IsOptional()
  @IsBoolean()
  hasVariants?: boolean;

  // The attribute name behind this product's variants (e.g. "সাইজ",
  // "ফ্লেভার") — set from the Pricing & Variants "Step 1 — Options"
  // generator when exactly one attribute was used. Omitted/null means the
  // storefront shows a generic "ভ্যারিয়েন্ট" label instead.
  @IsOptional()
  @IsString()
  variantOptionLabel?: string;

  // Only meaningful when hasVariants is false — the master Inventory row's
  // starting currentStock. Ignored (variant stocks are summed instead) when
  // variants are present.
  @IsOptional()
  @IsNumber()
  @Min(0)
  initialStock?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateProductVariantDto)
  variants?: CreateProductVariantDto[];

  // Channels to publish to immediately at creation — each gets a
  // ProductChannel row with isPublished: true. Optional; a product can
  // still be created unpublished and wired up later from its own page.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  channelIds?: string[];

  // Extra storefront categories (ProductCategory tags), on top of the
  // single `categoryId` above.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  categoryIds?: string[];
}
