import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import {
  ReportsService,
  SalesPeriodUnit,
  TopProductsSortBy,
} from './reports.service';

const PERIOD_UNITS: SalesPeriodUnit[] = ['day', 'week', 'month'];
const SORT_OPTIONS: TopProductsSortBy[] = ['quantity', 'revenue'];

@Controller('admin/reports')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('reports.view')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('dashboard')
  getDashboard(
    @CurrentUser() user: JwtPayload,
    @Query('channelId') channelId?: string,
  ) {
    return this.reportsService.getDashboard(user, channelId);
  }

  @Get('sales-by-channel')
  getSalesByChannel(
    @CurrentUser() user: JwtPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('channelId') channelId?: string,
  ) {
    return this.reportsService.getSalesByChannel(user, from, to, channelId);
  }

  @Get('sales-by-period')
  getSalesByPeriod(
    @CurrentUser() user: JwtPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('groupBy') groupBy?: string,
    @Query('channelId') channelId?: string,
  ) {
    const unit = this.validateOneOf(groupBy, PERIOD_UNITS, 'day', 'groupBy');
    return this.reportsService.getSalesByPeriod(
      user,
      from,
      to,
      unit,
      channelId,
    );
  }

  @Get('top-products')
  getTopProducts(
    @CurrentUser() user: JwtPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('sortBy') sortBy?: string,
    @Query('channelId') channelId?: string,
  ) {
    const sort = this.validateOneOf(sortBy, SORT_OPTIONS, 'revenue', 'sortBy');
    const parsedLimit = limit ? parseInt(limit, 10) : 10;
    if (Number.isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      throw new BadRequestException(
        'limit must be an integer between 1 and 100',
      );
    }
    return this.reportsService.getTopProducts(
      user,
      from,
      to,
      parsedLimit,
      sort,
      channelId,
    );
  }

  @Get('stock-valuation')
  getStockValuation(
    @CurrentUser() user: JwtPayload,
    @Query('channelId') channelId?: string,
  ) {
    return this.reportsService.getStockValuation(user, channelId);
  }

  private validateOneOf<T extends string>(
    value: string | undefined,
    allowed: T[],
    fallback: T,
    paramName: string,
  ): T {
    if (value === undefined) return fallback;
    if (!allowed.includes(value as T)) {
      throw new BadRequestException(
        `${paramName} must be one of: ${allowed.join(', ')}`,
      );
    }
    return value as T;
  }
}
