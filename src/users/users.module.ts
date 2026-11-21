import { Module } from '@nestjs/common';
import { FileStorageModule } from '../common/file-storage/file-storage.module';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

@Module({
  imports: [FileStorageModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
