import { IsEnum, IsOptional, IsString } from 'class-validator';
import { OverdueResponse } from '@prisma/client';

export class UpdateOverdueResponseDto {
  @IsEnum(OverdueResponse)
  overdueResponse: OverdueResponse;

  @IsOptional()
  @IsString()
  note?: string;
}
