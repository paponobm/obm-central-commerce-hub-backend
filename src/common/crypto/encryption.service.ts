import {
  Injectable,
  InternalServerErrorException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit nonce, the GCM-recommended size
const KEY_LENGTH = 32; // AES-256

// Encrypts/decrypts secrets (today: courier integration credentials)
// before they ever touch the database. Fails at boot, not on first use, if
// INTEGRATION_ENCRYPTION_KEY is missing or the wrong length — a bad key
// here means every stored secret becomes unrecoverable, so this should
// never surface as a runtime surprise deep in a request.
@Injectable()
export class EncryptionService implements OnModuleInit {
  private key!: Buffer;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const raw = this.config.getOrThrow<string>('INTEGRATION_ENCRYPTION_KEY');
    const key = Buffer.from(raw, 'base64');
    if (key.length !== KEY_LENGTH) {
      throw new Error(
        `INTEGRATION_ENCRYPTION_KEY must decode to ${KEY_LENGTH} bytes (base64 of crypto.randomBytes(32)), got ${key.length}`,
      );
    }
    this.key = key;
  }

  // Returns a compound "iv:authTag:ciphertext" string, each part base64.
  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return [
      iv.toString('base64'),
      authTag.toString('base64'),
      ciphertext.toString('base64'),
    ].join(':');
  }

  decrypt(blob: string): string {
    const [ivB64, authTagB64, ciphertextB64] = blob.split(':');
    if (!ivB64 || !authTagB64 || !ciphertextB64) {
      // Corrupt/foreign data, not a key mismatch — those surface from
      // decipher.final() below instead.
      throw new InternalServerErrorException(
        'Stored credential blob is malformed',
      );
    }
    const decipher = createDecipheriv(
      ALGORITHM,
      this.key,
      Buffer.from(ivB64, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextB64, 'base64')),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  }
}
