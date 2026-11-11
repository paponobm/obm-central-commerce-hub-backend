import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaymentMethod } from '@prisma/client';
import { StorefrontOrderItemDto } from './storefront-order-item.dto';

export class StorefrontCreateOrderDto {
  @IsString()
  @MinLength(1)
  customerName: string;

  @IsString()
  @MinLength(5)
  customerPhone: string;

  @IsOptional()
  @IsEmail()
  customerEmail?: string;

  @IsString()
  @MinLength(1)
  shippingAddress: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StorefrontOrderItemDto)
  items: StorefrontOrderItemDto[];

  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @IsOptional()
  @IsString()
  notes?: string;

  // The code typed into the checkout coupon field, if any. Matched
  // case-insensitively server-side (StorefrontService.createOrder) against
  // the channel's configured coupons — never trusted for the discount
  // amount itself, only as a lookup key.
  @IsOptional()
  @IsString()
  @MaxLength(20)
  couponCode?: string;
}
