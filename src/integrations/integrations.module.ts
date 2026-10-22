import { Module } from '@nestjs/common';
import { CryptoModule } from '../common/crypto/crypto.module';
import { IntegrationsService } from './integrations.service';
import { IntegrationsController } from './integrations.controller';
import { ProviderRegistry } from './providers/provider-registry';
import { SteadfastAdapter } from './providers/steadfast.adapter';
import { WebhooksService } from './webhooks/webhooks.service';
import { SteadfastWebhookController } from './webhooks/steadfast-webhook.controller';

@Module({
  imports: [CryptoModule],
  controllers: [IntegrationsController, SteadfastWebhookController],
  providers: [
    IntegrationsService,
    ProviderRegistry,
    SteadfastAdapter,
    WebhooksService,
  ],
  exports: [IntegrationsService, ProviderRegistry],
})
export class IntegrationsModule {}
