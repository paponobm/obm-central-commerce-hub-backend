import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

// Deliberately has no price/discount fields — unlike the admin
// CreateOrderItemDto. A public checkout endpoint must never accept a
// client-supplied price; it's always resolved server-side from this
// channel's published ProductChannel price (or, when variantId is set,
// from that ProductVariant's own basePrice — see OrdersService.createOrder).
export class StorefrontOrderItemDto {
  @IsString()
  productId: string;

  @IsOptional()
  @IsString()
  variantId?: string;

  @IsInt()
  @Min(1)
  quantity: number;

  // A client-assigned grouping key, shared by every line that was added
  // together as one "Build your own combo" bundle (see ComboBuilder). Only
  // ever used for grouping — never trusted as a price or discount; the
  // group's subtotal and its qualifying tier are both recomputed
  // server-side from real prices (StorefrontService.createOrder).
  @IsOptional()
  @IsString()
  @MaxLength(40)
  comboGroupId?: string;
}
