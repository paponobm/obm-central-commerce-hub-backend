import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { InventoryService } from './inventory.service';
import { AdjustInventoryDto } from './dto/adjust-inventory.dto';

@Controller('admin/inventory')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get()
  @RequirePermissions('inventory.view')
  findAll(
    @Query('lowStock') lowStock?: string,
    @Query('search') search?: string,
  ) {
    return this.inventoryService.findAll({
      lowStockOnly: lowStock === 'true',
      search,
    });
  }

  @Get(':productId')
  @RequirePermissions('inventory.view')
  findOne(@Param('productId') productId: string) {
    return this.inventoryService.findOne(productId);
  }

  @Get(':productId/movements')
  @RequirePermissions('inventory.view')
  getMovements(@Param('productId') productId: string) {
    return this.inventoryService.getMovements(productId);
  }

  @Post(':productId/adjust')
  @RequirePermissions('inventory.adjust')
  adjust(
    @Param('productId') productId: string,
    @Body() dto: AdjustInventoryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.inventoryService.adjust(productId, dto, user.sub);
  }
}
