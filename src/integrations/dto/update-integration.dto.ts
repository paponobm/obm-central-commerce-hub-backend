import {
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class UpdateIntegrationDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  label?: string;

  // Merged into the existing (decrypted) credential set, not a full
  // replace — a key with an empty/omitted value leaves that field as it
  // was, so updating the label doesn't require re-entering secrets. See
  // IntegrationsService.update.
  @IsOptional()
  @IsObject()
  credentials?: Record<string, string>;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}
