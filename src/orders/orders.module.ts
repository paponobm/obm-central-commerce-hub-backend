import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { ChannelScopeModule } from '../common/channel-scope/channel-scope.module';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';

@Module({
  imports: [CustomersModule, ChannelScopeModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
