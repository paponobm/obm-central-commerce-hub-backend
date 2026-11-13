import { IsString } from 'class-validator';

// The order-confirmation page's "একই পার্সেলে যোগ করুন" strip — adds one
// admin-curated product to an order the customer just placed. No
// price/discount fields, same reasoning as StorefrontOrderItemDto: both are
// always resolved server-side (StorefrontService.addUpsellItem), never
// trusted from the client.
export class StorefrontAddUpsellItemDto {
  @IsString()
  productId: string;
}
