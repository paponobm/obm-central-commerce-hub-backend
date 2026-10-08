import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { PaymentMethod } from '@prisma/client';

// Editing an existing payment (Edit Order's Advance Payment section) rather
// than recording a new one — amount is whole-number only per that screen's
// requirement, unlike RecordPaymentDto which allows cents.
export class UpdatePaymentDto {
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 0 })
  @Min(1)
  amount?: number;

  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  @IsOptional()
  @IsString()
  transactionId?: string;
}
