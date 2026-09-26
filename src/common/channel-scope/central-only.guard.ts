import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { JwtPayload } from '../../auth/types/jwt-payload.type';
import { ALL_ACCESS_PERMISSION } from './channel-scope.service';

// For routes that manage the shared, cross-store side of the business
// (stock, purchasing, creating master products). A store-assigned user —
// someone working inside one storefront — must never reach these, no matter
// which role permissions they hold. Must run after JwtAuthGuard.
@Injectable()
export class CentralOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user: JwtPayload = context.switchToHttp().getRequest().user;
    if (!user.permissions.includes(ALL_ACCESS_PERMISSION)) {
      throw new ForbiddenException(
        'This is managed centrally — not available from a storefront account',
      );
    }
    return true;
  }
}
