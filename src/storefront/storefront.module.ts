import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { CallRequestsModule } from '../call-requests/call-requests.module';
import { StorefrontService } from './storefront.service';
import { StorefrontController } from './storefront.controller';
import { ChannelResolverGuard } from './guards/channel-resolver.guard';

@Module({
  imports: [OrdersModule, CallRequestsModule],
  controllers: [StorefrontController],
  providers: [StorefrontService, ChannelResolverGuard],
})
export class StorefrontModule {}
