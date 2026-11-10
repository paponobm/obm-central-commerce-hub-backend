import {
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

// One row in the product page's buy-box quantity tiers (and the cart
// drawer's matching "আর ১টা নিলে …" hint) — e.g.
// { quantity: 2, discountPercent: 5 }, { quantity: 3, discountPercent: 10 }.
// Quantity 1 is always the free baseline tile and isn't configured here.
// The highest-quantity tier a line's quantity actually reaches wins (not
// stacked). `description` is an optional override for the tile's badge
// text — left blank, the storefront generates "X% বাড়তি ছাড়" from the
// percent itself.
export class QuantityDiscountDto {
  @IsNumber()
  @Min(2)
  quantity!: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  discountPercent!: number;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  description?: string;
}
