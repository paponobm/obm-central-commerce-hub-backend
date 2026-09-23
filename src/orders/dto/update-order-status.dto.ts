import { IsEnum, IsIn, IsOptional, IsString } from 'class-validator';
import { OrderStatus } from '@prisma/client';

export class UpdateOrderStatusDto {
  @IsEnum(OrderStatus)
  status: OrderStatus;

  @IsOptional()
  @IsString()
  note?: string;

  // Only meaningful when status is RETURNED. 'restock' (default) adds the
  // goods back to currentStock; 'write_off' logs the return without
  // touching stock (damaged/unsellable).
  @IsOptional()
  @IsIn(['restock', 'write_off'])
  returnAction?: 'restock' | 'write_off';
}
