import { IsString, MaxLength, MinLength } from 'class-validator';

export class SpecificationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  key: string;

  @IsString()
  @MaxLength(300)
  value: string;
}
