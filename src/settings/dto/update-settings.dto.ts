import {
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class UpdateSettingsDto {
  @IsOptional()
  @IsString()
  businessName?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  address?: string;

  // Applied to the inventory row of every NEW product; existing products
  // keep the threshold they already have.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  defaultLowStockThreshold?: number;
}
