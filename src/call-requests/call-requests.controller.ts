import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { CallRequestStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CallRequestsService } from './call-requests.service';
import { UpdateCallRequestStatusDto } from './dto/update-call-request-status.dto';

// Central — "Counseling" in the sidebar, visible only under All Stores
// (see nav-config.ts's centralOnly flag). Its own permission pair, toggled
// independently of Customers on a staff user's Access panel (see
// NAV_GROUPS in the Users page) — see rbac-seed-data.ts for where these are
// defined and granted to Super Admin.
@Controller('admin/call-requests')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CallRequestsController {
  constructor(private readonly callRequestsService: CallRequestsService) {}

  @Get()
  @RequirePermissions('counseling.view')
  findAll(@Query('status') status?: CallRequestStatus) {
    return this.callRequestsService.findAll(status);
  }

  @Patch(':id/status')
  @RequirePermissions('counseling.manage')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateCallRequestStatusDto,
  ) {
    return this.callRequestsService.updateStatus(id, dto.status);
  }
}
