import { IsInt, IsOptional, IsString, Min } from 'class-validator';

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
}
