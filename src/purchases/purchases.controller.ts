import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CentralOnlyGuard } from '../common/channel-scope/central-only.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { PurchasesService } from './purchases.service';
import { CreatePurchaseDto, PurchaseItemDto } from './dto/create-purchase.dto';

@Controller('admin/purchases')
@UseGuards(JwtAuthGuard, PermissionsGuard, CentralOnlyGuard)
@RequirePermissions('suppliers.manage')
export class PurchasesController {
  constructor(private readonly purchasesService: PurchasesService) {}

  @Get()
  findAll() {
    return this.purchasesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.purchasesService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreatePurchaseDto, @CurrentUser() user: JwtPayload) {
    return this.purchasesService.create(dto, user.sub);
  }

  @Post(':id/items')
  addItem(@Param('id') id: string, @Body() dto: PurchaseItemDto) {
    return this.purchasesService.addItem(id, dto);
  }

  @Delete(':id/items/:itemId')
  removeItem(@Param('id') id: string, @Param('itemId') itemId: string) {
    return this.purchasesService.removeItem(id, itemId);
  }

  @Post(':id/order')
  markOrdered(@Param('id') id: string) {
    return this.purchasesService.markOrdered(id);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.purchasesService.cancel(id);
  }

  @Post(':id/receive')
  receive(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.purchasesService.receive(id, user.sub);
  }
}
