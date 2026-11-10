import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

// One milestone row in the cart drawer's stacked "আর ৳X নিলে …" nudges —
// e.g. { amount: 1300, description: 'ফ্রি ডেলিভারি', freeDelivery: true } or
// { amount: 2000, description: '১০% ছাড়', discountPercent: 10 }.
// `description` is plain admin-written text, same as TrustBadgeDto's — it
// only drives what the storefront shows. `discountPercent` and
// `freeDelivery` are the two fields that are actually real: when set,
// StorefrontService.createOrder applies the highest-amount qualifying
// tier's percent (off the server-computed subtotal) as the order's
// discount, and waives Settings → Other Settings → Delivery charge
// whenever any qualifying tier has `freeDelivery` on — same way
// minimumOrderAmount is server-enforced rather than cosmetic.
export class SpendingRewardDto {
  @IsNumber()
  @Min(0)
  amount!: number;

  @IsString()
  @MaxLength(60)
  description!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  discountPercent?: number;

  @IsOptional()
  @IsBoolean()
  freeDelivery?: boolean;
}
