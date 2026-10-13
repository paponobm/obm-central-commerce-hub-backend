import { Module } from '@nestjs/common';
import { CryptoModule } from '../common/crypto/crypto.module';
import { IntegrationsService } from './integrations.service';
import { IntegrationsController } from './integrations.controller';
import { ProviderRegistry } from './providers/provider-registry';
import { SteadfastAdapter } from './providers/steadfast.adapter';

@Module({
  imports: [CryptoModule],
  controllers: [IntegrationsController],
  providers: [IntegrationsService, ProviderRegistry, SteadfastAdapter],
  exports: [IntegrationsService, ProviderRegistry],
})
export class IntegrationsModule {}
