import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { BD_DISTRICT_NAMES } from '../../common/bd-districts.util';

export class CreateCustomerDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsString()
  @MinLength(5)
  phone: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  city?: string;

  // Manual override / manual-assignment save — always one of the 64 known
  // districts, never free text (auto-detection writes it separately via
  // CustomersService.detectDistricts, which bypasses this DTO).
  @IsOptional()
  @IsIn(BD_DISTRICT_NAMES)
  district?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
