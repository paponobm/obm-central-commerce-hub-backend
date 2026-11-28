import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

const EVENT_TYPES = ['PAGE_VIEW', 'PRODUCT_VIEW', 'SEARCH', 'ADD_TO_CART'];

export class TrackEventDto {
  @IsIn(EVENT_TYPES)
  type: 'PAGE_VIEW' | 'PRODUCT_VIEW' | 'SEARCH' | 'ADD_TO_CART';

  @IsString()
  @IsNotEmpty()
  path: string;

  @IsString()
  @IsNotEmpty()
  sessionId: string;

  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsString()
  searchQuery?: string;

  @IsOptional()
  @IsString()
  referrer?: string;

  @IsOptional()
  @IsString()
  utmSource?: string;

  @IsOptional()
  @IsString()
  utmMedium?: string;

  @IsOptional()
  @IsString()
  utmCampaign?: string;
}
