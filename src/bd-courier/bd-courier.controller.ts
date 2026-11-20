import { Body, Controller, Delete, Get, Patch, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { CentralOnlyGuard } from '../common/channel-scope/central-only.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { BdCourierService } from './bd-courier.service';
import { UpdateBdCourierSettingsDto } from './dto/update-bd-courier-settings.dto';

@Controller('admin/bd-courier')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class BdCourierController {
  constructor(private readonly bdCourierService: BdCourierService) {}

  // The actual phone lookup — available to whoever can create/view orders
  // (New Order, Web Orders, Edit Order), not just the central admins who
  // manage the API key below. orderId/leadId route to the persisted,
  // fetch-once version (BdCourierService.getOrderCheck/getLeadCheck) —
  // omitted only on New Order, where no row exists yet to persist onto.
  @Get('check')
  @RequirePermissions('orders.view')
  check(
    @Query('phone') phone: string,
    @Query('orderId') orderId?: string,
    @Query('leadId') leadId?: string,
  ) {
    if (orderId) return this.bdCourierService.getOrderCheck(orderId);
    if (leadId) return this.bdCourierService.getLeadCheck(leadId);
    return this.bdCourierService.checkPhone(phone ?? '');
  }

  // Managing the credential itself is account-wide config, same audience
  // and guard as the courier shipment Integrations it sits next to.
  @Get('settings')
  @UseGuards(CentralOnlyGuard)
  @RequirePermissions('integrations.manage')
  getSettings() {
    return this.bdCourierService.getSettings();
  }

  @Patch('settings')
  @UseGuards(CentralOnlyGuard)
  @RequirePermissions('integrations.manage')
  updateSettings(@Body() dto: UpdateBdCourierSettingsDto) {
    return this.bdCourierService.updateApiKey(dto.apiKey);
  }

  @Delete('settings')
  @UseGuards(CentralOnlyGuard)
  @RequirePermissions('integrations.manage')
  disconnect() {
    return this.bdCourierService.disconnect();
  }
}
