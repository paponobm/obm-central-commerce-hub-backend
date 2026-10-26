import { IsOptional, IsBoolean } from 'class-validator';

export class AcquireLockDto {
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
