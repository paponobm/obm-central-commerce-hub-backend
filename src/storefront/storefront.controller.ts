import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Channel } from '@prisma/client';
import { ChannelResolverGuard } from './guards/channel-resolver.guard';
import { CurrentChannel } from './decorators/current-channel.decorator';
import { StorefrontService } from './storefront.service';
import { StorefrontCreateOrderDto } from './dto/storefront-create-order.dto';

// No JwtAuthGuard here — deliberately public. ChannelResolverGuard is the
// only guard, and it's what keeps this whole surface channel-isolated
// (see the guard's own comment for the mechanism).
@Controller('store/:channelSlug')
@UseGuards(ChannelResolverGuard)
export class StorefrontController {
  constructor(private readonly storefrontService: StorefrontService) {}

  @Get('categories')
  getCategories() {
    return this.storefrontService.getCategories();
  }

  @Get('products')
  getProducts(
    @CurrentChannel() channel: Channel,
    @Query('categoryId') categoryId?: string,
    @Query('search') search?: string,
    @Query('featured') featured?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.storefrontService.getProducts(channel.id, {
      categoryId,
      search,
      featured:
        featured === 'true' ? true : featured === 'false' ? false : undefined,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('products/:slug')
  getProduct(@CurrentChannel() channel: Channel, @Param('slug') slug: string) {
    return this.storefrontService.getProductBySlug(channel.id, slug);
  }

  // Order spam is the realistic abuse vector on a public, unauthenticated
  // mutating endpoint — tighter than the global default.
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('orders')
  createOrder(
    @CurrentChannel() channel: Channel,
    @Body() dto: StorefrontCreateOrderDto,
  ) {
    return this.storefrontService.createOrder(channel, dto);
  }
}
