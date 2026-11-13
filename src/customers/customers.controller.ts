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
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@Controller('admin/customers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  @RequirePermissions('customers.view')
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query('search') search?: string,
    @Query('channelId') channelId?: string,
  ) {
    return this.customersService.findAll(user, search, channelId);
  }

  // POST, not GET — declared before ':id' only for readability; no actual
  // route collision since the methods differ.
  @Post('detect-districts')
  @RequirePermissions('customers.manage')
  detectDistricts(
    @CurrentUser() user: JwtPayload,
    @Query('channelId') channelId?: string,
  ) {
    return this.customersService.detectDistricts(user, channelId);
  }

  @Post('detect-thanas')
  @RequirePermissions('customers.manage')
  detectThanas(
    @CurrentUser() user: JwtPayload,
    @Query('channelId') channelId?: string,
    @Query('district') district?: string,
  ) {
    return this.customersService.detectThanas(user, channelId, district);
  }

  @Get('thana-breakdown')
  @RequirePermissions('customers.view')
  getThanaBreakdown(
    @CurrentUser() user: JwtPayload,
    @Query('district') district: string,
    @Query('channelId') channelId?: string,
  ) {
    return this.customersService.getThanaBreakdown(user, district, channelId);
  }

  @Get(':id')
  @RequirePermissions('customers.view')
  findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.customersService.findOne(id, user);
  }

  @Get(':id/activity')
  @RequirePermissions('customers.view')
  listActivity(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.customersService.listCustomerActivity(id, user);
  }

  @Post()
  @RequirePermissions('customers.manage')
  create(@Body() dto: CreateCustomerDto) {
    return this.customersService.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('customers.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.customersService.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('customers.manage')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.customersService.remove(id, user);
  }
}
