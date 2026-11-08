import { IsIn, IsString, IsUrl, MaxLength } from 'class-validator';

// Fixed platform palette the admin picks from — keys are what the
// storefront's own icon map renders, so a value here with no matching icon
// there would silently show a generic dot instead.
export const SOCIAL_LINK_PLATFORMS = [
  'facebook',
  'instagram',
  'youtube',
  'tiktok',
  'whatsapp',
  'website',
] as const;
export type SocialLinkPlatform = (typeof SOCIAL_LINK_PLATFORMS)[number];

export class SocialLinkDto {
  @IsIn(SOCIAL_LINK_PLATFORMS)
  platform: SocialLinkPlatform;

  // Rows with no URL entered yet are filtered out by the admin before
  // saving (same convention as trust badges' blank-text rows), so this is
  // required here, not optional.
  @IsString()
  @IsUrl({ require_protocol: true })
  @MaxLength(300)
  url: string;
}
