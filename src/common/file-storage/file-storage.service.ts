import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import { unlink } from 'fs/promises';
import { join } from 'path';

// Deletes an uploaded image from wherever it actually lives — this
// server's own /uploads/ directory, or Cloudinary — detected from the
// URL's own shape rather than the current STORAGE_DRIVER, since older
// records can still point at whichever backend was active when they were
// uploaded. Anything else (an arbitrary external URL) is left untouched.
// Best-effort either way: missing/already-gone files are silently
// ignored, never something that should fail the caller's own request.
// Shared by every module whose records hold an uploaded image URL
// (Product, Category, Brand, Channel, User) instead of each one
// reimplementing this.
@Injectable()
export class FileStorageService {
  constructor(private readonly config: ConfigService) {
    cloudinary.config({
      cloud_name: this.config.get<string>('CLOUDINARY_CLOUD_NAME'),
      api_key: this.config.get<string>('CLOUDINARY_API_KEY'),
      api_secret: this.config.get<string>('CLOUDINARY_API_SECRET'),
    });
  }

  deleteUploadedFile(imageUrl: string | null | undefined): void {
    if (!imageUrl) return;

    const localMatch = imageUrl.match(/\/uploads\/([^/?#]+)$/);
    if (localMatch) {
      const filePath = join(process.cwd(), 'uploads', localMatch[1]);
      unlink(filePath).catch(() => undefined);
      return;
    }

    // e.g. https://res.cloudinary.com/<cloud>/image/upload/v169.../obm-
    // sourcing/abc123.png -> public_id "obm-sourcing/abc123".
    const cloudinaryMatch = imageUrl.match(
      /res\.cloudinary\.com\/.+\/upload\/(?:v\d+\/)?(.+)\.[a-zA-Z0-9]+(?:[?#].*)?$/,
    );
    if (cloudinaryMatch) {
      cloudinary.uploader.destroy(cloudinaryMatch[1]).catch(() => undefined);
    }
  }
}
