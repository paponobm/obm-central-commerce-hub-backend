import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

// The order-confirmation page's "একই পার্সেলে যোগ করুন, ডেলিভারি চার্জ লাগবে
// না" upsell strip — admin-curated products (same productIds pattern as
// FlashSaleDto/CartSuggestionsDto), a relative countdown length (not an
// absolute deadline — it starts fresh from when each customer lands on their
// own confirmation page, unlike Flash Sale's single shared deadline), and the
// extra discount percent advertised for adding a product to the same parcel.
export class CheckoutUpsellDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  // Minutes the countdown runs for, starting when the confirmation page
  // loads. Omitted/0 means the section still shows (if enabled) without a
  // countdown.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  durationMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  discountPercent?: number;

  // Order here IS display order, same as FlashSaleDto.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  productIds?: string[];
}
