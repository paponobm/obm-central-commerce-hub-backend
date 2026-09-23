import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

// Resolves :channelSlug from the URL to a live Channel row, server-side,
// once, before any controller method runs — and attaches it to the
// request. Every storefront service call downstream takes this resolved
// channelId as an explicit parameter; nothing in the storefront path ever
// trusts a channelId from the request body or query string. This is the
// entire mechanism that keeps one storefront from ever seeing another
// storefront's products or orders (ARCHITECTURE.md §5.4).
@Injectable()
export class ChannelResolverGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const slug = request.params?.channelSlug;

    const channel = await this.prisma.channel.findFirst({
      where: { slug, deletedAt: null, isActive: true },
    });
    if (!channel) {
      throw new NotFoundException(`Storefront "${slug}" not found`);
    }

    request.channel = channel;
    return true;
  }
}
