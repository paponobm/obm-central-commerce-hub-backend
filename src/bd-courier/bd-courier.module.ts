import { Module } from '@nestjs/common';
import { CryptoModule } from '../common/crypto/crypto.module';
import { BdCourierService } from './bd-courier.service';
import { BdCourierController } from './bd-courier.controller';

@Module({
  imports: [CryptoModule],
  controllers: [BdCourierController],
  providers: [BdCourierService],
})
export class BdCourierModule {}
