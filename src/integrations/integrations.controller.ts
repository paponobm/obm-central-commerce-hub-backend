import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CentralOnlyGuard } from '../common/channel-scope/central-only.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { IntegrationsService } from './integrations.service';
import { CreateIntegrationDto } from './dto/create-integration.dto';
import { UpdateIntegrationDto } from './dto/update-integration.dto';

@Controller('admin/integrations')
@UseGuards(JwtAuthGuard, PermissionsGuard, CentralOnlyGuard)
@RequirePermissions('integrations.manage')
export class IntegrationsController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  // The registry of supported providers + the credential fields each one
  // needs — drives the Add Integration form without the frontend hardcoding
  // any provider's field names.
  @Get('providers')
  providers() {
    return this.integrationsService.providersMeta();
  }

  @Get()
  findAll() {
    return this.integrationsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.integrationsService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateIntegrationDto, @CurrentUser() user: JwtPayload) {
    return this.integrationsService.create(dto, user.sub);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateIntegrationDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.integrationsService.update(id, dto, user.sub);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.integrationsService.remove(id, user.sub);
  }

  @Post(':id/test')
  testConnection(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.integrationsService.testConnection(id, user.sub);
  }

  @Post(':id/set-default')
  setDefault(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.integrationsService.setDefault(id, user.sub);
  }

  // Returns the new secret in plaintext exactly once — the frontend shows
  // it in a one-time dialog and never fetches it again afterwards.
  @Post(':id/webhook-secret/regenerate')
  regenerateWebhookSecret(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.integrationsService.regenerateWebhookSecret(id, user.sub);
  }
}
