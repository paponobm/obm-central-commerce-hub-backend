import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Controller('admin/users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getMe(@CurrentUser() currentUser: JwtPayload) {
    const user = await this.usersService.findByIdWithPermissions(
      currentUser.sub,
    );
    if (!user || !user.isActive || user.deletedAt) {
      throw new NotFoundException('User not found');
    }
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.roleName,
      permissions: user.permissions,
    };
  }

  @Get()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('users.manage')
  findAll() {
    return this.usersService.findAll();
  }

  // The full permission catalog, for the per-user permission checklist on
  // the create/edit user form.
  @Get('permissions-catalog')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('users.manage')
  permissionsCatalog() {
    return this.usersService.permissionsCatalog();
  }

  @Post()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('users.manage')
  create(@Body() dto: CreateUserDto, @CurrentUser() currentUser: JwtPayload) {
    return this.usersService.create(dto, currentUser.roleName);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('users.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() currentUser: JwtPayload,
  ) {
    return this.usersService.update(
      id,
      dto,
      currentUser.sub,
      currentUser.roleName,
    );
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('users.manage')
  remove(@Param('id') id: string, @CurrentUser() currentUser: JwtPayload) {
    return this.usersService.remove(id, currentUser.sub, currentUser.roleName);
  }
}
