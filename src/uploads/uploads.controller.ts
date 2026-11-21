import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { extname } from 'path';
import { randomBytes } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';

const ALLOWED_MIME_TYPES = /^image\/(jpeg|png|webp|gif)$/;
const MAX_FILE_SIZE = 1 * 1024 * 1024; // 1MB

@Controller('admin/uploads')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class UploadsController {
  constructor(private readonly config: ConfigService) {
    cloudinary.config({
      cloud_name: this.config.get<string>('CLOUDINARY_CLOUD_NAME'),
      api_key: this.config.get<string>('CLOUDINARY_API_KEY'),
      api_secret: this.config.get<string>('CLOUDINARY_API_SECRET'),
    });
  }

  // Storage backend picked by STORAGE_DRIVER ("local" | "cloudinary"),
  // defaulting to local disk — so a free-tier test deploy (no persistent
  // disk) just sets STORAGE_DRIVER=cloudinary in its own env, and the real
  // server keeps local disk, with no code to comment in/out before a push.
  // Multer parses into memory (not straight to disk) so one handler can
  // feed either branch; every caller still just stores the URL this
  // returns, so nothing else changes.
  @Post('image')
  @RequirePermissions('products.manage')
  @UseInterceptors(
    FileInterceptor('file', {
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
  async uploadImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    const driver = this.config.get<string>('STORAGE_DRIVER') ?? 'local';
    const url =
      driver === 'cloudinary'
        ? await this.uploadToCloudinary(file)
        : await this.uploadToLocalDisk(file);
    return { url };
  }

  private async uploadToLocalDisk(
    file: Express.Multer.File,
  ): Promise<string> {
    const unique = `${Date.now()}-${randomBytes(6).toString('hex')}`;
    const filename = `${unique}${extname(file.originalname)}`;
    await mkdir('./uploads', { recursive: true });
    await writeFile(`./uploads/${filename}`, file.buffer);
    const publicUrl =
      this.config.get<string>('PUBLIC_URL') ?? 'http://localhost:3000';
    return `${publicUrl}/uploads/${filename}`;
  }

  private uploadToCloudinary(file: Express.Multer.File): Promise<string> {
    const folder = this.config.get<string>('CLOUDINARY_FOLDER');
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder, resource_type: 'image' },
        (error: unknown, result?: UploadApiResponse) => {
          if (error || !result) {
            reject(
              error instanceof Error
                ? error
                : new Error('Cloudinary upload failed'),
            );
            return;
          }
          resolve(result.secure_url);
        },
      );
      stream.end(file.buffer);
    });
  }
}
