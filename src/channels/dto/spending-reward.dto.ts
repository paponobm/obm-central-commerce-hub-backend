import {
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

// One milestone row in the cart drawer's stacked "আর ৳X নিলে …" nudges —
// e.g. { amount: 1300, description: 'ফ্রি ডেলিভারি' } or
// { amount: 2000, description: '১০% ছাড়', discountPercent: 10 }.
// `description` is plain admin-written text, same as TrustBadgeDto's — it
// only drives what the storefront shows. `discountPercent` is the one field
// that's actually real: when set, StorefrontService.createOrder applies it
// (the highest-amount qualifying tier's percent, off the server-computed
// subtotal) to the order it creates, same way minimumOrderAmount is
// server-enforced rather than cosmetic.
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
}
