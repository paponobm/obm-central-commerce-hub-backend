import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class AddOrderNoteDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  note: string;
}
