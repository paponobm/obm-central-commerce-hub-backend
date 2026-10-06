import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { StorefrontOrderItemDto } from './storefront-order-item.dto';

// Sent as the customer types. Only a valid 11-digit mobile number is needed
// to keep the checkout as an Incomplete lead; name and address are optional.
export class StorefrontCheckoutLeadDto {
  @IsString()
  @Matches(/^01\d{9}$/, {
    message: 'customerPhone must be an 11-digit mobile number starting with 01',
  })
  customerPhone: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  customerName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  shippingAddress?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StorefrontOrderItemDto)
  items: StorefrontOrderItemDto[];
}
