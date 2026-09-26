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
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { ChannelsService } from './channels.service';
import { CreateChannelDto } from './dto/create-channel.dto';
import { UpdateChannelDto } from './dto/update-channel.dto';

@Controller('admin/channels')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ChannelsController {
  constructor(private readonly channelsService: ChannelsService) {}

  @Get()
  @RequirePermissions('channels.view')
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query('includeInactive') includeInactive?: string,
    @Query('withStats') withStats?: string,
  ) {
    if (withStats === 'true') {
      return this.channelsService.findAllWithStats(
        user,
        includeInactive === 'true',
      );
    }
    return this.channelsService.findAll(user, includeInactive === 'true');
  }

  @Get(':id')
  @RequirePermissions('channels.view')
  findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.channelsService.findOne(id, user);
  }

  @Post()
  @RequirePermissions('channels.manage')
  create(@Body() dto: CreateChannelDto) {
    return this.channelsService.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('channels.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateChannelDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.channelsService.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('channels.manage')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.channelsService.remove(id, user);
  }
}
