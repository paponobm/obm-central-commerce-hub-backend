import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

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

  // Which stores this user can see/act on. Meaningless (but harmless to
  // store) for a role that also holds channels.all_access — that
  // permission ignores UserChannel entirely. Omit or pass [] for a role
  // with no channel-restricted permissions.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  channelIds?: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
