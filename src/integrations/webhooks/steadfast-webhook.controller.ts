import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { WebhooksService } from './webhooks.service';

// Deliberately NOT behind JwtAuthGuard/PermissionsGuard — Steadfast calls
// this from their own servers with no admin session. The HMAC signature
// (verified in WebhooksService, against the per-integration secret in the
// URL) is what proves a request is genuine, not a cookie or bearer token.
@Controller('webhooks/steadfast')
export class SteadfastWebhookController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post(':integrationId')
  @HttpCode(HttpStatus.OK)
  handle(
    @Param('integrationId') integrationId: string,
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-signature') signature?: string,
  ) {
    if (!req.rawBody) {
      throw new BadRequestException('Missing request body');
    }
    return this.webhooksService.handleSteadfastWebhook(
      integrationId,
      req.rawBody,
      signature,
    );
  }
}
