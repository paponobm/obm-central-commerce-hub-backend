import { Module } from '@nestjs/common';
import { ChannelScopeModule } from '../common/channel-scope/channel-scope.module';
import { FileStorageModule } from '../common/file-storage/file-storage.module';
import { SettingsModule } from '../settings/settings.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';

@Module({
  imports: [ChannelScopeModule, SettingsModule, FileStorageModule, AnalyticsModule],
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
