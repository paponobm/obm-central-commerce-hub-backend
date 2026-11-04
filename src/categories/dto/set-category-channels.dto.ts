import { ArrayMaxSize, IsArray, IsString } from 'class-validator';

export class SetCategoryChannelsDto {
  // Every active channel this category should be published to — exhaustive,
  // not additive: a channel left out here is unpublished from (see
  // CategoriesService.setCategoryChannels).
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  channelIds: string[];
}
