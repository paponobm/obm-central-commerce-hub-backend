import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'requiredPermissions';

// @RequirePermissions('orders.create') on a route requires the caller's
// JWT to carry that permission key. Checked by PermissionsGuard, which
// must run after JwtAuthGuard on the same route.
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
