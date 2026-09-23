import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtPayload } from '../types/jwt-payload.type';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  // Runs once the signature/expiry check already passed. A refresh token
  // (aud: "admin-refresh") is a different secret in practice, but if it
  // ever reaches this strategy, the audience check below still rejects it
  // rather than silently trusting it as an access token.
  validate(payload: JwtPayload): JwtPayload {
    if (payload.aud !== 'admin') {
      throw new UnauthorizedException('Invalid token audience');
    }
    return payload;
  }
}
