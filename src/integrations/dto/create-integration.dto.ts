import { IntegrationProvider } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class CreateIntegrationDto {
  @IsEnum(IntegrationProvider)
  provider: IntegrationProvider;

  @IsString()
  @MinLength(1)
  label: string;

  // Raw values in transit over HTTPS; encrypted by IntegrationsService
  // before anything touches the database. Shape/keys come from that
  // provider's own CourierAdapter.credentialFields (see
  // GET /admin/integrations/providers) — not fixed here, since different
  // couriers need different fields.
  @IsOptional()
  @IsObject()
  credentials?: Record<string, string>;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}
