import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  OrderSource,
  OrderStatus,
  PaymentStatus,
  ShipmentStatus,
} from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { UpdateCustomerResponseDto } from './dto/update-customer-response.dto';

@Controller('admin/orders')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  @RequirePermissions('orders.view')
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query('channelId') channelId?: string,
    @Query('status') status?: OrderStatus,
    @Query('source') source?: OrderSource,
    @Query('paymentStatus') paymentStatus?: PaymentStatus,
    @Query('shipmentStatus') shipmentStatus?: ShipmentStatus,
    @Query('customerId') customerId?: string,
    @Query('productId') productId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('search') search?: string,
  ) {
    return this.ordersService.findAll(
      {
        channelId,
        status,
        source,
        paymentStatus,
        shipmentStatus,
        customerId,
        productId,
        from,
        to,
        search,
      },
      user,
    );
  }

  @Get(':id')
  @RequirePermissions('orders.view')
  findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.ordersService.findOne(id, user);
  }

  // The one order-creation endpoint for every source — website checkout
  // (once Phase 9's storefront module calls this internally), manual,
  // phone, Facebook, WhatsApp. Distinguished by `source` in the body, not
  // by a separate route.
  @Post()
  @RequirePermissions('orders.create')
  create(@Body() dto: CreateOrderDto, @CurrentUser() user: JwtPayload) {
    return this.ordersService.createOrder(dto, user.sub, user);
  }

  @Patch(':id/status')
  @RequirePermissions('orders.update_status')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.ordersService.updateStatus(id, dto, user.sub, user);
  }

  // Independent of order status — tracks whether the customer has actually
  // been reached and how they responded, not where the order is in
  // fulfillment. No state machine: any value can follow any value.
  @Patch(':id/customer-response')
  @RequirePermissions('orders.update_status')
  updateCustomerResponse(
    @Param('id') id: string,
    @Body() dto: UpdateCustomerResponseDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.ordersService.updateCustomerResponse(id, dto, user.sub, user);
  }
}
