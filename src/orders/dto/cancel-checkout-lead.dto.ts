import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CancelCheckoutLeadDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  note: string;
}
