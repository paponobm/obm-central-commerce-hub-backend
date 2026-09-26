import { IsEnum, IsOptional, IsString } from 'class-validator';
import { CustomerResponseStatus } from '@prisma/client';

export class UpdateCustomerResponseDto {
  @IsEnum(CustomerResponseStatus)
  customerResponse: CustomerResponseStatus;

  @IsOptional()
  @IsString()
  note?: string;
}
