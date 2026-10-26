import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsObject,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { PermissionsByScopeDto } from './create-user.dto';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  @IsOptional()
  @IsString()
  roleId?: string;

  // When provided, REPLACES the user's full permission set — not a merge.
  // Omit to leave it untouched. Ignored for Super Admin; see
  // UsersService.create for what's stripped regardless of role. Store
  // assignment is derived from this (see UsersService.update) rather than
  // being a separate field — granting a permission under a specific
  // store's scope is what assigns the user to that store.
  @IsOptional()
  @IsObject()
  permissions?: PermissionsByScopeDto;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  // Purely informational profile fields — no auth/permission meaning.
  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  employeeCode?: string;

  @IsOptional()
  @IsString()
  gender?: string;

  @IsOptional()
  @IsDateString()
  joiningDate?: string;

  @IsOptional()
  @IsString()
  shift?: string;

  @IsOptional()
  @IsString()
  designation?: string;

  @IsOptional()
  @IsString()
  about?: string;
}
