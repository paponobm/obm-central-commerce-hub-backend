import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtPayload } from '../../auth/types/jwt-payload.type';

export const ALL_ACCESS_PERMISSION = 'channels.all_access';

// Channel scoping is a second, orthogonal axis to RBAC: Role/Permission
// governs *what* a user can do; this governs *where* (which stores) that
// applies to. See ARCHITECTURE.md §14 for the full design and why it's
// deliberately not folded into a bigger role enum.
//
// This is the ONLY place that decides what "All Stores" means for a given
// user — every caller (Orders today; Products/Inventory/Customers/Reports
// in their own later phases) goes through this rather than re-deriving the
// same logic, so it can't drift between pages.
@Injectable()
export class ChannelScopeService {
  constructor(private readonly prisma: PrismaService) {}

  async getAssignedChannelIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.userChannel.findMany({
      where: { userId },
      select: { channelId: true },
    });
    return rows.map((r) => r.channelId);
  }

  // For models with a direct `channelId` column (Order today). Merge the
  // returned object straight into that model's Prisma `where`.
  //
  // - Unrestricted user (`channels.all_access`): requested channel passes
  //   through untouched; no channel requested = no filter at all (truly
  //   every channel).
  // - Restricted user, specific channel requested: must be one of their
  //   assigned channels, or this throws — never silently narrows.
  // - Restricted user, "All Stores" (no channel requested): silently
  //   becomes "channel in my assigned set" — this is the one line in the
  //   whole feature that must get this right; getting it backwards means
  //   a restricted user picking "All Stores" would see everyone else's
  //   data too.
  async resolveDirectFilter(
    user: JwtPayload,
    requestedChannelId?: string,
  ): Promise<{ channelId?: string | { in: string[] } }> {
    if (user.permissions.includes(ALL_ACCESS_PERMISSION)) {
      return requestedChannelId ? { channelId: requestedChannelId } : {};
    }

    const allowed = await this.getAssignedChannelIds(user.sub);

    if (requestedChannelId) {
      if (!allowed.includes(requestedChannelId)) {
        throw new ForbiddenException('You are not assigned to this store');
      }
      return { channelId: requestedChannelId };
    }

    // Empty `in` matches zero rows (Prisma short-circuits rather than
    // emitting invalid SQL) — correct fail-closed behavior for a user with
    // no channel assignments at all, no special-casing needed by callers.
    return { channelId: { in: allowed } };
  }
}
