import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import { randomBytes } from 'crypto';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { extname, join } from 'path';

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

  // Makes an independent physical copy of an uploaded image and returns
  // its new URL — used by ProductsService.duplicate() so the copy and the
  // original each own their own file. Without this, two products would
  // point at the exact same file, and deleting/replacing the image on
  // either one (deleteUploadedFile above has no reference counting) would
  // silently break the other's image too.
  // An arbitrary external URL (neither /uploads/ nor Cloudinary) is
  // returned unchanged — deleteUploadedFile already leaves those alone
  // too, so there's no shared-file risk to begin with.
  async duplicateUploadedFile(imageUrl: string): Promise<string> {
    const localMatch = imageUrl.match(/\/uploads\/([^/?#]+)$/);
    if (localMatch) {
      const sourcePath = join(process.cwd(), 'uploads', localMatch[1]);
      const buffer = await readFile(sourcePath);
      const unique = `${Date.now()}-${randomBytes(6).toString('hex')}`;
      const filename = `${unique}${extname(localMatch[1])}`;
      await mkdir('./uploads', { recursive: true });
      await writeFile(`./uploads/${filename}`, buffer);
      const publicUrl =
        this.config.get<string>('PUBLIC_URL') ?? 'http://localhost:3000';
      return `${publicUrl}/uploads/${filename}`;
    }

    const cloudinaryMatch = imageUrl.match(
      /res\.cloudinary\.com\/.+\/upload\/(?:v\d+\/)?(.+)\.[a-zA-Z0-9]+(?:[?#].*)?$/,
    );
    if (cloudinaryMatch) {
      const folder = this.config.get<string>('CLOUDINARY_FOLDER');
      const result = await cloudinary.uploader.upload(imageUrl, {
        folder,
        resource_type: 'image',
      });
      return result.secure_url;
    }

    return imageUrl;
  }
}
