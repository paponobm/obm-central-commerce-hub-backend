import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { ChannelsService } from './channels.service';
import { CreateChannelDto } from './dto/create-channel.dto';
import { UpdateChannelDto } from './dto/update-channel.dto';

@Controller('admin/channels')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ChannelsController {
  constructor(private readonly channelsService: ChannelsService) {}

  @Get()
  @RequirePermissions('channels.view')
  findAll(@Query('includeInactive') includeInactive?: string) {
    return this.channelsService.findAll(includeInactive === 'true');
  }

  @Get(':id')
  @RequirePermissions('channels.view')
  findOne(@Param('id') id: string) {
    return this.channelsService.findOne(id);
  }

  @Post()
  @RequirePermissions('channels.manage')
  create(@Body() dto: CreateChannelDto) {
    return this.channelsService.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('channels.manage')
  update(@Param('id') id: string, @Body() dto: UpdateChannelDto) {
    return this.channelsService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('channels.manage')
  remove(@Param('id') id: string) {
    return this.channelsService.remove(id);
  }
}
