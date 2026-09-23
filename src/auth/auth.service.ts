import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { UsersService, UserWithPermissions } from '../users/users.service';
import { JwtPayload } from './types/jwt-payload.type';

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL = '7d';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async validateCredentials(
    email: string,
    password: string,
  ): Promise<UserWithPermissions> {
    const user = await this.usersService.findByEmailWithPermissions(email);
    // Same error for "no such user" and "wrong password" — don't leak
    // which one it was.
    if (!user || user.deletedAt || !user.isActive) {
      throw new UnauthorizedException('Invalid email or password');
    }
    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return user;
  }

  async issueTokenPair(user: UserWithPermissions) {
    const accessToken = await this.signAccessToken(user);
    const refreshToken = await this.signRefreshToken(user);
    return { accessToken, refreshToken };
  }

  async refresh(refreshToken: string) {
    let payload: { sub: string; aud: string };
    try {
      payload = await this.jwtService.verifyAsync(refreshToken, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    if (payload.aud !== 'admin-refresh') {
      throw new UnauthorizedException('Invalid token audience');
    }

    // Re-fetch rather than trust the refresh token's own claims — this is
    // what makes a deactivated user or a changed role take effect on the
    // very next refresh instead of waiting out a 7-day-old token.
    const user = await this.usersService.findByIdWithPermissions(payload.sub);
    if (!user || user.deletedAt || !user.isActive) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    return this.issueTokenPair(user);
  }

  toPublicUser(user: UserWithPermissions) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.roleName,
      permissions: user.permissions,
    };
  }

  private signAccessToken(user: UserWithPermissions): Promise<string> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      roleId: user.roleId,
      roleName: user.roleName,
      permissions: user.permissions,
      aud: 'admin',
    };
    return this.jwtService.signAsync(payload, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: ACCESS_TOKEN_TTL,
    });
  }

  private signRefreshToken(user: UserWithPermissions): Promise<string> {
    return this.jwtService.signAsync(
      { sub: user.id, aud: 'admin-refresh' },
      {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: REFRESH_TOKEN_TTL,
      },
    );
  }
}
