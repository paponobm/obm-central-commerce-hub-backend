import { IsBoolean, IsIn, IsString, MaxLength } from 'class-validator';

// Fixed icon palette the admin picks from — keys are what the storefront's
// own icon map (components/trust-strip.tsx) renders, so a name here with no
// matching SVG there would silently show nothing.
export const TRUST_BADGE_ICONS = [
  'shield',
  'cash',
  'truck',
  'clock',
  'star',
  'gift',
  'lock',
  'percent',
] as const;
export type TrustBadgeIcon = (typeof TRUST_BADGE_ICONS)[number];

export class TrustBadgeDto {
  @IsString()
  @MaxLength(60)
  text: string;

  @IsIn(TRUST_BADGE_ICONS)
  icon: TrustBadgeIcon;

  // Off badges stay in the admin's list (for re-enabling later) but are
  // never included in the storefront's public config.
  @IsBoolean()
  enabled: boolean;
}
