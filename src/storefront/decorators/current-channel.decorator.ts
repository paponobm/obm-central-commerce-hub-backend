import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Channel } from '@prisma/client';

// Only valid on routes behind ChannelResolverGuard, which populates it.
export const CurrentChannel = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Channel => {
    const request = ctx.switchToHttp().getRequest();
    return request.channel;
  },
);
