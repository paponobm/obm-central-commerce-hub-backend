import { ArrayMinSize, IsArray, IsString } from 'class-validator';

export class MarkPrintedDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  orderIds: string[];
}
