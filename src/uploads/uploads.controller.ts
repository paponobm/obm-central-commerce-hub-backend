import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { randomBytes } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';

const ALLOWED_MIME_TYPES = /^image\/(jpeg|png|webp|gif)$/;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

@Controller('admin/uploads')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class UploadsController {
  constructor(private readonly config: ConfigService) {}

  // Local disk storage for now — fine for a single-server dev/small-business
  // deployment. Swapping to S3/R2 later (per ARCHITECTURE.md's deployment
  // section) means replacing only this one handler's storage engine; every
  // caller just stores the URL this returns, so nothing else changes.
  @Post('image')
  @RequirePermissions('products.manage')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads',
        filename: (_req, file, cb) => {
          const unique = `${Date.now()}-${randomBytes(6).toString('hex')}`;
          cb(null, `${unique}${extname(file.originalname)}`);
        },
      }),
      limits: { fileSize: MAX_FILE_SIZE },
      fileFilter: (_req, file, cb) => {
        if (!ALLOWED_MIME_TYPES.test(file.mimetype)) {
          cb(
            new BadRequestException(
              'Only JPEG, PNG, WEBP, or GIF images are allowed',
            ),
            false,
          );
          return;
        }
        cb(null, true);
      },
    }),
  )
  uploadImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    const publicUrl =
      this.config.get<string>('PUBLIC_URL') ?? 'http://localhost:3000';
    return { url: `${publicUrl}/uploads/${file.filename}` };
  }
}
