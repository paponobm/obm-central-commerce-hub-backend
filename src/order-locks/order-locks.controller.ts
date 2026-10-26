import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { OrderLocksService } from './order-locks.service';
import { AcquireLockDto } from './dto/acquire-lock.dto';

@Controller('admin/order-locks')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('orders.view')
export class OrderLocksController {
  constructor(private readonly orderLocksService: OrderLocksService) {}

  @Get()
  list() {
    return this.orderLocksService.list();
  }

  @Post(':orderId/acquire')
  acquire(
    @Param('orderId') orderId: string,
    @Body() dto: AcquireLockDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.orderLocksService.acquire(orderId, user, dto.force === true);
  }

  @Post(':orderId/heartbeat')
  heartbeat(
    @Param('orderId') orderId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.orderLocksService.heartbeat(orderId, user);
  }

  @Delete(':orderId')
  release(@Param('orderId') orderId: string, @CurrentUser() user: JwtPayload) {
    return this.orderLocksService.release(orderId, user);
  }
}
