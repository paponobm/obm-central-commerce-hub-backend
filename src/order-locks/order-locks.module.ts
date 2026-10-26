import { Module } from '@nestjs/common';
import { OrderLocksService } from './order-locks.service';
import { OrderLocksController } from './order-locks.controller';

@Module({
  controllers: [OrderLocksController],
  providers: [OrderLocksService],
})
export class OrderLocksModule {}
