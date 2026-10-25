import { IsArray, IsString } from 'class-validator';

export class SetProductCategoriesDto {
  @IsArray()
  @IsString({ each: true })
  categoryIds: string[];
}
