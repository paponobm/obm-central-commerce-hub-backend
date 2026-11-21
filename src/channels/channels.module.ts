import { Module } from '@nestjs/common';
import { ChannelScopeModule } from '../common/channel-scope/channel-scope.module';
import { FileStorageModule } from '../common/file-storage/file-storage.module';
import { ChannelsService } from './channels.service';
import { ChannelsController } from './channels.controller';

@Module({
  imports: [ChannelScopeModule, FileStorageModule],
  controllers: [ChannelsController],
  providers: [ChannelsService],
  exports: [ChannelsService],
})
export class ChannelsModule {}
