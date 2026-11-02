import { IsBoolean, IsString, Matches, MaxLength } from 'class-validator';

// The promo pill shown in the storefront hero banner (label + code), with
// its own on/off switch so it can be hidden without deleting the saved
// label/code.
export class HeroCouponDto {
  @IsBoolean()
  enabled: boolean;

  @IsString()
  @MaxLength(80)
  label: string;

  @IsString()
  @MaxLength(20)
  @Matches(/^[A-Za-z0-9]+$/, {
    message: 'code must contain only letters and numbers',
  })
  code: string;
}
