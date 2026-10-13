import { IsString } from 'class-validator';

export class CreateOrderShipmentDto {
  @IsString()
  integrationId: string;
}
