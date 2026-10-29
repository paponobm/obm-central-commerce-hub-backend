import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { IntegrationProvider, OrderStatus, ScanMode } from '@prisma/client';

// What the Scan To Update page posts after every scan attempt — success or
// failure — so Scan History has a complete record. orderId/orderNumber are
// omitted on a miss (order not found); fromStatus/toStatus are omitted when
// the order was found but rejected as ineligible for the chosen mode.
export class CreateScanEventDto {
  @IsEnum(ScanMode)
  mode: ScanMode;

  @IsString()
  query: string;

  @IsOptional()
  @IsString()
  orderId?: string;

  @IsOptional()
  @IsString()
  orderNumber?: string;

  @IsOptional()
  @IsEnum(OrderStatus)
  fromStatus?: OrderStatus;

  @IsOptional()
  @IsEnum(OrderStatus)
  toStatus?: OrderStatus;

  @IsBoolean()
  success: boolean;

  @IsString()
  message: string;

  @IsOptional()
  @IsString()
  channelId?: string;

  @IsOptional()
  @IsEnum(IntegrationProvider)
  provider?: IntegrationProvider;
}
