import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

// Admin-entered sections for the storefront's /policy page ("ডেলিভারি ও
// রিটার্ন নীতি") — a title plus a list of lines, rendered as a bulleted list,
// same shape the page's two original hardcoded sections (ডেলিভারি, রিটার্ন ও
// বদল) already used. Order here IS display order; empty/omitted on the
// channel falls back to those same two defaults (see StorefrontService).
export class PolicySectionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  points?: string[];

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
