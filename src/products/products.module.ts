import { Module } from '@nestjs/common';
import { ChannelScopeModule } from '../common/channel-scope/channel-scope.module';
import { FileStorageModule } from '../common/file-storage/file-storage.module';
import { SettingsModule } from '../settings/settings.module';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';

@Module({
  imports: [ChannelScopeModule, SettingsModule, FileStorageModule],
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
