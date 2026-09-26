import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { ChannelScopeModule } from '../common/channel-scope/channel-scope.module';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';

@Module({
  imports: [InventoryModule, ChannelScopeModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
