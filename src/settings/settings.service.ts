import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';

const KEY = 'general';

export interface GeneralSettings {
  businessName: string;
  phone: string;
  email: string;
  address: string;
  defaultLowStockThreshold: number;
}

const DEFAULTS: GeneralSettings = {
  businessName: '',
  phone: '',
  email: '',
  address: '',
  defaultLowStockThreshold: 10,
};

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<GeneralSettings> {
    const row = await this.prisma.setting.findUnique({ where: { key: KEY } });
    return { ...DEFAULTS, ...((row?.value as Partial<GeneralSettings>) ?? {}) };
  }

  async update(dto: UpdateSettingsDto): Promise<GeneralSettings> {
    const next = { ...(await this.get()), ...dto };
    await this.prisma.setting.upsert({
      where: { key: KEY },
      create: { key: KEY, value: next },
      update: { value: next },
    });
    return next;
  }
}
