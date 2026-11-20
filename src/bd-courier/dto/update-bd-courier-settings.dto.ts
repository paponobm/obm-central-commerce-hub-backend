import { IsString, MinLength } from 'class-validator';

export class UpdateBdCourierSettingsDto {
  // Always required on write — unlike Integration credentials, there's
  // only this one field, so there's no "leave it as it is" case to
  // support; clearing it is done via the dedicated disconnect endpoint.
  @IsString()
  @MinLength(1)
  apiKey: string;
}
