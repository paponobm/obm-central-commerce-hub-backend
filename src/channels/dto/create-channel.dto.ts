import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ChannelThemeConfigDto } from './channel-theme-config.dto';

export class CreateChannelDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  // Used verbatim in URLs (/api/store/:slug/*) and as NEXT_PUBLIC_CHANNEL —
  // lowercase kebab-case only, so it never needs encoding.
  @IsString()
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase kebab-case, e.g. "burmese-market"',
  })
  slug: string;

  @IsOptional()
  @IsString()
  domain?: string;

  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => ChannelThemeConfigDto)
  themeConfig?: ChannelThemeConfigDto;
}
