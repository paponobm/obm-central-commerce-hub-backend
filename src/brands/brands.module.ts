import { Module } from '@nestjs/common';
import { FileStorageModule } from '../common/file-storage/file-storage.module';
import { BrandsService } from './brands.service';
import { BrandsController } from './brands.controller';

@Module({
  imports: [FileStorageModule],
  controllers: [BrandsController],
  providers: [BrandsService],
  exports: [BrandsService],
})
export class BrandsModule {}
