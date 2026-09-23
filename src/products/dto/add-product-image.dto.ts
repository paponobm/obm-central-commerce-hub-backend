import { IsInt, IsOptional, IsString, MinLength } from 'class-validator';

export class AddProductImageDto {
  @IsString()
  @MinLength(1)
  url: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
