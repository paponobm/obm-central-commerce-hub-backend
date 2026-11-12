import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

// One sub-category inside a quiz problem (e.g. "মাথাব্যথা বা মাইগ্রেন" under
// "ব্যথা") — admin-curated product ids, resolved against this channel's live
// ProductChannel rows at read time, same pattern as Flash Sale/Cart
// Suggestions (see StorefrontService.getQuiz).
export class QuizSubDto {
  @IsString()
  @MaxLength(80)
  label: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  productIds?: string[];
}

// One top-level "কী কী সমস্যা?" category (e.g. "ব্যথা", "চামড়ার সমস্যা") the
// storefront's symptom-finder quiz offers — Settings → Badge & Category →
// Problem. Replaces the old hardcoded lib/quiz-data.ts list with admin-
// curated categories, sub-categories, and real product assignments.
export class QuizProblemDto {
  @IsString()
  @MaxLength(80)
  label: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => QuizSubDto)
  subs?: QuizSubDto[];
}
