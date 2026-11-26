import { IsNotEmpty, IsString } from 'class-validator';

export class CreateCallRequestDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsString()
  @IsNotEmpty()
  problem: string;
}
