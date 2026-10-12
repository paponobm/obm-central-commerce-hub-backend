import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsObject,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

// A user's permission grants, split by scope: the "All Stores" set, plus an
// independent set per specific store (keyed by channel id). The two never
// merge — a permission on for one scope says nothing about another. See
// UserChannelPermission in the schema for why this isn't one flat list.
export class PermissionsByScopeDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allStores?: string[];

  @IsOptional()
  @IsObject()
  byChannel?: Record<string, string[]>;
}

export class CreateUserDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  roleId: string;

  // Ignored for Super Admin (always every permission). For every other
  // role this IS the user's actual access — see UsersService.create,
  // which also strips anything the target role isn't allowed to hold
  // (users.manage, channels.all_access for Member) regardless of what's
  // sent here.
  @IsOptional()
  @IsObject()
  permissions?: PermissionsByScopeDto;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
