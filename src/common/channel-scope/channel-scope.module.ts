import { Module } from '@nestjs/common';
import { ChannelScopeService } from './channel-scope.service';

@Module({
  providers: [ChannelScopeService],
  exports: [ChannelScopeService],
})
export class ChannelScopeModule {}
