import { Injectable } from '@nestjs/common';
import { IntegrationProvider } from '@prisma/client';
import { CourierAdapter } from './courier-provider.interface';
import { SteadfastAdapter } from './steadfast.adapter';

// The single place that maps a provider enum value to its adapter.
// Adding a new courier is: implement its CourierAdapter, register it here,
// add the enum value in schema.prisma — nothing else in the module
// (controller/service/frontend) needs to know a provider's specifics.
@Injectable()
export class ProviderRegistry {
  private readonly adapters: Record<IntegrationProvider, CourierAdapter>;

  constructor(steadfast: SteadfastAdapter) {
    this.adapters = {
      [IntegrationProvider.STEADFAST]: steadfast,
    };
  }

  get(provider: IntegrationProvider): CourierAdapter {
    return this.adapters[provider];
  }

  list(): {
    provider: IntegrationProvider;
    credentialFields: CourierAdapter['credentialFields'];
  }[] {
    return Object.entries(this.adapters).map(([provider, adapter]) => ({
      provider: provider as IntegrationProvider,
      credentialFields: adapter.credentialFields,
    }));
  }
}
