import { IsIn } from 'class-validator';
import { CallRequestStatus } from '@prisma/client';

export class UpdateCallRequestStatusDto {
  @IsIn(['PENDING', 'SOLVED'])
  status: CallRequestStatus;
}
