import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { OrderSource, PaymentMethod } from '@prisma/client';
import { CreateOrderItemDto } from './create-order-item.dto';

export class CreateOrderDto {
  @IsEnum(OrderSource)
  source: OrderSource;

  // "None" per the manual-order spec — a phone/manual order isn't
  // necessarily tied to any storefront.
  @IsOptional()
  @IsString()
  channelId?: string;

  // Existing customer wins if provided; otherwise customerName+customerPhone
  // create (or, if that phone already exists, reuse) a customer.
  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  customerName?: string;

  @IsOptional()
  @IsString()
  customerPhone?: string;

  @IsOptional()
  @IsEmail()
  customerEmail?: string;

  // Shipping snapshot — falls back to the customer's own info when omitted.
  @IsOptional()
  @IsString()
  shippingName?: string;

  @IsOptional()
  @IsString()
  shippingPhone?: string;

  @IsOptional()
  @IsString()
  shippingAddress?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items: CreateOrderItemDto[];

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  discount?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  shippingFee?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  // true = collected in full at order time (e.g. bKash confirmed up front).
  // Omitted/false = UNPAID (COD, "due" per the manual-order spec).
  @IsOptional()
  @IsBoolean()
  isPaid?: boolean;
}
