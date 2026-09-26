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
import { CentralOnlyGuard } from '../common/channel-scope/central-only.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { AddProductImageDto } from './dto/add-product-image.dto';
import { UpsertProductChannelDto } from './dto/upsert-product-channel.dto';

@Controller('admin/products')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @RequirePermissions('products.view')
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query('categoryId') categoryId?: string,
    @Query('brandId') brandId?: string,
    @Query('search') search?: string,
    @Query('includeInactive') includeInactive?: string,
    @Query('channelId') channelId?: string,
  ) {
    return this.productsService.findAll(user, {
      categoryId,
      brandId,
      search,
      includeInactive: includeInactive === 'true',
      channelId,
    });
  }

  @Get(':id')
  @RequirePermissions('products.view')
  findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.productsService.findOne(id, user);
  }

  // Master products are created centrally; a storefront only sees and
  // sells what's published to it.
  @Post()
  @UseGuards(CentralOnlyGuard)
  @RequirePermissions('products.manage')
  create(@Body() dto: CreateProductDto) {
    return this.productsService.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('products.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.productsService.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('products.manage')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.productsService.remove(id, user);
  }

  @Post(':id/images')
  @RequirePermissions('products.manage')
  addImage(
    @Param('id') id: string,
    @Body() dto: AddProductImageDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.productsService.addImage(id, dto, user);
  }

  @Delete(':id/images/:imageId')
  @RequirePermissions('products.manage')
  removeImage(
    @Param('id') id: string,
    @Param('imageId') imageId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.productsService.removeImage(id, imageId, user);
  }

  @Get(':id/channels')
  @RequirePermissions('products.view')
  getChannelOverrides(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.productsService.getChannelOverrides(user, id);
  }

  @Post(':id/channels/:channelId')
  @RequirePermissions('products.publish')
  upsertChannelOverride(
    @Param('id') id: string,
    @Param('channelId') channelId: string,
    @Body() dto: UpsertProductChannelDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.productsService.upsertChannelOverride(user, id, channelId, dto);
  }

  @Post(':id/channels/:channelId/publish')
  @RequirePermissions('products.publish')
  publish(
    @Param('id') id: string,
    @Param('channelId') channelId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.productsService.publish(user, id, channelId);
  }

  @Post(':id/channels/:channelId/unpublish')
  @RequirePermissions('products.publish')
  unpublish(
    @Param('id') id: string,
    @Param('channelId') channelId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.productsService.unpublish(user, id, channelId);
  }
}
