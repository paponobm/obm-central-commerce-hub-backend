import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MaxLength,
  ValidateNested,
} from 'class-validator';

class CheckoutLeadItemDto {
  @IsString()
  productId: string;

  @IsInt()
  @Min(1)
  quantity: number;

  // Optional: when omitted the channel's price is used.
  @IsOptional()
  @IsNumber()
  @Min(0)
  unitPrice?: number;
}

// Admin edits to an Incomplete checkout, saved from Order actions.
export class UpdateCheckoutLeadDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  customerName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  shippingAddress?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CheckoutLeadItemDto)
  items?: CheckoutLeadItemDto[];
}
