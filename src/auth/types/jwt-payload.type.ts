export type JwtAudience = 'admin' | 'admin-refresh';

export interface JwtPayload {
  sub: string; // User.id
  email: string;
  roleId: string;
  roleName: string;
  permissions: string[]; // snapshot at token-issue time; access tokens are short-lived
  aud: JwtAudience;
}
