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
    @Query('categoryId') categoryId?: string,
    @Query('brandId') brandId?: string,
    @Query('search') search?: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.productsService.findAll({
      categoryId,
      brandId,
      search,
      includeInactive: includeInactive === 'true',
    });
  }

  @Get(':id')
  @RequirePermissions('products.view')
  findOne(@Param('id') id: string) {
    return this.productsService.findOne(id);
  }

  @Post()
  @RequirePermissions('products.manage')
  create(@Body() dto: CreateProductDto) {
    return this.productsService.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('products.manage')
  update(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.productsService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('products.manage')
  remove(@Param('id') id: string) {
    return this.productsService.remove(id);
  }

  @Post(':id/images')
  @RequirePermissions('products.manage')
  addImage(@Param('id') id: string, @Body() dto: AddProductImageDto) {
    return this.productsService.addImage(id, dto);
  }

  @Delete(':id/images/:imageId')
  @RequirePermissions('products.manage')
  removeImage(@Param('id') id: string, @Param('imageId') imageId: string) {
    return this.productsService.removeImage(id, imageId);
  }

  @Get(':id/channels')
  @RequirePermissions('products.view')
  getChannelOverrides(@Param('id') id: string) {
    return this.productsService.getChannelOverrides(id);
  }

  @Post(':id/channels/:channelId')
  @RequirePermissions('products.publish')
  upsertChannelOverride(
    @Param('id') id: string,
    @Param('channelId') channelId: string,
    @Body() dto: UpsertProductChannelDto,
  ) {
    return this.productsService.upsertChannelOverride(id, channelId, dto);
  }

  @Post(':id/channels/:channelId/publish')
  @RequirePermissions('products.publish')
  publish(@Param('id') id: string, @Param('channelId') channelId: string) {
    return this.productsService.publish(id, channelId);
  }

  @Post(':id/channels/:channelId/unpublish')
  @RequirePermissions('products.publish')
  unpublish(@Param('id') id: string, @Param('channelId') channelId: string) {
    return this.productsService.unpublish(id, channelId);
  }
}
