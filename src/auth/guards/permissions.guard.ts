import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { JwtPayload } from '../types/jwt-payload.type';

// Must run after JwtAuthGuard (@UseGuards(JwtAuthGuard, PermissionsGuard))
// so request.user is already populated. A route with no @RequirePermissions
// metadata is allowed through for any authenticated user.
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) {
      return true;
    }

    const user: JwtPayload = context.switchToHttp().getRequest().user;
    const hasAll = required.every((key) => user.permissions.includes(key));
    if (!hasAll) {
      throw new ForbiddenException(
        `Missing required permission(s): ${required.join(', ')}`,
      );
    }
    return true;
  }
}
