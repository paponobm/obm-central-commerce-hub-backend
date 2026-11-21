import { Module } from '@nestjs/common';
import { FileStorageModule } from '../common/file-storage/file-storage.module';
import { CategoriesService } from './categories.service';
import { CategoriesController } from './categories.controller';

@Module({
  imports: [FileStorageModule],
  controllers: [CategoriesController],
  providers: [CategoriesService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
